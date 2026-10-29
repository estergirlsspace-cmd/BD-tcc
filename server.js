const { createApp } = require('./src/app');
const os = require('node:os');
const database = require('./src/database');
const backup = require('./src/services/backup');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const server = createApp();

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT deve ser um número inteiro entre 1 e 65535.');
}

server.on('error', (error) => {
    console.error(`Não foi possível iniciar o servidor em ${HOST}:${PORT}: ${error.message}`);
    process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
    console.log(`C-Warning disponível em http://${HOST}:${PORT}/`);
    if (HOST === '0.0.0.0') {
        const addresses = Object.values(os.networkInterfaces())
            .flat()
            .filter((network) => network && network.family === 'IPv4' && !network.internal)
            .map((network) => network.address);
        for (const address of addresses) {
            console.log(`Acesso na rede local: http://${address}:${PORT}/`);
        }
    }
    // Backup diário às 03h de Brasília (CW_BACKUP=0 desliga).
    backup.start();
});

// Desligamento gracioso (o Docker/Dokploy manda SIGTERM no redeploy): para de aceitar conexões,
// espera as requisições em andamento (até 10 s), espera um backup em andamento, fecha o banco.
const SHUTDOWN_TIMEOUT_MS = 10 * 1000;
let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido: encerrando (até ${SHUTDOWN_TIMEOUT_MS / 1000} s).`);
    const closed = new Promise((resolve) => server.close(() => resolve(true)));
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    // Conexões keep-alive que ficarem ociosas depois de responder também são fechadas.
    const idleSweep = setInterval(() => server.closeIdleConnections?.(), 250);
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), SHUTDOWN_TIMEOUT_MS);
    });
    const finished = await Promise.race([closed, timeout]);
    clearInterval(idleSweep);
    clearTimeout(timer);
    if (!finished) {
        console.warn('Tempo esgotado: fechando conexões ainda abertas.');
        server.closeAllConnections?.();
    }
    try {
        await backup.stop();
        database.close();
    } catch (error) {
        console.error(`Erro ao fechar o banco: ${error.message}`);
        process.exit(1);
    }
    console.log('Servidor encerrado.');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
