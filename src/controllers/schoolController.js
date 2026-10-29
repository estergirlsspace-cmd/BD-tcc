const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { randomInt } = require('node:crypto');
const { hashPassword, verifyPassword, newPasswordProblem } = require('../utils/password');
const { parseSchoolDate, deadlineTimestamp } = require('../utils/dates');
const { parseClassDate } = require('../utils/calendario');
const notificacoes = require('../services/notificacoes');
const { optionalAccountEmail } = require('../services/email');
const { registrar } = require('../services/auditoria');
const { assertCurrentPassword } = require('./authController');
const { issueEmailConfirmation } = require('./contaController');

function requireRole(user, roles) {
    if (!roles.includes(user.tipo_usuario)) {
        throw new ApiError(403, 'Seu perfil não tem permissão para esta operação.');
    }
}

function positiveId(value, field) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new ApiError(400, `Informe um identificador válido em "${field}".`);
    }
    return value;
}

function getRecordId(value) {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new ApiError(400, 'O identificador deve ser um número inteiro positivo.');
    }
    return Number(value);
}

function requireFields(body, fields) {
    const missing = fields.filter((field) => body[field] === undefined || body[field] === null);
    if (missing.length) {
        throw new ApiError(400, `Campo(s) obrigatório(s): ${missing.join(', ')}.`);
    }
}

function rejectUnknownFields(body, allowed) {
    const unknown = Object.keys(body).filter((field) => !allowed.includes(field));
    if (unknown.length) {
        throw new ApiError(400, `Campo(s) não permitido(s): ${unknown.join(', ')}.`);
    }
}

// Texto opcional: null/ausente vira null; qualquer outro tipo é recusado com 400.
function optionalText(value, field, maxLength) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > maxLength) {
        throw new ApiError(400, `O campo "${field}" deve ser um texto com até ${maxLength} caracteres.`);
    }
    return value.trim() || null;
}

function requiredText(value, field, maxLength, label = field) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ApiError(400, `${label} não pode ficar vazio.`);
    }
    if (value.length > maxLength) {
        throw new ApiError(400, `${label} pode ter no máximo ${maxLength} caracteres.`);
    }
    return value.trim();
}

function isTeacherAssignedToClass(user, classId, disciplineId) {
    if (!user.id_professor) return false;
    const assignment = database.prepare(`
        SELECT 1 FROM disciplinas
        WHERE id_turma = ? AND id_professor = ?
          AND (? IS NULL OR id_disciplina = ?)
    `).get(classId, user.id_professor, disciplineId ?? null, disciplineId ?? null);
    return Boolean(assignment);
}

function canAccessClass(user, classId, disciplineId) {
    if (user.tipo_usuario === 'gestao') return true;
    if (user.tipo_usuario === 'aluno') {
        if (user.conta_compartilhada) {
            return Boolean(database.prepare(`
                SELECT 1 FROM turmas WHERE id_turma = ? AND curso = ? AND serie = ?
            `).get(classId, user.curso, user.serie));
        }
        return user.id_turma === classId;
    }
    return isTeacherAssignedToClass(user, classId, disciplineId);
}

function getProfile(request, response, user) {
    sendJson(response, 200, {
        id_usuario: user.id_usuario,
        login: user.conta_compartilhada ? null : user.login,
        tipo_usuario: user.tipo_usuario,
        nome: user.nome,
        area: user.area,
        conta_compartilhada: user.conta_compartilhada,
        deve_trocar_senha: user.deve_trocar_senha,
        termos_pendentes: user.termos_pendentes,
        curso: user.curso,
        serie: user.serie,
        id_turma: user.id_turma,
        nome_turma: user.nome_turma,
        id_aluno: user.id_aluno,
        id_professor: user.id_professor
    });
}

const MATRICULA_PATTERN = /^\d{3,20}$/;
const CPF_INICIO_PATTERN = /^\d{4}$/;

// Senha de primeiro acesso: "ceep@" + 4 primeiros dígitos do CPF. O CPF não é armazenado.
async function initialPasswordHash(cpfStart) {
    if (typeof cpfStart !== 'string' || !CPF_INICIO_PATTERN.test(cpfStart)) {
        throw new ApiError(400, 'Informe em "cpf_inicio" os 4 primeiros dígitos do CPF.');
    }
    return hashPassword(`ceep@${cpfStart}`);
}

