const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { assertOwnFile } = require('../utils/arquivos');
const { registrar } = require('../services/auditoria');
const { requireRole, getRecordId, positiveId, rejectUnknownFields } = require('./schoolController');

// Horários em PDF publicados pela gestão: um por turma (para os alunos e professores dela) e um
// geral para os professores. O PDF é enviado antes por POST /api/arquivos; aqui só se vincula.
// O download continua em GET /api/arquivos/:id (regra de acesso em utils/arquivos.js).

const ITEM_COLUMNS = `
    SELECT h.id_horario_pdf, h.publico, h.id_turma, t.nome_turma, h.atualizado_em,
           arq.id_arquivo, arq.nome AS arquivo_nome, arq.tamanho AS arquivo_tamanho
    FROM horarios_pdf h
    JOIN arquivos arq ON arq.id_arquivo = h.id_arquivo
    LEFT JOIN turmas t ON t.id_turma = h.id_turma`;

function toItem(row) {
    if (!row) return null;
    return {
        id_horario_pdf: row.id_horario_pdf,
        publico: row.publico,
        id_turma: row.id_turma,
        nome_turma: row.nome_turma ?? null,
        arquivo: { id_arquivo: row.id_arquivo, nome: row.arquivo_nome, tamanho: row.arquivo_tamanho },
        atualizado_em: row.atualizado_em
    };
}

function teachersItem() {
    return toItem(database.prepare(`${ITEM_COLUMNS} WHERE h.publico = 'professores'`).get());
}

function getSchedules(user) {
    if (user.tipo_usuario === 'aluno') {
        // Conta compartilhada (sem turma própria) vê o horário da primeira turma do curso/série.
        const row = user.conta_compartilhada
            ? database.prepare(`${ITEM_COLUMNS}
                WHERE h.publico = 'turma' AND t.curso = ? AND t.serie = ?
                ORDER BY t.nome_turma LIMIT 1`).get(user.curso, user.serie)
            : user.id_turma
                ? database.prepare(`${ITEM_COLUMNS} WHERE h.publico = 'turma' AND h.id_turma = ?`)
                    .get(user.id_turma)
                : null;
        return { turma: toItem(row) };
    }
    if (user.tipo_usuario === 'professor') {
        const turmas = database.prepare(`${ITEM_COLUMNS}
            WHERE h.publico = 'turma' AND h.id_turma IN (
                SELECT id_turma FROM disciplinas WHERE id_professor = ?
            )
            ORDER BY t.nome_turma`).all(user.id_professor || -1).map(toItem);
        return { professores: teachersItem(), turmas };
    }
    const turmas = database.prepare(`${ITEM_COLUMNS}
        WHERE h.publico = 'turma' ORDER BY t.nome_turma`).all().map(toItem);
    return { professores: teachersItem(), turmas };
}

// Alvo da rota: /professores ou /turma/:id_turma. Devolve { publico, classId } ou lança 404.
function parseTarget(parts) {
    if (parts.length === 3 && parts[2] === 'professores') return { publico: 'professores', classId: null };
    if (parts.length === 4 && parts[2] === 'turma') {
        const classId = getRecordId(parts[3]);
        if (!database.prepare('SELECT 1 FROM turmas WHERE id_turma = ?').get(classId)) {
            throw new ApiError(404, 'Turma não encontrada.');
        }
        return { publico: 'turma', classId };
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

function findCurrent({ publico, classId }) {
    return database.prepare(`
        SELECT id_horario_pdf, id_arquivo FROM horarios_pdf
        WHERE publico = ? AND COALESCE(id_turma, 0) = ?
    `).get(publico, classId ?? 0);
}

function auditTarget({ publico, classId }) {
    return publico === 'turma' ? `turma:${classId}` : 'horario:professores';
}

async function publishSchedule(request, response, user, target) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['id_arquivo']);
    const fileId = positiveId(body.id_arquivo, 'id_arquivo');
    const current = findCurrent(target);
    assertOwnFile(user, fileId, current?.id_arquivo ?? null);
    const file = database.prepare('SELECT tipo_mime FROM arquivos WHERE id_arquivo = ?').get(fileId);
    if (!file) throw new ApiError(400, 'O anexo informado não está entre os arquivos que você enviou.');
    if (file.tipo_mime !== 'application/pdf') {
        throw new ApiError(400, 'O horário deve ser um arquivo PDF.');
    }

    database.exec('BEGIN IMMEDIATE');
    let scheduleId;
    try {
        const existing = findCurrent(target);
        if (existing) {
            database.prepare(`
                UPDATE horarios_pdf SET id_arquivo = ?, id_usuario = ?, atualizado_em = CURRENT_TIMESTAMP
                WHERE id_horario_pdf = ?
            `).run(fileId, user.id_usuario, existing.id_horario_pdf);
            scheduleId = existing.id_horario_pdf;
        } else {
            scheduleId = Number(database.prepare(`
                INSERT INTO horarios_pdf (publico, id_turma, id_arquivo, id_usuario) VALUES (?, ?, ?, ?)
            `).run(target.publico, target.classId, fileId, user.id_usuario).lastInsertRowid);
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    // O PDF substituído fica sem vínculo e sai na limpeza diária de órfãos.
    registrar(user, 'horario.publicar', auditTarget(target));
    sendJson(response, 200, toItem(database.prepare(`${ITEM_COLUMNS} WHERE h.id_horario_pdf = ?`)
        .get(scheduleId)));
}

function removeSchedule(response, user, target) {
    const current = findCurrent(target);
    if (!current) throw new ApiError(404, 'Nenhum horário publicado para este público.');
    database.prepare('DELETE FROM horarios_pdf WHERE id_horario_pdf = ?').run(current.id_horario_pdf);
    registrar(user, 'horario.remover', auditTarget(target));
    sendJson(response, 200, { removido: true });
}

async function handleHorariosPdfRequest(request, response, user, parts) {
    const { method } = request;
    if (parts.length === 2) {
        if (method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        sendJson(response, 200, getSchedules(user));
        return;
    }
    requireRole(user, ['gestao']);
    const target = parseTarget(parts);
    if (method !== 'PUT' && method !== 'DELETE') throw new ApiError(405, 'Método não permitido.');
    if (method === 'PUT') await publishSchedule(request, response, user, target);
    else removeSchedule(response, user, target);
}

module.exports = { handleHorariosPdfRequest };
