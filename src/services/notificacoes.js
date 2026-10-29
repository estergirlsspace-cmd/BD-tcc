// Ganchos de notificação por e-mail. Os chamadores não esperam o envio (fire-and-forget):
// falha de e-mail nunca pode quebrar a ação principal.
const database = require('../database');
const email = require('./email');

const PORTAL_PATH = { aluno: '/aluno', professor: '/professor', gestao: '/gestao' };
const MESSAGE_EMAIL_WINDOW_MINUTES = 30;
const CONFIRM_EMAIL_HOURS = 24;
const RESET_PASSWORD_MINUTES = 30;

// Executa o gancho fora da requisição; qualquer erro só vai para o log.
function detach(name, task) {
    setImmediate(() => {
        Promise.resolve().then(task).catch((error) => {
            console.error(`[email] erro no gancho ${name}: ${error.name}`);
        });
    });
}

// Alunos ativos no público do aviso (mesma regra de studentNoticeScope em utils/audience.js).
function noticeAudienceStudents(notice) {
    return database.prepare(`
        SELECT u.id_usuario
        FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario
        JOIN turmas t ON t.id_turma = a.id_turma
        WHERE u.ativo = 1 AND u.tipo_usuario = 'aluno' AND u.email IS NOT NULL
          AND (? IS NULL OR a.id_turma = ?)
          AND (? IS NULL OR u.curso = ?)
          AND (? IS NULL OR COALESCE(t.serie, u.serie) = ?)
    `).all(notice.id_turma, notice.id_turma, notice.curso, notice.curso,
        notice.serie, notice.serie).map((row) => row.id_usuario);
}

function onNoticePublished(postId) {
    detach('onNoticePublished', async () => {
        const notice = database.prepare(`
            SELECT p.id_post, p.titulo, p.conteudo, p.urgente, p.id_turma, p.curso, p.serie,
                   COALESCE(pr.nome, u.nome, CASE u.tipo_usuario WHEN 'gestao' THEN 'Coordenação'
                       ELSE 'Professor(a)' END) AS autor
            FROM posts_avisos p
            JOIN usuarios u ON u.id_usuario = p.id_usuario_autor
            LEFT JOIN professores pr ON pr.id_usuario = u.id_usuario
            WHERE p.id_post = ?
        `).get(postId);
        // Avisos não urgentes não geram e-mail imediato: entram no resumo semanal.
        if (!notice || notice.urgente !== 1) return;
        for (const userId of noticeAudienceStudents(notice)) {
            const to = email.recipient(userId, 'urgente');
            await email.sendOnce(`urgente:${notice.id_post}:${userId}`, 'cw-aviso-urgente', to, {
                NOME: to?.nome,
                TITULO: email.truncate(notice.titulo, 200),
                RESUMO: email.truncate(notice.conteudo, 400),
                AUTOR: notice.autor,
                LINK: email.appUrl('/aluno')
            });
        }
    });
}

function onPasswordChanged(userId) {
    detach('onPasswordChanged', async () => {
        const to = email.recipient(userId);
        await email.sendTemplate('cw-senha-alterada', to, {
            NOME: to?.nome,
            DATA_HORA: email.formatSchoolDateTime(Date.now())
        });
    });
}

// O e-mail informado pela gestão no cadastro ainda não está confirmado (não vira e-mail de
// recuperação): o aviso de conta criada vai para esse endereço junto com o link de confirmação.
function onStaffCreated(userId, pendingAddress = null) {
    detach('onStaffCreated', async () => {
        const to = pendingAddress
            ? accountWithAddress(userId, pendingAddress)
            : email.recipient(userId);
        if (!to) return;
        const { login } = database.prepare('SELECT login FROM usuarios WHERE id_usuario = ?')
            .get(userId);
        await email.sendTemplate('cw-conta-criada', to, {
            NOME: to.nome,
            LOGIN: login,
            LINK: email.appUrl('/')
        });
    });
}

// Destinatário para um endereço ainda não gravado em usuarios.email (conta ativa), ou null.
function accountWithAddress(userId, address) {
    const account = database.prepare(`
        SELECT u.id_usuario, COALESCE(a.nome, p.nome, u.nome, u.login) AS nome
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.id_usuario = ? AND u.ativo = 1
    `).get(userId);
    return account ? { ...account, email: address } : null;
}

// Link de confirmação vai para o endereço novo (ainda não gravado em usuarios.email).
function sendEmailConfirmation(userId, address, token) {
    detach('sendEmailConfirmation', async () => {
        const account = accountWithAddress(userId, address);
        if (!account) return;
        await email.sendTemplate('cw-confirmar-email', { id_usuario: userId, email: address }, {
            NOME: account.nome,
            LINK: email.appUrl(`/confirmar-email#token=${token}`),
            VALIDADE_HORAS: CONFIRM_EMAIL_HOURS
        });
    });
}

function sendPasswordReset(userId, token) {
    detach('sendPasswordReset', async () => {
        const to = email.recipient(userId);
        await email.sendTemplate('cw-redefinir-senha', to, {
            NOME: to?.nome,
            LINK: email.appUrl(`/redefinir#token=${token}`),
            VALIDADE_MINUTOS: RESET_PASSWORD_MINUTES
        });
    });
}

// No máximo 1 e-mail por conversa e destinatário a cada 30 minutos.
function onMessageSent(messageId) {
    detach('onMessageSent', async () => {
        const message = database.prepare(`
            SELECT m.id_conversa, m.id_autor, m.texto,
                   CASE WHEN c.id_usuario_a = m.id_autor THEN c.id_usuario_b
                        ELSE c.id_usuario_a END AS id_destinatario,
                   COALESCE(a.nome, p.nome, u.nome, u.login) AS remetente
            FROM mensagens m
            JOIN conversas c ON c.id_conversa = m.id_conversa
            JOIN usuarios u ON u.id_usuario = m.id_autor
            LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
            LEFT JOIN professores p ON p.id_usuario = u.id_usuario
            WHERE m.id_mensagem = ?
        `).get(messageId);
        if (!message) return;
        const to = email.recipient(message.id_destinatario, 'mensagens');
        if (!to) return;
        const key = `mensagem:${message.id_conversa}:${to.id_usuario}`;
        if (!email.claimKeyWithWindow(key, MESSAGE_EMAIL_WINDOW_MINUTES)) return;
        await email.sendTemplate('cw-nova-mensagem', to, {
            NOME: to.nome,
            REMETENTE: message.remetente,
            TRECHO: email.truncate(message.texto, 200),
            LINK: email.appUrl(PORTAL_PATH[to.perfil] || '/')
        });
    });
}

module.exports = {
    onNoticePublished,
    onPasswordChanged,
    onStaffCreated,
    onMessageSent,
    sendEmailConfirmation,
    sendPasswordReset,
    CONFIRM_EMAIL_HOURS,
    RESET_PASSWORD_MINUTES
};

// O agendador (lembretes e resumo semanal) começa na primeira carga deste módulo.
// CW_AGENDADOR=0 desliga (testes e scripts).
if (process.env.CW_AGENDADOR !== '0') {
    require('./agendador').start();
}