async function enrollStudent(request, response, user) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['matricula', 'nome', 'id_turma', 'cpf_inicio', 'email']);
    requireFields(body, ['matricula', 'nome', 'id_turma', 'cpf_inicio']);
    const email = optionalAccountEmail(body.email);
    if (typeof body.matricula !== 'string' || !MATRICULA_PATTERN.test(body.matricula.trim())) {
        throw new ApiError(400, 'A matrícula deve conter apenas números (3 a 20 dígitos).');
    }
    if (typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 150) {
        throw new ApiError(400, 'Informe o nome do aluno com até 150 caracteres.');
    }
    const matricula = body.matricula.trim();
    const passwordHash = await initialPasswordHash(body.cpf_inicio);
    const classId = positiveId(body.id_turma, 'id_turma');
    const schoolClass = database.prepare(
        'SELECT id_turma, nome_turma, curso, serie FROM turmas WHERE id_turma = ?'
    ).get(classId);
    if (!schoolClass) throw new ApiError(404, 'Turma não encontrada.');
    if (database.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(matricula)) {
        throw new ApiError(409, 'Já existe um usuário com essa matrícula.');
    }

    database.exec('BEGIN IMMEDIATE');
    try {
        const result = database.prepare(`
            INSERT INTO usuarios (login, senha, tipo_usuario, curso, serie, ativo, deve_trocar_senha)
            VALUES (?, ?, 'aluno', ?, ?, 1, 1)
        `).run(matricula, passwordHash, schoolClass.curso, schoolClass.serie);
        const userId = Number(result.lastInsertRowid);
        const studentResult = database.prepare(`
            INSERT INTO alunos (id_usuario, nome, id_turma)
            VALUES (?, ?, ?)
        `).run(userId, body.nome.trim(), classId);
        const confirmationToken = email && issueEmailConfirmation(userId, email);
        database.exec('COMMIT');
        if (email) notificacoes.sendEmailConfirmation(userId, email, confirmationToken);
        registrar(user, 'aluno.matricular', `aluno:${Number(studentResult.lastInsertRowid)}`);
        sendJson(response, 201, {
            id_aluno: Number(studentResult.lastInsertRowid),
            id_usuario: userId,
            matricula,
            nome: body.nome.trim(),
            id_turma: classId,
            nome_turma: schoolClass.nome_turma,
            curso: schoolClass.curso,
            serie: schoolClass.serie,
            email: null,
            email_pendente: email,
            senha_inicial: 'ceep@ + 4 primeiros dígitos do CPF',
            deve_trocar_senha: true
        });
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

async function resetStudentPassword(request, response, user, studentId) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['cpf_inicio']);
    requireFields(body, ['cpf_inicio']);
    const passwordHash = await initialPasswordHash(body.cpf_inicio);
    const student = database.prepare(`
        SELECT u.id_usuario FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario
        WHERE a.id_aluno = ?
    `).get(studentId);
    if (!student) throw new ApiError(404, 'Aluno não encontrado.');
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(`
            UPDATE usuarios SET senha = ?, deve_trocar_senha = 1 WHERE id_usuario = ?
        `).run(passwordHash, student.id_usuario);
        database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(student.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'senha.redefinir_aluno', `aluno:${studentId}`);
    sendJson(response, 200, {
        mensagem: 'Senha redefinida. No próximo acesso o aluno deverá criar uma nova senha.'
    });
}

const STAFF_LOGIN_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/i;
const TEACHER_AREAS = ['natureza', 'humanas', 'linguagens', 'matematica', 'informatica', 'redes'];
// Sem caracteres ambíguos (0/O, 1/l/I) para facilitar a digitação da senha provisória.
const PROVISIONAL_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function provisionalPassword() {
    return Array.from({ length: 10 },
        () => PROVISIONAL_ALPHABET[randomInt(PROVISIONAL_ALPHABET.length)]).join('');
}

