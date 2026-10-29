const { randomBytes } = require('node:crypto');
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { hashPassword, verifyPassword, newPasswordProblem } = require('../utils/password');
const { hashToken, createIpLimiter, assertCurrentPassword } = require('./authController');
const email = require('../services/email');
const notificacoes = require('../services/notificacoes');
const { registrar } = require('../services/auditoria');

// Conta: e-mail, preferências de notificação, dispositivos conectados e recuperação de senha.

const RESET_TOKEN_SECONDS = notificacoes.RESET_PASSWORD_MINUTES * 60;
const CONFIRM_TOKEN_SECONDS = notificacoes.CONFIRM_EMAIL_HOURS * 60 * 60;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SESSION_ID_LENGTH = 16;
const GENERIC_RECOVERY_MESSAGE =
    'Se a conta tiver um e-mail confirmado, enviaremos um link para criar uma nova senha.';

// "Esqueci minha senha": mesmo limitador por IP do login, com limite próprio.
const assertRecoveryRate = createIpLimiter({
    max: 5,
    windowMs: 15 * 60 * 1000,
    message: 'Muitos pedidos de recuperação a partir desta rede. Aguarde alguns minutos.'
});
const assertResetRate = createIpLimiter({
    max: 20,
    windowMs: 60 * 1000,
    message: 'Muitas tentativas a partir desta rede. Aguarde 1 minuto.'
});

// Limite simples por chave (conta), em memória: no máximo `max` eventos por janela.
function createKeyLimiter(max, windowMs) {
    const events = new Map();
    return function allow(key) {
        const now = Date.now();
        if (events.size > 10000) {
            for (const [entryKey, times] of events) {
                if (!times.some((time) => now - time < windowMs)) events.delete(entryKey);
            }
        }
        const recent = (events.get(key) || []).filter((time) => now - time < windowMs);
        if (recent.length >= max) {
            events.set(key, recent);
            return false;
        }
        recent.push(now);
        events.set(key, recent);
        return true;
    };
}

const allowResetEmail = createKeyLimiter(3, 60 * 60 * 1000);
const allowConfirmEmail = createKeyLimiter(5, 60 * 60 * 1000);

function rejectUnknownFields(body, allowed) {
    const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
    if (unknown.length) {
        throw new ApiError(400, `Campo(s) não permitido(s): ${unknown.join(', ')}.`);
    }
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

// Gera um token de uso único; só o hash SHA-256 fica no banco.
function createToken(userId, purpose, lifetimeSeconds, data = null) {
    const token = randomBytes(32).toString('base64url');
    database.prepare(`
        INSERT INTO tokens (token_hash, id_usuario, finalidade, dado, expira_em)
        VALUES (?, ?, ?, ?, ?)
    `).run(hashToken(token), userId, purpose, data, nowSeconds() + lifetimeSeconds);
    return token;
}

function readToken(body) {
    if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) {
        throw new ApiError(400, 'Link inválido ou expirado. Peça um novo.');
    }
    return hashToken(body.token);
}

// ---------- Preferências ----------

function notificationPreferences(userId) {
    const silenced = new Set(database.prepare(
        'SELECT tipo FROM notificacoes_silenciadas WHERE id_usuario = ?'
    ).all(userId).map((row) => row.tipo));
    return Object.fromEntries(email.NOTIFICATION_TYPES.map((type) => [type, !silenced.has(type)]));
}

function getAccount(response, user) {
    const account = database.prepare('SELECT email FROM usuarios WHERE id_usuario = ?')
        .get(user.id_usuario);
    sendJson(response, 200, {
        email: account?.email ?? null,
        notificacoes: notificationPreferences(user.id_usuario)
    });
}

