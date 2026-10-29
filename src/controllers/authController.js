const { createHash, randomBytes } = require('node:crypto');
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { hashPassword, verifyPassword } = require('../utils/password');

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 5 * 60 * 1000;

// Tentativas de login malsucedidas por IP + usuário, mantidas em memória.
const failedAttempts = new Map();
// Hash usado quando o usuário não existe, para o tempo de resposta não revelar contas válidas.
let dummyPasswordHash;

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function attemptKey(request, login) {
    return `${request.socket.remoteAddress}|${login.toLowerCase()}`;
}

function assertNotLocked(key) {
    const entry = failedAttempts.get(key);
    if (!entry) return;
    const now = Date.now();
    if (entry.lockedUntil > now) {
        const minutes = Math.ceil((entry.lockedUntil - now) / 60000);
        throw new ApiError(429,
            `Muitas tentativas incorretas. Tente novamente em ${minutes} minuto(s).`);
    }
    if (now - entry.firstFailure > FAILURE_WINDOW_MS) failedAttempts.delete(key);
}

function registerFailure(key) {
    const now = Date.now();
    const entry = failedAttempts.get(key);
    if (!entry || now - entry.firstFailure > FAILURE_WINDOW_MS) {
        failedAttempts.set(key, { count: 1, firstFailure: now, lockedUntil: 0 });
        return;
    }
    entry.count += 1;
    if (entry.count >= MAX_FAILED_ATTEMPTS) {
        entry.lockedUntil = now + LOCK_DURATION_MS;
        entry.count = 0;
        entry.firstFailure = now;
    }
}

async function handleLogin(request, response) {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
    }

    const allowedFields = ['login', 'senha'];
    if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
        throw new ApiError(400, 'Use somente os campos "login" e "senha".');
    }
    if (typeof body.login !== 'string' || !body.login.trim() || body.login.length > 100) {
        throw new ApiError(400, 'Informe o usuário ou a matrícula.');
    }
    if (typeof body.senha !== 'string' || !body.senha || body.senha.length > 128) {
        throw new ApiError(400, 'Informe a senha.');
    }

    const login = body.login.trim();
    const key = attemptKey(request, login);
    assertNotLocked(key);

    const user = database.prepare(`
        SELECT u.id_usuario, u.login, u.senha, u.tipo_usuario, u.curso, u.serie,
               u.deve_trocar_senha, a.id_aluno, a.nome, a.id_turma,
               t.serie AS turma_serie, t.nome_turma, p.id_professor
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN turmas t ON t.id_turma = a.id_turma
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.login = ? AND u.ativo = 1
          AND u.login NOT GLOB '__aluno_compartilhado_*'
    `).get(login);

    if (!user) {
        dummyPasswordHash ??= hashPassword(randomBytes(16).toString('hex'));
        verifyPassword(body.senha, dummyPasswordHash);
    }
    if (!user || !verifyPassword(body.senha, user.senha)) {
        registerFailure(key);
        throw new ApiError(401, 'Usuário ou senha inválidos.');
    }
    failedAttempts.delete(key);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
    database.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Math.floor(Date.now() / 1000));
    database.prepare(
        'INSERT INTO sessoes (token_hash, id_usuario, curso, expira_em) VALUES (?, ?, ?, ?)'
    ).run(hashToken(token), user.id_usuario, user.curso, expiresAt);

    sendJson(response, 200, {
        token,
        tipo: 'Bearer',
        expira_em: new Date(expiresAt * 1000).toISOString(),
        usuario: {
            id_usuario: user.id_usuario,
            login: user.login,
            nome: user.nome,
            tipo_usuario: user.tipo_usuario,
            conta_compartilhada: false,
            deve_trocar_senha: user.deve_trocar_senha === 1,
            curso: user.curso,
            serie: user.turma_serie || user.serie,
            id_aluno: user.id_aluno,
            id_turma: user.id_turma,
            nome_turma: user.nome_turma,
            id_professor: user.id_professor
        }
    });
}

async function handleLogout(request, response, session) {
    database.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(session.tokenHash);
    response.writeHead(204);
    response.end();
}

module.exports = { handleLogin, handleLogout, hashToken };