async function createStaffMember(request, response, user) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['login', 'tipo_usuario', 'nome', 'area', 'email']);
    requireFields(body, ['login', 'tipo_usuario', 'nome']);
    const email = optionalAccountEmail(body.email);
    if (typeof body.login !== 'string' || !STAFF_LOGIN_PATTERN.test(body.login.trim())) {
        throw new ApiError(400,
            'O usuário deve ter de 3 a 50 caracteres: letras, números, ponto, hífen ou sublinhado.');
    }
    if (!['professor', 'gestao'].includes(body.tipo_usuario)) {
        throw new ApiError(400, 'O tipo deve ser "professor" ou "gestao".');
    }
    if (typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length > 150) {
        throw new ApiError(400, 'Informe o nome com até 150 caracteres.');
    }
    if (body.tipo_usuario === 'professor' && !TEACHER_AREAS.includes(body.area)) {
        throw new ApiError(400, `Informe a área do professor: ${TEACHER_AREAS.join(', ')}.`);
    }
    if (body.tipo_usuario === 'gestao' && body.area !== undefined) {
        throw new ApiError(400, 'A área só se aplica a professores.');
    }
    const login = body.login.trim();
    if (database.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login)) {
        throw new ApiError(409, 'Já existe um usuário com esse login.');
    }

    const password = provisionalPassword();
    // O hash é calculado antes de abrir a transação: um await dentro dela deixaria outras
    // requisições executarem SQL no meio da transação.
    const passwordHash = await hashPassword(password);
    database.exec('BEGIN IMMEDIATE');
    try {
        const userId = Number(database.prepare(`
            INSERT INTO usuarios (login, nome, senha, tipo_usuario, ativo, deve_trocar_senha)
            VALUES (?, ?, ?, ?, 1, 1)
        `).run(login, body.nome.trim(), passwordHash, body.tipo_usuario).lastInsertRowid);
        let teacherId = null;
        if (body.tipo_usuario === 'professor') {
            teacherId = Number(database.prepare(
                'INSERT INTO professores (id_usuario, nome, area) VALUES (?, ?, ?)'
            ).run(userId, body.nome.trim(), body.area).lastInsertRowid);
        }
        const confirmationToken = email && issueEmailConfirmation(userId, email);
        database.exec('COMMIT');
        registrar(user, 'conta.criar', `usuario:${userId}`);
        notificacoes.onStaffCreated(userId, email);
        if (email) notificacoes.sendEmailConfirmation(userId, email, confirmationToken);
        sendJson(response, 201, {
            id_usuario: userId,
            id_professor: teacherId,
            login,
            nome: body.nome.trim(),
            tipo_usuario: body.tipo_usuario,
            area: body.area ?? null,
            email: null,
            email_pendente: email,
            senha_provisoria: password,
            aviso: 'Entregue esta senha à pessoa. Ela não será exibida de novo e deve ser trocada no primeiro acesso.'
        });
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

async function resetStaffPassword(request, response, user, userId) {
    requireRole(user, ['gestao']);
    const staff = database.prepare(`
        SELECT id_usuario FROM usuarios
        WHERE id_usuario = ? AND tipo_usuario IN ('professor', 'gestao')
    `).get(userId);
    if (!staff) throw new ApiError(404, 'Professor ou membro da gestão não encontrado.');
    if (staff.id_usuario === user.id_usuario) {
        throw new ApiError(400, 'Para trocar a sua própria senha, use "Alterar senha".');
    }
    const password = provisionalPassword();
    const passwordHash = await hashPassword(password);
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(`
            UPDATE usuarios SET senha = ?, deve_trocar_senha = 1 WHERE id_usuario = ?
        `).run(passwordHash, staff.id_usuario);
        database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(staff.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'senha.redefinir_equipe', `usuario:${staff.id_usuario}`);
    sendJson(response, 200, {
        senha_provisoria: password,
        aviso: 'Entregue esta senha à pessoa. Ela deve ser trocada no primeiro acesso.'
    });
}

// Desativar mantém todo o histórico (avisos, atividades, frequências) e só impede o acesso.
async function setAccountActive(request, response, user, userId) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['ativo']);
    if (typeof body.ativo !== 'boolean') {
        throw new ApiError(400, 'Informe "ativo" como verdadeiro ou falso.');
    }
    const account = database.prepare(
        'SELECT id_usuario, login, tipo_usuario, ativo FROM usuarios WHERE id_usuario = ?'
    ).get(userId);
    if (!account) throw new ApiError(404, 'Conta não encontrada.');
    if (!body.ativo) {
        if (account.id_usuario === user.id_usuario) {
            throw new ApiError(400, 'Você não pode desativar a sua própria conta.');
        }
        if (account.tipo_usuario === 'gestao') {
            const otherManagers = database.prepare(`
                SELECT COUNT(*) AS n FROM usuarios
                WHERE tipo_usuario = 'gestao' AND ativo = 1 AND id_usuario != ?
            `).get(account.id_usuario).n;
            if (!otherManagers) {
                throw new ApiError(409, 'Esta é a última conta ativa da gestão e não pode ser desativada.');
            }
        }
    } else if (account.tipo_usuario === 'aluno' && database.prepare(`
        SELECT 1 FROM usuarios
        WHERE login = ? AND tipo_usuario = 'aluno' AND ativo = 1 AND id_usuario != ?
    `).get(account.login, account.id_usuario)) {
        throw new ApiError(409, 'Já existe outro aluno ativo com essa matrícula.');
    }

    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare('UPDATE usuarios SET ativo = ? WHERE id_usuario = ?')
            .run(body.ativo ? 1 : 0, account.id_usuario);
        if (!body.ativo) {
            database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(account.id_usuario);
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, body.ativo ? 'conta.reativar' : 'conta.desativar', `usuario:${account.id_usuario}`);
    sendJson(response, 200, {
        id_usuario: account.id_usuario,
        ativo: body.ativo,
        mensagem: body.ativo
            ? 'Conta reativada.'
            : 'Conta desativada. O histórico foi mantido e a pessoa não consegue mais entrar.'
    });
}

async function changePassword(request, response, user) {
    const body = await readBody(request);
    rejectUnknownFields(body, ['senha_atual', 'nova_senha']);
    requireFields(body, ['senha_atual', 'nova_senha']);
    if (typeof body.senha_atual !== 'string') {
        throw new ApiError(400, 'Informe a senha atual.');
    }
    const problem = newPasswordProblem(body.nova_senha);
    if (problem) throw new ApiError(400, problem);
    if (body.nova_senha === body.senha_atual) {
        throw new ApiError(400, 'A nova senha precisa ser diferente da senha atual.');
    }
    await assertCurrentPassword(user, body.senha_atual);
    const passwordHash = await hashPassword(body.nova_senha);
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare(`
            UPDATE usuarios SET senha = ?, deve_trocar_senha = 0 WHERE id_usuario = ?
        `).run(passwordHash, user.id_usuario);
        database.prepare(`
            DELETE FROM sessoes
            WHERE id_usuario = ? AND token_hash != ?
        `).run(user.id_usuario, user.tokenHash);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'senha.trocar', `usuario:${user.id_usuario}`);
    notificacoes.onPasswordChanged(user.id_usuario);
    sendJson(response, 200, { mensagem: 'Senha atualizada com sucesso.' });
}

function getSchedule(user, searchParams) {
    const filters = [];
    const params = [];
    if (user.tipo_usuario === 'aluno') {
        if (user.conta_compartilhada) {
            filters.push('t.curso = ? AND t.serie = ?');
            params.push(user.curso, user.serie);
        } else {
            if (!user.id_turma) return [];
            filters.push('h.id_turma = ?');
            params.push(user.id_turma);
        }
    } else if (user.tipo_usuario === 'professor') {
        if (!user.id_professor) return [];
        filters.push('d.id_professor = ?');
        params.push(user.id_professor);
    }

    const classId = searchParams.get('id_turma');
    if (classId && user.tipo_usuario === 'gestao') {
        filters.push('h.id_turma = ?');
        params.push(getRecordId(classId));
    }

    return database.prepare(`
        SELECT h.id_horario, h.id_turma, h.id_disciplina, h.dia_semana,
               h.hora_inicio, h.hora_fim, h.sala, h.carga_minutos,
               t.nome_turma, d.nome_disciplina, COALESCE(p.nome, pu.nome) AS professor
        FROM horarios h
        JOIN turmas t ON t.id_turma = h.id_turma
        JOIN disciplinas d ON d.id_disciplina = h.id_disciplina
        LEFT JOIN professores p ON p.id_professor = d.id_professor
        LEFT JOIN usuarios pu ON pu.id_usuario = p.id_usuario
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY h.dia_semana, h.hora_inicio
    `).all(...params);
}

