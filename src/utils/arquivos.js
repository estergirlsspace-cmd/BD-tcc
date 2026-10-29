const { mkdirSync, readdirSync, unlinkSync } = require('node:fs');
const path = require('node:path');
const database = require('../database');
const { ApiError } = require('../errors');
const { studentNoticeScope, teacherNoticeScope } = require('./audience');

// Arquivos enviados (PDF, JPG, PNG até 5 MB). Os metadados ficam na tabela `arquivos`; o conteúdo
// fica em DATA_DIR/arquivos/<id_arquivo>. O caminho em disco é derivado só do id inteiro — o nome
// enviado pelo usuário nunca chega ao sistema de arquivos.

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const ORPHAN_HOURS = 24;
// Arquivos enviados e ainda não vinculados por pessoa nas últimas 24 h (evita encher o disco).
const MAX_PENDING_PER_USER = 10;

const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILES_DIRECTORY = path.join(dataDirectory, 'arquivos');

// Assinatura (magic bytes) de cada tipo aceito. O tipo gravado é sempre o detectado no conteúdo.
const FILE_TYPES = {
    'application/pdf': { signature: Buffer.from('%PDF-', 'latin1'), extensions: ['.pdf'] },
    'image/jpeg': { signature: Buffer.from([0xff, 0xd8, 0xff]), extensions: ['.jpg', '.jpeg'] },
    'image/png': {
        signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        extensions: ['.png']
    }
};

// Arquivo sem vínculo: não é anexo de aviso nem atestado de justificativa.
const UNLINKED = `NOT EXISTS (SELECT 1 FROM posts_avisos WHERE id_arquivo = arq.id_arquivo)
    AND NOT EXISTS (SELECT 1 FROM justificativas WHERE id_arquivo = arq.id_arquivo)`;

function ensureDirectory() {
    mkdirSync(FILES_DIRECTORY, { recursive: true, mode: 0o700 });
}

function storagePath(fileId) {
    if (!Number.isSafeInteger(fileId) || fileId < 1) {
        throw new Error(`Identificador de arquivo inválido: ${fileId}`);
    }
    return path.join(FILES_DIRECTORY, String(fileId));
}

function detectFileType(buffer) {
    return Object.keys(FILE_TYPES).find((type) => {
        const { signature } = FILE_TYPES[type];
        return buffer.length > signature.length && buffer.subarray(0, signature.length).equals(signature);
    }) || null;
}

