const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { parseBody } = require('../utils/validation');

function publicRecord(resource, record, user) {
    if (!record) {
        return record;
    }

    const hiddenFields = [];
    if (resource.secret) hiddenFields.push(resource.secret);
    if (resource.table === 'posts_avisos' && user.tipo_usuario === 'aluno') {
        hiddenFields.push('id_usuario_autor');
    }
    if (!hiddenFields.length) return record;
    const publicFields = { ...record };
    for (const field of hiddenFields) delete publicFields[field];
    return publicFields;
}

// Registros que seriam apagados em cascata junto com o item. Se houver algum, a exclusão é
// recusada: o histórico escolar não pode sumir (contas devem ser desativadas, não excluídas).
const HISTORY_CHECKS = {
    usuarios: [
        ['avisos publicados', 'SELECT COUNT(*) AS n FROM posts_avisos WHERE id_usuario_autor = ?'],
        ['atividades publicadas', 'SELECT COUNT(*) AS n FROM atividades WHERE id_usuario_autor = ?'],
        ['frequências registradas', 'SELECT COUNT(*) AS n FROM frequencias WHERE id_usuario_registro = ?'],
        ['frequências como aluno', `SELECT COUNT(*) AS n FROM frequencias f
            JOIN alunos a ON a.id_aluno = f.id_aluno WHERE a.id_usuario = ?`],
        ['entregas de atividades', `SELECT COUNT(*) AS n FROM entregas_atividades e
            JOIN alunos a ON a.id_aluno = e.id_aluno WHERE a.id_usuario = ?`]
    ],
    alunos: [
        ['frequências', 'SELECT COUNT(*) AS n FROM frequencias WHERE id_aluno = ?'],
        ['entregas de atividades', 'SELECT COUNT(*) AS n FROM entregas_atividades WHERE id_aluno = ?']
    ],
    turmas: [
        ['alunos matriculados', 'SELECT COUNT(*) AS n FROM alunos WHERE id_turma = ?'],
        ['disciplinas', 'SELECT COUNT(*) AS n FROM disciplinas WHERE id_turma = ?'],
        ['avisos', 'SELECT COUNT(*) AS n FROM posts_avisos WHERE id_turma = ?'],
        ['atividades', 'SELECT COUNT(*) AS n FROM atividades WHERE id_turma = ?']
    ],
    disciplinas: [
        ['atividades', 'SELECT COUNT(*) AS n FROM atividades WHERE id_disciplina = ?'],
        ['frequências', 'SELECT COUNT(*) AS n FROM frequencias WHERE id_disciplina = ?'],
        ['horários', 'SELECT COUNT(*) AS n FROM horarios WHERE id_disciplina = ?']
    ]
};

function assertDeletable(table, recordId) {
    const found = (HISTORY_CHECKS[table] || [])
        .map(([label, sql]) => [label, database.prepare(sql).get(recordId).n])
        .filter(([, count]) => count > 0);
    if (!found.length) return;
    const details = found.map(([label, count]) => `${count} ${label}`).join(', ');
    const advice = ['usuarios', 'alunos'].includes(table)
        ? 'Desative a conta em vez de excluir.'
        : 'Remova ou transfira esses registros antes.';
    throw new ApiError(409, `Não é possível excluir: há histórico vinculado (${details}). ${advice}`);
}

// Aviso para uma turma não pode indicar outro curso ou série: ficaria invisível para todos.
function assertCoherentAudience(notice) {
    if (!notice.id_turma) return;
    const schoolClass = database.prepare(
        'SELECT curso, serie FROM turmas WHERE id_turma = ?'
    ).get(notice.id_turma);
    if (!schoolClass) throw new ApiError(400, 'A turma informada não existe.');
    if ((notice.curso != null && notice.curso !== schoolClass.curso)
        || (notice.serie != null && notice.serie !== schoolClass.serie)) {
        throw new ApiError(400,
            'O público do aviso é contraditório: a turma escolhida é de outro curso ou série.');
    }
}

