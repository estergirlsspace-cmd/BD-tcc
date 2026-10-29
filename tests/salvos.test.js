const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

async function publicar(token, body) {
    const r = await s.api('/api/avisos', { method: 'POST', token, body });
    assert.equal(r.status, 201, r.text);
    return r.body;
}

function criarPasta(token, nome) {
    return s.api('/api/pastas', { method: 'POST', token, body: { nome } });
}

function salvar(token, idPost, idPasta = null) {
    return s.api(`/api/salvos/${idPost}`, { method: 'PUT', token, body: { id_pasta: idPasta } });
}

test('pastas: criar, validar nome, único por pessoa (sem diferenciar maiúsculas), renomear', async () => {
    const aluno = await s.alunoPronto(0);
    const r = await criarPasta(aluno.token, '  Provas  ');
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(Object.keys(r.body).sort(), ['id_pasta', 'nome', 'total']);
    assert.equal(r.body.nome, 'Provas');
    assert.equal(r.body.total, 0);

    assert.equal((await criarPasta(aluno.token, 'provas')).status, 409);
    assert.equal((await criarPasta(aluno.token, '   ')).status, 400);
    assert.equal((await criarPasta(aluno.token, 'x'.repeat(41))).status, 400);
    assert.equal((await criarPasta(aluno.token, 'á'.repeat(40))).status, 201, '40 caracteres com acento');
    assert.equal((await criarPasta(aluno.token, 123)).status, 400);
    assert.equal((await s.api('/api/pastas', { method: 'POST', token: aluno.token, body: { nome: 'A', x: 1 } })).status, 400);

    // Outra pessoa pode usar o mesmo nome.
    const outro = await s.alunoPronto(1);
    assert.equal((await criarPasta(outro.token, 'Provas')).status, 201);

    const renomear = await s.api(`/api/pastas/${r.body.id_pasta}`, {
        method: 'PATCH', token: aluno.token, body: { nome: 'Avaliações' }
    });
    assert.equal(renomear.status, 200, renomear.text);
    assert.deepEqual(renomear.body, { id_pasta: r.body.id_pasta, nome: 'Avaliações', total: 0 });
    // Pasta de outra pessoa: 404.
    assert.equal((await s.api(`/api/pastas/${r.body.id_pasta}`, {
        method: 'PATCH', token: outro.token, body: { nome: 'Minha' }
    })).status, 404);
    assert.equal((await s.api(`/api/pastas/${r.body.id_pasta}`, { method: 'DELETE', token: outro.token })).status, 404);

    const lista = await s.api('/api/pastas', { token: aluno.token });
    assert.equal(lista.status, 200);
    assert.deepEqual(lista.body.map((p) => p.nome).sort(), ['Avaliações', 'á'.repeat(40)].sort());
});

test('pastas: no máximo 30 por pessoa', async () => {
    const aluno = await s.alunoPronto(2);
    for (let i = 1; i <= 30; i += 1) {
        assert.equal((await criarPasta(aluno.token, `Pasta ${i}`)).status, 201);
    }
    const r = await criarPasta(aluno.token, 'Pasta 31');
    assert.equal(r.status, 400);
    assert.match(r.body.erro, /30/);
});

