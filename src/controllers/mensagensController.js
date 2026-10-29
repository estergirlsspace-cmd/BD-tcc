const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const notificacoes = require('../services/notificacoes');

// Conversas 1:1 entre aluno, professor e gestão.
// Quem pode falar com quem: aluno → professores das disciplinas da turma e gestão;
// professor → alunos das suas turmas e gestão; gestão → todos.

const MAX_TEXT_LENGTH = 2000;
const MAX_MESSAGES_PER_MINUTE = 30;
const PAGE_SIZE = 100;
const STAFF_DETAIL = 'Coordenação';

const sentPerUser = new Map();

function assertSendRate(userId) {
    const now = Date.now();
    if (sentPerUser.size > 10000) {
        for (const [id, times] of sentPerUser) {
            if (!times.some((time) => now - time < 60000)) sentPerUser.delete(id);
        }
    }
    const recent = (sentPerUser.get(userId) || []).filter((time) => now - time < 60000);
    if (recent.length >= MAX_MESSAGES_PER_MINUTE) {
        sentPerUser.set(userId, recent);
        throw new ApiError(429, 'Você enviou muitas mensagens em pouco tempo. Aguarde 1 minuto.');
    }
    recent.push(now);
    sentPerUser.set(userId, recent);
}

function parseId(value, field) {
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) value = Number(value);
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new ApiError(400, `Informe um identificador válido em "${field}".`);
    }
    return value;
}

// Dados públicos de uma pessoa para a lista de contatos/conversas.
const PERSON_COLUMNS = `
    u.id_usuario, u.tipo_usuario AS perfil,
    COALESCE(a.nome, p.nome, u.nome, u.login) AS nome,
    t.nome_turma, p.id_professor, p.area`;
const PERSON_JOINS = `
    LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
    LEFT JOIN turmas t ON t.id_turma = a.id_turma
    LEFT JOIN professores p ON p.id_usuario = u.id_usuario`;

const AREA_LABEL = {
    natureza: 'Ciências da Natureza', humanas: 'Ciências Humanas', linguagens: 'Linguagens',
    matematica: 'Matemática', informatica: 'Informática', redes: 'Redes'
};

// Detalhe exibido abaixo do nome: turma do aluno; disciplinas do professor (na turma de quem
// vê, se for aluno); "Coordenação" para a gestão.
function personDetail(person, viewer) {
    if (person.perfil === 'aluno') return person.nome_turma || 'Aluno(a)';
    if (person.perfil === 'gestao') return STAFF_DETAIL;
    const disciplines = database.prepare(`
        SELECT DISTINCT nome_disciplina FROM disciplinas
        WHERE id_professor = ? AND (? IS NULL OR id_turma = ?)
        ORDER BY nome_disciplina
    `).all(person.id_professor, viewer.id_turma ?? null, viewer.id_turma ?? null)
        .map((row) => row.nome_disciplina);
    if (disciplines.length) return disciplines.slice(0, 3).join(', ')
        + (disciplines.length > 3 ? '…' : '');
    return AREA_LABEL[person.area] || 'Professor(a)';
}

function toContact(person, viewer) {
    return {
        id_usuario: person.id_usuario,
        nome: person.nome,
        perfil: person.perfil,
        detalhe: personDetail(person, viewer)
    };
}

function listContactRows(user) {
    const base = `SELECT ${PERSON_COLUMNS} FROM usuarios u ${PERSON_JOINS}
        WHERE u.ativo = 1 AND u.id_usuario != ? AND u.login NOT GLOB '__aluno_compartilhado_*'`;
    const order = `ORDER BY CASE u.tipo_usuario WHEN 'gestao' THEN 0 WHEN 'professor' THEN 1 ELSE 2 END,
        nome COLLATE NOCASE`;
    if (user.tipo_usuario === 'gestao') {
        return database.prepare(`${base} ${order}`).all(user.id_usuario);
    }
    if (user.tipo_usuario === 'professor') {
        return database.prepare(`${base}
            AND (u.tipo_usuario = 'gestao'
                 OR (u.tipo_usuario = 'aluno' AND a.id_turma IN (
                     SELECT id_turma FROM disciplinas WHERE id_professor = ?)))
            ${order}`).all(user.id_usuario, user.id_professor ?? -1);
    }
    if (user.tipo_usuario === 'aluno' && user.id_turma) {
        return database.prepare(`${base}
            AND (u.tipo_usuario = 'gestao'
                 OR (u.tipo_usuario = 'professor' AND p.id_professor IN (
                     SELECT id_professor FROM disciplinas
                     WHERE id_turma = ? AND id_professor IS NOT NULL)))
            ${order}`).all(user.id_usuario, user.id_turma);
    }
    return database.prepare(`${base} AND u.tipo_usuario = 'gestao' ${order}`).all(user.id_usuario);
}

