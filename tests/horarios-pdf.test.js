const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { usarServidor, ARQUIVOS, ROOT } = require('./helpers/servidor');

const s = usarServidor();

async function enviar(token, conteudo = ARQUIVOS.pdf, tipo = 'application/pdf', nome = 'horario.pdf') {
    const r = await s.api('/api/arquivos', {
        method: 'POST', token, body: conteudo,
        headers: { 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) }
    });
    assert.equal(r.status, 201, r.text);
    return r.body;
}

function publicar(rota, token, idArquivo) {
    return s.api(`/api/horarios-pdf/${rota}`, { method: 'PUT', token, body: { id_arquivo: idArquivo } });
}

test('horário da turma: gestão publica; aluno da turma e professor dela veem e baixam', async () => {
    const gestao = await s.gestao();
    const aluno = await s.alunoPronto(0);
    const arquivo = await enviar(gestao, ARQUIVOS.pdf, 'application/pdf', 'Horário 1ª série.pdf');

    const r = await publicar(`turma/${aluno.id_turma}`, gestao, arquivo.id_arquivo);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.body).sort(),
        ['arquivo', 'atualizado_em', 'id_horario_pdf', 'id_turma', 'nome_turma', 'publico']);
    assert.equal(r.body.publico, 'turma');
    assert.equal(r.body.id_turma, aluno.id_turma);
    assert.ok(r.body.nome_turma);
    assert.deepEqual(r.body.arquivo, { id_arquivo: arquivo.id_arquivo, nome: arquivo.nome, tamanho: arquivo.tamanho });

    const doAluno = await s.api('/api/horarios-pdf', { token: aluno.token });
    assert.equal(doAluno.status, 200);
    assert.deepEqual(Object.keys(doAluno.body), ['turma']);
    assert.deepEqual(doAluno.body.turma, r.body);
    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: aluno.token })).status, 200);

    // O professor do exemplo leciona em todas as turmas.
    const professor = await s.professor();
    const doProfessor = await s.api('/api/horarios-pdf', { token: professor });
    assert.deepEqual(Object.keys(doProfessor.body).sort(), ['professores', 'turmas']);
    assert.ok(doProfessor.body.turmas.some((item) => item.id_horario_pdf === r.body.id_horario_pdf));
    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: professor })).status, 200);

    const daGestao = await s.api('/api/horarios-pdf', { token: gestao });
    assert.ok(daGestao.body.turmas.some((item) => item.id_horario_pdf === r.body.id_horario_pdf));
});

test('horário da turma: aluno de outra turma e professor sem a turma recebem 404 no download', async () => {
    const gestao = await s.gestao();
    const aluno = await s.alunoPronto(0);
    const deOutra = await s.alunoPronto(6);
    assert.notEqual(aluno.id_turma, deOutra.id_turma);
    const arquivo = await enviar(gestao);
    assert.equal((await publicar(`turma/${aluno.id_turma}`, gestao, arquivo.id_arquivo)).status, 200);

    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: deOutra.token })).status, 404);
    const lista = await s.api('/api/horarios-pdf', { token: deOutra.token });
    assert.notEqual(lista.body.turma?.id_turma, aluno.id_turma);

    s.criarProfessor('prof.semturma', 'Senha-prof-123');
    const semTurma = await s.login('prof.semturma', 'Senha-prof-123');
    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: semTurma })).status, 404);
    assert.deepEqual((await s.api('/api/horarios-pdf', { token: semTurma })).body.turmas, []);
});

test('horário dos professores: todo professor baixa; aluno não', async () => {
    const gestao = await s.gestao();
    const aluno = await s.alunoPronto(1);
    const arquivo = await enviar(gestao, ARQUIVOS.pdf, 'application/pdf', 'professores.pdf');
    const r = await publicar('professores', gestao, arquivo.id_arquivo);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.publico, 'professores');
    assert.equal(r.body.id_turma, null);
    assert.equal(r.body.nome_turma, null);

    s.criarProfessor('prof.geral', 'Senha-prof-123');
    const prof = await s.login('prof.geral', 'Senha-prof-123');
    assert.deepEqual((await s.api('/api/horarios-pdf', { token: prof })).body.professores, r.body);
    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: prof })).status, 200);
    assert.equal((await s.api(`/api/arquivos/${arquivo.id_arquivo}`, { token: aluno.token })).status, 404);
});