test('salvos do aluno: salvar em pasta, filtrar, mover, mural traz id_pasta, excluir pasta mantém salvo', async () => {
    const aluno = await s.alunoPronto(3);
    const gestao = await s.gestao();
    const a1 = await publicar(gestao, { titulo: 'Prova de redes', conteudo: 'x', id_turma: aluno.id_turma, urgente: true });
    const a2 = await publicar(gestao, { titulo: 'Feira', conteudo: 'x', id_turma: aluno.id_turma });
    const pasta = (await criarPasta(aluno.token, 'Importantes')).body;

    const r = await salvar(aluno.token, a1.id_post, pasta.id_pasta);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.salvo, true);
    assert.equal(r.body.id_pasta, pasta.id_pasta);
    assert.ok(r.body.salvo_em);
    assert.equal((await salvar(aluno.token, a2.id_post)).status, 200);

    const todos = await s.api('/api/salvos', { token: aluno.token });
    assert.equal(todos.status, 200);
    assert.deepEqual(todos.body.map((a) => a.id_post).sort(), [a1.id_post, a2.id_post].sort());
    const item = todos.body.find((a) => a.id_post === a1.id_post);
    assert.deepEqual(Object.keys(item).sort(),
        ['autor', 'criado_em', 'id_pasta', 'id_post', 'salvo_em', 'tipo', 'titulo', 'urgente']);
    assert.equal(item.urgente, true);
    assert.equal(item.autor.perfil, 'gestao');

    const naPasta = await s.api(`/api/salvos?id_pasta=${pasta.id_pasta}`, { token: aluno.token });
    assert.deepEqual(naPasta.body.map((a) => a.id_post), [a1.id_post]);
    const semPasta = await s.api('/api/salvos?sem_pasta=1', { token: aluno.token });
    assert.deepEqual(semPasta.body.map((a) => a.id_post), [a2.id_post]);
    assert.equal((await s.api('/api/salvos?id_pasta=1&sem_pasta=1', { token: aluno.token })).status, 400);
    assert.equal((await s.api('/api/salvos?id_pasta=999999', { token: aluno.token })).status, 404);

    const pastas = (await s.api('/api/pastas', { token: aluno.token })).body;
    assert.equal(pastas.find((p) => p.id_pasta === pasta.id_pasta).total, 1);

    // Mural do aluno traz id_pasta.
    const mural = (await s.api('/api/mural', { token: aluno.token })).body.avisos;
    assert.equal(mural.find((a) => a.id_post === a1.id_post).id_pasta, pasta.id_pasta);
    assert.equal(mural.find((a) => a.id_post === a2.id_post).id_pasta, null);
    assert.equal(mural.find((a) => a.id_post === a2.id_post).salvo, true);

    // Mover mantém a data em que foi salvo.
    const mover = await salvar(aluno.token, a2.id_post, pasta.id_pasta);
    assert.equal(mover.body.id_pasta, pasta.id_pasta);
    assert.equal(mover.body.salvo_em, todos.body.find((a) => a.id_post === a2.id_post).salvo_em);

    // Excluir a pasta: os avisos continuam salvos, sem pasta.
    const excluir = await s.api(`/api/pastas/${pasta.id_pasta}`, { method: 'DELETE', token: aluno.token });
    assert.equal(excluir.status, 200);
    const depois = (await s.api('/api/salvos?sem_pasta=1', { token: aluno.token })).body;
    assert.deepEqual(depois.map((a) => a.id_post).sort(), [a1.id_post, a2.id_post].sort());

    // Deixar de salvar.
    const tirar = await s.api(`/api/salvos/${a1.id_post}`, { method: 'DELETE', token: aluno.token });
    assert.equal(tirar.status, 200);
    assert.deepEqual(tirar.body, { id_post: a1.id_post, salvo: false });
    assert.deepEqual((await s.api('/api/salvos', { token: aluno.token })).body.map((a) => a.id_post), [a2.id_post]);
});

test('salvos: aviso fora do escopo e pasta alheia → 404; corpo inválido → 400', async () => {
    const aluno = await s.alunoPronto(4);
    const deOutra = await s.alunoPronto(6);
    assert.notEqual(aluno.id_turma, deOutra.id_turma);
    const aviso = await publicar(await s.gestao(), { titulo: 'Só da turma', conteudo: 'x', id_turma: aluno.id_turma });
    assert.equal((await salvar(deOutra.token, aviso.id_post)).status, 404);
    assert.equal((await s.api(`/api/salvos/${aviso.id_post}`, { method: 'DELETE', token: deOutra.token })).status, 404);
    assert.equal((await salvar(aluno.token, 999999)).status, 404);

    const alheia = (await criarPasta(deOutra.token, 'Alheia')).body;
    assert.equal((await salvar(aluno.token, aviso.id_post, alheia.id_pasta)).status, 404);
    assert.equal((await s.api(`/api/salvos/${aviso.id_post}`, {
        method: 'PUT', token: aluno.token, body: { id_pasta: 'x' }
    })).status, 400);
    assert.equal((await s.api(`/api/salvos/${aviso.id_post}`, {
        method: 'PUT', token: aluno.token, body: { salvo: true }
    })).status, 400);
    assert.equal((await s.api('/api/salvos', { method: 'POST', token: aluno.token, body: {} })).status, 405);
});

