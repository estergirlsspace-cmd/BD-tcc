const { createHash, randomBytes } = require('node:crypto');
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { hashPassword, verifyPassword } = require('../utils/password');

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 20;
const IP_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10000;

// Tentativas de login malsucedidas por IP + usuário, mantidas em memória.
const failedAttempts = new Map();
// Hash usado quando o usuário não existe, para o tempo de resposta não revelar contas válidas.
let dummyPasswordHash;

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

// Atrás da Cloudflare, o IP real do visitante vem no cabeçalho CF-Connecting-IP.
function clientAddress(request) {
    const forwarded = request.headers['cf-connecting-ip']
        || String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || request.socket.remoteAddress;
}

function attemptKey(request, login) {
    return `${clientAddress(request)}|${login.toLowerCase()}`;
}

// Remove registros vencidos para os mapas não crescerem sem limite.
function pruneAttempts(now) {
    if (failedAttempts.size > MAX_TRACKED_KEYS) {
        for (const [key, entry] of failedAttempts) {
            if (entry.lockedUntil < now && now - entry.firstFailure > FAILURE_WINDOW_MS) {
                failedAttempts.delete(key);
            }
        }
    }
}

// Limitador por IP em janela fixa, em memória. Reaproveitado pelo login e por
// "Esqueci minha senha" (contaController), cada um com o próprio mapa e limite.
function createIpLimiter({ max, windowMs, message }) {
    const attempts = new Map();
    return function assertRate(request) {
        const now = Date.now();
        if (attempts.size > MAX_TRACKED_KEYS) {
            for (const [ip, entry] of attempts) {
                if (now - entry.windowStart > windowMs) attempts.delete(ip);
            }
        }
        const ip = clientAddress(request);
        const entry = attempts.get(ip);
        if (!entry || now - entry.windowStart > windowMs) {
            attempts.set(ip, { count: 1, windowStart: now });
            return;
        }
        entry.count += 1;
        if (entry.count > max) throw new ApiError(429, message);
    };
}

// Limite geral por IP: barra quem testa muitos usuários diferentes antes de calcular qualquer hash.
const assertIpRate = createIpLimiter({
    max: MAX_ATTEMPTS_PER_IP,
    windowMs: IP_WINDOW_MS,
    message: 'Muitas tentativas de login a partir desta rede. Aguarde 1 minuto.'
});

// Resumo do User-Agent para a lista de dispositivos conectados, ex.: "Chrome · Windows".
function describeDevice(userAgent) {
    const ua = String(userAgent || '').slice(0, 512);
    const browsers = [
        [/Edg(e|A|iOS)?\//, 'Edge'], [/OPR\/|Opera/, 'Opera'], [/SamsungBrowser\//, 'Samsung Internet'],
        [/Firefox\/|FxiOS\//, 'Firefox'], [/Chrome\/|CriOS\//, 'Chrome'], [/Safari\//, 'Safari']
    ];
    const systems = [
        [/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPod/, 'iPhone'], [/iPad/, 'iPad'],
        [/CrOS/, 'ChromeOS'], [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux']
    ];
    const browser = browsers.find(([pattern]) => pattern.test(ua))?.[1];
    const system = systems.find(([pattern]) => pattern.test(ua))?.[1];
    if (!browser && !system) return 'Dispositivo desconhecido';
    return [browser || 'Navegador', system].filter(Boolean).join(' · ');
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
    assertIpRate(request);
    const key = attemptKey(request, login);
    assertNotLocked(key);

    const user = database.prepare(`
        SELECT u.id_usuario, u.login, u.senha, u.tipo_usuario, u.curso, u.serie,
               u.deve_trocar_senha, a.id_aluno, COALESCE(a.nome, p.nome, u.nome) AS nome, p.area, a.id_turma,
               t.serie AS turma_serie, t.nome_turma, p.id_professor
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN turmas t ON t.id_turma = a.id_turma
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.login = ? AND u.ativo = 1
          AND u.login NOT GLOB '__aluno_compartilhado_*'
    `).get(login);

    if (!user) {
        dummyPasswordHash ??= await hashPassword(randomBytes(16).toString('hex'));
        await verifyPassword(body.senha, dummyPasswordHash);
    }
    if (!user || !(await verifyPassword(body.senha, user.senha))) {
        registerFailure(key);
        throw new ApiError(401, 'Usuário ou senha inválidos.');
    }
    failedAttempts.delete(key);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
    database.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Math.floor(Date.now() / 1000));
    database.prepare(`
        INSERT INTO sessoes (token_hash, id_usuario, curso, expira_em, dispositivo, ultimo_acesso)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(hashToken(token), user.id_usuario, user.curso, expiresAt,
        describeDevice(request.headers['user-agent']), Math.floor(Date.now() / 1000));

    sendJson(response, 200, {
        token,
        tipo: 'Bearer',
        expira_em: new Date(expiresAt * 1000).toISOString(),
        usuario: {
            id_usuario: user.id_usuario,
            login: user.login,
            nome: user.nome,
            area: user.area,
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

module.exports = { handleLogin, handleLogout, hashToken, clientAddress, createIpLimiter };
