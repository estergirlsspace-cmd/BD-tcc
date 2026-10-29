const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

let aluno;
let colega;
const s = usarServidor({}, async (ambiente) => {
    aluno = await ambiente.alunoPronto(0);
    colega = await ambiente.alunoPronto(1);
    ambiente.criarProfessor('prof.sem.turma', 'Senha-prof-123');
});

const registrar = (token, body) => s.api('/api/ocorrencias', { method: 'POST', token, body });

test('professor da turma registra; aluno vê a própria só com o perfil do autor', async () => {
    const r = await registrar(await s.professor(), { id_aluno: aluno.id_aluno, descricao: 'Chegou atrasado' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.situacao, 'aberta');
    assert.equal(r.body.aluno.id_aluno, aluno.id_aluno);
    assert.equal(r.body.autor.perfil, 'professor');
    assert.ok(r.body.autor.nome);
    assert.equal(r.body.resolvida_em, null);

    const minhas = await s.api('/api/ocorrencias', { token: aluno.token });
    assert.equal(minhas.status, 200);
    assert.equal(minhas.body.length, 1);
    assert.deepEqual(minhas.body[0].autor, { perfil: 'professor' });
    assert.deepEqual((await s.api('/api/ocorrencias', { token: colega.token })).body, []);
});

test('professor fora da turma do aluno recebe 404; aluno não registra (403)', async () => {
    const outro = await s.login('prof.sem.turma', 'Senha-prof-123');
    assert.equal((await registrar(outro, { id_aluno: aluno.id_aluno, descricao: 'x' })).status, 404);
    assert.equal((await registrar(aluno.token, { id_aluno: colega.id_aluno, descricao: 'x' })).status, 403);
    assert.equal((await registrar(await s.gestao(), { id_aluno: 999999, descricao: 'x' })).status, 404);
});

test('aluno com conta desativada não recebe ocorrência (404)', async () => {
    const inativo = s.alunoInfo(s.alunos[5].matricula);
    s.db.prepare('UPDATE usuarios SET ativo = 0 WHERE id_usuario = ?').run(inativo.id_usuario);
    assert.equal((await registrar(await s.gestao(), { id_aluno: inativo.id_aluno, descricao: 'x' })).status, 404);
});

test('validação do corpo (400)', async () => {
    const gestao = await s.gestao();
    for (const body of [
        { id_aluno: aluno.id_aluno },
        { descricao: 'x' },
        { id_aluno: aluno.id_aluno, descricao: '  ' },
        { id_aluno: aluno.id_aluno, descricao: 'x'.repeat(2001) },
        { id_aluno: String(aluno.id_aluno), descricao: 'x' },
        { id_aluno: aluno.id_aluno, descricao: 'x', gravidade: 'alta' }
    ]) {
        assert.equal((await registrar(gestao, body)).status, 400, JSON.stringify(body));
    }
});

test('listagem: professor só as que registrou; gestão todas; filtro por situação', async () => {
    const gestao = await s.gestao();
    const daGestao = await registrar(gestao, { id_aluno: colega.id_aluno, descricao: 'Uniforme' });
    assert.equal(daGestao.status, 201);
    assert.equal(daGestao.body.autor.perfil, 'gestao');
    const prof = await s.api('/api/ocorrencias', { token: await s.professor() });
    assert.ok(prof.body.every((o) => o.autor.perfil === 'professor'));
    const todas = await s.api('/api/ocorrencias', { token: gestao });
    assert.equal(todas.body.length, prof.body.length + 1);
    const abertas = await s.api('/api/ocorrencias?situacao=aberta', { token: gestao });
    assert.equal(abertas.body.length, todas.body.length);
    assert.equal((await s.api('/api/ocorrencias?situacao=fechada', { token: gestao })).status, 400);
});

test('resolução pela gestão: idempotente; professor e aluno recebem 403', async () => {
    const gestao = await s.gestao();
    const [ocorrencia] = (await s.api('/api/ocorrencias', { token: gestao })).body;
    const url = `/api/ocorrencias/${ocorrencia.id_ocorrencia}`;
    assert.equal((await s.api(url, { method: 'PATCH', token: await s.professor(), body: { situacao: 'resolvida' } })).status, 403);
    assert.equal((await s.api(url, { method: 'PATCH', token: aluno.token, body: { situacao: 'resolvida' } })).status, 403);
    assert.equal((await s.api(url, { method: 'PATCH', token: gestao, body: { situacao: 'aberta' } })).status, 400);
    const r = await s.api(url, { method: 'PATCH', token: gestao, body: { situacao: 'resolvida' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.situacao, 'resolvida');
    assert.ok(r.body.resolvida_em);
    const de_novo = await s.api(url, { method: 'PATCH', token: gestao, body: { situacao: 'resolvida' } });
    assert.equal(de_novo.body.resolvida_em, r.body.resolvida_em);
    assert.equal((await s.api('/api/ocorrencias/999999', { method: 'PATCH', token: gestao, body: { situacao: 'resolvida' } })).status, 404);
    const resolvidas = await s.api('/api/ocorrencias?situacao=resolvida', { token: gestao });
    assert.deepEqual(resolvidas.body.map((o) => o.id_ocorrencia), [ocorrencia.id_ocorrencia]);
});
