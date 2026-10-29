// Restauração guiada de um backup do banco (ver "Backup e restauração" no README).
//
//   node scripts/restaurar-backup.js                         lista os backups disponíveis
//   node scripts/restaurar-backup.js <arquivo>               verifica o backup e mostra o plano
//   node scripts/restaurar-backup.js <arquivo> --confirmar   restaura (servidor PARADO!)
//
// A pasta de dados vem de DATA_DIR (ou --dir <pasta>); padrão: data/ do projeto. <arquivo> é o
// nome de um arquivo em <pasta>/backups (ex.: educacao-2026-10-28.sqlite) ou um caminho.
// Antes de substituir, o banco atual é guardado como educacao.antes-restauracao-<data>.sqlite.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const confirm = args.includes('--confirmar');
const dirIndex = args.indexOf('--dir');
const dataDirectory = path.resolve(dirIndex >= 0 ? args[dirIndex + 1] || '' :
    process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const positional = args.filter((arg, index) =>
    !arg.startsWith('--') && !(dirIndex >= 0 && index === dirIndex + 1));
const chosen = positional[0];

const databasePath = path.join(dataDirectory, 'educacao.sqlite');
const backupDirectory = path.join(dataDirectory, 'backups');
const SIDE_FILES = ['-journal', '-wal', '-shm'];

function fail(message) {
    console.error(`Erro: ${message}`);
    process.exit(1);
}

function integrity(filePath) {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
        const rows = db.prepare('PRAGMA integrity_check').all();
        const ok = rows.length === 1 && Object.values(rows[0])[0] === 'ok';
        const tables = db.prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        ).get().n;
        const hasUsers = db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'"
        ).get();
        return { ok: ok && Boolean(hasUsers), detalhe: ok ? `${tables} tabelas` : rows[0] };
    } finally {
        db.close();
    }
}

function list() {
    let names = [];
    try {
        names = fs.readdirSync(backupDirectory)
            .filter((name) => /^educacao-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().reverse();
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    console.log(`Pasta de backups: ${backupDirectory}`);
    if (!names.length) {
        console.log('Nenhum backup encontrado.');
        return;
    }
    for (const name of names) {
        const stat = fs.statSync(path.join(backupDirectory, name));
        console.log(`  ${name}  ${Math.round(stat.size / 1024)} KB`);
    }
    console.log('\nPara verificar um backup: node scripts/restaurar-backup.js <arquivo>');
}

if (!chosen) {
    list();
    process.exit(0);
}

const source = fs.existsSync(path.join(backupDirectory, chosen)) && !chosen.includes(path.sep)
    ? path.join(backupDirectory, chosen)
    : path.resolve(chosen);
if (!fs.existsSync(source)) fail(`backup não encontrado: ${chosen}`);
if (path.resolve(source) === path.resolve(databasePath)) fail('o backup não pode ser o próprio banco.');

let check;
try {
    check = integrity(source);
} catch (error) {
    fail(`não foi possível abrir o backup como SQLite (${error.message}).`);
}
if (!check.ok) fail(`backup com problema de integridade: ${JSON.stringify(check.detalhe)}`);
console.log(`Backup ${path.basename(source)}: íntegro (${check.detalhe}).`);

const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..*$/, '');
const safetyCopy = path.join(dataDirectory, `educacao.antes-restauracao-${stamp}.sqlite`);

if (!confirm) {
    console.log(`\nPlano:\n  1. guardar o banco atual em ${safetyCopy}` +
        `\n  2. substituir ${databasePath} pelo backup`);
    console.log('\nATENÇÃO: pare o servidor antes (no Dokploy, pare a aplicação).');
    console.log('Para restaurar de fato, rode de novo com --confirmar.');
    process.exit(0);
}

console.log('ATENÇÃO: o servidor precisa estar parado durante a restauração.');
fs.mkdirSync(dataDirectory, { recursive: true });

// 1. Cópia de segurança do banco atual (e de journal/WAL que existam, que não podem sobrar
//    ao lado do banco restaurado).
if (fs.existsSync(databasePath)) {
    fs.copyFileSync(databasePath, safetyCopy, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(safetyCopy, 0o600);
    console.log(`Banco atual guardado em ${path.basename(safetyCopy)}.`);
}
for (const suffix of SIDE_FILES) {
    if (fs.existsSync(databasePath + suffix)) {
        fs.renameSync(databasePath + suffix, safetyCopy + suffix);
    }
}

// 2. Copia para um temporário na mesma pasta e renomeia (troca atômica).
const tmpPath = `${databasePath}.restaurando`;
fs.copyFileSync(source, tmpPath);
fs.chmodSync(tmpPath, 0o600);
if (!integrity(tmpPath).ok) {
    fs.rmSync(tmpPath, { force: true });
    fail('a cópia do backup falhou na verificação; o banco atual não foi alterado.');
}
fs.renameSync(tmpPath, databasePath);
console.log(`Restaurado: ${databasePath} <- ${path.basename(source)}. Pode iniciar o servidor.`);