function listRecords(resource, user) {
    let where = '';
    let params = [];

    if (user.tipo_usuario === 'aluno') {
        if (!user.id_turma && !user.conta_compartilhada
            && ['turmas', 'disciplinas', 'posts_avisos'].includes(resource.table)) {
            return [];
        }
        if (resource.table === 'turmas') {
            where = user.conta_compartilhada
                ? ' WHERE curso = ? AND serie = ?'
                : ' WHERE id_turma = ?';
            params = user.conta_compartilhada
                ? [user.curso, user.serie]
                : [user.id_turma];
        } else if (resource.table === 'disciplinas') {
            where = user.conta_compartilhada
                ? ` WHERE id_turma IN (
                    SELECT id_turma FROM turmas WHERE curso = ? AND serie = ?
                )`
                : ' WHERE id_turma = ?';
            params = user.conta_compartilhada
                ? [user.curso, user.serie]
                : [user.id_turma];
        } else if (resource.table === 'posts_avisos') {
            where = user.conta_compartilhada
                ? ` WHERE (id_turma IS NULL OR id_turma IN (
                        SELECT id_turma FROM turmas WHERE curso = ? AND serie = ?
                    ))
                    AND (curso IS NULL OR curso = ?)
                    AND (serie IS NULL OR serie = ?)`
                : ` WHERE (id_turma IS NULL OR id_turma = ?)
                    AND (curso IS NULL OR curso = ?)
                    AND (serie IS NULL OR serie = ?)`;
            params = user.conta_compartilhada
                ? [user.curso, user.serie, user.curso, user.serie]
                : [user.id_turma, user.curso, user.serie];
        } else {
            return [];
        }
    } else if (user.tipo_usuario === 'professor') {
        if (resource.table === 'turmas') {
            if (!user.id_professor) return [];
            where = ` WHERE id_turma IN (
                SELECT id_turma FROM disciplinas WHERE id_professor = ?
            )`;
            params = [user.id_professor];
        } else if (resource.table === 'disciplinas') {
            where = ' WHERE id_professor = ?';
            params = [user.id_professor || -1];
        } else if (resource.table === 'posts_avisos') {
            where = ` WHERE id_usuario_autor = ?
                OR id_turma IN (SELECT id_turma FROM disciplinas WHERE id_professor = ?)
                OR (id_turma IS NULL AND EXISTS (
                    SELECT 1
                    FROM disciplinas d
                    JOIN turmas t ON t.id_turma = d.id_turma
                    WHERE d.id_professor = ?
                      AND (posts_avisos.curso IS NULL OR posts_avisos.curso = t.curso)
                      AND (posts_avisos.serie IS NULL OR posts_avisos.serie = t.serie)
                ))`;
            params = [
                user.id_usuario,
                user.id_professor || -1,
                user.id_professor || -1
            ];
        } else {
            return [];
        }
    }

    // Avisos: do mais recente para o mais antigo, como em um mural.
    const orderBy = resource.table === 'posts_avisos'
        ? 'criado_em DESC, id_post DESC'
        : resource.id;
    return database.prepare(
        `SELECT * FROM ${resource.table}${where} ORDER BY ${orderBy}`
    ).all(...params)
        .map((record) => publicRecord(resource, record, user));
}

