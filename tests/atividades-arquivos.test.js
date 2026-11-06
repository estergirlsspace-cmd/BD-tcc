const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { usarServidor, ARQUIVOS, ROOT } = require('./helpers/servidor');

const s = usarServidor();
const SENHA_TURMA = 'Senha-da-turma-arquivos';

function enviarArquivo(token, conteudo = ARQUIVOS.pdf, { tipo = 'application/pdf', nome = 'arquivo.pdf' } = {}) {
    return s.api('/api/arquivos', {
        method: 'POST', token, body: conteudo,
        headers: { 'content-type': tipo, 'x-nome-arquivo': encodeURIComponent(nome) }
    });
}

function baixar(id, token) {
    return s.api(`/api/arquivos/${id}`, { token });
}

// Disciplina do professor de exemplo na turma informada.
function disciplinaDoProfessor(idTurma) {
    return s.db.prepare(`
        SELECT d.id_disciplina FROM disciplinas d
        JOIN professores p ON p.id_professor = d.id_professor
        JOIN usuarios u ON u.id_usuario = p.id_usuario
        WHERE d.id_turma = ? AND u.login = ? ORDER BY d.id_disciplina LIMIT 1
    `).get(idTurma, s.contas.professor.login).id_disciplina;
}

async function criarAtividade(token, aluno, extra = {}) {
    const r = await s.api('/api/atividades', {
        method: 'POST', token, body: {
            titulo: 'Lista com anexo', descricao: 'Resolva a lista do arquivo.', id_turma: aluno.id_turma,
            id_disciplina: disciplinaDoProfessor(aluno.id_turma), prazo: '2099-12-31', ...extra
        }
    });
    assert.equal(r.status, 201, r.text);
    return r.body;
}

function alunoDeOutraTurma(idTurma) {
    const indice = s.alunos.findIndex((a) => s.alunoInfo(a.matricula).id_turma !== idTurma);
    assert.ok(indice >= 0);
    return s.alunoPronto(indice);
}