async function updatePreferences(request, response, user) {
    const body = await readBody(request);
    rejectUnknownFields(body, email.NOTIFICATION_TYPES);
    const entries = Object.entries(body);
    if (!entries.length) {
        throw new ApiError(400, `Informe ao menos um tipo: ${email.NOTIFICATION_TYPES.join(', ')}.`);
    }
    if (entries.some(([, value]) => typeof value !== 'boolean')) {
        throw new ApiError(400, 'Cada tipo de notificação deve ser true ou false.');
    }
    database.exec('BEGIN IMMEDIATE');
    try {
        for (const [type, enabled] of entries) {
            if (enabled) {
                database.prepare(
                    'DELETE FROM notificacoes_silenciadas WHERE id_usuario = ? AND tipo = ?'
                ).run(user.id_usuario, type);
            } else {
                database.prepare(
                    'INSERT OR IGNORE INTO notificacoes_silenciadas (id_usuario, tipo) VALUES (?, ?)'
                ).run(user.id_usuario, type);
            }
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    sendJson(response, 200, { notificacoes: notificationPreferences(user.id_usuario) });
}

// ---------- E-mail ----------

function emailInUse(address, exceptUserId) {
    return Boolean(database.prepare(
        'SELECT 1 FROM usuarios WHERE lower(email) = ? AND id_usuario != ?'
    ).get(address, exceptUserId));
}

// Prepara a confirmação de `address` para a conta: troca o token pendente por um novo e devolve-o.
// Não abre transação (roda dentro da do chamador); o envio fica com quem chama, depois do COMMIT.
function issueEmailConfirmation(userId, address) {
    database.prepare(
        "DELETE FROM tokens WHERE id_usuario = ? AND finalidade = 'confirmar_email'"
    ).run(userId);
    return createToken(userId, 'confirmar_email', CONFIRM_TOKEN_SECONDS, address);
}

// Trocar ou remover o e-mail de recuperação exige a senha atual: com uma sessão roubada não dá
// para apontar a recuperação de senha para outro endereço.
async function requestEmailChange(request, response, user) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['email', 'senha_atual']);
    const address = email.normalizeEmail(body.email);
    if (!address) throw new ApiError(400, 'Informe um e-mail válido.');
    await assertCurrentPassword(user, body.senha_atual);
    const current = database.prepare('SELECT email FROM usuarios WHERE id_usuario = ?')
        .get(user.id_usuario);
    if (current?.email === address) throw new ApiError(400, 'Este já é o seu e-mail.');
    if (emailInUse(address, user.id_usuario)) {
        throw new ApiError(409, 'Este e-mail já está em uso em outra conta.');
    }
    if (!allowConfirmEmail(user.id_usuario)) {
        throw new ApiError(429, 'Muitos pedidos de confirmação. Tente de novo mais tarde.');
    }
    database.exec('BEGIN IMMEDIATE');
    let token;
    try {
        token = issueEmailConfirmation(user.id_usuario, address);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    notificacoes.sendEmailConfirmation(user.id_usuario, address, token);
    sendJson(response, 200, {
        email_pendente: address,
        mensagem: 'Enviamos um link de confirmação para este e-mail. Ele vale por 24 horas.'
    });
}

async function removeEmail(request, response, user) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['senha_atual']);
    await assertCurrentPassword(user, body.senha_atual);
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare('UPDATE usuarios SET email = NULL WHERE id_usuario = ?').run(user.id_usuario);
        database.prepare(
            "DELETE FROM tokens WHERE id_usuario = ? AND finalidade = 'confirmar_email'"
        ).run(user.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'email.remover', `usuario:${user.id_usuario}`);
    sendJson(response, 200, { email: null, mensagem: 'E-mail removido da conta.' });
}

