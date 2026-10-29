const { createApp } = require('./src/app');
const os = require('node:os');

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
});
