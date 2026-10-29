const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { registrar } = require('../services/auditoria');
const {
    requireRole, requireFields, getRecordId, positiveId, rejectUnknownFields, requiredText,
    isTeacherAssignedToClass
} = require('./schoolController');

// Ocorrências disciplinares: registradas pelo professor (de uma turma do aluno) ou pela gestão;
// a gestão marca como resolvidas. O aluno vê as próprias com o perfil do autor, sem o nome.

const SITUATIONS = ['aberta', 'resolvida'];

const SELECT_OCCURRENCES = `
    SELECT o.id_ocorrencia, o.id_aluno, al.nome AS aluno_nome, t.nome_turma, o.descricao,
           o.situacao, o.criado_em, o.resolvida_em, u.tipo_usuario AS autor_perfil,
           COALESCE(p.nome, u.nome) AS autor_nome
    FROM ocorrencias o
    JOIN alunos al ON al.id_aluno = o.id_aluno
    LEFT JOIN turmas t ON t.id_turma = al.id_turma
    JOIN usuarios u ON u.id_usuario = o.id_usuario_autor
    LEFT JOIN professores p ON p.id_usuario = u.id_usuario`;

function toItem(row, user) {
    return {
        id_ocorrencia: row.id_ocorrencia,
        aluno: { id_aluno: row.id_aluno, nome: row.aluno_nome, turma: row.nome_turma },
        descricao: row.descricao,
        situacao: row.situacao,
        criado_em: row.criado_em,
        resolvida_em: row.resolvida_em,
        autor: user.tipo_usuario === 'aluno'
            ? { perfil: row.autor_perfil }
            : { nome: row.autor_nome, perfil: row.autor_perfil }
    };
}

function fetchOccurrence(occurrenceId, user) {
    const row = database.prepare(`${SELECT_OCCURRENCES} WHERE o.id_ocorrencia = ?`).get(occurrenceId);
    return row && toItem(row, user);
}

function listOccurrences(user, searchParams) {
    const filters = [];
    const params = [];
    if (user.tipo_usuario === 'aluno') {
        if (!user.id_aluno) return [];
        filters.push('o.id_aluno = ?');
        params.push(user.id_aluno);
    } else if (user.tipo_usuario === 'professor') {
        filters.push('o.id_usuario_autor = ?');
        params.push(user.id_usuario);
    }
    if (searchParams.has('situacao')) {
        const situation = searchParams.get('situacao');
        if (!SITUATIONS.includes(situation)) {
            throw new ApiError(400, `Filtro "situacao" inválido. Use: ${SITUATIONS.join(', ')}.`);
        }
        filters.push('o.situacao = ?');
        params.push(situation);
    }
    return database.prepare(`
        ${SELECT_OCCURRENCES}
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY o.criado_em DESC, o.id_ocorrencia DESC
    `).all(...params).map((row) => toItem(row, user));
}

async function createOccurrence(request, response, user) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['id_aluno', 'descricao']);
    requireFields(body, ['id_aluno', 'descricao']);
    const studentId = positiveId(body.id_aluno, 'id_aluno');
    const description = requiredText(body.descricao, 'descricao', 2000, 'A descrição');
    const student = database.prepare(`
        SELECT a.id_turma FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario
        WHERE a.id_aluno = ? AND u.ativo = 1 AND u.login NOT GLOB 'turma-[0-9]*'
    `).get(studentId);
    // Professor só registra para alunos das turmas em que leciona (404 fora do escopo).
    if (!student || (user.tipo_usuario === 'professor'
        && !(student.id_turma && isTeacherAssignedToClass(user, student.id_turma)))) {
        throw new ApiError(404, 'Aluno não encontrado.');
    }
    const occurrenceId = Number(database.prepare(`
        INSERT INTO ocorrencias (id_aluno, id_usuario_autor, descricao) VALUES (?, ?, ?)
    `).run(studentId, user.id_usuario, description).lastInsertRowid);
    registrar(user, 'ocorrencia.registrar', `ocorrencia:${occurrenceId}`);
    sendJson(response, 201, fetchOccurrence(occurrenceId, user));
}

async function resolveOccurrence(request, response, user, occurrenceId) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['situacao']);
    if (body.situacao !== 'resolvida') {
        throw new ApiError(400, 'Informe em "situacao" o valor "resolvida".');
    }
    // Idempotente: resolver de novo mantém a data da primeira resolução.
    const result = database.prepare(`
        UPDATE ocorrencias
        SET situacao = 'resolvida', resolvida_em = COALESCE(resolvida_em, CURRENT_TIMESTAMP)
        WHERE id_ocorrencia = ?
    `).run(occurrenceId);
    if (!result.changes) throw new ApiError(404, 'Ocorrência não encontrada.');
    registrar(user, 'ocorrencia.resolver', `ocorrencia:${occurrenceId}`);
    sendJson(response, 200, fetchOccurrence(occurrenceId, user));
}

async function handleOcorrenciasRequest(request, response, user, parts, searchParams) {
    if (parts.length === 2) {
        if (request.method === 'GET') {
            sendJson(response, 200, listOccurrences(user, searchParams));
        } else if (request.method === 'POST') {
            await createOccurrence(request, response, user);
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return;
    }
    if (parts.length === 3) {
        if (request.method !== 'PATCH') throw new ApiError(405, 'Método não permitido.');
        await resolveOccurrence(request, response, user, getRecordId(parts[2]));
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handleOcorrenciasRequest };
