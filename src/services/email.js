const database = require('../database');
const { ApiError } = require('../errors');
const { SCHOOL_UTC_OFFSET_HOURS } = require('../utils/dates');

// Envio de e-mails pela API da Resend com os templates publicados (ver emails/README.md).
// Sem RESEND_API_KEY (desenvolvimento) o envio é só registrado no log. Nunca lança erro para
// quem chama: falhas ficam no log, sem dados pessoais (só o alias e o id do usuário).

const RESEND_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 8000;
// A Resend aceita poucas requisições por segundo: os envios saem de uma fila, um de cada vez.
const SEND_INTERVAL_MS = 600;
const MAX_VARIABLE_LENGTH = 2000;
const NOTIFICATION_TYPES = ['urgente', 'turma', 'prazos', 'eventos', 'mensagens'];

function appUrl(path = '/') {
    const base = (process.env.APP_URL || 'https://ceeplourdinhaguerra.com.br').replace(/\/+$/, '');
    return `${base}${path}`;
}

// Partes da data no horário de Brasília (deslocamento fixo, ver utils/dates.js).
function schoolParts(ms) {
    const date = new Date(ms + SCHOOL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
        weekday: date.getUTCDay() // 0 = domingo, 1 = segunda
    };
}

const pad = (value) => String(value).padStart(2, '0');

// "30/10/2026, às 23h59" no horário de Brasília.
function formatSchoolDateTime(ms) {
    const p = schoolParts(ms);
    return `${pad(p.day)}/${pad(p.month)}/${p.year}, às ${pad(p.hour)}h${pad(p.minute)}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncate(text, maxLength) {
    const value = String(text ?? '').replace(/\s+/g, ' ').trim();
    return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

const EMAIL_PATTERN = /^[^\s@"<>()\[\],;:\\]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Valida e normaliza (minúsculas, sem espaços nas pontas) um endereço de e-mail.
// Devolve o endereço normalizado ou null se for inválido.
function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const address = value.trim().toLowerCase();
    if (address.length > 254 || !EMAIL_PATTERN.test(address)) return null;
    return address;
}

// E-mail opcional informado pela gestão no cadastro: ausente/vazio → null; inválido → 400;
// já usado por outra conta → 409. Devolve o endereço normalizado.
function optionalAccountEmail(value) {
    if (value === undefined || value === null || value === '') return null;
    const address = normalizeEmail(value);
    if (!address) throw new ApiError(400, 'Informe um e-mail válido (ou deixe o campo vazio).');
    if (database.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?').get(address)) {
        throw new ApiError(409, 'Este e-mail já está em uso em outra conta.');
    }
    return address;
}

// Destinatário válido: conta ativa, com e-mail, e (se o tipo for silenciável) sem silenciar.
// Devolve { id_usuario, email, nome, perfil } ou null.
function recipient(userId, notificationType = null) {
    const row = database.prepare(`
        SELECT u.id_usuario, u.email, u.tipo_usuario AS perfil,
               COALESCE(a.nome, p.nome, u.nome, u.login) AS nome
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.id_usuario = ? AND u.ativo = 1 AND u.email IS NOT NULL
    `).get(userId);
    if (!row) return null;
    if (notificationType && isSilenced(userId, notificationType)) return null;
    return row;
}

function isSilenced(userId, type) {
    return Boolean(database.prepare(
        'SELECT 1 FROM notificacoes_silenciadas WHERE id_usuario = ? AND tipo = ?'
    ).get(userId, type));
}

// Prepara as variáveis: escapa todas, exceto as listadas em rawFields (HTML montado pela
// aplicação com o texto já escapado), e corta no limite da Resend.
function prepareVariables(variables, rawFields) {
    const prepared = {};
    for (const [key, value] of Object.entries(variables)) {
        if (typeof value === 'number') {
            prepared[key] = value;
            continue;
        }
        const text = rawFields.includes(key) ? String(value ?? '') : escapeHtml(value);
        prepared[key] = text.slice(0, MAX_VARIABLE_LENGTH);
    }
    return prepared;
}

let queue = Promise.resolve();

function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms).unref();
    });
}

async function deliver(alias, userId, to, variables) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.info(`[email] (simulado) ${alias} para ${userId}`);
        return 'ok';
    }
    try {
        const response = await fetch(RESEND_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: [to], template: { id: alias, variables } }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        await response.arrayBuffer().catch(() => {});
        if (response.ok) return 'ok';
        console.error(`[email] falha ${alias} para ${userId}: HTTP ${response.status}`);
        return response.status === 429 || response.status >= 500 ? 'transient' : 'permanent';
    } catch (error) {
        console.error(`[email] falha ${alias} para ${userId}: ${error.name}`);
        return 'transient';
    } finally {
        await wait(SEND_INTERVAL_MS);
    }
}

// Enfileira um envio. Resolve com 'ok' | 'transient' | 'permanent' | 'skipped'; nunca rejeita.
// to: recipient() já validado (ou { id_usuario, email } para o e-mail ainda não confirmado).
function sendTemplate(alias, to, variables, { rawFields = [] } = {}) {
    if (!to || !to.email) return Promise.resolve('skipped');
    const prepared = prepareVariables(variables, rawFields);
    const job = queue.then(() => deliver(alias, to.id_usuario, to.email, prepared));
    queue = job.catch(() => {});
    return job.catch((error) => {
        console.error(`[email] erro inesperado ${alias}: ${error.name}`);
        return 'transient';
    });
}

// Idempotência: reserva a chave antes de enviar. Devolve false se já havia envio com ela.
function claimKey(key) {
    return database.prepare('INSERT OR IGNORE INTO envios_email (chave) VALUES (?)').run(key)
        .changes === 1;
}

// Reserva com janela: só reserva se o último envio com a chave tiver mais de `minutes` minutos.
function claimKeyWithWindow(key, minutes) {
    return database.prepare(`
        INSERT INTO envios_email (chave) VALUES (?)
        ON CONFLICT (chave) DO UPDATE SET enviado_em = CURRENT_TIMESTAMP
            WHERE enviado_em <= datetime('now', ?)
    `).run(key, `-${Number(minutes)} minutes`).changes === 1;
}

function releaseKey(key) {
    database.prepare('DELETE FROM envios_email WHERE chave = ?').run(key);
}

// Envio com chave de idempotência; libera a chave se a falha for temporária (tenta de novo depois).
async function sendOnce(key, alias, to, variables, options) {
    if (!to || !claimKey(key)) return 'skipped';
    const result = await sendTemplate(alias, to, variables, options);
    if (result === 'transient') releaseKey(key);
    return result;
}

module.exports = {
    NOTIFICATION_TYPES,
    appUrl,
    schoolParts,
    formatSchoolDateTime,
    escapeHtml,
    normalizeEmail,
    optionalAccountEmail,
    truncate,
    recipient,
    isSilenced,
    sendTemplate,
    sendOnce,
    claimKey,
    claimKeyWithWindow,
    releaseKey
};
