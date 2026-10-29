const database = require('../database');
const { ApiError } = require('../errors');
const { sendJson } = require('../utils/http');
const { requireRole } = require('./schoolController');
const { schoolNow } = require('../utils/calendario');
const { MIN_ATTENDANCE, attendancePercent } = require('../utils/frequencia');
const { sendCsv, decimal } = require('../utils/csv');

// Painéis do professor e da gestão e relatórios em CSV. Tudo é calculado na hora a partir de
// frequencias, entregas, justificativas e ocorrências; nada de totais gravados.

const ATTENTION_LIMIT = 20;
const RECENT_ACTIVITIES = 10;

// Alunos com conta ativa numa turma (expressão SQL com o id da turma).
const activeStudentsIn = (classExpression) => `(SELECT COUNT(*) FROM alunos sa
    JOIN usuarios su ON su.id_usuario = sa.id_usuario AND su.ativo = 1
    WHERE sa.id_turma = ${classExpression})`;

function unreadMessages(user) {
    return database.prepare(`
        SELECT COUNT(*) AS n FROM mensagens m
        JOIN conversas c ON c.id_conversa = m.id_conversa
        WHERE (c.id_usuario_a = ? OR c.id_usuario_b = ?) AND m.id_autor != ? AND m.lida_em IS NULL
    `).get(user.id_usuario, user.id_usuario, user.id_usuario).n;
}

function teacherDashboard(user) {
    const now = schoolNow();
    const teacherId = user.id_professor || -1;

    const lessons = database.prepare(`
        SELECT h.id_horario, h.id_disciplina, d.nome_disciplina, h.id_turma, t.nome_turma,
               h.hora_inicio, h.hora_fim, h.sala,
               EXISTS (SELECT 1 FROM frequencias f
                   WHERE f.id_disciplina = h.id_disciplina AND f.data_aula = ?) AS chamada_feita
        FROM horarios h
        JOIN disciplinas d ON d.id_disciplina = h.id_disciplina
        JOIN turmas t ON t.id_turma = h.id_turma
        WHERE d.id_professor = ? AND h.dia_semana = ?
        ORDER BY h.hora_inicio
    `).all(now.data, teacherId, now.dia_semana).map((lesson) => ({
        ...lesson,
        chamada_feita: lesson.chamada_feita === 1,
        em_andamento: lesson.hora_inicio <= now.hora && now.hora < lesson.hora_fim
    }));

    // Frequência da turma nas disciplinas deste professor.
    const classes = database.prepare(`
        SELECT t.id_turma, t.nome_turma, ${activeStudentsIn('t.id_turma')} AS alunos,
               COUNT(f.id_frequencia) AS aulas, COALESCE(SUM(f.presente), 0) AS presencas
        FROM turmas t
        JOIN disciplinas d ON d.id_turma = t.id_turma AND d.id_professor = ?
        LEFT JOIN frequencias f ON f.id_disciplina = d.id_disciplina
        GROUP BY t.id_turma
        ORDER BY t.serie, t.nome_turma
    `).all(teacherId).map(({ aulas, presencas, ...schoolClass }) => ({
        ...schoolClass,
        frequencia: attendancePercent(presencas, aulas)
    }));

    const submissions = database.prepare(`
        SELECT at.id_atividade, at.titulo, at.prazo, at.id_turma, t.nome_turma, d.nome_disciplina,
               (SELECT COUNT(*) FROM entregas_atividades e
                   WHERE e.id_atividade = at.id_atividade) AS enviadas,
               ${activeStudentsIn('at.id_turma')} AS total
        FROM atividades at
        JOIN disciplinas d ON d.id_disciplina = at.id_disciplina
        JOIN turmas t ON t.id_turma = at.id_turma
        WHERE d.id_professor = ? AND at.tipo = 'atividade'
        ORDER BY COALESCE(at.prazo, at.criado_em) DESC, at.id_atividade DESC
        LIMIT ${RECENT_ACTIVITIES}
    `).all(teacherId);

    const pendingJustifications = database.prepare(`
        SELECT COUNT(*) AS n FROM justificativas j
        JOIN disciplinas d ON d.id_disciplina = j.id_disciplina
        WHERE d.id_professor = ? AND j.situacao = 'pendente'
    `).get(teacherId).n;

    return {
        hoje: { data: now.data, dia_semana: now.dia_semana },
        aulas_hoje: lessons,
        aula_em_andamento: lessons.find((lesson) => lesson.em_andamento) || null,
        turmas: classes,
        entregas: submissions,
        justificativas_pendentes: pendingJustifications,
        mensagens_nao_lidas: unreadMessages(user)
    };
}

// Frequência geral de cada aluno ativo, com as ocorrências abertas.
function studentSummaries() {
    return database.prepare(`
        SELECT a.id_aluno, a.nome, u.login AS matricula, t.id_turma, t.nome_turma,
               COUNT(f.id_frequencia) AS aulas, COALESCE(SUM(f.presente), 0) AS presencas,
               (SELECT COUNT(*) FROM ocorrencias o
                   WHERE o.id_aluno = a.id_aluno AND o.situacao = 'aberta') AS ocorrencias_abertas
        FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.ativo = 1
        JOIN turmas t ON t.id_turma = a.id_turma
        LEFT JOIN frequencias f ON f.id_aluno = a.id_aluno
        GROUP BY a.id_aluno
        ORDER BY t.serie, t.nome_turma, a.nome COLLATE NOCASE
    `).all().map((student) => ({
        ...student,
        faltas: student.aulas - student.presencas,
        frequencia: attendancePercent(student.presencas, student.aulas)
    }));
}

