const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { parseSchoolDate } = require('../utils/dates');
const { schoolNow, addBusinessDays } = require('../utils/calendario');
const { assertOwnFile, attachmentColumns, attachmentFrom } = require('../utils/arquivos');
const {
    requireRole, requireFields, getRecordId, positiveId, rejectUnknownFields, requiredText, optionalText
} = require('./schoolController');

// Justificativas de falta: o aluno envia (com atestado opcional) até 5 dias úteis depois da falta;
// a gestão aceita ou recusa. "Falta justificada" não é gravada em frequencias: é derivada daqui.

const DEADLINE_BUSINESS_DAYS = 5;
const SITUATIONS = ['pendente', 'aceita', 'recusada'];

const SELECT_JUSTIFICATIONS = `
    SELECT j.id_justificativa, j.id_aluno, al.nome AS aluno_nome, t.nome_turma,
           j.id_disciplina, d.nome_disciplina, j.data_falta, j.motivo, j.situacao, j.resposta,
           j.analisado_em, j.criado_em, ${attachmentColumns('arq')}
    FROM justificativas j
    JOIN alunos al ON al.id_aluno = j.id_aluno
    LEFT JOIN turmas t ON t.id_turma = al.id_turma
    JOIN disciplinas d ON d.id_disciplina = j.id_disciplina
    LEFT JOIN arquivos arq ON arq.id_arquivo = j.id_arquivo`;

function toItem(row) {
    return {
        id_justificativa: row.id_justificativa,
        aluno: { id_aluno: row.id_aluno, nome: row.aluno_nome, turma: row.nome_turma },
        id_disciplina: row.id_disciplina,
        disciplina: row.nome_disciplina,
        data_falta: row.data_falta,
        motivo: row.motivo,
        anexo: attachmentFrom(row),
        situacao: row.situacao,
        resposta: row.resposta,
        analisado_em: row.analisado_em,
        criado_em: row.criado_em
    };
}

function fetchJustification(justificationId) {
    const row = database.prepare(`${SELECT_JUSTIFICATIONS} WHERE j.id_justificativa = ?`)
        .get(justificationId);
    return row && toItem(row);
}

function situationFilter(searchParams) {
    if (!searchParams.has('situacao')) return null;
    const situation = searchParams.get('situacao');
    if (!SITUATIONS.includes(situation)) {
        throw new ApiError(400, `Filtro "situacao" inválido. Use: ${SITUATIONS.join(', ')}.`);
    }
    return situation;
}

function listJustifications(user, searchParams) {
    const filters = [];
    const params = [];
    if (user.tipo_usuario === 'aluno') {
        if (!user.id_aluno) return [];
        filters.push('j.id_aluno = ?');
        params.push(user.id_aluno);
    } else if (user.tipo_usuario === 'professor') {
        filters.push('d.id_professor = ?');
        params.push(user.id_professor || -1);
    }
    const situation = situationFilter(searchParams);
    if (situation) {
        filters.push('j.situacao = ?');
        params.push(situation);
    }
    return database.prepare(`
        ${SELECT_JUSTIFICATIONS}
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY j.criado_em DESC, j.id_justificativa DESC
    `).all(...params).map(toItem);
}

async function createJustification(request, response, user) {
    requireRole(user, ['aluno']);
    if (!user.id_aluno) throw new ApiError(403, 'Sua conta ainda não está vinculada a uma matrícula.');
    const body = await readBody(request);
    rejectUnknownFields(body, ['id_disciplina', 'data_falta', 'motivo', 'id_arquivo']);
    requireFields(body, ['id_disciplina', 'data_falta', 'motivo']);
    const disciplineId = positiveId(body.id_disciplina, 'id_disciplina');
    const absenceDate = parseSchoolDate(body.data_falta, 'data_falta', { allowTime: false });
    const reason = requiredText(body.motivo, 'motivo', 2000, 'O motivo');
    const fileId = body.id_arquivo === undefined || body.id_arquivo === null
        ? null
        : positiveId(body.id_arquivo, 'id_arquivo');
    assertOwnFile(user, fileId);

    const absence = database.prepare(`
        SELECT 1 FROM frequencias
        WHERE id_aluno = ? AND id_disciplina = ? AND data_aula = ? AND presente = 0
    `).get(user.id_aluno, disciplineId, absenceDate);
    if (!absence) {
        throw new ApiError(404, 'Não há falta registrada para você nessa disciplina e data.');
    }
    const deadline = addBusinessDays(absenceDate, DEADLINE_BUSINESS_DAYS);
    if (schoolNow().data > deadline) {
        throw new ApiError(409,
            `O prazo para justificar esta falta terminou em ${deadline} (${DEADLINE_BUSINESS_DAYS} dias úteis).`);
    }
    if (database.prepare(`
        SELECT 1 FROM justificativas WHERE id_aluno = ? AND id_disciplina = ? AND data_falta = ?
    `).get(user.id_aluno, disciplineId, absenceDate)) {
        throw new ApiError(409, 'Já existe uma justificativa para essa falta.');
    }

    const justificationId = Number(database.prepare(`
        INSERT INTO justificativas (id_aluno, id_disciplina, data_falta, motivo, id_arquivo)
        VALUES (?, ?, ?, ?, ?)
    `).run(user.id_aluno, disciplineId, absenceDate, reason, fileId).lastInsertRowid);
    sendJson(response, 201, fetchJustification(justificationId));
}

async function reviewJustification(request, response, user, justificationId) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['situacao', 'resposta']);
    if (!['aceita', 'recusada'].includes(body.situacao)) {
        throw new ApiError(400, 'Informe em "situacao" "aceita" ou "recusada".');
    }
    const answer = optionalText(body.resposta, 'resposta', 2000);
    const result = database.prepare(`
        UPDATE justificativas
        SET situacao = ?, resposta = ?, id_usuario_analise = ?, analisado_em = CURRENT_TIMESTAMP
        WHERE id_justificativa = ?
    `).run(body.situacao, answer, user.id_usuario, justificationId);
    if (!result.changes) throw new ApiError(404, 'Justificativa não encontrada.');
    sendJson(response, 200, fetchJustification(justificationId));
}

async function handleJustificativasRequest(request, response, user, parts, searchParams) {
    if (parts.length === 2) {
        if (request.method === 'GET') {
            sendJson(response, 200, listJustifications(user, searchParams));
        } else if (request.method === 'POST') {
            await createJustification(request, response, user);
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return;
    }
    if (parts.length === 3) {
        if (request.method !== 'PATCH') throw new ApiError(405, 'Método não permitido.');
        await reviewJustification(request, response, user, getRecordId(parts[2]));
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handleJustificativasRequest };
