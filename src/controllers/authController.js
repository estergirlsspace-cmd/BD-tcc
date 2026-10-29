const { createHash, randomBytes } = require('node:crypto');
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { hashPassword, verifyPassword } = require('../utils/password');
const { registrar } = require('../services/auditoria');
const { clientAddress } = require('../utils/ip');

const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const MAX_ATTEMPTS_PER_IP = 20;
const IP_WINDOW_MS = 60 * 1000;
const MAX_TRACKED_KEYS = 10000;
const HOUR_MS = 60 * 60 * 1000;

// Bloqueio progressivo por CONTA, independente do IP (a senha inicial "ceep@" + 4 dígitos tem só
// 10.000 combinações): a cada 5 senhas erradas seguidas a conta fica bloqueada — 5 min, depois
// 1 h e, a partir da 15ª, 24 h. Um acerto zera a contagem; 24 h sem erros também.
const FAILURES_PER_LOCK = 5;
const FAILURE_MEMORY_MS = 24 * HOUR_MS;
function lockDuration(failures) {
    if (failures >= 15) return 24 * HOUR_MS;
    if (failures >= 10) return HOUR_MS;
    return 5 * 60 * 1000;
}

// Senhas erradas por conta (login em minúsculas), mantidas em memória.
const accountFailures = new Map();
// Hash usado quando o usuário não existe, para o tempo de resposta não revelar contas válidas.
let dummyPasswordHash;

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function pruneAccountFailures(now) {
    if (accountFailures.size <= MAX_TRACKED_KEYS) return;
    for (const [key, entry] of accountFailures) {
        if (entry.lockedUntil < now && now - entry.lastFailure > FAILURE_MEMORY_MS) {
            accountFailures.delete(key);
        }
    }
}

function lockedMessage(lockedUntil, now) {
    const minutes = Math.ceil((lockedUntil - now) / 60000);
    const wait = minutes > 90 ? `${Math.ceil(minutes / 60)} hora(s)` : `${minutes} minuto(s)`;
    return `Muitas tentativas incorretas. Tente novamente em ${wait}.`;
}

// Reserva uma tentativa de senha para a conta ANTES de verificar o hash: a falha já fica contada,
// então pedidos simultâneos não passam do limite. Devolve a função que desfaz a contagem quando
// a senha confere. Usado no login e onde a API pede "senha_atual".
function beginPasswordAttempt(login) {
    const key = String(login).toLowerCase();
    const now = Date.now();
    pruneAccountFailures(now);
    let entry = accountFailures.get(key);
    if (entry && entry.lockedUntil > now) throw new ApiError(429, lockedMessage(entry.lockedUntil, now));
    if (!entry || now - entry.lastFailure > FAILURE_MEMORY_MS) {
        entry = { failures: 0, lastFailure: now, lockedUntil: 0 };
        accountFailures.set(key, entry);
    }
    entry.failures += 1;
    entry.lastFailure = now;
    if (entry.failures % FAILURES_PER_LOCK === 0) {
        entry.lockedUntil = now + lockDuration(entry.failures);
    }
    return function passwordAccepted() {
        accountFailures.delete(key);
    };
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
    const passwordAccepted = beginPasswordAttempt(login);

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
        throw new ApiError(401, 'Usuário ou senha inválidos.');
    }
    passwordAccepted();

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
    database.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Math.floor(Date.now() / 1000));
    database.prepare(`
        INSERT INTO sessoes (token_hash, id_usuario, curso, expira_em, dispositivo, ultimo_acesso)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(hashToken(token), user.id_usuario, user.curso, expiresAt,
        describeDevice(request.headers['user-agent']), Math.floor(Date.now() / 1000));

    registrar(user, 'auth.login', `usuario:${user.id_usuario}`);
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

// Confere a "senha_atual" de quem está logado, com o mesmo bloqueio progressivo por conta do
// login (quem roubou uma sessão não pode usar estas rotas para adivinhar a senha).
async function assertCurrentPassword(user, password) {
    if (typeof password !== 'string' || !password || password.length > 128) {
        throw new ApiError(400, 'Informe a senha atual em "senha_atual".');
    }
    const passwordAccepted = beginPasswordAttempt(user.login);
    const account = database.prepare(
        'SELECT senha FROM usuarios WHERE id_usuario = ? AND ativo = 1'
    ).get(user.id_usuario);
    if (!account || !(await verifyPassword(password, account.senha))) {
        // 400, não 401: 401 significa sessão inválida e faria as telas encerrarem o login.
        throw new ApiError(400, 'A senha atual está incorreta.');
    }
    passwordAccepted();
}

async function handleLogout(request, response, session) {
    database.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(session.tokenHash);
    response.writeHead(204);
    response.end();
}

module.exports = {
    handleLogin, handleLogout, hashToken, clientAddress, createIpLimiter, beginPasswordAttempt,
    assertCurrentPassword
};
