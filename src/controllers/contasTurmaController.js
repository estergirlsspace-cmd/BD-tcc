// Conta compartilhada da turma (Sprint 5): uma conta de aluno por turma, login 'turma-<id_turma>',
// senha definida pela gestão. Sem tabela nova: usa usuarios + alunos.
//   PUT    /api/turmas/:id/senha  (gestão) { senha } → cria a conta ou troca a senha
//   DELETE /api/turmas/:id/senha  (gestão)          → desativa a conta (ativo = 0)
// O aluno entra com o "usuário da sala" legível (ex.: "1info-a"), resolvido no authController.
const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { hashPassword } = require('../utils/password');
const { registrar } = require('../services/auditoria');
const { classAccountLogin, isClassAccount, readableClassLogin } = require('../utils/accounts');
const { requireRole, getRecordId, rejectUnknownFields } = require('./schoolController');

function findClass(classId) {
    const schoolClass = database.prepare(
        'SELECT id_turma, nome_turma, curso, serie FROM turmas WHERE id_turma = ?'
    ).get(classId);
    if (!schoolClass) throw new ApiError(404, 'Turma não encontrada.');
    return schoolClass;
}

function findClassAccount(classId) {
    return database.prepare(`
        SELECT id_usuario, ativo FROM usuarios
        WHERE login = ? AND tipo_usuario = 'aluno'
        ORDER BY ativo DESC, id_usuario LIMIT 1
    `).get(classAccountLogin(classId));
}

async function setClassPassword(request, response, user, classId) {
    requireRole(user, ['gestao']);
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
    }
    rejectUnknownFields(body, ['senha']);
    if (typeof body.senha !== 'string' || body.senha.length < 8 || body.senha.length > 128) {
        throw new ApiError(400, 'A senha da turma deve ter entre 8 e 128 caracteres.');
    }
    const schoolClass = findClass(classId);
    if (!readableClassLogin(schoolClass)) {
        throw new ApiError(400, 'Só as turmas A e B de cada série e curso podem ter senha da turma.');
    }
    const login = classAccountLogin(classId);
    // Login reservado: se outra conta (não aluno) usar este login, não mexe nela.
    const conflict = database.prepare(
        "SELECT 1 FROM usuarios WHERE login = ? AND tipo_usuario != 'aluno'"
    ).get(login);
    if (conflict) throw new ApiError(409, `O usuário "${login}" já é usado por outra conta.`);

    const passwordHash = await hashPassword(body.senha);
    let created = false;
    let userId;
    database.exec('BEGIN IMMEDIATE');
    try {
        const account = findClassAccount(classId);
        if (account) {
            userId = account.id_usuario;
            database.prepare(`
                UPDATE usuarios SET senha = ?, ativo = 1, deve_trocar_senha = 0, curso = ?, serie = ?,
                    nome = ?
                WHERE id_usuario = ?
            `).run(passwordHash, schoolClass.curso, schoolClass.serie, schoolClass.nome_turma, userId);
            const student = database.prepare('SELECT id_aluno FROM alunos WHERE id_usuario = ?').get(userId);
            if (student) {
                database.prepare('UPDATE alunos SET nome = ?, id_turma = ? WHERE id_aluno = ?')
                    .run(schoolClass.nome_turma, classId, student.id_aluno);
            } else {
                database.prepare('INSERT INTO alunos (id_usuario, nome, id_turma) VALUES (?, ?, ?)')
                    .run(userId, schoolClass.nome_turma, classId);
            }
            database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(userId);
        } else {
            created = true;
            userId = Number(database.prepare(`
                INSERT INTO usuarios (login, nome, senha, tipo_usuario, curso, serie, ativo, deve_trocar_senha)
                VALUES (?, ?, ?, 'aluno', ?, ?, 1, 0)
            `).run(login, schoolClass.nome_turma, passwordHash, schoolClass.curso, schoolClass.serie)
                .lastInsertRowid);
            database.prepare('INSERT INTO alunos (id_usuario, nome, id_turma) VALUES (?, ?, ?)')
                .run(userId, schoolClass.nome_turma, classId);
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'turma.senha', `turma:${classId}`);
    sendJson(response, created ? 201 : 200, {
        id_turma: classId,
        login,
        usuario: readableClassLogin(schoolClass),
        tem_senha: true,
        mensagem: created ? 'Acesso da turma criado.' : 'Senha da turma atualizada.'
    });
}

function disableClassAccount(response, user, classId) {
    requireRole(user, ['gestao']);
    findClass(classId);
    const account = findClassAccount(classId);
    if (!account || !account.ativo) throw new ApiError(404, 'Esta turma não tem acesso ativo.');
    database.exec('BEGIN IMMEDIATE');
    try {
        database.prepare('UPDATE usuarios SET ativo = 0 WHERE id_usuario = ?').run(account.id_usuario);
        database.prepare('DELETE FROM sessoes WHERE id_usuario = ?').run(account.id_usuario);
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
    registrar(user, 'turma.desativar_acesso', `turma:${classId}`);
    sendJson(response, 200, { id_turma: classId, tem_senha: false, mensagem: 'Acesso da turma desativado.' });
}

// Com login. Devolve true quando tratou a requisição.
async function handleClassPasswordRequest(request, response, user, parts) {
    if (parts[1] !== 'turmas' || parts[3] !== 'senha' || parts.length !== 4) return false;
    const classId = getRecordId(parts[2]);
    if (request.method === 'PUT') await setClassPassword(request, response, user, classId);
    else if (request.method === 'DELETE') disableClassAccount(response, user, classId);
    else throw new ApiError(405, 'Método não permitido.');
    return true;
}

// Rotas pessoais recusadas para a conta da turma (403). `parts` = caminho já dividido.
function isPersonalRoute(parts, method) {
    const [, section, second, third] = parts;
    if (['justificativas', 'mensagens', 'frequencias', 'desempenho', 'entregas'].includes(section)) return true;
    if (section === 'atividades' && third === 'entregas') return true;
    if (section === 'auth' && second === 'password') return true;
    if (section === 'conta' && ['email', 'sessoes'].includes(second)) return true;
    if (section === 'privacidade' && second === 'meus-dados') return true;
    if (section === 'arquivos' && method === 'POST') return true;
    return false;
}

function assertClassAccountAllowed(user, parts, method) {
    if (!isClassAccount(user) || !isPersonalRoute(parts, method)) return;
    throw new ApiError(403, 'Este recurso é pessoal e não está disponível no acesso da turma.');
}

module.exports = {
    handleClassPasswordRequest, assertClassAccountAllowed
};