function minutesBetween(start, end) {
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!validTime.test(start) || !validTime.test(end)) {
        throw new ApiError(400, 'Horários devem usar o formato HH:MM.');
    }
    const toMinutes = (value) => {
        const [hours, minutes] = value.split(':').map(Number);
        return hours * 60 + minutes;
    };
    const duration = toMinutes(end) - toMinutes(start);
    if (duration <= 0) {
        throw new ApiError(400, 'O horário final deve ser posterior ao inicial.');
    }
    return duration;
}

async function createSchedule(request, response, user) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    const fields = ['id_turma', 'id_disciplina', 'dia_semana', 'hora_inicio', 'hora_fim', 'sala'];
    rejectUnknownFields(body, fields);
    requireFields(body, fields.slice(0, 5));
    const classId = positiveId(body.id_turma, 'id_turma');
    const disciplineId = positiveId(body.id_disciplina, 'id_disciplina');
    if (!Number.isInteger(body.dia_semana) || body.dia_semana < 1 || body.dia_semana > 7) {
        throw new ApiError(400, 'O dia da semana deve ser um número entre 1 e 7.');
    }
    if (!canAccessClass(user, classId, disciplineId)) {
        throw new ApiError(403, 'Você não está vinculado a essa turma e disciplina.');
    }
    const duration = minutesBetween(body.hora_inicio, body.hora_fim);
    const discipline = database.prepare(
        'SELECT id_turma FROM disciplinas WHERE id_disciplina = ?'
    ).get(disciplineId);
    if (!discipline || discipline.id_turma !== classId) {
        throw new ApiError(400, 'A disciplina informada não pertence à turma.');
    }

    const result = database.prepare(`
        INSERT INTO horarios
            (id_turma, id_disciplina, dia_semana, hora_inicio, hora_fim, sala, carga_minutos)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(classId, disciplineId, body.dia_semana, body.hora_inicio, body.hora_fim,
        optionalText(body.sala, 'sala', 50), duration);
    const schedule = database.prepare(`
        SELECT h.*, t.nome_turma, d.nome_disciplina
        FROM horarios h
        JOIN turmas t ON t.id_turma = h.id_turma
        JOIN disciplinas d ON d.id_disciplina = h.id_disciplina
        WHERE h.id_horario = ?
    `).get(Number(result.lastInsertRowid));
    sendJson(response, 201, schedule);
}

async function handleScheduleRecord(request, response, user, scheduleId) {
    const current = database.prepare(
        'SELECT * FROM horarios WHERE id_horario = ?'
    ).get(scheduleId);
    if (!current || !canAccessClass(user, current.id_turma, current.id_disciplina)) {
        throw new ApiError(404, 'Horário não encontrado.');
    }
    if (request.method === 'GET') {
        sendJson(response, 200, current);
        return;
    }
    requireRole(user, ['professor', 'gestao']);
    if (request.method === 'DELETE') {
        database.prepare('DELETE FROM horarios WHERE id_horario = ?').run(scheduleId);
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method !== 'PATCH') throw new ApiError(405, 'Método não permitido.');

    const body = await readBody(request);
    const allowed = ['id_turma', 'id_disciplina', 'dia_semana', 'hora_inicio', 'hora_fim', 'sala'];
    rejectUnknownFields(body, allowed);
    if (!Object.keys(body).length) throw new ApiError(400, 'Informe campos para atualizar.');
    const updated = { ...current, ...body };
    const classId = positiveId(updated.id_turma, 'id_turma');
    const disciplineId = positiveId(updated.id_disciplina, 'id_disciplina');
    if (!Number.isInteger(updated.dia_semana) || updated.dia_semana < 1 || updated.dia_semana > 7) {
        throw new ApiError(400, 'O dia da semana deve ser um número entre 1 e 7.');
    }
    if (!canAccessClass(user, classId, disciplineId)) {
        throw new ApiError(403, 'Você não está vinculado a essa turma e disciplina.');
    }
    const discipline = database.prepare(
        'SELECT id_turma FROM disciplinas WHERE id_disciplina = ?'
    ).get(disciplineId);
    if (!discipline || discipline.id_turma !== classId) {
        throw new ApiError(400, 'A disciplina informada não pertence à turma.');
    }
    const duration = minutesBetween(updated.hora_inicio, updated.hora_fim);
    database.prepare(`
        UPDATE horarios
        SET id_turma = ?, id_disciplina = ?, dia_semana = ?, hora_inicio = ?,
            hora_fim = ?, sala = ?, carga_minutos = ?
        WHERE id_horario = ?
    `).run(classId, disciplineId, updated.dia_semana, updated.hora_inicio,
        updated.hora_fim, optionalText(updated.sala, 'sala', 50), duration, scheduleId);
    sendJson(response, 200, database.prepare(
        'SELECT * FROM horarios WHERE id_horario = ?'
    ).get(scheduleId));
}

function getActivities(user) {
    let where = '';
    let params = [];
    if (user.tipo_usuario === 'aluno') {
        if (user.conta_compartilhada) {
            where = 'WHERE t.curso = ? AND t.serie = ?';
            params = [user.curso, user.serie];
        } else {
            if (!user.id_turma) return [];
            where = 'WHERE a.id_turma = ?';
            params = [user.id_turma];
        }
    } else if (user.tipo_usuario === 'professor') {
        where = 'WHERE (d.id_professor = ? OR a.id_usuario_autor = ?)';
        params = [user.id_professor || -1, user.id_usuario];
    }
    // A entrega só existe para o próprio aluno (o LEFT JOIN usa o usuário logado); para
    // professor e gestão "entrega" vem sempre null.
    const rows = database.prepare(`
        SELECT a.id_atividade, a.titulo, a.descricao, a.id_turma,
               a.id_disciplina, a.prazo, a.tipo, a.criado_em,
               t.nome_turma, d.nome_disciplina,
               e.id_entrega, e.enviado_em, e.nota, e.feedback
        FROM atividades a
        JOIN turmas t ON t.id_turma = a.id_turma
        JOIN disciplinas d ON d.id_disciplina = a.id_disciplina
        LEFT JOIN alunos al ON al.id_usuario = ?
        LEFT JOIN entregas_atividades e
            ON e.id_atividade = a.id_atividade AND e.id_aluno = al.id_aluno
        ${where}
        ORDER BY a.prazo, a.criado_em DESC
    `).all(user.id_usuario, ...params);
    return rows.map(({ id_entrega: submissionId, enviado_em, nota, feedback, ...activity }) => ({
        ...activity,
        entrega: submissionId ? { enviado_em, nota, feedback } : null
    }));
}

async function createActivity(request, response, user) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    const allowed = ['titulo', 'descricao', 'id_turma', 'id_disciplina', 'prazo', 'tipo'];
    rejectUnknownFields(body, allowed);
    requireFields(body, ['titulo', 'descricao', 'id_turma', 'id_disciplina']);
    body.titulo = requiredText(body.titulo, 'titulo', 200, 'O título');
    body.descricao = requiredText(body.descricao, 'descricao', 10000, 'A descrição');
    const classId = positiveId(body.id_turma, 'id_turma');
    const disciplineId = positiveId(body.id_disciplina, 'id_disciplina');
    if (!canAccessClass(user, classId, disciplineId)) {
        throw new ApiError(403, 'Você não está vinculado a essa turma e disciplina.');
    }
    if (body.prazo !== undefined && body.prazo !== null && body.prazo !== '') {
        body.prazo = parseSchoolDate(body.prazo, 'prazo');
    }
    const type = body.tipo || 'atividade';
    if (!['atividade', 'avaliacao', 'evento', 'comunicado'].includes(type)) {
        throw new ApiError(400, 'Tipo inválido para publicação escolar.');
    }
    const discipline = database.prepare(
        'SELECT id_turma FROM disciplinas WHERE id_disciplina = ?'
    ).get(disciplineId);
    if (!discipline || discipline.id_turma !== classId) {
        throw new ApiError(400, 'A disciplina informada não pertence à turma.');
    }

    const result = database.prepare(`
        INSERT INTO atividades
            (titulo, descricao, id_turma, id_disciplina, id_usuario_autor, prazo, tipo)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(body.titulo.trim(), body.descricao.trim(), classId, disciplineId,
        user.id_usuario, body.prazo || null, type);
    sendJson(response, 201, database.prepare(
        'SELECT * FROM atividades WHERE id_atividade = ?'
    ).get(Number(result.lastInsertRowid)));
}

