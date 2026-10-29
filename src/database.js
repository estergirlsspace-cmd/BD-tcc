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
ensureColumn('posts_avisos', 'urgente', 'INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0, 1))');
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
    -- Estado do aviso por pessoa (leitura confirmada, salvo). Só existe linha quando houve
    -- interação; o CHECK impede guardar estado vazio (a linha é apagada nesse caso).
    CREATE TABLE IF NOT EXISTS avisos_usuarios (
        id_post INTEGER NOT NULL REFERENCES posts_avisos(id_post) ON DELETE CASCADE,
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        lido_em TEXT,
        salvo_em TEXT,
        PRIMARY KEY (id_post, id_usuario),
        CHECK (lido_em IS NOT NULL OR salvo_em IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS avisos_usuarios_usuario_idx ON avisos_usuarios (id_usuario);
`);
database.exec('PRAGMA foreign_keys = ON');

// ---- Sprint 2: arquivos, justificativas, ocorrências, mensagens, e-mail e sessões ----
ensureColumn('usuarios', 'email', 'TEXT'); // só e-mail confirmado (ou cadastrado pela gestão)
ensureColumn('sessoes', 'dispositivo', 'TEXT');
ensureColumn('sessoes', 'ultimo_acesso', 'INTEGER');
database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS usuarios_email_unique ON usuarios (lower(email))
        WHERE email IS NOT NULL;

    -- Metadados dos arquivos enviados; o conteúdo fica em DATA_DIR/arquivos/<id_arquivo>.
    CREATE TABLE IF NOT EXISTS arquivos (
        id_arquivo INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario),
        nome TEXT NOT NULL,
        tipo_mime TEXT NOT NULL CHECK (tipo_mime IN ('application/pdf', 'image/jpeg', 'image/png')),
        tamanho INTEGER NOT NULL CHECK (tamanho > 0 AND tamanho <= 5242880),
        sha256 TEXT NOT NULL,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS justificativas (
        id_justificativa INTEGER PRIMARY KEY AUTOINCREMENT,
        id_aluno INTEGER NOT NULL REFERENCES alunos(id_aluno) ON DELETE CASCADE,
        id_disciplina INTEGER NOT NULL REFERENCES disciplinas(id_disciplina) ON DELETE CASCADE,
        data_falta TEXT NOT NULL,
        motivo TEXT NOT NULL,
        id_arquivo INTEGER REFERENCES arquivos(id_arquivo) ON DELETE SET NULL,
        situacao TEXT NOT NULL DEFAULT 'pendente'
            CHECK (situacao IN ('pendente', 'aceita', 'recusada')),
        id_usuario_analise INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
        analisado_em TEXT,
        resposta TEXT,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (id_aluno, id_disciplina, data_falta)
    );
    CREATE INDEX IF NOT EXISTS justificativas_situacao_idx ON justificativas (situacao, criado_em);

    CREATE TABLE IF NOT EXISTS ocorrencias (
        id_ocorrencia INTEGER PRIMARY KEY AUTOINCREMENT,
        id_aluno INTEGER NOT NULL REFERENCES alunos(id_aluno) ON DELETE CASCADE,
        id_usuario_autor INTEGER NOT NULL REFERENCES usuarios(id_usuario),
        descricao TEXT NOT NULL,
        situacao TEXT NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'resolvida')),
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolvida_em TEXT
    );
    CREATE INDEX IF NOT EXISTS ocorrencias_aluno_idx ON ocorrencias (id_aluno, criado_em);

    -- Conversa 1:1; o par é guardado em ordem (a < b) para existir uma só conversa por dupla.
    CREATE TABLE IF NOT EXISTS conversas (
        id_conversa INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario_a INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        id_usuario_b INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (id_usuario_a < id_usuario_b),
        UNIQUE (id_usuario_a, id_usuario_b)
    );
    CREATE TABLE IF NOT EXISTS mensagens (
        id_mensagem INTEGER PRIMARY KEY AUTOINCREMENT,
        id_conversa INTEGER NOT NULL REFERENCES conversas(id_conversa) ON DELETE CASCADE,
        id_autor INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lida_em TEXT
    );
    CREATE INDEX IF NOT EXISTS mensagens_conversa_idx ON mensagens (id_conversa, id_mensagem);

    -- Tokens de uso único (hash SHA-256): redefinir senha e confirmar e-mail (dado = e-mail novo).
    CREATE TABLE IF NOT EXISTS tokens (
        token_hash TEXT PRIMARY KEY,
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        finalidade TEXT NOT NULL CHECK (finalidade IN ('redefinir_senha', 'confirmar_email')),
        dado TEXT,
        expira_em INTEGER NOT NULL
    );

    -- Notificações por e-mail são ligadas por padrão; aqui ficam só as que a pessoa desligou.
    CREATE TABLE IF NOT EXISTS notificacoes_silenciadas (
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK (tipo IN ('urgente', 'turma', 'prazos', 'eventos', 'mensagens')),
        PRIMARY KEY (id_usuario, tipo)
    );

    -- Idempotência de e-mails automáticos (ex.: "prazo:12:34", "resumo:2026-W44:34").
    CREATE TABLE IF NOT EXISTS envios_email (
        chave TEXT PRIMARY KEY,
        enviado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);
ensureColumn('posts_avisos', 'id_arquivo', 'INTEGER REFERENCES arquivos(id_arquivo) ON DELETE SET NULL');

// ---- Sprint 3: LGPD ----
ensureColumn('usuarios', 'termos_aceitos_em', 'TEXT'); // aceite dos termos e da política de privacidade
database.exec(`
    -- Registro de auditoria: quem acessou ou alterou dados pessoais e ações administrativas.
    CREATE TABLE IF NOT EXISTS auditoria (
        id_auditoria INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
        acao TEXT NOT NULL,
        alvo TEXT,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS auditoria_data_idx ON auditoria (criado_em);
`);

// ---- Sprint 4: horários em PDF e pastas de avisos salvos ----
database.exec(`
    -- Horário publicado pela gestão: um PDF por turma (alunos) e um geral para os professores.
    CREATE TABLE IF NOT EXISTS horarios_pdf (
        id_horario_pdf INTEGER PRIMARY KEY AUTOINCREMENT,
        publico TEXT NOT NULL CHECK (publico IN ('turma', 'professores')),
        id_turma INTEGER REFERENCES turmas(id_turma) ON DELETE CASCADE,
        id_arquivo INTEGER NOT NULL REFERENCES arquivos(id_arquivo),
        id_usuario INTEGER REFERENCES usuarios(id_usuario) ON DELETE SET NULL,
        atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK ((publico = 'turma') = (id_turma IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS horarios_pdf_alvo_unique
        ON horarios_pdf (publico, COALESCE(id_turma, 0));

    -- Pastas pessoais para organizar avisos salvos.
    CREATE TABLE IF NOT EXISTS pastas (
        id_pasta INTEGER PRIMARY KEY AUTOINCREMENT,
        id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
        nome TEXT NOT NULL,
        criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (id_usuario, nome)
    );
`);
ensureColumn('avisos_usuarios', 'id_pasta', 'INTEGER REFERENCES pastas(id_pasta) ON DELETE SET NULL');

// ---- Sprint 5: 12 turmas (série 1–3 × curso × letra A/B), sem mudar a estrutura ----
// Idempotente: "1ª Série — Informática" vira "1ª Série — Informática A" (mesmo id, nada se perde)
// e as que faltarem são criadas. Banco sem nenhuma turma (instalação nova / seed de exemplo)
// fica como está; a migração roda na próxima subida, quando já houver turmas.
function migrateClassLetters() {
    if (!database.prepare('SELECT 1 FROM turmas LIMIT 1').get()) return;
    const labels = { informatica: 'Informática', redes: 'Redes' };
    const byName = database.prepare('SELECT id_turma FROM turmas WHERE nome_turma = ?');
    const rename = database.prepare(
        'UPDATE turmas SET nome_turma = ?, curso = ?, serie = ? WHERE id_turma = ?'
    );
    const insert = database.prepare('INSERT INTO turmas (nome_turma, curso, serie) VALUES (?, ?, ?)');
    database.exec('BEGIN IMMEDIATE');
    try {
        for (let serie = 1; serie <= 3; serie += 1) {
            for (const [curso, label] of Object.entries(labels)) {
                const base = `${serie}ª Série — ${label}`;
                const legacy = byName.get(base);
                if (legacy && !byName.get(`${base} A`)) {
                    rename.run(`${base} A`, curso, serie, legacy.id_turma);
                }
                for (const letra of ['A', 'B']) {
                    if (!byName.get(`${base} ${letra}`)) insert.run(`${base} ${letra}`, curso, serie);
                }
            }
        }
        database.exec('COMMIT');
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}
migrateClassLetters();

// Instalação nova (banco vazio): cria a primeira conta da gestão a partir de variáveis de
// ambiente. A senha é provisória e precisa ser trocada no primeiro acesso.
const hasManager = database.prepare(
    "SELECT 1 FROM usuarios WHERE tipo_usuario = 'gestao' AND ativo = 1"
).get();
if (!hasManager && process.env.ADMIN_LOGIN && process.env.ADMIN_SENHA) {
    const { hashPasswordSync } = require('./utils/password');
    database.prepare(`
        INSERT INTO usuarios (login, nome, senha, tipo_usuario, ativo, deve_trocar_senha)
        VALUES (?, ?, ?, 'gestao', 1, 1)
    `).run(process.env.ADMIN_LOGIN.trim(), process.env.ADMIN_NOME || 'Gestão',
        hashPasswordSync(process.env.ADMIN_SENHA));
    console.log(`Conta inicial da gestão criada: ${process.env.ADMIN_LOGIN.trim()}`);
}

module.exports = database;
