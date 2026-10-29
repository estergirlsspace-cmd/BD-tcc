const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR permite guardar o banco fora do código (ex.: volume do Docker em produção).
const dataDirectory = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const databasePath = path.join(dataDirectory, 'educacao.sqlite');

mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);

function migrateUsersTable() {
    const table = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'"
    ).get();

    if (!table) {
        database.exec(`
            CREATE TABLE usuarios (
                id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT NOT NULL,
                senha TEXT NOT NULL,
                tipo_usuario TEXT NOT NULL,
                curso TEXT
            );
        `);
        return;
    }

    const columns = database.prepare('PRAGMA table_info(usuarios)').all();
    if (columns.some((column) => column.name === 'curso')) {
        return;
    }

    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('PRAGMA legacy_alter_table = ON');
    try {
        database.exec(`
            BEGIN IMMEDIATE;
            CREATE TABLE usuarios_nova (
                id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
                login TEXT NOT NULL,
                senha TEXT NOT NULL,
                tipo_usuario TEXT NOT NULL,
                curso TEXT
            );
            INSERT INTO usuarios_nova (id_usuario, login, senha, tipo_usuario)
                SELECT id_usuario, login, senha, tipo_usuario FROM usuarios;
            DROP TABLE usuarios;
            ALTER TABLE usuarios_nova RENAME TO usuarios;
            COMMIT;
        `);
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    } finally {
        database.exec('PRAGMA legacy_alter_table = OFF');
        database.exec('PRAGMA foreign_keys = ON');
    }
}

