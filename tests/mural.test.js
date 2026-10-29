const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

async function publicar(token, body) {
    const r = await s.api('/api/avisos', { method: 'POST', token, body });
    assert.equal(r.status, 201, r.text);
    return r.body;
}

test('mural: só para aluno (403 para professor e gestão)', async () => {
    assert.equal((await s.api('/api/mural', { token: await s.professor() })).status, 403);
    assert.equal((await s.api('/api/mural', { token: await s.gestao() })).status, 403);
});

test('mural: categorias e públicos derivados, urgentes primeiro, sem id do autor', async () => {
    const aluno = await s.alunoPronto(0);
    const gestao = await s.gestao();
    const urgente = await publicar(gestao, { titulo: 'Sem aula', conteudo: 'Amanhã', id_turma: aluno.id_turma, urgente: true });
    const doCurso = await publicar(gestao, { titulo: 'Do curso', conteudo: 'x', curso: aluno.curso });
    const daSerie = await publicar(gestao, { titulo: 'Da série', conteudo: 'x', curso: aluno.curso, serie: aluno.serie });
    const doProf = await publicar(await s.professor(), { titulo: 'Prova', conteudo: 'x', id_turma: aluno.id_turma });

    const r = await s.api('/api/mural', { token: aluno.token });
    assert.equal(r.status, 200);
    const { avisos, nao_lidos: naoLidos } = r.body;
    assert.equal(naoLidos, avisos.length);
    assert.equal(avisos[0].id_post, urgente.id_post, 'urgente vem primeiro');
    const por = (id) => avisos.find((a) => a.id_post === id);
    assert.equal(por(urgente.id_post).categoria, 'urgente');
    assert.equal(por(urgente.id_post).publico, 'turma');
    assert.equal(por(doCurso.id_post).categoria, 'coordenacao');
    assert.equal(por(doCurso.id_post).publico, 'curso');
    assert.equal(por(daSerie.id_post).publico, 'serie');
    assert.equal(por(doProf.id_post).categoria, 'turma');
    assert.equal(por(doProf.id_post).autor.perfil, 'professor');
    const evento = avisos.find((a) => a.tipo === 'evento');
    assert.equal(evento.categoria, 'eventos');
    const geral = avisos.find((a) => a.publico === 'escola');
    assert.ok(geral, 'aviso da escola toda aparece');
    for (const aviso of avisos) {
        assert.ok(!('id_usuario_autor' in aviso));
        assert.ok(!('id_usuario' in aviso.autor));
        assert.equal(aviso.lido_em, null);
        assert.equal(aviso.salvo, false);
        assert.ok('anexo' in aviso);
    }
});

test('mural: confirmar leitura é idempotente; desfazer apaga o estado vazio', async () => {
    const aluno = await s.alunoPronto(1);
    const { avisos } = (await s.api('/api/mural', { token: aluno.token })).body;
    const id = avisos[0].id_post;
    const primeira = await s.api(`/api/mural/${id}/leitura`, { method: 'PUT', token: aluno.token });
    assert.equal(primeira.status, 200);
    assert.ok(primeira.body.lido_em);
    const segunda = await s.api(`/api/mural/${id}/leitura`, { method: 'PUT', token: aluno.token });
    assert.equal(segunda.body.lido_em, primeira.body.lido_em, 'mantém o primeiro horário');

    const depois = (await s.api('/api/mural', { token: aluno.token })).body;
    assert.equal(depois.nao_lidos, avisos.length - 1);

    const desfeita = await s.api(`/api/mural/${id}/leitura`, { method: 'DELETE', token: aluno.token });
    assert.deepEqual(desfeita.body, { lido_em: null });
    const linhas = s.db.prepare('SELECT COUNT(*) AS n FROM avisos_usuarios WHERE id_post = ? AND id_usuario = ?')
        .get(id, aluno.id_usuario).n;
    assert.equal(linhas, 0);
});

test('mural: salvar e remover dos salvos; corpo inválido 400', async () => {
    const aluno = await s.alunoPronto(1);
    const { avisos } = (await s.api('/api/mural', { token: aluno.token })).body;
    const id = avisos[1].id_post;
    const salvo = await s.api(`/api/mural/${id}/salvo`, { method: 'PUT', token: aluno.token, body: { salvo: true } });
    assert.deepEqual(salvo.body, { salvo: true });
    const lista = (await s.api('/api/mural', { token: aluno.token })).body.avisos;
    assert.equal(lista.find((a) => a.id_post === id).salvo, true);
    const removido = await s.api(`/api/mural/${id}/salvo`, { method: 'PUT', token: aluno.token, body: { salvo: false } });
    assert.deepEqual(removido.body, { salvo: false });
    for (const body of [{}, { salvo: 'sim' }, { salvo: true, extra: 1 }]) {
        const r = await s.api(`/api/mural/${id}/salvo`, { method: 'PUT', token: aluno.token, body });
        assert.equal(r.status, 400, JSON.stringify(body));
    }
});

test('mural: marcar todos como lidos devolve quantos mudaram', async () => {
    const aluno = await s.alunoPronto(2);
    const antes = (await s.api('/api/mural', { token: aluno.token })).body;
    const r = await s.api('/api/mural/leitura', { method: 'POST', token: aluno.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.marcados, antes.nao_lidos);
    assert.equal((await s.api('/api/mural/leitura', { method: 'POST', token: aluno.token })).body.marcados, 0);
    assert.equal((await s.api('/api/mural', { token: aluno.token })).body.nao_lidos, 0);
});

test('mural: aviso de outra turma responde 404 (não revela que existe)', async () => {
    const aluno = await s.alunoPronto(0);
    const outraTurma = s.db.prepare('SELECT id_turma FROM turmas WHERE id_turma != ? LIMIT 1').get(aluno.id_turma).id_turma;
    const aviso = await publicar(await s.gestao(), { titulo: 'Só da outra', conteudo: 'x', id_turma: outraTurma });
    assert.equal((await s.api(`/api/mural/${aviso.id_post}/leitura`, { method: 'PUT', token: aluno.token })).status, 404);
    assert.equal((await s.api(`/api/mural/${aviso.id_post}/salvo`, {
        method: 'PUT', token: aluno.token, body: { salvo: true }
    })).status, 404);
    assert.equal((await s.api('/api/mural/999999/leitura', { method: 'PUT', token: aluno.token })).status, 404);
});

test('mural: rotas e métodos inválidos (400/404/405)', async () => {
    const aluno = await s.alunoPronto(0);
    assert.equal((await s.api('/api/mural/abc/leitura', { method: 'PUT', token: aluno.token })).status, 400);
    assert.equal((await s.api('/api/mural/1/outra', { method: 'PUT', token: aluno.token })).status, 404);
    assert.equal((await s.api('/api/mural', { method: 'POST', token: aluno.token })).status, 405);
    assert.equal((await s.api('/api/mural/1/salvo', { method: 'DELETE', token: aluno.token })).status, 405);
});