// Permissão de contato (mesma regra da lista de contatos), para uma pessoa específica.
function canContact(user, other) {
    if (!other || other.id_usuario === user.id_usuario) return false;
    if (user.tipo_usuario === 'gestao' || other.perfil === 'gestao') return true;
    if (user.tipo_usuario === 'professor' && other.perfil === 'aluno') {
        return Boolean(user.id_professor && database.prepare(`
            SELECT 1 FROM alunos a JOIN disciplinas d ON d.id_turma = a.id_turma
            WHERE a.id_usuario = ? AND d.id_professor = ?
        `).get(other.id_usuario, user.id_professor));
    }
    if (user.tipo_usuario === 'aluno' && other.perfil === 'professor') {
        return Boolean(user.id_turma && database.prepare(`
            SELECT 1 FROM disciplinas WHERE id_turma = ? AND id_professor = ?
        `).get(user.id_turma, other.id_professor));
    }
    return false;
}

function findPerson(userId) {
    return database.prepare(`SELECT ${PERSON_COLUMNS} FROM usuarios u ${PERSON_JOINS}
        WHERE u.id_usuario = ? AND u.ativo = 1 AND u.login NOT GLOB '__aluno_compartilhado_*'`)
        .get(userId);
}

function listConversations(user) {
    const rows = database.prepare(`
        SELECT c.id_conversa,
               CASE WHEN c.id_usuario_a = ? THEN c.id_usuario_b ELSE c.id_usuario_a END AS id_outro,
               m.texto, m.criado_em, m.id_autor,
               (SELECT COUNT(*) FROM mensagens n
                WHERE n.id_conversa = c.id_conversa AND n.id_autor != ? AND n.lida_em IS NULL)
                   AS nao_lidas
        FROM conversas c
        JOIN mensagens m ON m.id_mensagem = (
            SELECT MAX(id_mensagem) FROM mensagens WHERE id_conversa = c.id_conversa)
        WHERE c.id_usuario_a = ? OR c.id_usuario_b = ?
        ORDER BY m.id_mensagem DESC
    `).all(user.id_usuario, user.id_usuario, user.id_usuario, user.id_usuario);
    return rows.map((row) => {
        const person = database.prepare(`SELECT ${PERSON_COLUMNS} FROM usuarios u ${PERSON_JOINS}
            WHERE u.id_usuario = ?`).get(row.id_outro);
        return {
            id_conversa: row.id_conversa,
            com: toContact(person, user),
            ultima: { texto: row.texto, criado_em: row.criado_em, minha: row.id_autor === user.id_usuario },
            nao_lidas: row.nao_lidas
        };
    });
}

function unreadTotal(user) {
    return database.prepare(`
        SELECT COUNT(*) AS total FROM mensagens m
        JOIN conversas c ON c.id_conversa = m.id_conversa
        WHERE (c.id_usuario_a = ? OR c.id_usuario_b = ?)
          AND m.id_autor != ? AND m.lida_em IS NULL
    `).get(user.id_usuario, user.id_usuario, user.id_usuario).total;
}

async function sendMessage(request, response, user) {
    const body = await readBody(request);
    const unknown = Object.keys(body).filter((field) => !['para', 'texto'].includes(field));
    if (unknown.length) {
        throw new ApiError(400, `Campo(s) não permitido(s): ${unknown.join(', ')}.`);
    }
    const recipientId = parseId(body.para, 'para');
    if (typeof body.texto !== 'string' || !body.texto.trim()) {
        throw new ApiError(400, 'Escreva a mensagem.');
    }
    const text = body.texto.trim();
    if (text.length > MAX_TEXT_LENGTH) {
        throw new ApiError(400, `A mensagem pode ter no máximo ${MAX_TEXT_LENGTH} caracteres.`);
    }
    const recipient = findPerson(recipientId);
    if (!recipient) throw new ApiError(404, 'Contato não encontrado.');
    if (!canContact(user, recipient)) {
        throw new ApiError(403, 'Você não pode enviar mensagens para esta pessoa.');
    }
    assertSendRate(user.id_usuario);

    const [first, second] = [user.id_usuario, recipientId].sort((x, y) => x - y);
    let message;
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(
            'INSERT OR IGNORE INTO conversas (id_usuario_a, id_usuario_b) VALUES (?, ?)'
        ).run(first, second);
        const { id_conversa: conversationId } = database.prepare(
            'SELECT id_conversa FROM conversas WHERE id_usuario_a = ? AND id_usuario_b = ?'
        ).get(first, second);
        message = database.prepare(`
            INSERT INTO mensagens (id_conversa, id_autor, texto) VALUES (?, ?, ?)
            RETURNING id_mensagem, id_conversa, texto, criado_em, lida_em
        `).get(conversationId, user.id_usuario, text);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    notificacoes.onMessageSent(message.id_mensagem);
    sendJson(response, 201, { ...message, minha: true });
}