async function handleActivityRecord(request, response, user, activityId) {
    const current = database.prepare(
        'SELECT * FROM atividades WHERE id_atividade = ?'
    ).get(activityId);
    if (!current || !canAccessClass(user, current.id_turma, current.id_disciplina)) {
        throw new ApiError(404, 'Atividade não encontrada.');
    }
    if (request.method === 'GET') {
        if (user.tipo_usuario === 'aluno') {
            const { id_usuario_autor: _author, ...studentView } = current;
            sendJson(response, 200, studentView);
        } else {
            sendJson(response, 200, current);
        }
        return;
    }
    requireRole(user, ['professor', 'gestao']);
    if (request.method === 'DELETE') {
        database.prepare('DELETE FROM atividades WHERE id_atividade = ?').run(activityId);
        response.writeHead(204);
        response.end();
        return;
    }
    if (request.method !== 'PATCH') throw new ApiError(405, 'Método não permitido.');

    const body = await readBody(request);
    const allowed = ['titulo', 'descricao', 'id_turma', 'id_disciplina', 'prazo', 'tipo'];
    rejectUnknownFields(body, allowed);
    if (!Object.keys(body).length) throw new ApiError(400, 'Informe campos para atualizar.');
    if (body.prazo === '') body.prazo = null;
    if (body.prazo !== undefined && body.prazo !== null) {
        body.prazo = parseSchoolDate(body.prazo, 'prazo');
    }
    const updated = { ...current, ...body };
    updated.titulo = requiredText(updated.titulo, 'titulo', 200, 'O título');
    updated.descricao = requiredText(updated.descricao, 'descricao', 10000, 'A descrição');
    const classId = positiveId(updated.id_turma, 'id_turma');
    const disciplineId = positiveId(updated.id_disciplina, 'id_disciplina');
    if (!canAccessClass(user, classId, disciplineId)) {
        throw new ApiError(403, 'Você não está vinculado a essa turma e disciplina.');
    }
    const discipline = database.prepare(
        'SELECT id_turma FROM disciplinas WHERE id_disciplina = ?'
    ).get(disciplineId);
    if (!discipline || discipline.id_turma !== classId) {
        throw new ApiError(400, 'A disciplina informada não pertence à turma.');
    }
    if (!['atividade', 'avaliacao', 'evento', 'comunicado'].includes(updated.tipo)) {
        throw new ApiError(400, 'Tipo inválido para publicação escolar.');
    }
    database.prepare(`
        UPDATE atividades
        SET titulo = ?, descricao = ?, id_turma = ?, id_disciplina = ?, prazo = ?, tipo = ?
        WHERE id_atividade = ?
    `).run(updated.titulo.trim(), updated.descricao.trim(), classId, disciplineId,
        updated.prazo || null, updated.tipo, activityId);
    sendJson(response, 200, database.prepare(
        'SELECT * FROM atividades WHERE id_atividade = ?'
    ).get(activityId));
}

