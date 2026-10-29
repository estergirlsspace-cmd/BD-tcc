const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

let aluno;      // turma 1
let colega;     // turma 1
let deOutra;    // turma 2
let profT2;     // professor só da turma 2
let profSem;    // professor sem turma
let ids;
const s = usarServidor({}, async (a) => {
    aluno = await a.alunoPronto(0);
    colega = await a.alunoPronto(1);
    deOutra = await a.alunoPronto(6);
    const discT2 = a.db.prepare('SELECT id_disciplina FROM disciplinas WHERE id_turma = ? AND id_professor IS NULL LIMIT 1')
        .get(deOutra.id_turma).id_disciplina;
    const t2 = a.criarProfessor('prof.t2', 'Senha-prof-123', [discT2]);
    const sem = a.criarProfessor('prof.sem', 'Senha-prof-123');
    profT2 = { ...t2, token: await a.login('prof.t2', 'Senha-prof-123') };
    profSem = { ...sem, token: await a.login('prof.sem', 'Senha-prof-123') };
    const id = (login) => a.db.prepare('SELECT id_usuario FROM usuarios WHERE login = ?').get(login).id_usuario;
    ids = { gestao: id(a.contas.gestao.login), professor: id(a.contas.professor.login) };
});

const enviar = (token, para, texto = 'Olá') => s.api('/api/mensagens', { method: 'POST', token, body: { para, texto } });

test('contatos do aluno: professores da turma e gestão, nunca outros alunos', async () => {
    const r = await s.api('/api/mensagens/contatos', { token: aluno.token });
    assert.equal(r.status, 200);
    const perfis = new Set(r.body.map((c) => c.perfil));
    assert.ok(!perfis.has('aluno'));
    assert.ok(r.body.some((c) => c.id_usuario === ids.professor));
    assert.ok(r.body.some((c) => c.id_usuario === ids.gestao && c.detalhe === 'Coordenação'));
    assert.ok(!r.body.some((c) => c.id_usuario === profSem.id_usuario || c.id_usuario === profT2.id_usuario));
    for (const c of r.body) assert.deepEqual(Object.keys(c).sort(), ['detalhe', 'id_usuario', 'nome', 'perfil']);
});

test('contatos do professor: alunos das suas turmas e gestão', async () => {
    const r = await s.api('/api/mensagens/contatos', { token: profT2.token });
    const alunos = r.body.filter((c) => c.perfil === 'aluno');
    assert.ok(alunos.length === 6);
    assert.ok(alunos.some((c) => c.id_usuario === deOutra.id_usuario));
    assert.ok(!alunos.some((c) => c.id_usuario === aluno.id_usuario));
    assert.ok(!r.body.some((c) => c.perfil === 'professor'));
    const gestao = await s.api('/api/mensagens/contatos', { token: await s.gestao() });
    assert.ok(gestao.body.length >= 38);
});

test('aluno → aluno é proibido (403), mesmo da mesma turma', async () => {
    const r = await enviar(aluno.token, colega.id_usuario);
    assert.equal(r.status, 403);
    assert.equal((await enviar(aluno.token, deOutra.id_usuario)).status, 403);
});

test('aluno → professor de fora da turma (403); professor → aluno de outra turma (403)', async () => {
    assert.equal((await enviar(aluno.token, profT2.id_usuario)).status, 403);
    assert.equal((await enviar(aluno.token, profSem.id_usuario)).status, 403);
    assert.equal((await enviar(profT2.token, aluno.id_usuario)).status, 403);
    assert.equal((await enviar(profSem.token, aluno.id_usuario)).status, 403);
    assert.equal((await enviar(profT2.token, deOutra.id_usuario)).status, 201);
});

test('para si mesmo (403), destinatário inexistente (404), corpo inválido (400)', async () => {
    assert.equal((await enviar(aluno.token, aluno.id_usuario)).status, 403);
    assert.equal((await enviar(aluno.token, 999999)).status, 404);
    for (const body of [
        { para: ids.gestao },
        { para: ids.gestao, texto: '   ' },
        { para: ids.gestao, texto: 'x'.repeat(2001) },
        { para: 'gestão', texto: 'x' },
        { para: 0, texto: 'x' },
        { para: ids.gestao, texto: 'x', anexo: 1 }
    ]) {
        const r = await s.api('/api/mensagens', { method: 'POST', token: aluno.token, body });
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
    }
});

test('conversa: envio, lista, não lidas e leitura ao abrir', async () => {
    const env = await enviar(aluno.token, ids.professor, '  Professor, tenho uma dúvida  ');
    assert.equal(env.status, 201);
    assert.equal(env.body.texto, 'Professor, tenho uma dúvida');
    assert.equal(env.body.minha, true);
    const conversa = env.body.id_conversa;

    const prof = await s.professor();
    assert.equal((await s.api('/api/mensagens/nao-lidas', { token: prof })).body.total, 1);
    const lista = await s.api('/api/mensagens', { token: prof });
    const item = lista.body.find((c) => c.id_conversa === conversa);
    assert.equal(item.nao_lidas, 1);
    assert.equal(item.com.id_usuario, aluno.id_usuario);
    assert.equal(item.ultima.minha, false);

    const aberta = await s.api(`/api/mensagens/${conversa}`, { token: prof });
    assert.equal(aberta.status, 200);
    assert.equal(aberta.body.pode_responder, true);
    assert.equal(aberta.body.mais, false);
    assert.equal(aberta.body.mensagens.length, 1);
    assert.equal((await s.api('/api/mensagens/nao-lidas', { token: prof })).body.total, 0);

    const resposta = await enviar(prof, aluno.id_usuario, 'Pode perguntar');
    assert.equal(resposta.body.id_conversa, conversa, 'mesma conversa para o par');
    const depois = await s.api(`/api/mensagens/${conversa}?depois=${env.body.id_mensagem}`, { token: aluno.token });
    assert.deepEqual(depois.body.mensagens.map((m) => m.texto), ['Pode perguntar']);
    assert.equal((await s.api(`/api/mensagens/${conversa}?depois=abc`, { token: aluno.token })).status, 400);
});

test('conversa de terceiros responde 404', async () => {
    const env = await enviar(colega.token, ids.gestao, 'Oi');
    assert.equal((await s.api(`/api/mensagens/${env.body.id_conversa}`, { token: aluno.token })).status, 404);
    assert.equal((await s.api(`/api/mensagens/${env.body.id_conversa}`, { token: await s.professor() })).status, 404);
    assert.equal((await s.api('/api/mensagens/999999', { token: aluno.token })).status, 404);
    assert.equal((await s.api('/api/mensagens/xyz', { token: aluno.token })).status, 400);
});

test('limite de 30 mensagens por minuto por pessoa (429)', async () => {
    const remetente = await s.alunoPronto(2);
    for (let i = 0; i < 30; i += 1) {
        assert.equal((await enviar(remetente.token, ids.gestao, `m${i}`)).status, 201);
    }
    assert.equal((await enviar(remetente.token, ids.gestao, 'excesso')).status, 429);
});

test('métodos não suportados (405)', async () => {
    assert.equal((await s.api('/api/mensagens', { method: 'DELETE', token: aluno.token })).status, 405);
    assert.equal((await s.api('/api/mensagens/contatos', { method: 'POST', token: aluno.token, body: {} })).status, 405);
});
