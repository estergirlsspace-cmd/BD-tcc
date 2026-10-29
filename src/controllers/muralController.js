const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { studentNoticeScope } = require('../utils/audience');
const { attachmentColumns, attachmentFrom } = require('../utils/arquivos');
const { requireRole, getRecordId, rejectUnknownFields } = require('./schoolController');

// Mural do aluno: avisos visíveis para ele com o estado pessoal (lido/salvo) de avisos_usuarios.
// A categoria e o público são derivados das colunas do aviso; nada disso é gravado.

const AUTHOR_FALLBACK = { gestao: 'Coordenação', professor: 'Professor(a)' };

function noticeCategory(notice) {
    if (notice.urgente === 1) return 'urgente';
    if (notice.tipo === 'evento') return 'eventos';
    if (notice.autor_perfil === 'gestao') return 'coordenacao';
    return 'turma';
}

function noticeAudience(notice) {
    if (notice.id_turma) return 'turma';
    if (notice.serie) return 'serie';
    if (notice.curso) return 'curso';
    return 'escola';
}

function toMuralItem(notice) {
    return {
        id_post: notice.id_post,
        titulo: notice.titulo,
        conteudo: notice.conteudo,
        tipo: notice.tipo,
        urgente: notice.urgente === 1,
        categoria: noticeCategory(notice),
        data_evento: notice.data_evento,
        criado_em: notice.criado_em,
        autor: {
            nome: notice.autor_nome || AUTHOR_FALLBACK[notice.autor_perfil] || 'Escola',
            perfil: notice.autor_perfil
        },
        publico: noticeAudience(notice),
        lido_em: notice.lido_em,
        salvo: notice.salvo_em !== null,
        anexo: attachmentFrom(notice)
    };
}

function getMural(user) {
    const scope = studentNoticeScope(user, 'p');
    if (!scope) return { nao_lidos: 0, avisos: [] };
    const avisos = database.prepare(`
        SELECT p.id_post, p.titulo, p.conteudo, p.tipo, p.urgente, p.data_evento, p.criado_em,
               p.id_turma, p.curso, p.serie,
               u.tipo_usuario AS autor_perfil, COALESCE(pr.nome, u.nome) AS autor_nome,
               au.lido_em, au.salvo_em, ${attachmentColumns('arq')}
        FROM posts_avisos p
        JOIN usuarios u ON u.id_usuario = p.id_usuario_autor
        LEFT JOIN professores pr ON pr.id_usuario = u.id_usuario
        LEFT JOIN arquivos arq ON arq.id_arquivo = p.id_arquivo
        LEFT JOIN avisos_usuarios au ON au.id_post = p.id_post AND au.id_usuario = ?
        WHERE ${scope.clause}
        ORDER BY p.urgente DESC, p.criado_em DESC, p.id_post DESC
    `).all(user.id_usuario, ...scope.params).map(toMuralItem);
    return {
        nao_lidos: avisos.filter((aviso) => aviso.lido_em === null).length,
        avisos
    };
}

// 404 (e não 403) para aviso fora do público do aluno: não revela que o aviso existe.
function assertVisible(user, postId) {
    const scope = studentNoticeScope(user, 'p');
    const visible = scope && database.prepare(
        `SELECT 1 FROM posts_avisos p WHERE p.id_post = ? AND ${scope.clause}`
    ).get(postId, ...scope.params);
    if (!visible) throw new ApiError(404, 'Aviso não encontrado.');
}

// Colunas de estado; o nome entra no SQL, por isso só estes dois valores são aceitos.
const STATE_COLUMNS = { lido_em: 'salvo_em', salvo_em: 'lido_em' };

function setState(user, postId, column) {
    if (!STATE_COLUMNS[column]) throw new Error(`Coluna de estado inválida: ${column}`);
    database.prepare(`
        INSERT INTO avisos_usuarios (id_post, id_usuario, ${column})
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (id_post, id_usuario)
            DO UPDATE SET ${column} = COALESCE(${column}, excluded.${column})
    `).run(postId, user.id_usuario);
    return database.prepare(
        `SELECT ${column} AS valor FROM avisos_usuarios WHERE id_post = ? AND id_usuario = ?`
    ).get(postId, user.id_usuario).valor;
}

// Desfaz um estado; se o outro também estiver vazio, a linha inteira é apagada.
function clearState(user, postId, column) {
    const other = STATE_COLUMNS[column];
    if (!other) throw new Error(`Coluna de estado inválida: ${column}`);
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(`
            DELETE FROM avisos_usuarios
            WHERE id_post = ? AND id_usuario = ? AND ${other} IS NULL
        `).run(postId, user.id_usuario);
        database.prepare(`
            UPDATE avisos_usuarios SET ${column} = NULL
            WHERE id_post = ? AND id_usuario = ?
        `).run(postId, user.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

function markAllAsRead(user) {
    const scope = studentNoticeScope(user, 'p');
    if (!scope) return 0;
    return Number(database.prepare(`
        INSERT INTO avisos_usuarios (id_post, id_usuario, lido_em)
        SELECT p.id_post, ?, CURRENT_TIMESTAMP FROM posts_avisos p
        WHERE ${scope.clause}
        ON CONFLICT (id_post, id_usuario)
            DO UPDATE SET lido_em = excluded.lido_em WHERE lido_em IS NULL
    `).run(user.id_usuario, ...scope.params).changes);
}

async function handleSaved(request, response, user, postId) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['salvo']);
    if (typeof body.salvo !== 'boolean') {
        throw new ApiError(400, 'Informe em "salvo" true ou false.');
    }
    assertVisible(user, postId);
    if (body.salvo) setState(user, postId, 'salvo_em');
    else clearState(user, postId, 'salvo_em');
    sendJson(response, 200, { salvo: body.salvo });
}

async function handleMuralRequest(request, response, user, parts) {
    requireRole(user, ['aluno']);
    const { method } = request;

    if (parts.length === 2) {
        if (method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        sendJson(response, 200, getMural(user));
        return;
    }

    if (parts.length === 3 && parts[2] === 'leitura') {
        if (method !== 'POST') throw new ApiError(405, 'Método não permitido.');
        sendJson(response, 200, { marcados: markAllAsRead(user) });
        return;
    }

    if (parts.length !== 4 || !['leitura', 'salvo'].includes(parts[3])) {
        throw new ApiError(404, 'Rota não encontrada.');
    }
    const postId = getRecordId(parts[2]);

    if (parts[3] === 'salvo') {
        if (method !== 'PUT') throw new ApiError(405, 'Método não permitido.');
        await handleSaved(request, response, user, postId);
        return;
    }

    if (method === 'PUT') {
        assertVisible(user, postId);
        sendJson(response, 200, { lido_em: setState(user, postId, 'lido_em') });
    } else if (method === 'DELETE') {
        assertVisible(user, postId);
        clearState(user, postId, 'lido_em');
        sendJson(response, 200, { lido_em: null });
    } else {
        throw new ApiError(405, 'Método não permitido.');
    }
}

module.exports = { handleMuralRequest };
