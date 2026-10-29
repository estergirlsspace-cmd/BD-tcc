// E-mails automáticos que rodam dentro do processo do servidor, a cada 5 minutos, no horário de
// Brasília: lembrete de prazo (18h do dia anterior) e resumo semanal de avisos não lidos
// (segunda a partir das 7h). Cada envio tem uma chave em envios_email, então rodar de novo
// (ou reiniciar o servidor) não repete e-mails.
const database = require('../database');
const email = require('./email');
const { deadlineTimestamp, SCHOOL_UTC_OFFSET_HOURS } = require('../utils/dates');
const { studentNoticeScope } = require('../utils/audience');

const TICK_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_TICK_DELAY_MS = 30 * 1000;
const REMINDER_HOUR = 18;
const DIGEST_WEEKDAY = 1; // segunda-feira
const DIGEST_HOUR = 7;
const DIGEST_MAX_ITEMS = 10;
// O resumo só lembra avisos recentes: não lidos de meses atrás não entram.
const DIGEST_LOOKBACK_DAYS = 14;
const SENT_KEYS_RETENTION_DAYS = 60;
// LGPD (política em README.md, "Privacidade e LGPD"): o registro de auditoria fica 2 anos;
// sessões expiradas e tokens vencidos são apagados assim que vencem.
const AUDIT_RETENTION_YEARS = 2;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad = (value) => String(value).padStart(2, '0');

// Mesmo formato de CURRENT_TIMESTAMP do SQLite ("AAAA-MM-DD HH:MM:SS", UTC).
function sqliteTimestamp(ms) {
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function schoolDateString(ms) {
    const p = email.schoolParts(ms);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Semana ISO 8601 da data (no horário de Brasília), ex.: "2026-W44".
function isoWeek(ms) {
    const p = email.schoolParts(ms);
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - weekday);
    const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((date - yearStart) / DAY_MS + 1) / 7);
    return `${date.getUTCFullYear()}-W${pad(week)}`;
}

// 18h (Brasília) do dia anterior ao dia em que o prazo termina.
function reminderTimestamp(deadline) {
    const p = email.schoolParts(deadline);
    return Date.UTC(p.year, p.month - 1, p.day - 1, REMINDER_HOUR) - SCHOOL_UTC_OFFSET_HOURS * HOUR_MS;
}

async function sendDeadlineReminders(now) {
    // Filtro largo pela data do texto; a janela exata é calculada abaixo.
    const activities = database.prepare(`
        SELECT a.id_atividade, a.titulo, a.prazo, a.id_turma, d.nome_disciplina
        FROM atividades a
        JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
        WHERE a.tipo = 'atividade' AND a.prazo IS NOT NULL
          AND substr(a.prazo, 1, 10) BETWEEN ? AND ?
    `).all(schoolDateString(now - DAY_MS), schoolDateString(now + 2 * DAY_MS));
    let sent = 0;
    for (const activity of activities) {
        const deadline = deadlineTimestamp(activity.prazo);
        if (!Number.isFinite(deadline) || now < reminderTimestamp(deadline) || now >= deadline) {
            continue;
        }
        const students = database.prepare(`
            SELECT u.id_usuario
            FROM alunos al
            JOIN usuarios u ON u.id_usuario = al.id_usuario
            WHERE al.id_turma = ? AND u.ativo = 1 AND u.email IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM entregas_atividades e
                  WHERE e.id_atividade = ? AND e.id_aluno = al.id_aluno
              )
        `).all(activity.id_turma, activity.id_atividade);
        for (const { id_usuario: userId } of students) {
            const to = email.recipient(userId, 'prazos');
            const result = await email.sendOnce(`prazo:${activity.id_atividade}:${userId}`,
                'cw-lembrete-prazo', to, {
                    NOME: to?.nome,
                    ATIVIDADE: email.truncate(activity.titulo, 200),
                    DISCIPLINA: activity.nome_disciplina,
                    PRAZO: email.formatSchoolDateTime(deadline),
                    LINK: email.appUrl('/aluno')
                });
            if (result === 'ok') sent += 1;
        }
    }
    return sent;
}

// Mesma categoria do mural (muralController): define qual silenciamento vale para o aviso.
function noticeNotificationType(notice) {
    if (notice.urgente === 1) return 'urgente';
    if (notice.tipo === 'evento') return 'eventos';
    return 'turma';
}

