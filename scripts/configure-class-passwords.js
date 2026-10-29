const database = require('../src/database');
const { hashPassword } = require('../src/utils/password');
const { sharedStudentLogin } = require('../src/utils/accounts');

const accounts = [
    { curso: 'redes', serie: 1, passwordVariable: 'REDES_TURMA_1_SENHA' },
    { curso: 'redes', serie: 2, passwordVariable: 'REDES_TURMA_2_SENHA' },
    { curso: 'redes', serie: 3, passwordVariable: 'REDES_TURMA_3_SENHA' },
    { curso: 'informatica', serie: 1, passwordVariable: 'INFORMATICA_TURMA_1_SENHA' },
    { curso: 'informatica', serie: 2, passwordVariable: 'INFORMATICA_TURMA_2_SENHA' },
    { curso: 'informatica', serie: 3, passwordVariable: 'INFORMATICA_TURMA_3_SENHA' }
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
    const upsertPassword = database.prepare(`
        INSERT INTO senhas_iniciais_turma (curso, serie, senha_hash, atualizado_em)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (curso, serie)
        DO UPDATE SET senha_hash = excluded.senha_hash, atualizado_em = CURRENT_TIMESTAMP
    `);

    for (const account of accounts) {
        const passwordHash = hashPassword(process.env[account.passwordVariable]);
        upsertPassword.run(account.curso, account.serie, passwordHash);

        const login = sharedStudentLogin(account.curso, account.serie);
        const existing = database.prepare(`
            SELECT id_usuario FROM usuarios
            WHERE login = ? AND tipo_usuario = 'aluno' AND curso = ? AND serie = ?
        `).get(login, account.curso, account.serie);

        if (existing) {
            database.prepare(`
                UPDATE usuarios SET senha = ?, ativo = 1 WHERE id_usuario = ?
            `).run(passwordHash, existing.id_usuario);
        } else {
            database.prepare(`
                INSERT INTO usuarios (login, senha, tipo_usuario, curso, serie, ativo)
                VALUES (?, ?, 'aluno', ?, ?, 1)
            `).run(login, passwordHash, account.curso, account.serie);
        }
    }
    database.exec('COMMIT');
} catch (error) {
    database.exec('ROLLBACK');
    throw error;
}

console.log('Acessos compartilhados por curso e série atualizados; senhas não foram exibidas.');
