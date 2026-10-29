const { createHash } = require('node:crypto');
const { createReadStream, statSync, writeFileSync } = require('node:fs');
const database = require('../database');
const { ApiError } = require('../errors');
const { sendJson } = require('../utils/http');
const { getRecordId } = require('./schoolController');
const arquivos = require('../utils/arquivos');

const ORPHAN_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Upload em corpo binário cru: Content-Type (application/pdf|image/jpeg|image/png) e
// X-Nome-Arquivo (nome original, URI-encoded). O tipo declarado só precisa ser um dos aceitos;
// o que vale é a assinatura do conteúdo.
async function uploadFile(request, response, user) {
    const declaredType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!arquivos.FILE_TYPES[declaredType]) {
        throw new ApiError(415, 'Envie um arquivo PDF, JPG ou PNG.');
    }
    const rawName = request.headers['x-nome-arquivo'];
    if (typeof rawName !== 'string' || !rawName.trim()) {
        throw new ApiError(400, 'Informe o nome do arquivo no cabeçalho X-Nome-Arquivo.');
    }
    arquivos.assertUploadQuota(user);

    const content = await arquivos.readUpload(request);
    const type = arquivos.detectFileType(content);
    if (!type) {
        throw new ApiError(415, 'O conteúdo não é um PDF, JPG ou PNG válido.');
    }
    const name = arquivos.sanitizeFileName(rawName, type);
    const sha256 = createHash('sha256').update(content).digest('hex');

    // Registro primeiro (o id define o caminho), conteúdo depois; se a gravação falhar, o
    // registro é desfeito. Tudo síncrono, sem await entre as duas etapas.
    const fileId = Number(database.prepare(`
        INSERT INTO arquivos (id_usuario, nome, tipo_mime, tamanho, sha256)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id_usuario, name, type, content.length, sha256).lastInsertRowid);
    try {
        arquivos.ensureDirectory();
        writeFileSync(arquivos.storagePath(fileId), content, { mode: 0o600, flag: 'wx' });
    } catch (error) {
        database.prepare('DELETE FROM arquivos WHERE id_arquivo = ?').run(fileId);
        throw error;
    }
    sendJson(response, 201, { id_arquivo: fileId, nome: name, tipo_mime: type, tamanho: content.length });
}

// filename (ASCII, para clientes antigos) + filename* (UTF-8, RFC 6266/5987).
function contentDisposition(name) {
    const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\x20-\x7e]|["\\]/g, '_');
    const encoded = encodeURIComponent(name)
        .replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function downloadFile(response, user, fileId) {
    const file = database.prepare(
        'SELECT id_arquivo, id_usuario, nome, tipo_mime, tamanho FROM arquivos WHERE id_arquivo = ?'
    ).get(fileId);
    // 404 também quando não há permissão: não revela que o arquivo existe.
    if (!file || !arquivos.canReadFile(user, file)) {
        throw new ApiError(404, 'Arquivo não encontrado.');
    }
    const filePath = arquivos.storagePath(file.id_arquivo);
    let size;
    try {
        size = statSync(filePath).size;
    } catch {
        throw new ApiError(404, 'Arquivo não encontrado.');
    }
    response.writeHead(200, {
        'Content-Type': file.tipo_mime,
        'Content-Length': size,
        'Content-Disposition': contentDisposition(file.nome),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        'Cache-Control': 'private, no-store'
    });
    createReadStream(filePath)
        .on('error', (error) => response.destroy(error))
        .pipe(response);
}

async function handleArquivosRequest(request, response, user, parts) {
    if (parts.length === 2) {
        if (request.method !== 'POST') throw new ApiError(405, 'Método não permitido.');
        await uploadFile(request, response, user);
        return;
    }
    if (parts.length === 3) {
        if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        downloadFile(response, user, getRecordId(parts[2]));
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

// Limpeza de arquivos órfãos na primeira carga do módulo (início do servidor) e uma vez por dia.
function sweepOrphanFiles() {
    try {
        const result = arquivos.cleanOrphanFiles();
        if (result.removidos || result.sem_registro) {
            console.log(`Arquivos órfãos removidos: ${result.removidos + result.sem_registro}.`);
        }
    } catch (error) {
        console.error('Falha na limpeza de arquivos órfãos:', error.message);
    }
}
sweepOrphanFiles();
setInterval(sweepOrphanFiles, ORPHAN_SWEEP_INTERVAL_MS).unref();

module.exports = { handleArquivosRequest, sweepOrphanFiles };