async function submitActivity(request, response, user, activityId) {
    requireRole(user, ['aluno']);
    if (!user.id_aluno || !user.id_turma) {
        const message = user.conta_compartilhada
            ? 'A conta compartilhada não identifica o aluno para registrar uma entrega.'
            : 'Sua conta ainda não está vinculada a uma matrícula.';
        throw new ApiError(403, message);
    }
    const activity = database.prepare(
        'SELECT id_turma, prazo, tipo FROM atividades WHERE id_atividade = ?'
    ).get(activityId);
    if (!activity || activity.id_turma !== user.id_turma) {
        throw new ApiError(404, 'Atividade não encontrada para sua turma.');
    }
    if (activity.tipo !== 'atividade') {
        throw new ApiError(400, 'Esta publicação não recebe envio pelo portal (avaliações são presenciais).');
    }
    const deadline = deadlineTimestamp(activity.prazo);
    if (Number.isNaN(deadline)) {
        throw new ApiError(409, 'O prazo desta atividade está registrado de forma inválida. Avise o professor.');
    }
    if (deadline !== null && deadline < Date.now()) {
        throw new ApiError(409, 'O prazo para envio desta atividade terminou.');
    }

    const body = await readBody(request);
    rejectUnknownFields(body, ['resposta']);
    requireFields(body, ['resposta']);
    body.resposta = requiredText(body.resposta, 'resposta', 10000, 'A resposta');
    // Reenvio só enquanto não houver nota: a resposta corrigida não pode mudar depois.
    const result = database.prepare(`
        INSERT INTO entregas_atividades (id_atividade, id_aluno, resposta)
        VALUES (?, ?, ?)
        ON CONFLICT (id_atividade, id_aluno)
        DO UPDATE SET resposta = excluded.resposta, enviado_em = CURRENT_TIMESTAMP
        WHERE entregas_atividades.nota IS NULL
    `).run(activityId, user.id_aluno, body.resposta.trim());
    if (result.changes === 0) {
        throw new ApiError(409, 'Esta entrega já foi corrigida e não pode mais ser reenviada.');
    }
    const submission = database.prepare(`
        SELECT id_entrega, id_atividade, id_aluno, resposta, enviado_em
        FROM entregas_atividades WHERE id_atividade = ? AND id_aluno = ?
    `).get(activityId, user.id_aluno);
    sendJson(response, 201, submission);
}

function getSubmissions(activityId, user) {
    const activity = database.prepare(
        'SELECT id_atividade, id_turma, id_disciplina FROM atividades WHERE id_atividade = ?'
    ).get(activityId);
    if (!activity) throw new ApiError(404, 'Atividade não encontrada.');
    if (user.tipo_usuario === 'aluno') {
        if (!user.id_aluno || activity.id_turma !== user.id_turma) {
            throw new ApiError(404, 'Atividade não encontrada.');
        }
        return database.prepare(`
            SELECT id_entrega, id_atividade, id_aluno, resposta, enviado_em
            FROM entregas_atividades WHERE id_atividade = ? AND id_aluno = ?
        `).all(activityId, user.id_aluno);
    }
    requireRole(user, ['professor', 'gestao']);
    // Professor: só o da disciplina (404 fora do escopo, sem revelar que a atividade existe).
    if (!canAccessClass(user, activity.id_turma, activity.id_disciplina)) {
        throw new ApiError(404, 'Atividade não encontrada.');
    }
    return database.prepare(`
        SELECT e.id_entrega, e.id_atividade, e.id_aluno, e.resposta, e.enviado_em,
               e.nota, e.feedback, a.nome
        FROM entregas_atividades e
        JOIN alunos a ON a.id_aluno = e.id_aluno
        WHERE e.id_atividade = ?
        ORDER BY a.nome
    `).all(activityId);
}

// Correção: gestão ou o professor da disciplina da atividade.
async function gradeSubmission(request, response, user, submissionId) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    rejectUnknownFields(body, ['nota', 'feedback']);
    if (body.nota === undefined && body.feedback === undefined) {
        throw new ApiError(400, 'Informe a nota ou o feedback para atualizar.');
    }
    if (body.nota !== undefined
        && (typeof body.nota !== 'number' || body.nota < 0 || body.nota > 10)) {
        throw new ApiError(400, 'A nota deve ser um número entre 0 e 10.');
    }
    if (body.feedback !== undefined
        && body.feedback !== null
        && (typeof body.feedback !== 'string' || body.feedback.length > 2000)) {
        throw new ApiError(400, 'O feedback deve ser texto com até 2000 caracteres.');
    }
    const current = database.prepare(`
        SELECT e.nota, e.feedback, a.id_turma, a.id_disciplina
        FROM entregas_atividades e
        JOIN atividades a ON a.id_atividade = e.id_atividade
        WHERE e.id_entrega = ?
    `).get(submissionId);
    if (!current || !canAccessClass(user, current.id_turma, current.id_disciplina)) {
        throw new ApiError(404, 'Entrega não encontrada.');
    }
    const nota = body.nota === undefined ? current.nota : body.nota;
    const feedback = body.feedback === undefined ? current.feedback : body.feedback;
    database.prepare(
        'UPDATE entregas_atividades SET nota = ?, feedback = ? WHERE id_entrega = ?'
    ).run(nota, feedback, submissionId);
    sendJson(response, 200, database.prepare(
        'SELECT * FROM entregas_atividades WHERE id_entrega = ?'
    ).get(submissionId));
}