async function handleCollection(request, response, resource, user) {
    if (request.method === 'GET') {
        sendJson(response, 200, listRecords(resource, user));
        return;
    }

    if (request.method !== 'POST') {
        throw new ApiError(405, 'Método não permitido.');
    }

    const body = await readBody(request);
    if (resource.table === 'posts_avisos') {
        if (user.tipo_usuario === 'professor'
            && (!Number.isSafeInteger(body.id_turma)
                || !database.prepare(`
                    SELECT 1 FROM disciplinas
                    WHERE id_turma = ? AND id_professor = ?
                `).get(body.id_turma, user.id_professor || -1))) {
            throw new ApiError(403, 'Professor só pode publicar avisos para uma turma vinculada.');
        }
        body.id_usuario_autor = user.id_usuario;
    }
    const values = await parseBody(body, resource, true);
    if (resource.table === 'posts_avisos') assertCoherentAudience(values);
    if (resource.table === 'alunos') {
        const student = database.prepare(
            'SELECT tipo_usuario, curso, serie FROM usuarios WHERE id_usuario = ?'
        ).get(values.id_usuario);
        const schoolClass = database.prepare(
            'SELECT curso, serie FROM turmas WHERE id_turma = ?'
        ).get(values.id_turma);
        if (!student || student.tipo_usuario !== 'aluno' || !schoolClass
            || student.curso !== schoolClass.curso
            || (student.serie !== null && student.serie !== schoolClass.serie)) {
            throw new ApiError(400, 'A matrícula deve vincular um usuário aluno a uma turma do mesmo curso.');
        }
    }
    // Senha definida pela gestão é provisória: o usuário precisa trocá-la no primeiro acesso.
    if (resource.table === 'usuarios') values.deve_trocar_senha = 1;
    const fields = Object.keys(values);
    const placeholders = fields.map(() => '?').join(', ');
    const result = database.prepare(
        `INSERT INTO ${resource.table} (${fields.join(', ')}) VALUES (${placeholders})`
    ).run(...fields.map((field) => values[field]));
    const record = database.prepare(
        `SELECT * FROM ${resource.table} WHERE ${resource.id} = ?`
    ).get(Number(result.lastInsertRowid));

    sendJson(response, 201, publicRecord(resource, record, user));
}