// Não lidos publicados nos últimos DIGEST_LOOKBACK_DAYS dias (criado_em é UTC, como CURRENT_TIMESTAMP).
function unreadNoticesFor(student, now) {
    const scope = studentNoticeScope(student, 'p');
    if (!scope) return [];
    const silenced = new Set(database.prepare(
        'SELECT tipo FROM notificacoes_silenciadas WHERE id_usuario = ?'
    ).all(student.id_usuario).map((row) => row.tipo));
    return database.prepare(`
        SELECT p.id_post, p.titulo, p.tipo, p.urgente
        FROM posts_avisos p
        LEFT JOIN avisos_usuarios au ON au.id_post = p.id_post AND au.id_usuario = ?
        WHERE au.lido_em IS NULL AND p.criado_em >= ?
          AND ${scope.clause}
        ORDER BY p.urgente DESC, p.criado_em DESC, p.id_post DESC
    `).all(student.id_usuario, sqliteTimestamp(now - DIGEST_LOOKBACK_DAYS * DAY_MS), ...scope.params)
        .filter((notice) => !silenced.has(noticeNotificationType(notice)));
}

async function sendWeeklyDigest(now) {
    const p = email.schoolParts(now);
    if (p.weekday !== DIGEST_WEEKDAY || p.hour < DIGEST_HOUR) return 0;
    const week = isoWeek(now);
    const students = database.prepare(`
        SELECT u.id_usuario, u.curso, a.id_turma, COALESCE(t.serie, u.serie) AS serie
        FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario
        JOIN turmas t ON t.id_turma = a.id_turma
        WHERE u.ativo = 1 AND u.tipo_usuario = 'aluno' AND u.email IS NOT NULL
    `).all();
    let sent = 0;
    for (const student of students) {
        const key = `resumo:${week}:${student.id_usuario}`;
        if (database.prepare('SELECT 1 FROM envios_email WHERE chave = ?').get(key)) continue;
        const notices = unreadNoticesFor({ ...student, conta_compartilhada: false }, now);
        if (!notices.length) continue;
        const shown = notices.slice(0, DIGEST_MAX_ITEMS).map((notice) => email.truncate(notice.titulo, 150));
        const rest = notices.length - shown.length;
        const more = rest > 0 ? [`e mais ${rest} aviso${rest === 1 ? '' : 's'}`] : [];
        const to = email.recipient(student.id_usuario);
        const result = await email.sendOnce(key, 'cw-resumo-avisos', to, {
            NOME: to?.nome,
            QUANTIDADE: notices.length,
            LISTA_HTML: [...shown, ...more].map((item) => `<li>${email.escapeHtml(item)}</li>`).join(''),
            LISTA_TEXTO: [...shown, ...more].map((item) => `- ${item}`).join('\n'),
            LINK: email.appUrl('/aluno')
        }, { rawFields: ['LISTA_HTML'] });
        if (result === 'ok') sent += 1;
    }
    return sent;
}

function purgeExpired(now) {
    database.prepare('DELETE FROM tokens WHERE expira_em <= ?').run(Math.floor(now / 1000));
    database.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(Math.floor(now / 1000));
    database.prepare("DELETE FROM auditoria WHERE criado_em < datetime('now', ?)")
        .run(`-${AUDIT_RETENTION_YEARS} years`);
    database.prepare("DELETE FROM envios_email WHERE enviado_em < datetime('now', ?)")
        .run(`-${SENT_KEYS_RETENTION_DAYS} days`);
}

let running = false;

// Uma rodada do agendador. `now` (ms) pode ser simulado nos testes.
async function runTick(now = Date.now()) {
    if (running) return { lembretes: 0, resumos: 0, ignorada: true };
    running = true;
    try {
        purgeExpired(Date.now());
        const lembretes = await sendDeadlineReminders(now);
        const resumos = await sendWeeklyDigest(now);
        return { lembretes, resumos };
    } finally {
        running = false;
    }
}

let started = false;

function start() {
    if (started) return;
    started = true;
    const tick = () => runTick().catch((error) => {
        console.error(`[agendador] erro na rodada: ${error.name}: ${error.message}`);
    });
    setTimeout(tick, FIRST_TICK_DELAY_MS).unref();
    setInterval(tick, TICK_INTERVAL_MS).unref();
}

module.exports = { start, runTick, isoWeek, reminderTimestamp };
