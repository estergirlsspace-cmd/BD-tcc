const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { studentNoticeScope, teacherNoticeScope } = require('../utils/audience');
const { requireRole, getRecordId, positiveId, rejectUnknownFields } = require('./schoolController');
const { clearState, AUTHOR_FALLBACK } = require('./muralController');

// Pastas pessoais e avisos salvos (aluno, professor e gestão). O estado "salvo" fica em
// avisos_usuarios (salvo_em + id_pasta), o mesmo usado pelo mural do aluno.

const ROLES = ['aluno', 'professor', 'gestao'];
const FOLDER_NAME_MAX = 40;
const MAX_FOLDERS = 30;

// Avisos que a pessoa pode ver; null quando não vê nenhum (aluno sem turma).
function noticeScope(user, alias = 'p') {
    if (user.tipo_usuario === 'aluno') return studentNoticeScope(user, alias);
    if (user.tipo_usuario === 'professor') return teacherNoticeScope(user, alias);
    return { clause: '1 = 1', params: [] };
}

// 404 (e não 403) fora do escopo: não revela que o aviso existe.
function assertVisible(user, postId) {
    const scope = noticeScope(user);
    const visible = scope && database.prepare(
        `SELECT 1 FROM posts_avisos p WHERE p.id_post = ? AND ${scope.clause}`
    ).get(postId, ...scope.params);
    if (!visible) throw new ApiError(404, 'Aviso não encontrado.');
}

function ownFolder(user, folderId) {
    const folder = database.prepare(
        'SELECT id_pasta, nome FROM pastas WHERE id_pasta = ? AND id_usuario = ?'
    ).get(folderId, user.id_usuario);
    if (!folder) throw new ApiError(404, 'Pasta não encontrada.');
    return folder;
}

function folderName(value) {
    if (typeof value !== 'string') throw new ApiError(400, 'Informe o nome da pasta.');
    const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
        .replace(/\s+/g, ' ').trim();
    const length = Array.from(name).length;
    if (length < 1 || length > FOLDER_NAME_MAX) {
        throw new ApiError(400, `O nome da pasta deve ter de 1 a ${FOLDER_NAME_MAX} caracteres.`);
    }
    return name;
}

function assertNameFree(user, name, exceptId = 0) {
    if (database.prepare(`
        SELECT 1 FROM pastas WHERE id_usuario = ? AND lower(nome) = lower(?) AND id_pasta <> ?
    `).get(user.id_usuario, name, exceptId)) {
        throw new ApiError(409, 'Você já tem uma pasta com esse nome.');
    }
}

// Total de avisos salvos e visíveis em cada pasta da pessoa.
function listFolders(user, folderId = null) {
    const scope = noticeScope(user);
    const visible = scope
        ? { clause: scope.clause, params: scope.params }
        : { clause: '0 = 1', params: [] };
    return database.prepare(`
        SELECT f.id_pasta, f.nome, (
            SELECT COUNT(*) FROM avisos_usuarios au
            JOIN posts_avisos p ON p.id_post = au.id_post
            WHERE au.id_usuario = f.id_usuario AND au.id_pasta = f.id_pasta
              AND au.salvo_em IS NOT NULL AND ${visible.clause}
        ) AS total
        FROM pastas f
        WHERE f.id_usuario = ? AND (? IS NULL OR f.id_pasta = ?)
        ORDER BY f.nome COLLATE NOCASE, f.id_pasta
    `).all(...visible.params, user.id_usuario, folderId, folderId);
}

async function createFolder(request, response, user) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['nome']);
    const name = folderName(body.nome);
    database.exec('BEGIN IMMEDIATE');
    let folderId;
    try {
        const { n } = database.prepare('SELECT COUNT(*) AS n FROM pastas WHERE id_usuario = ?')
            .get(user.id_usuario);
        if (n >= MAX_FOLDERS) throw new ApiError(400, `Você pode ter no máximo ${MAX_FOLDERS} pastas.`);
        assertNameFree(user, name);
        folderId = Number(database.prepare('INSERT INTO pastas (id_usuario, nome) VALUES (?, ?)')
            .run(user.id_usuario, name).lastInsertRowid);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    sendJson(response, 201, { id_pasta: folderId, nome: name, total: 0 });
}

async function renameFolder(request, response, user, folderId) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['nome']);
    const name = folderName(body.nome);
    ownFolder(user, folderId);
    assertNameFree(user, name, folderId);
    database.prepare('UPDATE pastas SET nome = ? WHERE id_pasta = ? AND id_usuario = ?')
        .run(name, folderId, user.id_usuario);
    sendJson(response, 200, listFolders(user, folderId)[0]);
}