async function entrarTurma(idTurma) {
    const definida = await s.api(`/api/turmas/${idTurma}/senha`, {
        method: 'PUT', token: await s.gestao(), body: { senha: SENHA_TURMA }
    });
    assert.ok([200, 201].includes(definida.status), definida.text);
    const r = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${idTurma}`, senha: SENHA_TURMA } });
    assert.equal(r.status, 200, r.text);
    await s.api('/api/privacidade/aceite', { method: 'POST', token: r.body.token, body: {} });
    return r.body.token;
}

test('atividade com anexo: aluno da turma vê e baixa; aluno de outra turma 404', async () => {
    const professor = await s.professor();
    const aluno = await s.alunoPronto(0);
    const up = await enviarArquivo(professor, ARQUIVOS.pdf, { nome: 'Lista 3.pdf' });
    assert.equal(up.status, 201, up.text);
    const atividade = await criarAtividade(professor, aluno, { id_arquivo: up.body.id_arquivo });
    assert.equal(atividade.id_arquivo, up.body.id_arquivo);
    assert.deepEqual(atividade.anexo, {
        id_arquivo: up.body.id_arquivo, nome: 'Lista 3.pdf', tipo_mime: 'application/pdf', tamanho: ARQUIVOS.pdf.length
    });
    assert.equal(atividade.anexo_nome, undefined);

    const lista = (await s.api('/api/atividades', { token: aluno.token })).body;
    const vista = lista.find((a) => a.id_atividade === atividade.id_atividade);
    assert.deepEqual(vista.anexo, atividade.anexo);
    assert.equal(vista.anexo_id_arquivo, undefined);
    assert.equal(lista.find((a) => a.id_atividade !== atividade.id_atividade).anexo, null);
    const daGestao = (await s.api('/api/atividades', { token: await s.gestao() })).body;
    assert.deepEqual(daGestao.find((a) => a.id_atividade === atividade.id_atividade).anexo, atividade.anexo);

    const baixado = await baixar(up.body.id_arquivo, aluno.token);
    assert.equal(baixado.status, 200);
    assert.ok(baixado.buffer.equals(ARQUIVOS.pdf));
    const outro = await alunoDeOutraTurma(aluno.id_turma);
    assert.equal((await baixar(up.body.id_arquivo, outro.token)).status, 404);
    const semDisciplina = s.criarProfessor('prof.sem.turma', 'Senha-prof-sem-turma');
    const tokenSem = await s.login('prof.sem.turma', 'Senha-prof-sem-turma');
    assert.ok(semDisciplina.id_professor);
    assert.equal((await baixar(up.body.id_arquivo, tokenSem)).status, 404);

    // Editar: trocar, remover (null) e manter quando o campo não vem.
    const novo = await enviarArquivo(professor, ARQUIVOS.png, { tipo: 'image/png', nome: 'quadro.png' });
    const trocada = await s.api(`/api/atividades/${atividade.id_atividade}`, {
        method: 'PATCH', token: professor, body: { id_arquivo: novo.body.id_arquivo }
    });
    assert.equal(trocada.status, 200, trocada.text);
    assert.equal(trocada.body.anexo.nome, 'quadro.png');
    const mantida = await s.api(`/api/atividades/${atividade.id_atividade}`, {
        method: 'PATCH', token: await s.gestao(), body: { titulo: 'Lista com anexo (revisada)' }
    });
    assert.equal(mantida.body.anexo.id_arquivo, novo.body.id_arquivo);
    const removida = await s.api(`/api/atividades/${atividade.id_atividade}`, {
        method: 'PATCH', token: professor, body: { id_arquivo: null }
    });
    assert.equal(removida.status, 200);
    assert.equal(removida.body.anexo, null);
    assert.equal((await baixar(novo.body.id_arquivo, aluno.token)).status, 404);
});

test('atividade: arquivo de outra pessoa ou id inválido em id_arquivo → 400', async () => {
    const professor = await s.professor();
    const aluno = await s.alunoPronto(0);
    const doAluno = await enviarArquivo(aluno.token);
    const r = await s.api('/api/atividades', {
        method: 'POST', token: professor, body: {
            titulo: 'X', descricao: 'Y', id_turma: aluno.id_turma,
            id_disciplina: disciplinaDoProfessor(aluno.id_turma), id_arquivo: doAluno.body.id_arquivo
        }
    });
    assert.equal(r.status, 400);
    const atividade = await criarAtividade(professor, aluno);
    for (const id_arquivo of [doAluno.body.id_arquivo, 'abc', 0, 999999]) {
        const p = await s.api(`/api/atividades/${atividade.id_atividade}`, {
            method: 'PATCH', token: professor, body: { id_arquivo }
        });
        assert.equal(p.status, 400, String(id_arquivo));
    }
});

test('entrega só com arquivo: 201; professor da disciplina baixa, outro professor 404', async () => {
    const professor = await s.professor();
    const aluno = await s.alunoPronto(1);
    const atividade = await criarAtividade(professor, aluno);
    const rota = `/api/atividades/${atividade.id_atividade}/entregas`;

    assert.equal((await s.api(rota, { method: 'POST', token: aluno.token, body: {} })).status, 400,
        'sem resposta e sem arquivo');
    assert.equal((await s.api(rota, { method: 'POST', token: aluno.token, body: { resposta: '   ' } })).status, 400);

    const up = await enviarArquivo(aluno.token, ARQUIVOS.jpg, { tipo: 'image/jpeg', nome: 'foto do caderno.jpg' });
    const entrega = await s.api(rota, { method: 'POST', token: aluno.token, body: { id_arquivo: up.body.id_arquivo } });
    assert.equal(entrega.status, 201, entrega.text);
    assert.equal(entrega.body.resposta, '');
    assert.equal(entrega.body.anexo.id_arquivo, up.body.id_arquivo);
    assert.equal(entrega.body.anexo.nome, 'foto do caderno.jpg');

    const minhas = (await s.api(rota, { token: aluno.token })).body;
    assert.equal(minhas[0].anexo.id_arquivo, up.body.id_arquivo);
    const doProfessor = (await s.api(rota, { token: professor })).body;
    assert.equal(doProfessor.find((e) => e.id_aluno === aluno.id_aluno).anexo.id_arquivo, up.body.id_arquivo);

    assert.equal((await baixar(up.body.id_arquivo, professor)).status, 200);
    assert.equal((await baixar(up.body.id_arquivo, await s.gestao())).status, 200);
    assert.equal((await baixar(up.body.id_arquivo, aluno.token)).status, 200);
    s.criarProfessor('prof.outro.arquivo', 'Senha-prof-outro-1');
    assert.equal((await baixar(up.body.id_arquivo, await s.login('prof.outro.arquivo', 'Senha-prof-outro-1'))).status, 404);
    const colega = s.alunos.findIndex((a, i) => i > 1 && s.alunoInfo(a.matricula).id_turma === aluno.id_turma);
    assert.equal((await baixar(up.body.id_arquivo, (await s.alunoPronto(colega)).token)).status, 404);

    // Reenvio substitui: só texto remove o arquivo; manter o arquivo atual é permitido.
    const textoComArquivo = await s.api(rota, {
        method: 'POST', token: aluno.token, body: { resposta: 'Segue a foto.', id_arquivo: up.body.id_arquivo }
    });
    assert.equal(textoComArquivo.status, 201);
    assert.equal(textoComArquivo.body.resposta, 'Segue a foto.');
    const soTexto = await s.api(rota, { method: 'POST', token: aluno.token, body: { resposta: 'Só texto agora.' } });
    assert.equal(soTexto.body.anexo, null);

    // Arquivo de outra pessoa → 400.
    const doProfessorArquivo = await enviarArquivo(professor);
    const alheio = await s.api(rota, { method: 'POST', token: aluno.token, body: { id_arquivo: doProfessorArquivo.body.id_arquivo } });
    assert.equal(alheio.status, 400);
});

test('conta da turma: envia com arquivo + matrícula/senha; não baixa o arquivo da entrega', async () => {
    const professor = await s.professor();
    const aluno = await s.alunoPronto(2);
    const outro = await s.alunoPronto(0);
    assert.equal(outro.id_turma, aluno.id_turma);
    const token = await entrarTurma(aluno.id_turma);
    const anexoAtividade = await enviarArquivo(professor);
    const atividade = await criarAtividade(professor, aluno, { id_arquivo: anexoAtividade.body.id_arquivo });
    const rota = `/api/atividades/${atividade.id_atividade}/entregas`;

    // A conta da turma vê e baixa o anexo da atividade.
    const lista = (await s.api('/api/atividades', { token })).body;
    assert.equal(lista.find((a) => a.id_atividade === atividade.id_atividade).anexo.id_arquivo,
        anexoAtividade.body.id_arquivo);
    assert.equal((await baixar(anexoAtividade.body.id_arquivo, token)).status, 200);

    const up = await enviarArquivo(token, ARQUIVOS.png, { tipo: 'image/png', nome: 'resolucao.png' });
    assert.equal(up.status, 201, up.text);
    assert.equal((await s.api(rota, { method: 'POST', token, body: { id_arquivo: up.body.id_arquivo } })).status, 400,
        'sem matrícula e senha');
    const ok = await s.api(rota, {
        method: 'POST', token, body: { id_arquivo: up.body.id_arquivo, matricula: aluno.matricula, senha: aluno.senha }
    });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.id_aluno, aluno.id_aluno);
    assert.equal(ok.body.anexo.id_arquivo, up.body.id_arquivo);

    // A conta da turma não baixa o arquivo da entrega (nem tendo enviado); aluno dono e professor sim.
    assert.equal((await baixar(up.body.id_arquivo, token)).status, 404);
    assert.equal((await baixar(up.body.id_arquivo, aluno.token)).status, 200);
    assert.equal((await baixar(up.body.id_arquivo, professor)).status, 200);
    assert.equal((await baixar(up.body.id_arquivo, outro.token)).status, 404);

    // O mesmo arquivo não serve para a entrega de outro aluno pela mesma conta.
    const reaproveitado = await s.api(rota, {
        method: 'POST', token, body: { id_arquivo: up.body.id_arquivo, matricula: outro.matricula, senha: outro.senha }
    });
    assert.equal(reaproveitado.status, 400);
    // Arquivo enviado pelo aluno (outra conta) também não.
    const pessoal = await enviarArquivo(outro.token);
    const deOutraConta = await s.api(rota, {
        method: 'POST', token, body: { id_arquivo: pessoal.body.id_arquivo, matricula: outro.matricula, senha: outro.senha }
    });
    assert.equal(deOutraConta.status, 400);
});

test('limpeza de órfãos: anexo de atividade e arquivo de entrega ficam; o solto sai', async () => {
    const professor = await s.professor();
    const aluno = await s.alunoPronto(3);
    const daAtividade = (await enviarArquivo(professor)).body.id_arquivo;
    const solto = (await enviarArquivo(professor)).body.id_arquivo;
    const atividade = await criarAtividade(professor, aluno, { id_arquivo: daAtividade });
    const daEntrega = (await enviarArquivo(aluno.token)).body.id_arquivo;
    const entrega = await s.api(`/api/atividades/${atividade.id_atividade}/entregas`, {
        method: 'POST', token: aluno.token, body: { id_arquivo: daEntrega }
    });
    assert.equal(entrega.status, 201, entrega.text);
    s.db.prepare("UPDATE arquivos SET criado_em = datetime('now', '-2 days') WHERE id_arquivo IN (?, ?, ?)")
        .run(daAtividade, solto, daEntrega);

    const env = { ...process.env, DATA_DIR: s.dir, CW_AGENDADOR: '0', CW_BACKUP: '0' };
    for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];
    delete env.ADMIN_LOGIN;
    delete env.ADMIN_SENHA;
    execFileSync(process.execPath,
        ['-e', "require('./src/utils/arquivos').cleanOrphanFiles()"], { cwd: ROOT, env, stdio: 'pipe' });

    const existe = (id) => Boolean(s.db.prepare('SELECT 1 FROM arquivos WHERE id_arquivo = ?').get(id));
    assert.ok(existe(daAtividade));
    assert.ok(existe(daEntrega));
    assert.ok(!existe(solto));
});
