const database = require('../database');
const { ApiError } = require('../errors');
const { hashToken } = require('../controllers/authController');
const { isSharedStudentLogin, isClassAccount } = require('../utils/accounts');
const { termosPendentes } = require('../utils/termos');

const LAST_SEEN_INTERVAL_SECONDS = 60;

function authenticate(request) {
    const authorization = request.headers.authorization || '';
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
    if (!match) {
        throw new ApiError(401, 'Envie um token válido no cabeçalho Authorization: Bearer.');
    }

    const tokenHash = hashToken(match[1]);
    const now = Math.floor(Date.now() / 1000);
    const session = database.prepare(`
        SELECT s.token_hash, s.curso AS curso_sessao, s.expira_em, s.ultimo_acesso,
               u.id_usuario, u.login, u.tipo_usuario, u.curso, u.serie,
               u.deve_trocar_senha, u.termos_aceitos_em, a.id_aluno, COALESCE(a.nome, p.nome, u.nome) AS nome, p.area, a.id_turma, t.serie AS turma_serie, t.nome_turma,
               p.id_professor
        FROM sessoes s
        JOIN usuarios u ON u.id_usuario = s.id_usuario
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN turmas t ON t.id_turma = a.id_turma
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1
    `).get(tokenHash, now);

    if (!session) {
        throw new ApiError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    // "Último acesso" da lista de dispositivos: gravado no máximo 1 vez por minuto por sessão.
    if (!session.ultimo_acesso || now - session.ultimo_acesso >= LAST_SEEN_INTERVAL_SECONDS) {
        database.prepare('UPDATE sessoes SET ultimo_acesso = ? WHERE token_hash = ?')
            .run(now, session.token_hash);
    }

    const classAccount = isClassAccount(session);
    return {
        tokenHash: session.token_hash,
        id_usuario: session.id_usuario,
        login: session.login,
        tipo_usuario: session.tipo_usuario,
        conta_compartilhada: isSharedStudentLogin(session.login),
        // Conta da turma: senha definida pela gestão, sem "primeiro acesso".
        conta_turma: classAccount,
        deve_trocar_senha: !classAccount && session.deve_trocar_senha === 1,
        termos_pendentes: termosPendentes(session.termos_aceitos_em),
        nome: session.nome,
        area: session.area,
        curso: session.curso,
        serie: session.turma_serie || session.serie,
        id_aluno: session.id_aluno,
        id_turma: session.id_turma,
        nome_turma: session.nome_turma,
        id_professor: session.id_professor
    };
}

module.exports = { authenticate };