test('mural: PUT salvo continua funcionando; desmarcar tira da pasta', async () => {
    const aluno = await s.alunoPronto(5);
    const aviso = await publicar(await s.gestao(), { titulo: 'Mural', conteudo: 'x', id_turma: aluno.id_turma });
    const pasta = (await criarPasta(aluno.token, 'Mural')).body;
    assert.equal((await s.api(`/api/mural/${aviso.id_post}/salvo`, {
        method: 'PUT', token: aluno.token, body: { salvo: true }
    })).status, 200);
    assert.equal((await s.api(`/api/salvos?sem_pasta=1`, { token: aluno.token })).body
        .some((a) => a.id_post === aviso.id_post), true);
    assert.equal((await salvar(aluno.token, aviso.id_post, pasta.id_pasta)).status, 200);
    // Marcar de novo pelo mural mantém a pasta.
    await s.api(`/api/mural/${aviso.id_post}/salvo`, { method: 'PUT', token: aluno.token, body: { salvo: true } });
    let item = (await s.api('/api/mural', { token: aluno.token })).body.avisos.find((a) => a.id_post === aviso.id_post);
    assert.equal(item.id_pasta, pasta.id_pasta);

    await s.api(`/api/mural/${aviso.id_post}/salvo`, { method: 'PUT', token: aluno.token, body: { salvo: false } });
    await s.api(`/api/mural/${aviso.id_post}/leitura`, { method: 'PUT', token: aluno.token });
    await s.api(`/api/mural/${aviso.id_post}/salvo`, { method: 'PUT', token: aluno.token, body: { salvo: true } });
    item = (await s.api('/api/mural', { token: aluno.token })).body.avisos.find((a) => a.id_post === aviso.id_post);
    assert.equal(item.salvo, true);
    assert.equal(item.id_pasta, null, 'salvar de novo começa sem pasta');
});

test('salvos do professor: os próprios e os recebidos; não vê aviso de turma alheia', async () => {
    const professor = await s.professor();
    const gestao = await s.gestao();
    const proprio = await publicar(professor, { titulo: 'Meu aviso', conteudo: 'x', id_turma: (await s.alunoPronto(0)).id_turma });
    const geral = await publicar(gestao, { titulo: 'Reunião', conteudo: 'x' });

    s.criarProfessor('prof.salvos', 'Senha-prof-123');
    const semTurma = await s.login('prof.salvos', 'Senha-prof-123');
    const deTurma = await publicar(gestao, { titulo: 'Turma', conteudo: 'x', id_turma: (await s.alunoPronto(0)).id_turma });
    assert.equal((await salvar(semTurma, deTurma.id_post)).status, 404);

    const pasta = (await criarPasta(professor, 'Recados')).body;
    assert.equal((await salvar(professor, proprio.id_post, pasta.id_pasta)).status, 200);
    assert.equal((await salvar(professor, geral.id_post)).status, 200);
    const lista = (await s.api('/api/salvos', { token: professor })).body.map((a) => a.id_post);
    assert.ok(lista.includes(proprio.id_post) && lista.includes(geral.id_post));

    // A gestão também pode usar.
    const daGestao = await salvar(gestao, deTurma.id_post);
    assert.equal(daGestao.status, 200);
});

test('pastas e salvos exigem login', async () => {
    assert.equal((await s.api('/api/pastas')).status, 401);
    assert.equal((await s.api('/api/salvos')).status, 401);
});