// Os avisos da pasta continuam salvos, sem pasta.
function deleteFolder(response, user, folderId) {
    ownFolder(user, folderId);
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare('UPDATE avisos_usuarios SET id_pasta = NULL WHERE id_usuario = ? AND id_pasta = ?')
            .run(user.id_usuario, folderId);
        database.prepare('DELETE FROM pastas WHERE id_pasta = ? AND id_usuario = ?')
            .run(folderId, user.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    sendJson(response, 200, { removida: true });
}

function listSaved(user, searchParams) {
    const folderParam = searchParams.get('id_pasta');
    const withoutFolder = searchParams.get('sem_pasta');
    if (folderParam !== null && withoutFolder !== null) {
        throw new ApiError(400, 'Use "id_pasta" ou "sem_pasta", não os dois.');
    }
    if (withoutFolder !== null && withoutFolder !== '1') {
        throw new ApiError(400, 'Use "sem_pasta=1" para listar os avisos sem pasta.');
    }
    let filter = '';
    const filterParams = [];
    if (folderParam !== null) {
        const folderId = getRecordId(folderParam);
        ownFolder(user, folderId);
        filter = 'AND au.id_pasta = ?';
        filterParams.push(folderId);
    } else if (withoutFolder === '1') {
        filter = 'AND au.id_pasta IS NULL';
    }
    const scope = noticeScope(user);
    if (!scope) return [];
    return database.prepare(`
        SELECT p.id_post, p.titulo, p.tipo, p.urgente, p.criado_em,
               u.tipo_usuario AS autor_perfil, COALESCE(pr.nome, u.nome) AS autor_nome,
               au.id_pasta, au.salvo_em
        FROM avisos_usuarios au
        JOIN posts_avisos p ON p.id_post = au.id_post
        JOIN usuarios u ON u.id_usuario = p.id_usuario_autor
        LEFT JOIN professores pr ON pr.id_usuario = u.id_usuario
        WHERE au.id_usuario = ? AND au.salvo_em IS NOT NULL ${filter} AND ${scope.clause}
        ORDER BY au.salvo_em DESC, p.id_post DESC
    `).all(user.id_usuario, ...filterParams, ...scope.params).map((row) => ({
        id_post: row.id_post,
        titulo: row.titulo,
        tipo: row.tipo,
        urgente: row.urgente === 1,
        criado_em: row.criado_em,
        autor: {
            nome: row.autor_nome || AUTHOR_FALLBACK[row.autor_perfil] || 'Escola',
            perfil: row.autor_perfil
        },
        id_pasta: row.id_pasta,
        salvo_em: row.salvo_em
    }));
}

// Salva o aviso (ou só o move de pasta, mantendo a data em que foi salvo).
async function saveNotice(request, response, user, postId) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['id_pasta']);
    const folderId = body.id_pasta === undefined || body.id_pasta === null
        ? null : positiveId(body.id_pasta, 'id_pasta');
    assertVisible(user, postId);
    if (folderId !== null) ownFolder(user, folderId);
    database.prepare(`
        INSERT INTO avisos_usuarios (id_post, id_usuario, salvo_em, id_pasta)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT (id_post, id_usuario) DO UPDATE SET
            salvo_em = COALESCE(salvo_em, excluded.salvo_em), id_pasta = excluded.id_pasta
    `).run(postId, user.id_usuario, folderId);
    const { salvo_em: savedAt } = database.prepare(
        'SELECT salvo_em FROM avisos_usuarios WHERE id_post = ? AND id_usuario = ?'
    ).get(postId, user.id_usuario);
    sendJson(response, 200, { id_post: postId, salvo: true, id_pasta: folderId, salvo_em: savedAt });
}

function unsaveNotice(response, user, postId) {
    assertVisible(user, postId);
    clearState(user, postId, 'salvo_em');
    sendJson(response, 200, { id_post: postId, salvo: false });
}

async function handlePastasRequest(request, response, user, parts) {
    requireRole(user, ROLES);
    const { method } = request;
    if (parts.length === 2) {
        if (method === 'GET') sendJson(response, 200, listFolders(user));
        else if (method === 'POST') await createFolder(request, response, user);
        else throw new ApiError(405, 'Método não permitido.');
        return;
    }
    if (parts.length !== 3) throw new ApiError(404, 'Rota não encontrada.');
    const folderId = getRecordId(parts[2]);
    if (method === 'PATCH') await renameFolder(request, response, user, folderId);
    else if (method === 'DELETE') deleteFolder(response, user, folderId);
    else throw new ApiError(405, 'Método não permitido.');
}

async function handleSalvosRequest(request, response, user, parts, searchParams) {
    requireRole(user, ROLES);
    const { method } = request;
    if (parts.length === 2) {
        if (method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        sendJson(response, 200, listSaved(user, searchParams));
        return;
    }
    if (parts.length !== 3) throw new ApiError(404, 'Rota não encontrada.');
    const postId = getRecordId(parts[2]);
    if (method === 'PUT') await saveNotice(request, response, user, postId);
    else if (method === 'DELETE') unsaveNotice(response, user, postId);
    else throw new ApiError(405, 'Método não permitido.');
}

module.exports = { handlePastasRequest, handleSalvosRequest };