function getAttendance(user, searchParams) {
    const filters = [];
    const params = [];
    if (user.tipo_usuario === 'aluno') {
        if (!user.id_aluno) return [];
        filters.push('f.id_aluno = ?');
        params.push(user.id_aluno);
    } else if (user.tipo_usuario === 'professor') {
        filters.push('d.id_professor = ?');
        params.push(user.id_professor || -1);
    } else if (searchParams.has('id_aluno')) {
        filters.push('f.id_aluno = ?');
        params.push(getRecordId(searchParams.get('id_aluno')));
    }
    // Falta justificada é derivada: existe justificativa para aluno + disciplina + data.
    return database.prepare(`
        SELECT f.id_frequencia, f.id_aluno, f.id_disciplina, f.data_aula,
               f.presente, f.observacao, a.nome, d.nome_disciplina, t.nome_turma,
               j.situacao AS justificativa_situacao
        FROM frequencias f
        JOIN alunos a ON a.id_aluno = f.id_aluno
        JOIN disciplinas d ON d.id_disciplina = f.id_disciplina
        JOIN turmas t ON t.id_turma = d.id_turma
        LEFT JOIN justificativas j ON f.presente = 0 AND j.id_aluno = f.id_aluno
            AND j.id_disciplina = f.id_disciplina AND j.data_falta = f.data_aula
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        ORDER BY f.data_aula DESC, a.nome
    `).all(...params).map(({ justificativa_situacao: situacao, ...record }) => ({
        ...record,
        justificativa: situacao ? { situacao } : null
    }));
}

