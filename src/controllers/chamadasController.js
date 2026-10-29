const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { parseSchoolDate } = require('../utils/dates');
const { schoolNow } = require('../utils/calendario');
const { attendancePercent } = require('../utils/frequencia');
const {
    requireRole, requireFields, getRecordId, positiveId, rejectUnknownFields, canAccessClass
} = require('./schoolController');

// Chamada de uma disciplina numa data: lista da turma com a presença já lançada e a frequência
// acumulada na disciplina; gravação em lote (upsert) numa única transação.

const MAX_BATCH = 200;

// Disciplina do professor (ou qualquer uma, para a gestão); fora do escopo responde 404.
function findDiscipline(user, disciplineId) {
    const discipline = database.prepare(`
        SELECT d.id_disciplina, d.id_turma FROM disciplinas d WHERE d.id_disciplina = ?
    `).get(disciplineId);
    if (!discipline || !canAccessClass(user, discipline.id_turma, discipline.id_disciplina)) {
        throw new ApiError(404, 'Disciplina não encontrada.');
    }
    return discipline;
}

function rollCall(discipline, date) {
    return database.prepare(`
        SELECT a.id_aluno, a.nome, f.presente,
               COUNT(h.id_frequencia) AS aulas, COALESCE(SUM(h.presente), 0) AS presencas
        FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.ativo = 1
        LEFT JOIN frequencias f
            ON f.id_aluno = a.id_aluno AND f.id_disciplina = ? AND f.data_aula = ?
        LEFT JOIN frequencias h ON h.id_aluno = a.id_aluno AND h.id_disciplina = ?
        WHERE a.id_turma = ?
        GROUP BY a.id_aluno
        ORDER BY a.nome COLLATE NOCASE
    `).all(discipline.id_disciplina, date, discipline.id_disciplina, discipline.id_turma)
        .map((row) => ({
            id_aluno: row.id_aluno,
            nome: row.nome,
            presente: row.presente === null ? null : row.presente === 1,
            frequencia: {
                aulas: row.aulas,
                presencas: row.presencas,
                faltas: row.aulas - row.presencas,
                percentual: attendancePercent(row.presencas, row.aulas)
            }
        }));
}

function classDate(value, field) {
    const date = parseSchoolDate(value, field, { allowTime: false });
    if (date > schoolNow().data) throw new ApiError(400, 'Não é possível lançar chamada em data futura.');
    return date;
}

function getRollCall(user, searchParams) {
    requireRole(user, ['professor', 'gestao']);
    if (!searchParams.has('id_disciplina') || !searchParams.has('data')) {
        throw new ApiError(400, 'Informe os parâmetros id_disciplina e data (AAAA-MM-DD).');
    }
    const disciplineId = getRecordId(searchParams.get('id_disciplina'));
    const date = parseSchoolDate(searchParams.get('data'), 'data', { allowTime: false });
    return rollCall(findDiscipline(user, disciplineId), date);
}

async function saveRollCall(request, response, user) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['id_disciplina', 'data_aula', 'presencas']);
    requireFields(body, ['id_disciplina', 'data_aula', 'presencas']);
    const disciplineId = positiveId(body.id_disciplina, 'id_disciplina');
    const date = classDate(body.data_aula, 'data_aula');
    if (!Array.isArray(body.presencas) || !body.presencas.length || body.presencas.length > MAX_BATCH) {
        throw new ApiError(400, `Envie em "presencas" de 1 a ${MAX_BATCH} itens { id_aluno, presente }.`);
    }
    const seen = new Set();
    const entries = body.presencas.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new ApiError(400, 'Cada item de "presencas" deve ser { id_aluno, presente }.');
        }
        rejectUnknownFields(entry, ['id_aluno', 'presente']);
        const studentId = positiveId(entry.id_aluno, 'id_aluno');
        if (typeof entry.presente !== 'boolean') {
            throw new ApiError(400, 'O campo "presente" deve ser verdadeiro ou falso.');
        }
        if (seen.has(studentId)) throw new ApiError(400, `O aluno ${studentId} aparece mais de uma vez.`);
        seen.add(studentId);
        return { studentId, present: entry.presente ? 1 : 0 };
    });

    const discipline = findDiscipline(user, disciplineId);
    const enrolled = new Set(database.prepare(`
        SELECT a.id_aluno FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.ativo = 1
        WHERE a.id_turma = ?
    `).all(discipline.id_turma).map((row) => row.id_aluno));
    const outside = entries.filter((entry) => !enrolled.has(entry.studentId)).map((entry) => entry.studentId);
    if (outside.length) {
        throw new ApiError(400, `Aluno(s) fora da turma da disciplina: ${outside.join(', ')}.`);
    }

    const upsert = database.prepare(`
        INSERT INTO frequencias (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id_aluno, id_disciplina, data_aula)
        DO UPDATE SET presente = excluded.presente, id_usuario_registro = excluded.id_usuario_registro
    `);
    database.exec('BEGIN IMMEDIATE');
    try {
        for (const entry of entries) {
            upsert.run(entry.studentId, disciplineId, user.id_usuario, date, entry.present);
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    sendJson(response, 200, rollCall(discipline, date));
}

async function handleChamadasRequest(request, response, user, parts, searchParams) {
    if (parts.length !== 2) throw new ApiError(404, 'Rota não encontrada.');
    if (request.method === 'GET') {
        sendJson(response, 200, getRollCall(user, searchParams));
    } else if (request.method === 'PUT') {
        await saveRollCall(request, response, user);
    } else {
        throw new ApiError(405, 'Método não permitido.');
    }
}

module.exports = { handleChamadasRequest };