migrateUsersTable();
database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_login_curso_unique
        ON usuarios (login, curso)
        WHERE curso IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_login_sem_curso_unique
        ON usuarios (login)
        WHERE curso IS NULL;

    CREATE TABLE IF NOT EXISTS turmas (
        id_turma INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_turma TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS professores (
        id_professor INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario INTEGER NOT NULL UNIQUE REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        id_disciplina INTEGER REFERENCES disciplinas(id_disciplina) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS disciplinas (
        id_disciplina INTEGER PRIMARY KEY AUTOINCREMENT,
        id_grade INTEGER,
        id_turma INTEGER NOT NULL REFERENCES turmas(id_turma) ON DELETE CASCADE,
        id_professor INTEGER REFERENCES professores(id_professor) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS alunos (
        id_aluno INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario INTEGER NOT NULL UNIQUE REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        id_turma INTEGER REFERENCES turmas(id_turma) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS posts_avisos (
        id_post INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        conteudo TEXT NOT NULL,
        id_usuario_autor INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessoes (
        token_hash TEXT PRIMARY KEY,
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        curso TEXT,
        expira_em INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS horarios (
        id_horario INTEGER PRIMARY KEY AUTOINCREMENT,
        id_turma INTEGER NOT NULL REFERENCES turmas(id_turma) ON DELETE CASCADE,
        id_disciplina INTEGER NOT NULL REFERENCES disciplinas(id_disciplina) ON DELETE CASCADE,
        dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
        hora_inicio TEXT NOT NULL,
        hora_fim TEXT NOT NULL,
        sala TEXT,
        UNIQUE (id_turma, dia_semana, hora_inicio)
    );

    CREATE TABLE IF NOT EXISTS atividades (
        id_atividade INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        descricao TEXT NOT NULL,
        id_turma INTEGER NOT NULL REFERENCES turmas(id_turma) ON DELETE CASCADE,
        id_disciplina INTEGER NOT NULL REFERENCES disciplinas(id_disciplina) ON DELETE CASCADE,
        id_usuario_autor INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        prazo TEXT,
        tipo TEXT NOT NULL DEFAULT 'atividade'
            CHECK (tipo IN ('atividade', 'avaliacao', 'evento', 'comunicado')),
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entregas_atividades (
        id_entrega INTEGER PRIMARY KEY AUTOINCREMENT,
        id_atividade INTEGER NOT NULL REFERENCES atividades(id_atividade) ON DELETE CASCADE,
        id_aluno INTEGER NOT NULL REFERENCES alunos(id_aluno) ON DELETE CASCADE,
        resposta TEXT NOT NULL,
        enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        nota REAL CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10)),
        feedback TEXT,
        UNIQUE (id_atividade, id_aluno)
    );

    CREATE TABLE IF NOT EXISTS frequencias (
        id_frequencia INTEGER PRIMARY KEY AUTOINCREMENT,
        id_aluno INTEGER NOT NULL REFERENCES alunos(id_aluno) ON DELETE CASCADE,
        id_disciplina INTEGER NOT NULL REFERENCES disciplinas(id_disciplina) ON DELETE CASCADE,
        id_usuario_registro INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        data_aula TEXT NOT NULL,
        presente INTEGER NOT NULL CHECK (presente IN (0, 1)),
        observacao TEXT,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (id_aluno, id_disciplina, data_aula)
    );

    CREATE TABLE IF NOT EXISTS senhas_iniciais_turma (
        curso TEXT NOT NULL CHECK (curso IN ('informatica', 'redes')),
        serie INTEGER NOT NULL CHECK (serie BETWEEN 1 AND 3),
        senha_hash TEXT NOT NULL,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (curso, serie)
    );
`);

function ensureColumn(table, column, definition) {
    const exists = database.prepare(`PRAGMA table_info(${table})`).all()
        .some((entry) => entry.name === column);
    if (!exists) {
        database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

const hadActiveColumn = database.prepare('PRAGMA table_info(usuarios)').all()
    .some((entry) => entry.name === 'ativo');
ensureColumn('usuarios', 'serie', 'INTEGER CHECK (serie IS NULL OR serie BETWEEN 1 AND 3)');
ensureColumn('usuarios', 'ativo', 'INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1))');
if (!hadActiveColumn) {
    database.prepare(`
        UPDATE usuarios SET ativo = 0
        WHERE login = 'aluno ceep' AND tipo_usuario = 'aluno'
    `).run();
}
ensureColumn('turmas', 'curso', "TEXT CHECK (curso IS NULL OR curso IN ('informatica', 'redes'))");
ensureColumn('turmas', 'serie', 'INTEGER CHECK (serie IS NULL OR serie BETWEEN 1 AND 3)');
ensureColumn('disciplinas', 'nome_disciplina', "TEXT NOT NULL DEFAULT 'Disciplina'");
ensureColumn('posts_avisos', 'id_turma', 'INTEGER REFERENCES turmas(id_turma) ON DELETE CASCADE');
ensureColumn('posts_avisos', 'curso', "TEXT CHECK (curso IS NULL OR curso IN ('informatica', 'redes'))");
ensureColumn('posts_avisos', 'serie', 'INTEGER CHECK (serie IS NULL OR serie BETWEEN 1 AND 3)');
ensureColumn('posts_avisos', 'tipo', "TEXT NOT NULL DEFAULT 'aviso' CHECK (tipo IN ('aviso', 'evento', 'avaliacao', 'atividade', 'comunicado'))");
ensureColumn('posts_avisos', 'data_evento', 'TEXT');
ensureColumn('horarios', 'carga_minutos', 'INTEGER');
ensureColumn('usuarios', 'nome', 'TEXT');
ensureColumn('professores', 'nome', 'TEXT');
ensureColumn('professores', 'area', `TEXT CHECK (area IS NULL OR area IN
    ('natureza', 'humanas', 'linguagens', 'matematica', 'informatica', 'redes'))`);
ensureColumn('usuarios', 'deve_trocar_senha',
    'INTEGER NOT NULL DEFAULT 0 CHECK (deve_trocar_senha IN (0, 1))');

// O acesso compartilhado por turma foi substituído por contas individuais (matrícula).
database.prepare(`
    UPDATE usuarios SET ativo = 0
    WHERE tipo_usuario = 'aluno' AND login GLOB '__aluno_compartilhado_*' AND ativo = 1
`).run();

database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_login_aluno_ativo_unique
        ON usuarios (login)
        WHERE tipo_usuario = 'aluno' AND ativo = 1;
    CREATE INDEX IF NOT EXISTS turmas_curso_serie_idx ON turmas (curso, serie);
    CREATE INDEX IF NOT EXISTS disciplinas_turma_idx ON disciplinas (id_turma);
    CREATE INDEX IF NOT EXISTS avisos_alvo_idx ON posts_avisos (id_turma, curso, serie, criado_em);
    CREATE INDEX IF NOT EXISTS horarios_turma_idx ON horarios (id_turma, dia_semana, hora_inicio);
    CREATE INDEX IF NOT EXISTS atividades_turma_prazo_idx ON atividades (id_turma, prazo);
    CREATE INDEX IF NOT EXISTS frequencias_aluno_data_idx ON frequencias (id_aluno, data_aula);
`);
database.exec('PRAGMA foreign_keys = ON');

module.exports = database;