function getConversation(user, conversationId, searchParams) {
    const conversation = database.prepare(`
        SELECT id_conversa, id_usuario_a, id_usuario_b FROM conversas
        WHERE id_conversa = ? AND (id_usuario_a = ? OR id_usuario_b = ?)
    `).get(conversationId, user.id_usuario, user.id_usuario);
    // 404 também para conversa de terceiros: não revela que ela existe.
    if (!conversation) throw new ApiError(404, 'Conversa não encontrada.');
    const otherId = conversation.id_usuario_a === user.id_usuario
        ? conversation.id_usuario_b : conversation.id_usuario_a;

    const after = searchParams.get('depois');
    let rows;
    if (after !== null) {
        // Novas mensagens depois de um id, em ordem; "mais" indica que há outra página.
        rows = database.prepare(`
            SELECT id_mensagem, id_autor, texto, criado_em, lida_em FROM mensagens
            WHERE id_conversa = ? AND id_mensagem > ?
            ORDER BY id_mensagem LIMIT ?
        `).all(conversationId, parseId(after, 'depois'), PAGE_SIZE + 1);
    } else {
        // Primeira carga: as últimas mensagens, em ordem cronológica.
        rows = database.prepare(`
            SELECT * FROM (
                SELECT id_mensagem, id_autor, texto, criado_em, lida_em FROM mensagens
                WHERE id_conversa = ? ORDER BY id_mensagem DESC LIMIT ?
            ) ORDER BY id_mensagem
        `).all(conversationId, PAGE_SIZE + 1);
    }
    const more = rows.length > PAGE_SIZE;
    if (more) rows = after !== null ? rows.slice(0, PAGE_SIZE) : rows.slice(1);

    database.prepare(`
        UPDATE mensagens SET lida_em = CURRENT_TIMESTAMP
        WHERE id_conversa = ? AND id_autor != ? AND lida_em IS NULL
          AND id_mensagem <= ?
    `).run(conversationId, user.id_usuario, rows.length ? rows[rows.length - 1].id_mensagem : 0);

    const other = database.prepare(`SELECT ${PERSON_COLUMNS} FROM usuarios u ${PERSON_JOINS}
        WHERE u.id_usuario = ?`).get(otherId);
    return {
        id_conversa: conversationId,
        com: toContact(other, user),
        pode_responder: canContact(user, findPerson(otherId)),
        mensagens: rows.map((row) => ({
            id_mensagem: row.id_mensagem,
            texto: row.texto,
            criado_em: row.criado_em,
            lida_em: row.lida_em,
            minha: row.id_autor === user.id_usuario
        })),
        mais: more
    };
}

async function handleMensagensRequest(request, response, user, parts, searchParams) {
    const { method } = request;
    if (parts.length === 2) {
        if (method === 'GET') sendJson(response, 200, listConversations(user));
        else if (method === 'POST') await sendMessage(request, response, user);
        else throw new ApiError(405, 'Método não permitido.');
        return;
    }
    if (parts.length === 3 && method !== 'GET') throw new ApiError(405, 'Método não permitido.');
    if (parts.length === 3 && parts[2] === 'contatos') {
        sendJson(response, 200, listContactRows(user).map((person) => toContact(person, user)));
        return;
    }
    if (parts.length === 3 && parts[2] === 'nao-lidas') {
        sendJson(response, 200, { total: unreadTotal(user) });
        return;
    }
    if (parts.length === 3) {
        sendJson(response, 200, getConversation(user, parseId(parts[2], 'id_conversa'), searchParams));
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handleMensagensRequest };
