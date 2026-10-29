const database = require('../src/database');
const { hashPasswordSync: hashPassword } = require('../src/utils/password');

const accounts = [
    {
        login: 'professor',
        legacyLogin: 'professor ceep',
        tipo_usuario: 'professor',
        passwordVariable: 'PROFESSOR_SENHA'
    },
    {
        login: 'gestao',
        legacyLogin: 'gestao ceep',
        tipo_usuario: 'gestao',
        passwordVariable: 'GESTAO_SENHA'
    }
];

for (const account of accounts) {
    const password = process.env[account.passwordVariable];
    if (typeof password !== 'string' || password.length < 8) {
        throw new Error(
            `Defina ${account.passwordVariable} com uma senha de pelo menos 8 caracteres.`
        );
    }
}

database.exec('BEGIN IMMEDIATE');
try {
    database.prepare(`
        UPDATE usuarios SET ativo = 0
        WHERE login = 'aluno ceep' AND tipo_usuario = 'aluno'
    `).run();

    for (const account of accounts) {
        const existing = database.prepare(`
            SELECT id_usuario FROM usuarios
            WHERE tipo_usuario = ? AND login IN (?, ?)
            ORDER BY CASE WHEN login = ? THEN 0 ELSE 1 END
            LIMIT 1
        `).get(account.tipo_usuario, account.login, account.legacyLogin, account.login);
        const passwordHash = hashPassword(process.env[account.passwordVariable]);

        if (existing) {
            database.prepare(`
                UPDATE usuarios
                SET login = ?, senha = ?, curso = NULL, serie = NULL, ativo = 1
                WHERE id_usuario = ?
            `).run(account.login, passwordHash, existing.id_usuario);
        } else {
            database.prepare(`
                INSERT INTO usuarios (login, senha, tipo_usuario, curso, serie, ativo)
                VALUES (?, ?, ?, NULL, NULL, 1)
            `).run(account.login, passwordHash, account.tipo_usuario);
        }
    }
    database.exec('COMMIT');
} catch (error) {
    database.exec('ROLLBACK');
    throw error;
}

console.log('Contas de professor e gestão atualizadas; senhas não foram exibidas.');
