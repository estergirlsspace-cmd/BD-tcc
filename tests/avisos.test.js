const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

test('aluno não vê aviso de outra turma, de outro curso ou de outra série', async () => {
    const aluno = await s.alunoPronto(0); // 1ª série de Informática
    const gestao = await s.gestao();
    const turmaRedes = s.db.prepare("SELECT id_turma FROM turmas WHERE curso = 'redes' AND serie = 1").get().id_turma;
    const outraTurma = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'A', conteudo: 'x', id_turma: turmaRedes } });
    const outroCurso = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'B', conteudo: 'x', curso: 'redes' } });
    const outraSerie = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'C', conteudo: 'x', curso: 'informatica', serie: 3 } });
    const minha = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'D', conteudo: 'x', id_turma: aluno.id_turma } });
    for (const r of [outraTurma, outroCurso, outraSerie, minha]) assert.equal(r.status, 201, r.text);

    const lista = await s.api('/api/avisos', { token: aluno.token });
    const ids = lista.body.map((a) => a.id_post);
    assert.ok(ids.includes(minha.body.id_post));
    for (const r of [outraTurma, outroCurso, outraSerie]) {
        assert.ok(!ids.includes(r.body.id_post));
        assert.equal((await s.api(`/api/avisos/${r.body.id_post}`, { token: aluno.token })).status, 404);
    }
    assert.ok(lista.body.every((a) => !('id_usuario_autor' in a)), 'aluno não recebe o id do autor');
    assert.ok(lista.body.every((a) => !('leituras' in a)));
    const mural = await s.api('/api/mural', { token: aluno.token });
    assert.deepEqual(mural.body.avisos.map((a) => a.id_post).sort(), ids.slice().sort(),
        'mural e /api/avisos usam a mesma regra de público');
});

test('aluno não publica avisos (403)', async () => {
    const aluno = await s.alunoPronto(0);
    const r = await s.api('/api/avisos', { method: 'POST', token: aluno.token, body: { titulo: 'x', conteudo: 'y' } });
    assert.equal(r.status, 403);
});

test('professor publica só para turma vinculada; autor vem do token', async () => {
    const prof = await s.professor();
    const semTurma = await s.api('/api/avisos', { method: 'POST', token: prof, body: { titulo: 'x', conteudo: 'y' } });
    assert.equal(semTurma.status, 403);
    const forjado = await s.api('/api/avisos', {
        method: 'POST', token: prof, body: { titulo: 'x', conteudo: 'y', id_turma: 1, id_usuario_autor: 1 }
    });
    assert.equal(forjado.status, 201);
    const meuId = (await s.api('/api/me', { token: prof })).body.id_usuario;
    assert.equal(forjado.body.id_usuario_autor, meuId);

    s.criarProfessor('prof.sem.turma', 'Senha-prof-123');
    const outro = await s.login('prof.sem.turma', 'Senha-prof-123');
    const r = await s.api('/api/avisos', { method: 'POST', token: outro, body: { titulo: 'x', conteudo: 'y', id_turma: 1 } });
    assert.equal(r.status, 403);
});

test('professor não edita aviso de outro autor (404) nem amplia o público (403)', async () => {
    const prof = await s.professor();
    const daGestao = await s.api('/api/avisos', {
        method: 'POST', token: await s.gestao(), body: { titulo: 'G', conteudo: 'x', id_turma: 1 }
    });
    const editar = await s.api(`/api/avisos/${daGestao.body.id_post}`, { method: 'PATCH', token: prof, body: { titulo: 'Hack' } });
    assert.equal(editar.status, 404);
    const apagar = await s.api(`/api/avisos/${daGestao.body.id_post}`, { method: 'DELETE', token: prof });
    assert.equal(apagar.status, 404);

    const meu = await s.api('/api/avisos', { method: 'POST', token: prof, body: { titulo: 'P', conteudo: 'x', id_turma: 1 } });
    const ampliar = await s.api(`/api/avisos/${meu.body.id_post}`, { method: 'PATCH', token: prof, body: { curso: 'redes' } });
    assert.equal(ampliar.status, 403);
    const ok = await s.api(`/api/avisos/${meu.body.id_post}`, { method: 'PATCH', token: prof, body: { titulo: 'Novo', urgente: true } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.urgente, true);
    const apagado = await s.api(`/api/avisos/${meu.body.id_post}`, { method: 'DELETE', token: prof });
    assert.equal(apagado.status, 204);
});

test('público contraditório (turma de um curso + outro curso) → 400; turma inexistente → 400', async () => {
    const gestao = await s.gestao();
    const r = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'x', conteudo: 'y', id_turma: 1, curso: 'redes' } });
    assert.equal(r.status, 400);
    const inexistente = await s.api('/api/avisos', { method: 'POST', token: gestao, body: { titulo: 'x', conteudo: 'y', id_turma: 9999 } });
    assert.equal(inexistente.status, 400);
});

test('validação do aviso: urgente boolean, tipo, campos obrigatórios e tamanhos', async () => {
    const gestao = await s.gestao();
    const casos = [
        { conteudo: 'y' },
        { titulo: 'x' },
        { titulo: 'x', conteudo: 'y', urgente: 'sim' },
        { titulo: 'x', conteudo: 'y', tipo: 'festa' },
        { titulo: 'x'.repeat(201), conteudo: 'y' },
        { titulo: '   ', conteudo: 'y' },
        { titulo: 'x', conteudo: 'y', data_evento: '2026-02-31' },
        { titulo: 'x', conteudo: 'y', campo_novo: 1 },
        { titulo: 'x', conteudo: 'y', serie: 4 }
    ];
    for (const body of casos) {
        const r = await s.api('/api/avisos', { method: 'POST', token: gestao, body });
        assert.equal(r.status, 400, JSON.stringify(body));
    }
});

test('leituras: o autor e a gestão veem { confirmadas, publico_total }', async () => {
    const prof = await s.professor();
    const aluno = await s.alunoPronto(0);
    const aviso = await s.api('/api/avisos', { method: 'POST', token: prof, body: { titulo: 'L', conteudo: 'x', id_turma: aluno.id_turma } });
    assert.deepEqual(aviso.body.leituras, { confirmadas: 0, publico_total: 6 });
    await s.api(`/api/mural/${aviso.body.id_post}/leitura`, { method: 'PUT', token: aluno.token });
    const lista = await s.api('/api/avisos', { token: prof });
    assert.deepEqual(lista.body.find((a) => a.id_post === aviso.body.id_post).leituras, { confirmadas: 1, publico_total: 6 });
    const gestao = await s.api('/api/avisos', { token: await s.gestao() });
    assert.ok(gestao.body.every((a) => a.leituras && typeof a.leituras.publico_total === 'number'));
});

test('aviso urgente dispara e-mail só simulado (sem RESEND_API_KEY) e não quebra a publicação', async () => {
    const r = await s.api('/api/avisos', {
        method: 'POST', token: await s.gestao(), body: { titulo: 'Urgente', conteudo: 'x', urgente: true }
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.urgente, true);
});

test('professor abre por id um aviso da gestão que aparece na própria lista',
    async () => {
        const prof = await s.professor();
        const aviso = await s.api('/api/avisos', {
            method: 'POST', token: await s.gestao(), body: { titulo: 'Da gestão', conteudo: 'x', id_turma: 1 }
        });
        const lista = await s.api('/api/avisos', { token: prof });
        assert.ok(lista.body.some((a) => a.id_post === aviso.body.id_post));
        assert.equal((await s.api(`/api/avisos/${aviso.body.id_post}`, { token: prof })).status, 200);
    });
