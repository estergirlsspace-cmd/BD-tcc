// Backup diário do banco SQLite, dentro do processo do servidor, no horário de Brasília.
// - Usa a API de backup online do node:sqlite (sqlite3_backup_*): copia o banco em uso, página
//   por página, em etapas assíncronas, sem parar as requisições; escritas feitas pela mesma
//   conexão durante a cópia entram no backup, então o arquivo final é consistente.
// - Arquivo do dia: DATA_DIR/backups/educacao-AAAA-MM-DD.sqlite (o nome garante idempotência:
//   se o arquivo do dia existe, não roda de novo). Grava num .tmp, confere a integridade
//   (PRAGMA integrity_check, abrindo só leitura), aplica permissão 600 e só então renomeia.
// - Retenção: os 7 backups mais recentes + os 4 domingos mais recentes.
// - CW_BACKUP=0 desliga o agendamento (testes e scripts). runBackup() roda sob demanda.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const sqlite = require('node:sqlite');
const database = require('../database');
const { SCHOOL_UTC_OFFSET_HOURS } = require('../utils/dates');

const BACKUP_HOUR = 3; // 03h de Brasília
const TICK_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 60 * 1000;
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4; // domingos
const PAGES_PER_STEP = 256; // cada etapa segura o banco por pouco tempo
const FILE_PATTERN = /^educacao-(\d{4})-(\d{2})-(\d{2})\.sqlite$/;

const pad = (value) => String(value).padStart(2, '0');

function databasePath() {
    if (typeof database.location === 'function') {
        const location = database.location();
        if (location) return location;
    }
    const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
    return path.join(dataDirectory, 'educacao.sqlite');
}

function backupDirectory() {
    return path.join(path.dirname(databasePath()), 'backups');
}

function schoolParts(ms) {
    const date = new Date(ms + SCHOOL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    return {
        date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        hour: date.getUTCHours()
    };
}

function backupFileName(dateString) {
    return `educacao-${dateString}.sqlite`;
}

// Backups válidos na pasta, do mais recente para o mais antigo.
function listBackups(directory = backupDirectory()) {
    let names;
    try {
        names = fs.readdirSync(directory);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    return names
        .map((name) => {
            const match = FILE_PATTERN.exec(name);
            if (!match) return null;
            const [, year, month, day] = match.map(Number);
            const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            return { name, date: `${match[1]}-${match[2]}-${match[3]}`, sunday: weekday === 0 };
        })
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date));
}

// Mantém os KEEP_DAILY mais recentes e os KEEP_WEEKLY domingos mais recentes; apaga o resto e
// arquivos temporários esquecidos por uma execução interrompida. Devolve os nomes apagados.
function applyRetention(directory = backupDirectory()) {
    const backups = listBackups(directory);
    const keep = new Set(backups.slice(0, KEEP_DAILY).map((item) => item.name));
    for (const item of backups.filter((b) => b.sunday).slice(0, KEEP_WEEKLY)) keep.add(item.name);
    const removed = [];
    for (const item of backups) {
        if (keep.has(item.name)) continue;
        fs.rmSync(path.join(directory, item.name), { force: true });
        removed.push(item.name);
    }
    for (const name of fs.readdirSync(directory)) {
        if (/^educacao-.*\.sqlite\.tmp(-journal|-wal|-shm)?$/.test(name)) {
            fs.rmSync(path.join(directory, name), { force: true });
        }
    }
    return removed;
}

// Abre o arquivo só leitura e roda PRAGMA integrity_check. Devolve true se "ok".
function checkIntegrity(filePath) {
    const db = new sqlite.DatabaseSync(filePath, { readOnly: true });
    try {
        const rows = db.prepare('PRAGMA integrity_check').all();
        return rows.length === 1 && Object.values(rows[0])[0] === 'ok';
    } finally {
        db.close();
    }
}

let current = null; // promessa do backup em andamento

// Gera o backup do dia (no horário de Brasília). Com { force: true } refaz mesmo se já existir.
// Devolve { status: 'ok' | 'existente' | 'falhou', arquivo, paginas?, ms?, removidos? }.
function runBackup({ now = Date.now(), force = false } = {}) {
    if (current) return current;
    current = doBackup(now, force).finally(() => {
        current = null;
    });
    return current;
}

async function doBackup(now, force) {
    const directory = backupDirectory();
    const fileName = backupFileName(schoolParts(now).date);
    const finalPath = path.join(directory, fileName);
    if (!force && fs.existsSync(finalPath)) {
        return { status: 'existente', arquivo: fileName };
    }
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const tmpPath = `${finalPath}.tmp`;
    await fsp.rm(tmpPath, { force: true });
    const started = Date.now();
    try {
        const pages = await sqlite.backup(database, tmpPath, { rate: PAGES_PER_STEP });
        await fsp.chmod(tmpPath, 0o600);
        if (!checkIntegrity(tmpPath)) {
            await fsp.rm(tmpPath, { force: true });
            console.error(`[backup] ${fileName}: falhou na verificação de integridade; descartado.`);
            return { status: 'falhou', arquivo: fileName };
        }
        await fsp.rename(tmpPath, finalPath);
        const removed = applyRetention(directory);
        const ms = Date.now() - started;
        const sizeKb = Math.round(fs.statSync(finalPath).size / 1024);
        console.log(`[backup] ${fileName} gerado (${sizeKb} KB, ${ms} ms)` +
            (removed.length ? `; retenção removeu ${removed.length}` : ''));
        return { status: 'ok', arquivo: fileName, paginas: pages, ms, removidos: removed };
    } catch (error) {
        await fsp.rm(tmpPath, { force: true }).catch(() => {});
        console.error(`[backup] ${fileName}: erro ${error.code || error.name}: ${error.message}`);
        return { status: 'falhou', arquivo: fileName };
    }
}

// Roda o backup do dia a partir das 03h de Brasília. Se ainda não há nenhum backup (instalação
// nova), roda já, mesmo antes das 03h, para não ficar um dia inteiro sem cópia.
function tick(now = Date.now()) {
    const { hour } = schoolParts(now);
    if (hour < BACKUP_HOUR && listBackups().length > 0) return Promise.resolve(null);
    return runBackup({ now });
}

const timers = [];

function start() {
    if (timers.length || process.env.CW_BACKUP === '0') return;
    const safeTick = () => tick().catch((error) => {
        console.error(`[backup] erro na rodada: ${error.name}: ${error.message}`);
    });
    timers.push(setTimeout(safeTick, FIRST_TICK_DELAY_MS).unref());
    timers.push(setInterval(safeTick, TICK_INTERVAL_MS).unref());
}

// Para os timers e espera o backup em andamento terminar (usado no desligamento).
async function stop() {
    while (timers.length) clearTimeout(timers.pop());
    if (current) await current.catch(() => {});
}

module.exports = {
    start,
    stop,
    tick,
    runBackup,
    applyRetention,
    listBackups,
    checkIntegrity,
    backupDirectory,
    databasePath,
    FILE_PATTERN
};