async function recordAttendance(request, response, user) {
    requireRole(user, ['professor', 'gestao']);
    const body = await readBody(request);
    const allowed = ['id_aluno', 'id_disciplina', 'data_aula', 'presente', 'observacao'];
    rejectUnknownFields(body, allowed);
    requireFields(body, allowed.slice(0, 4));
    const studentId = positiveId(body.id_aluno, 'id_aluno');
    const disciplineId = positiveId(body.id_disciplina, 'id_disciplina');
    if (typeof body.presente !== 'boolean') {
        throw new ApiError(400, 'O campo "presente" deve ser verdadeiro ou falso.');
    }
    const student = database.prepare(`
        SELECT a.id_turma FROM alunos a
        JOIN usuarios u ON u.id_usuario = a.id_usuario AND u.ativo = 1
        WHERE a.id_aluno = ?
    `).get(studentId);
    const discipline = database.prepare(
        'SELECT id_turma FROM disciplinas WHERE id_disciplina = ?'
    ).get(disciplineId);
    if (!student || !discipline || student.id_turma !== discipline.id_turma) {
        throw new ApiError(400, 'O aluno e a disciplina devem pertencer à mesma turma.');
    }
    if (!canAccessClass(user, discipline.id_turma, disciplineId)) {
        throw new ApiError(403, 'Você não está vinculado a essa turma e disciplina.');
    }
    // Mesmas regras da chamada (PUT /api/chamadas): dia útil do ano letivo, até hoje, aluno ativo.
    const classDate = parseClassDate(body.data_aula, 'data_aula');
    const result = database.prepare(`
        INSERT INTO frequencias
            (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente, observacao)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(studentId, disciplineId, user.id_usuario, classDate,
        body.presente ? 1 : 0, optionalText(body.observacao, 'observacao', 500));
    sendJson(response, 201, database.prepare(
        'SELECT * FROM frequencias WHERE id_frequencia = ?'
    ).get(Number(result.lastInsertRowid)));
}

function getPerformance(user, searchParams) {
    let studentId;
    if (user.tipo_usuario === 'aluno') {
        if (!user.id_aluno) {
            return {
                matriculado: false,
                mensagem: 'Sua conta ainda não está vinculada a uma matrícula.',
                notas: [],
                frequencia: { aulas: 0, presencas: 0, percentual: 0 },
                carga_horaria_minutos: 0
            };
        }
        studentId = user.id_aluno;
        if (searchParams.has('id_aluno')
            && getRecordId(searchParams.get('id_aluno')) !== studentId) {
            throw new ApiError(403, 'Você só pode consultar o seu próprio desempenho.');
        }
    } else if (user.tipo_usuario === 'gestao') {
        if (!searchParams.has('id_aluno')) {
            throw new ApiError(400, 'Informe o parâmetro id_aluno para consultar o desempenho.');
        }
        studentId = getRecordId(searchParams.get('id_aluno'));
    } else {
        throw new ApiError(403, 'O desempenho está disponível para o próprio aluno e para a gestão.');
    }

    const student = database.prepare(`
        SELECT a.id_aluno, a.nome, a.id_turma, t.nome_turma, t.serie, t.curso
        FROM alunos a JOIN turmas t ON t.id_turma = a.id_turma
        WHERE a.id_aluno = ?
    `).get(studentId);
    if (!student) throw new ApiError(404, 'Matrícula não encontrada.');

    const attendance = database.prepare(`
        SELECT count(*) AS aulas,
               coalesce(sum(presente), 0) AS presencas,
               coalesce(sum(CASE WHEN presente = 0 THEN 1 ELSE 0 END), 0) AS faltas
        FROM frequencias WHERE id_aluno = ?
    `).get(studentId);
    const grades = database.prepare(`
        SELECT a.id_atividade, a.titulo, a.tipo, a.prazo, e.nota, e.feedback, e.enviado_em
        FROM atividades a
        LEFT JOIN entregas_atividades e
            ON e.id_atividade = a.id_atividade AND e.id_aluno = ?
        WHERE a.id_turma = ? AND (e.nota IS NOT NULL OR e.id_entrega IS NOT NULL)
        ORDER BY a.prazo DESC
    `).all(studentId, student.id_turma);
    const workload = database.prepare(`
        SELECT coalesce(sum(h.carga_minutos), 0) AS carga_horaria_minutos
        FROM horarios h WHERE h.id_turma = ?
    `).get(student.id_turma);

    return {
        aluno: student,
        notas: grades,
        frequencia: {
            aulas: attendance.aulas,
            presencas: attendance.presencas,
            faltas: attendance.faltas,
            percentual: attendance.aulas
                ? Math.round((attendance.presencas / attendance.aulas) * 10000) / 100
                : 0
        },
        carga_horaria_minutos: workload.carga_horaria_minutos
    };
}

function getWorkload(user, searchParams) {
    const filters = [];
    const params = [];
    if (user.tipo_usuario === 'aluno') {
        if (user.conta_compartilhada) {
            filters.push('t.curso = ? AND t.serie = ?');
            params.push(user.curso, user.serie);
        } else {
            if (!user.id_turma) return [];
            filters.push('h.id_turma = ?');
            params.push(user.id_turma);
        }
    } else if (user.tipo_usuario === 'professor') {
        filters.push('d.id_professor = ?');
        params.push(user.id_professor || -1);
    } else if (searchParams.has('id_turma')) {
        filters.push('t.id_turma = ?');
        params.push(getRecordId(searchParams.get('id_turma')));
    }

    return database.prepare(`
        SELECT t.id_turma, t.nome_turma, t.curso, t.serie,
               d.id_disciplina, d.nome_disciplina,
               coalesce(sum(h.carga_minutos), 0) AS carga_horaria_minutos
        FROM turmas t
        JOIN disciplinas d ON d.id_turma = t.id_turma
        LEFT JOIN horarios h ON h.id_disciplina = d.id_disciplina
        ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
        GROUP BY t.id_turma, d.id_disciplina
        ORDER BY t.serie, t.nome_turma, d.nome_disciplina
    `).all(...params);
}

async function handleSchoolRequest(request, response, user, parts, searchParams) {
    if (parts[1] === 'auth' && parts[2] === 'password' && parts.length === 3
        && request.method === 'POST') {
        await changePassword(request, response, user);
        return true;
    }

    if (parts[1] === 'me' && parts.length === 2 && request.method === 'GET') {
        getProfile(request, response, user);
        return true;
    }

    if (parts[1] === 'matriculas' && parts.length === 2 && request.method === 'POST') {
        await enrollStudent(request, response, user);
        return true;
    }

    if (parts[1] === 'contas' && parts.length === 4 && parts[3] === 'situacao'
        && request.method === 'POST') {
        await setAccountActive(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'equipe' && parts.length === 2 && request.method === 'POST') {
        await createStaffMember(request, response, user);
        return true;
    }

    if (parts[1] === 'equipe' && parts.length === 4 && parts[3] === 'senha'
        && request.method === 'POST') {
        await resetStaffPassword(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'matriculas' && parts.length === 4 && parts[3] === 'senha'
        && request.method === 'POST') {
        await resetStudentPassword(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'horarios' && parts.length === 2) {
        if (request.method === 'GET') {
            sendJson(response, 200, getSchedule(user, searchParams));
        } else if (request.method === 'POST') {
            await createSchedule(request, response, user);
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return true;
    }

    if (parts[1] === 'horarios' && parts.length === 3) {
        await handleScheduleRecord(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'atividades' && parts.length === 2) {
        if (request.method === 'GET') {
            sendJson(response, 200, getActivities(user));
        } else if (request.method === 'POST') {
            await createActivity(request, response, user);
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return true;
    }

    if (parts[1] === 'atividades' && parts.length === 3) {
        await handleActivityRecord(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'atividades' && parts.length === 4 && parts[3] === 'entregas') {
        const activityId = getRecordId(parts[2]);
        if (request.method === 'POST') {
            await submitActivity(request, response, user, activityId);
        } else if (request.method === 'GET') {
            sendJson(response, 200, getSubmissions(activityId, user));
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return true;
    }

    if (parts[1] === 'entregas' && parts.length === 3 && request.method === 'PATCH') {
        await gradeSubmission(request, response, user, getRecordId(parts[2]));
        return true;
    }

    if (parts[1] === 'frequencias' && parts.length === 2) {
        if (request.method === 'GET') {
            requireRole(user, ['aluno', 'professor', 'gestao']);
            sendJson(response, 200, getAttendance(user, searchParams));
        } else if (request.method === 'POST') {
            await recordAttendance(request, response, user);
        } else {
            throw new ApiError(405, 'Método não permitido.');
        }
        return true;
    }

    if (parts[1] === 'desempenho' && parts.length === 2 && request.method === 'GET') {
        sendJson(response, 200, getPerformance(user, searchParams));
        return true;
    }

    if (parts[1] === 'carga-horaria' && parts.length === 2 && request.method === 'GET') {
        sendJson(response, 200, getWorkload(user, searchParams));
        return true;
    }

    return false;
}

module.exports = {
    handleSchoolRequest,
    requireRole,
    requireFields,
    getRecordId,
    positiveId,
    rejectUnknownFields,
    requiredText,
    optionalText,
    canAccessClass,
    isTeacherAssignedToClass
};