test('publicar: só gestão, só PDF próprio, turma existente; substituir e remover com auditoria', async () => {
    const gestao = await s.gestao();
    const professor = await s.professor();
    const aluno = await s.alunoPronto(2);
    const turma = aluno.id_turma;
    const pdf = await enviar(gestao);

    assert.equal((await publicar(`turma/${turma}`, professor, pdf.id_arquivo)).status, 403);
    assert.equal((await s.api(`/api/horarios-pdf/turma/${turma}`, { method: 'DELETE', token: aluno.token })).status, 403);
    assert.equal((await publicar('turma/999999', gestao, pdf.id_arquivo)).status, 404);
    assert.equal((await publicar('turma/abc', gestao, pdf.id_arquivo)).status, 400);
    assert.equal((await publicar('outra', gestao, pdf.id_arquivo)).status, 404);
    assert.equal((await s.api(`/api/horarios-pdf/turma/${turma}`, {
        method: 'PUT', token: gestao, body: { id_arquivo: pdf.id_arquivo, extra: 1 }
    })).status, 400);
    assert.equal((await s.api('/api/horarios-pdf', { method: 'POST', token: gestao, body: {} })).status, 405);

    const png = await enviar(gestao, ARQUIVOS.png, 'image/png', 'grade.png');
    const naoPdf = await publicar(`turma/${turma}`, gestao, png.id_arquivo);
    assert.equal(naoPdf.status, 400);
    assert.match(naoPdf.body.erro, /PDF/);
    const deOutro = await enviar(aluno.token);
    assert.equal((await publicar(`turma/${turma}`, gestao, deOutro.id_arquivo)).status, 400);

    const primeiro = await publicar(`turma/${turma}`, gestao, pdf.id_arquivo);
    assert.equal(primeiro.status, 200);
    const novo = await enviar(gestao, ARQUIVOS.pdf, 'application/pdf', 'horario-v2.pdf');
    const segundo = await publicar(`turma/${turma}`, gestao, novo.id_arquivo);
    assert.equal(segundo.status, 200);
    assert.equal(segundo.body.id_horario_pdf, primeiro.body.id_horario_pdf, 'substitui o anterior');
    assert.equal(segundo.body.arquivo.id_arquivo, novo.id_arquivo);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM horarios_pdf WHERE id_turma = ?').get(turma).n, 1);

    const remover = await s.api(`/api/horarios-pdf/turma/${turma}`, { method: 'DELETE', token: gestao });
    assert.equal(remover.status, 200);
    assert.deepEqual(remover.body, { removido: true });
    assert.equal((await s.api(`/api/horarios-pdf/turma/${turma}`, { method: 'DELETE', token: gestao })).status, 404);
    assert.equal((await s.api('/api/horarios-pdf', { token: aluno.token })).body.turma, null);

    const acoes = s.db.prepare(
        "SELECT acao FROM auditoria WHERE acao LIKE 'horario.%' AND alvo = ? ORDER BY id_auditoria"
    ).all(`turma:${turma}`).map((row) => row.acao);
    assert.deepEqual(acoes.slice(-3), ['horario.publicar', 'horario.publicar', 'horario.remover']);
});

test('limpeza de órfãos: PDF vinculado a horário fica; o substituído sai', async () => {
    const gestao = await s.gestao();
    const vinculado = await enviar(gestao);
    const substituido = await enviar(gestao);
    assert.equal((await publicar('professores', gestao, substituido.id_arquivo)).status, 200);
    assert.equal((await publicar('professores', gestao, vinculado.id_arquivo)).status, 200);
    s.db.prepare("UPDATE arquivos SET criado_em = datetime('now', '-2 days') WHERE id_arquivo IN (?, ?)")
        .run(vinculado.id_arquivo, substituido.id_arquivo);

    const env = { ...process.env, DATA_DIR: s.dir, CW_AGENDADOR: '0', CW_BACKUP: '0' };
    for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
    delete env.ADMIN_LOGIN;
    delete env.ADMIN_SENHA;
    execFileSync(process.execPath,
        ['-e', "require('./src/utils/arquivos').cleanOrphanFiles()"], { cwd: ROOT, env, stdio: 'pipe' });

    const existe = (id) => Boolean(s.db.prepare('SELECT 1 FROM arquivos WHERE id_arquivo = ?').get(id));
    assert.ok(existe(vinculado.id_arquivo));
    assert.ok(existsSync(path.join(s.dir, 'arquivos', String(vinculado.id_arquivo))));
    assert.ok(!existe(substituido.id_arquivo));
});