// Nome exibido e usado no download: sem caracteres de controle, de direção de texto (que
// disfarçam extensões), separadores de caminho ou reservados do Windows, com no máximo 120
// caracteres e sempre com a extensão do tipo real (um "nota.exe" com conteúdo PDF vira "nota.exe.pdf").
function sanitizeFileName(rawName, type) {
    let name;
    try {
        name = decodeURIComponent(String(rawName || ''));
    } catch {
        throw new ApiError(400, 'O cabeçalho X-Nome-Arquivo deve estar codificado como URI.');
    }
    name = name.normalize('NFC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
        .replace(/[/\\<>:"|?*]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.]+|[\s.]+$/g, '');
    const { extensions } = FILE_TYPES[type];
    const extension = path.extname(name).toLowerCase();
    const keepsExtension = extensions.includes(extension);
    const base = keepsExtension ? name.slice(0, -extension.length) : name;
    const shortBase = Array.from(base).slice(0, MAX_NAME_LENGTH - 5).join('').trim() || 'arquivo';
    return shortBase + (keepsExtension ? extension : extensions[0]);
}

// Lê o corpo binário cru com limite de 5 MB (413 acima disso).
async function readUpload(request) {
    const declaredLength = Number(request.headers['content-length']);
    if (declaredLength > MAX_FILE_SIZE) {
        throw new ApiError(413, 'O arquivo excede o limite de 5 MB.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_FILE_SIZE) throw new ApiError(413, 'O arquivo excede o limite de 5 MB.');
        chunks.push(chunk);
    }
    if (!size) throw new ApiError(400, 'Envie o conteúdo do arquivo no corpo da requisição.');
    return Buffer.concat(chunks, size);
}

// Uploads em andamento por pessoa (em memória). A cota é reservada de forma síncrona antes de ler
// o corpo, então envios simultâneos não passam do limite de pendentes.
const MAX_CONCURRENT_UPLOADS = 2;
const uploadsInProgress = new Map();

// Reserva a vaga do upload e devolve a função que a libera (chamar sempre, no finally, depois de
// gravar o registro em `arquivos`).
function reserveUpload(user) {
    const inProgress = uploadsInProgress.get(user.id_usuario) || 0;
    if (inProgress >= MAX_CONCURRENT_UPLOADS) {
        throw new ApiError(429, 'Aguarde terminar o envio em andamento antes de mandar outro arquivo.');
    }
    const pending = database.prepare(`
        SELECT COUNT(*) AS n FROM arquivos arq
        WHERE arq.id_usuario = ? AND arq.criado_em >= datetime('now', '-${ORPHAN_HOURS} hours')
          AND ${UNLINKED}
    `).get(user.id_usuario).n;
    if (pending + inProgress >= MAX_PENDING_PER_USER) {
        throw new ApiError(429,
            'Você tem muitos arquivos enviados e ainda não usados. Use-os ou aguarde 24 horas.');
    }
    uploadsInProgress.set(user.id_usuario, inProgress + 1);
    let released = false;
    return function releaseUpload() {
        if (released) return;
        released = true;
        const remaining = (uploadsInProgress.get(user.id_usuario) || 1) - 1;
        if (remaining > 0) uploadsInProgress.set(user.id_usuario, remaining);
        else uploadsInProgress.delete(user.id_usuario);
    };
}

// Metadados públicos de um arquivo; `row` traz as colunas com o prefixo indicado.
function publicFile(row, prefix = '') {
    const id = row[`${prefix}id_arquivo`];
    if (!id) return null;
    return {
        id_arquivo: id,
        nome: row[`${prefix}nome`],
        tipo_mime: row[`${prefix}tipo_mime`],
        tamanho: row[`${prefix}tamanho`]
    };
}

// Colunas de anexo para um LEFT JOIN em `arquivos` com o alias informado (prefixo "anexo_").
function attachmentColumns(alias) {
    return `${alias}.id_arquivo AS anexo_id_arquivo, ${alias}.nome AS anexo_nome,
        ${alias}.tipo_mime AS anexo_tipo_mime, ${alias}.tamanho AS anexo_tamanho`;
}

function attachmentFrom(row) {
    const anexo = publicFile(row, 'anexo_');
    for (const key of ['id_arquivo', 'nome', 'tipo_mime', 'tamanho']) delete row[`anexo_${key}`];
    return anexo;
}

// Só se vincula arquivo enviado pela própria pessoa. `currentId` permite manter o anexo atual
// ao editar um registro de outro autor (ex.: a gestão editando aviso de um professor).
function assertOwnFile(user, fileId, currentId = null) {
    if (fileId === null || fileId === undefined || fileId === currentId) return;
    const file = database.prepare('SELECT id_usuario FROM arquivos WHERE id_arquivo = ?').get(fileId);
    if (!file || file.id_usuario !== user.id_usuario) {
        throw new ApiError(400, 'O anexo informado não está entre os arquivos que você enviou.');
    }
}

// Quem pode baixar: quem enviou; a gestão; quem pode ver o aviso do qual é anexo; e, se for
// atestado de justificativa, só o aluno dono (além da gestão) — o professor não vê atestados.
function canReadFile(user, file) {
    if (file.id_usuario === user.id_usuario || user.tipo_usuario === 'gestao') return true;

    const noticeScope = user.tipo_usuario === 'aluno'
        ? studentNoticeScope(user, 'p')
        : user.tipo_usuario === 'professor' ? teacherNoticeScope(user, 'p') : null;
    if (noticeScope && database.prepare(
        `SELECT 1 FROM posts_avisos p WHERE p.id_arquivo = ? AND ${noticeScope.clause}`
    ).get(file.id_arquivo, ...noticeScope.params)) {
        return true;
    }

    if (user.tipo_usuario === 'aluno') {
        return Boolean(user.id_aluno && database.prepare(
            'SELECT 1 FROM justificativas WHERE id_arquivo = ? AND id_aluno = ?'
        ).get(file.id_arquivo, user.id_aluno));
    }
    return false;
}

function unlinkQuietly(filePath) {
    try {
        unlinkSync(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') console.error(`Não foi possível apagar ${filePath}: ${error.code}`);
    }
}

// Apaga arquivos enviados há mais de 24 h e nunca vinculados (ou cujo vínculo foi desfeito) e
// conteúdos em disco sem registro no banco. Tudo síncrono: não intercala com um upload em curso.
function cleanOrphanFiles() {
    ensureDirectory();
    const orphans = database.prepare(`
        SELECT arq.id_arquivo FROM arquivos arq
        WHERE arq.criado_em < datetime('now', '-${ORPHAN_HOURS} hours') AND ${UNLINKED}
    `).all();
    const remove = database.prepare('DELETE FROM arquivos WHERE id_arquivo = ?');
    for (const { id_arquivo: fileId } of orphans) {
        remove.run(fileId);
        unlinkQuietly(storagePath(fileId));
    }

    const known = new Set(database.prepare('SELECT id_arquivo FROM arquivos').all()
        .map((row) => String(row.id_arquivo)));
    let strays = 0;
    for (const entry of readdirSync(FILES_DIRECTORY, { withFileTypes: true })) {
        if (entry.isFile() && !known.has(entry.name)) {
            unlinkQuietly(path.join(FILES_DIRECTORY, entry.name));
            strays += 1;
        }
    }
    return { removidos: orphans.length, sem_registro: strays };
}

module.exports = {
    FILE_TYPES,
    ensureDirectory,
    storagePath,
    detectFileType,
    sanitizeFileName,
    readUpload,
    reserveUpload,
    publicFile,
    attachmentColumns,
    attachmentFrom,
    assertOwnFile,
    canReadFile,
    cleanOrphanFiles
};