const belowMinimum = (student) => student.frequencia !== null && student.frequencia < MIN_ATTENDANCE;

function managementDashboard(user) {
    const students = studentSummaries();
    const totals = students.reduce((sum, student) => ({
        aulas: sum.aulas + student.aulas,
        presencas: sum.presencas + student.presencas
    }), { aulas: 0, presencas: 0 });

    const byClass = new Map(database.prepare(
        'SELECT id_turma, nome_turma FROM turmas ORDER BY serie, nome_turma'
    ).all().map((schoolClass) => [schoolClass.id_turma,
        { ...schoolClass, alunos: 0, aulas: 0, presencas: 0 }]));
    for (const student of students) {
        const entry = byClass.get(student.id_turma);
        entry.alunos += 1;
        entry.aulas += student.aulas;
        entry.presencas += student.presencas;
    }

    const attention = students
        .filter((student) => belowMinimum(student) || student.ocorrencias_abertas > 0)
        .sort((a, b) => (a.frequencia ?? 101) - (b.frequencia ?? 101)
            || b.ocorrencias_abertas - a.ocorrencias_abertas)
        .slice(0, ATTENTION_LIMIT)
        .map((student) => ({
            id_aluno: student.id_aluno,
            nome: student.nome,
            turma: student.nome_turma,
            frequencia: student.frequencia,
            faltas: student.faltas,
            ocorrencias_abertas: student.ocorrencias_abertas
        }));

    const count = (sql) => database.prepare(sql).get().n;
    return {
        kpis: {
            alunos: students.length,
            frequencia_media: attendancePercent(totals.presencas, totals.aulas),
            alunos_abaixo_75: students.filter(belowMinimum).length,
            ocorrencias_abertas: count("SELECT COUNT(*) AS n FROM ocorrencias WHERE situacao = 'aberta'"),
            justificativas_pendentes: count(
                "SELECT COUNT(*) AS n FROM justificativas WHERE situacao = 'pendente'")
        },
        frequencia_por_turma: [...byClass.values()].map(({ aulas, presencas, ...schoolClass }) => ({
            ...schoolClass,
            frequencia: attendancePercent(presencas, aulas)
        })),
        alunos_atencao: attention,
        mensagens_nao_lidas: unreadMessages(user)
    };
}

function attendanceReport(response) {
    const rows = database.prepare(`
        SELECT t.nome_turma, u.login AS matricula, a.nome, d.nome_disciplina,
               COUNT(f.id_frequencia) AS aulas, COALESCE(SUM(f.presente), 0) AS presencas,
               COUNT(j.id_justificativa) AS justificadas
        FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.ativo = 1
        JOIN turmas t ON t.id_turma = a.id_turma
        JOIN disciplinas d ON d.id_turma = a.id_turma
        LEFT JOIN frequencias f ON f.id_aluno = a.id_aluno AND f.id_disciplina = d.id_disciplina
        LEFT JOIN justificativas j ON f.presente = 0 AND j.situacao = 'aceita'
            AND j.id_aluno = f.id_aluno AND j.id_disciplina = f.id_disciplina
            AND j.data_falta = f.data_aula
        GROUP BY a.id_aluno, d.id_disciplina
        ORDER BY t.serie, t.nome_turma, a.nome COLLATE NOCASE, d.nome_disciplina
    `).all().map((row) => [
        row.nome_turma, row.matricula, row.nome, row.nome_disciplina, row.aulas, row.presencas,
        row.aulas - row.presencas, row.justificadas, decimal(attendancePercent(row.presencas, row.aulas))
    ]);
    sendCsv(response, `frequencia-${schoolNow().data}.csv`,
        ['Turma', 'Matrícula', 'Aluno', 'Disciplina', 'Aulas', 'Presenças', 'Faltas',
            'Faltas justificadas', 'Frequência (%)'],
        rows);
}

function atRiskReport(response) {
    const rows = studentSummaries().filter(belowMinimum)
        .sort((a, b) => a.frequencia - b.frequencia)
        .map((student) => [
            student.nome_turma, student.matricula, student.nome, student.aulas, student.faltas,
            decimal(student.frequencia), student.ocorrencias_abertas
        ]);
    sendCsv(response, `alunos-em-risco-${schoolNow().data}.csv`,
        ['Turma', 'Matrícula', 'Aluno', 'Aulas', 'Faltas', 'Frequência (%)', 'Ocorrências abertas'],
        rows);
}

const REPORTS = { 'frequencia.csv': attendanceReport, 'alunos-em-risco.csv': atRiskReport };

async function handlePainelRequest(request, response, user, parts) {
    if (parts[1] === 'painel' && parts.length === 2) {
        if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        requireRole(user, ['professor', 'gestao']);
        sendJson(response, 200, user.tipo_usuario === 'gestao'
            ? managementDashboard(user)
            : teacherDashboard(user));
        return;
    }
    if (parts[1] === 'relatorios' && parts.length === 3 && Object.hasOwn(REPORTS, parts[2])) {
        if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        requireRole(user, ['gestao']);
        REPORTS[parts[2]](response);
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handlePainelRequest };