async function handleRecord(request, response, resource, id, user) {
    if (!/^[1-9]\d*$/.test(id)) {
        throw new ApiError(400, 'O identificador deve ser um número inteiro positivo.');
    }

    const recordId = Number(id);
    if (!Number.isSafeInteger(recordId)) {
        throw new ApiError(400, 'Identificador inválido.');
    }

    const currentRecord = database.prepare(
        `SELECT * FROM ${resource.table} WHERE ${resource.id} = ?`
    ).get(recordId);
    if (resource.table === 'posts_avisos' && user.tipo_usuario === 'professor'
        && currentRecord?.id_usuario_autor !== user.id_usuario) {
        throw new ApiError(404, 'Aviso não encontrado.');
    }

    if (request.method === 'GET') {
        const record = listRecords(resource, user)
            .find((entry) => entry[resource.id] === recordId);
        if (!record) {
            throw new ApiError(404, 'Registro não encontrado.');
        }
        sendJson(response, 200, publicRecord(resource, record, user));
        return;
    }

    if (request.method === 'DELETE') {
        assertDeletable(resource.table, recordId);
        const result = database.prepare(
            `DELETE FROM ${resource.table} WHERE ${resource.id} = ?`
        ).run(recordId);
        if (result.changes === 0) {
            throw new ApiError(404, 'Registro não encontrado.');
        }
        response.writeHead(204);
        response.end();
        return;
    }

    if (request.method !== 'PATCH') {
        throw new ApiError(405, 'Método não permitido.');
    }

    const body = await readBody(request);
    if (resource.table === 'posts_avisos') {
        if (user.tipo_usuario === 'professor' && body.id_turma !== undefined
            && (!Number.isSafeInteger(body.id_turma)
                || !database.prepare(`
                    SELECT 1 FROM disciplinas
                    WHERE id_turma = ? AND id_professor = ?
                `).get(body.id_turma, user.id_professor || -1))) {
            throw new ApiError(403, 'Professor só pode direcionar avisos a uma turma vinculada.');
        }
        if (user.tipo_usuario === 'professor'
            && (body.curso !== undefined || body.serie !== undefined)) {
            throw new ApiError(403, 'Professor não pode ampliar o público de um aviso para outras turmas.');
        }
        delete body.id_usuario_autor;
    }
    const values = await parseBody(body, resource, false);
    if (resource.table === 'posts_avisos' && currentRecord) {
        assertCoherentAudience({ ...currentRecord, ...values });
    }
    const fields = Object.keys(values);
    if (fields.length === 0) {
        throw new ApiError(400, 'Informe ao menos um campo para atualizar.');
    }

    const assignments = fields.map((field) => `${field} = ?`).join(', ');
    if (resource.table === 'alunos' && values.id_turma !== undefined) {
        const current = database.prepare(
            'SELECT id_usuario FROM alunos WHERE id_aluno = ?'
        ).get(recordId);
        const student = current && database.prepare(
            'SELECT tipo_usuario, curso, serie FROM usuarios WHERE id_usuario = ?'
        ).get(current.id_usuario);
        const schoolClass = values.id_turma === null ? null : database.prepare(
            'SELECT curso, serie FROM turmas WHERE id_turma = ?'
        ).get(values.id_turma);
        if (!student || student.tipo_usuario !== 'aluno'
            || values.id_turma === null || !schoolClass || student.curso !== schoolClass.curso
            || (student.serie !== null && student.serie !== schoolClass.serie)) {
            throw new ApiError(400, 'A matrícula deve permanecer em uma turma do mesmo curso.');
        }
    }
    if (resource.table === 'usuarios') {
        const profile = database.prepare(`
            SELECT u.tipo_usuario, u.curso AS current_course, u.serie AS current_series,
                   t.curso AS class_course, t.serie AS class_series
            FROM usuarios u
            LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
            LEFT JOIN turmas t ON t.id_turma = a.id_turma
            WHERE u.id_usuario = ?
        `).get(recordId);
        if (!profile) throw new ApiError(404, 'Registro não encontrado.');
        if (values.tipo_usuario && values.tipo_usuario !== profile.tipo_usuario) {
            throw new ApiError(409, 'Para alterar o perfil, crie uma nova conta com o tipo correto.');
        }
        if (profile.tipo_usuario === 'aluno'
            && ((Object.hasOwn(values, 'curso') && !['informatica', 'redes'].includes(values.curso))
                || (Object.hasOwn(values, 'serie')
                    && (!Number.isInteger(values.serie) || values.serie < 1 || values.serie > 3)))) {
            throw new ApiError(400, 'Aluno deve manter um curso e uma série válidos.');
        }
        const nextCourse = values.curso === undefined ? profile.current_course : values.curso;
        const nextSeries = values.serie === undefined ? profile.current_series : values.serie;
        if (profile.tipo_usuario === 'aluno' && profile.class_course
            && (nextCourse !== profile.class_course || nextSeries !== profile.class_series)) {
            throw new ApiError(409, 'Rematricule o aluno antes de alterar o curso ou série da conta.');
        }
    }
    if (resource.table === 'usuarios' && values.senha !== undefined
        && recordId !== user.id_usuario) {
        values.deve_trocar_senha = 1;
    }
    if (resource.table === 'turmas'
        && (values.curso !== undefined || values.serie !== undefined)) {
        const currentClass = database.prepare(
            'SELECT curso, serie FROM turmas WHERE id_turma = ?'
        ).get(recordId);
        if (!currentClass) throw new ApiError(404, 'Registro não encontrado.');
        const nextCourse = values.curso === undefined ? currentClass.curso : values.curso;
        const nextSeries = values.serie === undefined ? currentClass.serie : values.serie;
        const invalidEnrollment = database.prepare(`
            SELECT 1 FROM alunos a JOIN usuarios u ON u.id_usuario = a.id_usuario
            WHERE a.id_turma = ? AND (u.curso != ? OR u.serie != ?)
            LIMIT 1
        `).get(recordId, nextCourse, nextSeries);
        if (invalidEnrollment) {
            throw new ApiError(409, 'A turma não pode mudar de curso/série enquanto houver matrículas incompatíveis.');
        }
    }
    const result = database.prepare(
        `UPDATE ${resource.table} SET ${assignments} WHERE ${resource.id} = ?`
    ).run(...fields.map((field) => values[field]), recordId);
    if (result.changes === 0) {
        throw new ApiError(404, 'Registro não encontrado.');
    }

    const updated = database.prepare(
        `SELECT * FROM ${resource.table} WHERE ${resource.id} = ?`
    ).get(recordId);
    sendJson(response, 200, publicRecord(resource, updated, user));
}

module.exports = { handleCollection, handleRecord };