async function confirmEmail(request, response) {
    assertResetRate(request);
    const body = await readBody(request);
    rejectUnknownFields(body, ['token']);
    const tokenHash = readToken(body);
    database.exec('BEGIN IMMEDIATE');
    let address;
    let previous;
    let userId;
    try {
        const token = database.prepare(`
            DELETE FROM tokens
            WHERE token_hash = ? AND finalidade = 'confirmar_email' AND expira_em > ?
            RETURNING id_usuario, dado
        `).get(tokenHash, nowSeconds());
        const active = token && database.prepare(
            'SELECT 1 FROM usuarios WHERE id_usuario = ? AND ativo = 1'
        ).get(token.id_usuario);
        if (!active) {
            database.exec('COMMIT');
            throw new ApiError(400, 'Link inválido ou expirado. Peça um novo.');
        }
        if (emailInUse(token.dado, token.id_usuario)) {
            database.exec('COMMIT');
            throw new ApiError(409, 'Este e-mail já está em uso em outra conta.');
        }
        previous = database.prepare('SELECT email FROM usuarios WHERE id_usuario = ?')
            .get(token.id_usuario).email;
        database.prepare('UPDATE usuarios SET email = ? WHERE id_usuario = ?')
            .run(token.dado, token.id_usuario);
        database.exec('COMMIT');
        address = token.dado;
        userId = token.id_usuario;
    } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw error;
    }
    const actor = { id_usuario: userId };
    registrar(actor, 'email.alterar', `usuario:${userId}`);
    // Pendência: avisar o endereço anterior da troca. Ainda não há modelo de e-mail para isso
    // (não reaproveitamos cw-senha-alterada); por ora a troca fica registrada na auditoria.
    if (previous && previous !== address) {
        registrar(actor, 'email.alterar_sem_aviso', `usuario:${userId}`);
    }
    sendJson(response, 200, { email: address, mensagem: 'E-mail confirmado.' });
}

// ---------- Recuperação de senha ----------

async function requestPasswordReset(request, response) {
    assertRecoveryRate(request);
    const body = await readBody(request);
    rejectUnknownFields(body, ['login']);
    if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 254) {
        throw new ApiError(400, 'Informe o usuário, a matrícula ou o e-mail.');
    }
    const login = body.login.trim();
    const account = database.prepare(`
        SELECT id_usuario FROM usuarios
        WHERE (login = ? OR lower(email) = lower(?)) AND ativo = 1 AND email IS NOT NULL
          AND login NOT GLOB '__aluno_compartilhado_*'
        ORDER BY id_usuario
    `).get(login, login);
    if (account && allowResetEmail(account.id_usuario)) {
        database.exec('BEGIN IMMEDIATE');
        let token;
        try {
            database.prepare(
                "DELETE FROM tokens WHERE id_usuario = ? AND finalidade = 'redefinir_senha'"
            ).run(account.id_usuario);
            token = createToken(account.id_usuario, 'redefinir_senha', RESET_TOKEN_SECONDS);
            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
        notificacoes.sendPasswordReset(account.id_usuario, token);
    }
    // Mesma resposta exista ou não a conta: não revela quais logins têm e-mail.
    sendJson(response, 200, { mensagem: GENERIC_RECOVERY_MESSAGE });
}

