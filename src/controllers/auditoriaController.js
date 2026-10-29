const database = require('../database');
const { ApiError } = require('../errors');
const { sendJson } = require('../utils/http');
const { parseSchoolDate, SCHOOL_UTC_OFFSET_HOURS } = require('../utils/dates');
const { requireRole } = require('./schoolController');
const { ACOES } = require('../services/auditoria');

// Consulta do registro de auditoria (somente gestão).
// GET /api/auditoria?acao=&id_usuario=&de=AAAA-MM-DD&ate=AAAA-MM-DD&pagina=1&por_pagina=50
// "acao" aceita a ação exata ("aluno.matricular") ou o grupo ("senha" = todas as "senha.*").
// "de" e "ate" são dias no horário de Brasília (inclusivos); criado_em é gravado em UTC.

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const ACAO_FILTER = /^[a-z_]+(\.[a-z_]+)?$/;

function positiveInteger(value, field, fallback, max = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === '') return fallback;
    if (!/^[1-9]\d{0,8}$/.test(value)) {
        throw new ApiError(400, `Informe em "${field}" um número inteiro positivo.`);
    }
    return Math.min(Number(value), max);
}

// Início do dia de Brasília convertido para o texto UTC usado em criado_em.
function utcStartOf(date, extraDays = 0) {
    const [year, month, day] = date.split('-').map(Number);
    const ms = Date.UTC(year, month - 1, day + extraDays) - SCHOOL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function buildFilters(searchParams) {
    const clauses = [];
    const params = [];
    const acao = (searchParams.get('acao') || '').trim();
    if (acao) {
        if (!ACAO_FILTER.test(acao)) throw new ApiError(400, 'Filtro "acao" inválido.');
        if (acao.includes('.')) {
            clauses.push('a.acao = ?');
            params.push(acao);
        } else {
            clauses.push("a.acao LIKE ? ESCAPE '\\'");
            params.push(`${acao.replaceAll('_', '\\_')}.%`);
        }
    }
    const userId = searchParams.get('id_usuario');
    if (userId) {
        clauses.push('a.id_usuario = ?');
        params.push(positiveInteger(userId, 'id_usuario'));
    }
    const from = searchParams.get('de');
    const to = searchParams.get('ate');
    if (from) {
        clauses.push('a.criado_em >= ?');
        params.push(utcStartOf(parseSchoolDate(from, 'de', { allowTime: false })));
    }
    if (to) {
        clauses.push('a.criado_em < ?');
        params.push(utcStartOf(parseSchoolDate(to, 'ate', { allowTime: false }), 1));
    }
    if (from && to && from > to) {
        throw new ApiError(400, 'A data "de" deve ser anterior ou igual à data "ate".');
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function listAudit(searchParams) {
    const page = positiveInteger(searchParams.get('pagina'), 'pagina', 1);
    const pageSize = positiveInteger(searchParams.get('por_pagina'), 'por_pagina',
        DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const { where, params } = buildFilters(searchParams);
    const total = database.prepare(`SELECT COUNT(*) AS n FROM auditoria a ${where}`).get(...params).n;
    const rows = database.prepare(`
        SELECT a.id_auditoria, a.acao, a.alvo, a.criado_em, a.id_usuario,
               u.login, u.tipo_usuario, COALESCE(al.nome, p.nome, u.nome) AS nome
        FROM auditoria a
        LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
        LEFT JOIN alunos al ON al.id_usuario = u.id_usuario
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        ${where}
        ORDER BY a.id_auditoria DESC
        LIMIT ? OFFSET ?
    `).all(...params, pageSize, (page - 1) * pageSize);
    return {
        itens: rows.map((row) => ({
            id_auditoria: row.id_auditoria,
            acao: row.acao,
            descricao: ACOES[row.acao] || row.acao,
            alvo: row.alvo,
            criado_em: `${row.criado_em.replace(' ', 'T')}Z`,
            usuario: row.id_usuario === null ? null : {
                id_usuario: row.id_usuario,
                login: row.login,
                nome: row.nome,
                tipo_usuario: row.tipo_usuario
            }
        })),
        total,
        pagina: page,
        por_pagina: pageSize,
        paginas: Math.max(1, Math.ceil(total / pageSize)),
        acoes: Object.entries(ACOES).map(([acao, descricao]) => ({ acao, descricao }))
    };
}

async function handleAuditoriaRequest(request, response, user, parts, searchParams) {
    if (parts.length !== 2) throw new ApiError(404, 'Rota não encontrada.');
    if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
    requireRole(user, ['gestao']);
    sendJson(response, 200, listAudit(searchParams));
}

module.exports = { handleAuditoriaRequest };
