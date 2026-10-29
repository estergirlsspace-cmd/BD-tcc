const { createHash, randomBytes } = require('node:crypto');
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { isSharedStudentLogin, sharedStudentLogin } = require('../utils/accounts');
const { verifyPassword } = require('../utils/password');

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

async function handleLogin(request, response) {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
    }

    const allowedFields = ['login', 'senha', 'curso', 'serie'];
    if (Object.keys(body).some((field) => !allowedFields.includes(field))) {
        throw new ApiError(400, 'Use somente os campos "login", "senha", "curso" e "serie".');
    }
    if (typeof body.senha !== 'string') {
        throw new ApiError(400, 'Informe a senha como texto.');
    }
    if (body.login !== undefined
        && (typeof body.login !== 'string' || !body.login.trim())) {
        throw new ApiError(400, 'O usuário deve ser um texto não vazio.');
    }
    if (body.curso !== undefined && !['informatica', 'redes'].includes(body.curso)) {
        throw new ApiError(400, 'O curso deve ser "informatica" ou "redes".');
    }
    if (body.serie !== undefined
        && (!Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)) {
        throw new ApiError(400, 'A série deve ser um número entre 1 e 3.');
    }

    const sharedStudent = body.login === undefined;
    if (sharedStudent && (body.curso === undefined || body.serie === undefined)) {
        throw new ApiError(400, 'Informe o curso e a série para entrar como aluno.');
    }
    if (!sharedStudent && body.curso === undefined && body.serie !== undefined) {
        throw new ApiError(400, 'A série só deve ser informada no acesso de aluno.');
    }

    const login = sharedStudent
        ? sharedStudentLogin(body.curso, body.serie)
        : body.login.trim();
    const candidates = database.prepare(`
        SELECT u.id_usuario, u.login, u.senha, u.tipo_usuario, u.curso, u.serie,
               a.id_aluno, a.id_turma, t.serie AS turma_serie, t.nome_turma,
               p.id_professor
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN turmas t ON t.id_turma = a.id_turma
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.login = ? AND u.ativo = 1
    `).all(login);
    const user = candidates.find((candidate) => {
        if (candidate.tipo_usuario === 'aluno' && body.serie === undefined) {
            return false;
        }
        if (candidate.tipo_usuario === 'aluno' && candidate.curso !== body.curso) {
            return false;
        }
        if (sharedStudent && candidate.serie !== body.serie) return false;
        if (candidate.tipo_usuario === 'aluno' && candidate.turma_serie
            && body.serie !== undefined && candidate.turma_serie !== body.serie) {
            return false;
        }
        if (candidate.tipo_usuario !== 'aluno'
            && (body.curso !== undefined || body.serie !== undefined)) {
            return false;
        }
        if (sharedStudent && !isSharedStudentLogin(candidate.login)) return false;
        if (!sharedStudent && isSharedStudentLogin(candidate.login)) return false;
        return verifyPassword(body.senha, candidate.senha);
    });

    if (!user) {
        throw new ApiError(401, 'Curso, série ou senha inválidos.');
    }

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
            login: sharedStudent ? null : user.login,
            tipo_usuario: user.tipo_usuario,
            conta_compartilhada: isSharedStudentLogin(user.login),
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