async function resetPassword(request, response) {
    assertResetRate(request);
    const body = await readBody(request);
    rejectUnknownFields(body, ['token', 'nova_senha']);
    const tokenHash = readToken(body);
    const problem = newPasswordProblem(body.nova_senha);
    if (problem) throw new ApiError(400, problem);

    const invalidLink = () => new ApiError(400, 'Link inválido ou expirado. Peça um novo.');
    const account = database.prepare(`
        SELECT u.id_usuario, u.senha FROM tokens t
        JOIN usuarios u ON u.id_usuario = t.id_usuario
        WHERE t.token_hash = ? AND t.finalidade = 'redefinir_senha' AND t.expira_em > ?
          AND u.ativo = 1
    `).get(tokenHash, nowSeconds());
    if (!account) throw invalidLink();
    if (await verifyPassword(body.nova_senha, account.senha)) {
        throw new ApiError(400, 'A nova senha precisa ser diferente da senha atual.');
    }
    // Hash calculado antes da transação: nada de await com a transação aberta.
    const passwordHash = await hashPassword(body.nova_senha);
    database.exec('BEGIN IMMEDIATE');
    try {
        // Consome o token dentro da transação: dois pedidos simultâneos não usam o mesmo link.
        const consumed = database.prepare(`
            DELETE FROM tokens
            WHERE token_hash = ? AND finalidade = 'redefinir_senha' AND expira_em > ?
            RETURNING id_usuario
        `).get(tokenHash, nowSeconds());
        if (!consumed || consumed.id_usuario !== account.id_usuario) {
            database.exec('COMMIT');
            throw invalidLink();
        }
        database.prepare(
            'UPDATE usuarios SET senha = ?, deve_trocar_senha = 0 WHERE id_usuario = ?'
        ).run(passwordHash, account.id_usuario);
        database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(account.id_usuario);
        database.prepare(
            "DELETE FROM tokens WHERE id_usuario = ? AND finalidade = 'redefinir_senha'"
        ).run(account.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        if (database.isTransaction) database.exec('ROLLBACK');
        throw error;
    }
    registrar(account, 'senha.redefinir_link', `usuario:${account.id_usuario}`);
    notificacoes.onPasswordChanged(account.id_usuario);
    sendJson(response, 200, { mensagem: 'Senha redefinida. Entre com a nova senha.' });
}

// ---------- Dispositivos conectados ----------

function sessionId(tokenHash) {
    return tokenHash.slice(0, SESSION_ID_LENGTH);
}

function listSessions(response, user) {
    const sessions = database.prepare(`
        SELECT token_hash, dispositivo, ultimo_acesso FROM sessoes
        WHERE id_usuario = ? AND expira_em > ?
        ORDER BY ultimo_acesso DESC
    `).all(user.id_usuario, nowSeconds());
    sendJson(response, 200, sessions.map((session) => ({
        id: sessionId(session.token_hash),
        dispositivo: session.dispositivo || 'Dispositivo desconhecido',
        ultimo_acesso: session.ultimo_acesso
            ? new Date(session.ultimo_acesso * 1000).toISOString() : null,
        atual: session.token_hash === user.tokenHash
    })));
}

function revokeSession(response, user, id) {
    if (!new RegExp(`^[a-f0-9]{${SESSION_ID_LENGTH}}$`).test(id)) {
        throw new ApiError(400, 'Identificador de sessão inválido.');
    }
    const result = database.prepare(`
        DELETE FROM sessoes WHERE id_usuario = ? AND substr(token_hash, 1, ?) = ?
    `).run(user.id_usuario, SESSION_ID_LENGTH, id);
    if (!result.changes) throw new ApiError(404, 'Sessão não encontrada.');
    response.writeHead(204);
    response.end();
}

function revokeOtherSessions(response, user) {
    const result = database.prepare(
        'DELETE FROM sessoes WHERE id_usuario = ? AND token_hash != ?'
    ).run(user.id_usuario, user.tokenHash);
    sendJson(response, 200, {
        encerradas: Number(result.changes),
        mensagem: 'Os outros dispositivos foram desconectados.'
    });
}

// ---------- Roteamento ----------

async function handleContaRequest(request, response, user, parts) {
    const [, , section, id] = parts;
    const { method } = request;
    const notAllowed = () => new ApiError(405, 'Método não permitido.');

    if (parts.length === 2) {
        if (method !== 'GET') throw notAllowed();
        getAccount(response, user);
        return;
    }
    if (section === 'notificacoes' && parts.length === 3) {
        if (method !== 'PUT') throw notAllowed();
        await updatePreferences(request, response, user);
        return;
    }
    if (section === 'email' && parts.length === 3) {
        if (method === 'POST') await requestEmailChange(request, response, user);
        else if (method === 'DELETE') await removeEmail(request, response, user);
        else throw notAllowed();
        return;
    }
    if (section === 'sessoes' && parts.length === 3) {
        if (method === 'GET') listSessions(response, user);
        else if (method === 'DELETE') revokeOtherSessions(response, user);
        else throw notAllowed();
        return;
    }
    if (section === 'sessoes' && parts.length === 4) {
        if (method !== 'DELETE') throw notAllowed();
        revokeSession(response, user, id);
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

// Rotas sem login: POST /api/auth/recuperar, POST /api/auth/redefinir, POST /api/conta/email/confirmar.
// Devolve true quando tratou a requisição.
async function handlePublicAccountRequest(request, response, parts) {
    if (request.method !== 'POST') return false;
    const route = parts.slice(1).join('/');
    if (route === 'auth/recuperar') {
        await requestPasswordReset(request, response);
        return true;
    }
    if (route === 'auth/redefinir') {
        await resetPassword(request, response);
        return true;
    }
    if (route === 'conta/email/confirmar') {
        await confirmEmail(request, response);
        return true;
    }
    return false;
}

module.exports = { handleContaRequest, handlePublicAccountRequest, issueEmailConfirmation };
