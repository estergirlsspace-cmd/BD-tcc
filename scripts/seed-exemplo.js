// Cadastra turmas, disciplinas, horários, alunos, atividades, avisos e frequências de exemplo.
// Cada aluno recebe matrícula e um "início de CPF" fictício; a senha inicial é ceep@ + esses
// 4 dígitos e precisa ser trocada no primeiro acesso. A lista sai em data/alunos-exemplo.csv
// (fora do git), para testes.
// Uso: node scripts/seed-exemplo.js
const { randomInt } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const database = require('../src/database');
const { hashPassword } = require('../src/utils/password');
const { SCHOOL_UTC_OFFSET_HOURS } = require('../src/utils/dates');

const courses = {
    informatica: {
        label: 'Informática',
        disciplinas: ['Programação Web', 'Banco de Dados', 'Lógica de Programação', 'Língua Portuguesa']
    },
    redes: {
        label: 'Redes',
        disciplinas: ['Redes de Computadores', 'Sistemas Operacionais', 'Segurança da Informação', 'Matemática']
    }
};

const firstNames = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique',
    'Isabela', 'João', 'Larissa', 'Mateus', 'Natália', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Thiago'];
const lastNames = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Pereira', 'Costa', 'Almeida'];

const slots = [['07:30', '08:20'], ['08:20', '09:10'], ['09:30', '10:20'], ['10:20', '11:10']];

// Data "AAAA-MM-DD" no horário de Brasília, deslocada em dias a partir de hoje.
function isoDate(offsetDays) {
    const date = new Date(Date.now() + (SCHOOL_UTC_OFFSET_HOURS * 60 + offsetDays * 24 * 60) * 60000);
    return date.toISOString().slice(0, 10);
}

const professor = database.prepare(`
    SELECT p.id_professor, u.id_usuario FROM professores p
    JOIN usuarios u ON u.id_usuario = p.id_usuario
    WHERE u.login = 'lucas.professor'
`).get();
const gestao = database.prepare("SELECT id_usuario FROM usuarios WHERE login = 'lucas'").get();
if (!professor || !gestao) throw new Error('Crie antes os usuários lucas e lucas.professor.');

let studentIndex = 0;
const studentList = [['matricula', 'nome', 'turma', 'senha_inicial']];

database.exec('BEGIN IMMEDIATE');
try {
    for (const [curso, info] of Object.entries(courses)) {
        for (let serie = 1; serie <= 3; serie += 1) {
            const nomeTurma = `${serie}ª Série — ${info.label}`;
            const classId = Number(database.prepare(
                'INSERT INTO turmas (nome_turma, curso, serie) VALUES (?, ?, ?)'
            ).run(nomeTurma, curso, serie).lastInsertRowid);

            const disciplineIds = info.disciplinas.map((nome, index) => Number(database.prepare(`
                INSERT INTO disciplinas (id_turma, id_professor, nome_disciplina) VALUES (?, ?, ?)
            `).run(classId, index < 2 ? professor.id_professor : null, nome).lastInsertRowid));

            for (let dia = 1; dia <= 5; dia += 1) {
                slots.forEach(([inicio, fim], index) => {
                    database.prepare(`
                        INSERT INTO horarios
                            (id_turma, id_disciplina, dia_semana, hora_inicio, hora_fim, sala, carga_minutos)
                        VALUES (?, ?, ?, ?, ?, ?, 50)
                    `).run(classId, disciplineIds[(dia + index) % disciplineIds.length], dia,
                        inicio, fim, `Sala ${serie}${curso === 'redes' ? 'R' : 'I'}`);
                });
            }

            const studentIds = [];
            for (let i = 0; i < 6; i += 1) {
                const nome = `${firstNames[studentIndex % firstNames.length]} ${lastNames[(studentIndex * 3) % lastNames.length]}`;
                studentIndex += 1;
                const matricula = String(20260000 + studentIndex);
                const initialPassword = `ceep@${String(randomInt(0, 10000)).padStart(4, '0')}`;
                studentList.push([matricula, nome, nomeTurma, initialPassword]);
                const userId = Number(database.prepare(`
                    INSERT INTO usuarios (login, senha, tipo_usuario, curso, serie, ativo, deve_trocar_senha)
                    VALUES (?, ?, 'aluno', ?, ?, 1, 1)
                `).run(matricula, hashPassword(initialPassword), curso, serie).lastInsertRowid);
                studentIds.push(Number(database.prepare(
                    'INSERT INTO alunos (id_usuario, nome, id_turma) VALUES (?, ?, ?)'
                ).run(userId, nome, classId).lastInsertRowid));
            }

            const activities = [
                ['Lista de exercícios 1', 'Resolver os exercícios do capítulo 2.', 'atividade', 5],
                ['Prova bimestral', 'Conteúdo das aulas 1 a 8.', 'avaliacao', 14],
                ['Trabalho em grupo', 'Apresentação de 10 minutos sobre o tema sorteado.', 'atividade', -3]
            ];
            activities.forEach(([titulo, descricao, tipo, dias], index) => {
                database.prepare(`
                    INSERT INTO atividades
                        (titulo, descricao, id_turma, id_disciplina, id_usuario_autor, prazo, tipo)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(titulo, descricao, classId, disciplineIds[index % 2],
                    professor.id_usuario, isoDate(dias), tipo);
            });

            database.prepare(`
                INSERT INTO posts_avisos (titulo, conteudo, id_usuario_autor, id_turma, curso, serie, tipo, data_evento)
                VALUES (?, ?, ?, ?, ?, ?, 'evento', ?)
            `).run('Reunião de pais', `Reunião da turma ${nomeTurma} no auditório.`,
                gestao.id_usuario, classId, curso, serie, isoDate(10));

            for (let dias = 1; dias <= 5; dias += 1) {
                studentIds.forEach((studentId, index) => {
                    database.prepare(`
                        INSERT INTO frequencias
                            (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(studentId, disciplineIds[0], professor.id_usuario, isoDate(-dias),
                        (index + dias) % 5 === 0 ? 0 : 1);
                });
            }
        }
    }

    database.prepare(`
        INSERT INTO posts_avisos (titulo, conteudo, id_usuario_autor, tipo)
        VALUES ('Bem-vindos ao C-Warning', 'Avisos gerais da escola aparecem aqui.', ?, 'aviso')
    `).run(gestao.id_usuario);

    database.exec('COMMIT');
} catch (error) {
    database.exec('ROLLBACK');
    throw error;
}

writeFileSync(path.join(__dirname, '..', 'data', 'alunos-exemplo.csv'),
    `${studentList.map((row) => row.join(';')).join('\n')}\n`, { mode: 0o600 });
console.log(`Exemplo criado: 6 turmas, 24 disciplinas, ${studentIndex} alunos.`);
