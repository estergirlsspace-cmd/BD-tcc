const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

test('corpo: JSON inválido, array ou vazio → 400; acima de 1 MB → 413', async () => {
    const token = await s.gestao();
    const turma = (body) => s.api('/api/turmas', { method: 'POST', token, body, headers: { 'content-type': 'application/json' } });
    assert.equal((await turma('{"nome_turma": ')).status, 400);
    assert.equal((await turma('[1,2]')).status, 400);
    assert.equal((await turma('null')).status, 400);
    assert.equal((await turma('')).status, 400);
    const grande = JSON.stringify({ nome_turma: 'x'.repeat(1024 * 1024 + 10), curso: 'redes', serie: 1 });
    assert.equal((await turma(grande)).status, 413);
});

test('respostas de erro também são JSON { erro } sem cache', async () => {
    const r = await s.api('/api/turmas/abc', { token: await s.gestao() });
    assert.equal(r.status, 400);
    assert.equal(typeof r.body.erro, 'string');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('identificadores: não numérico ou zero → 400; inexistente → 404', async () => {
    const token = await s.gestao();
    assert.equal((await s.api('/api/turmas/abc', { token })).status, 400);
    assert.equal((await s.api('/api/turmas/0', { token })).status, 400);
    assert.equal((await s.api('/api/turmas/1.5', { token })).status, 400);
    assert.equal((await s.api('/api/turmas/99999999999999999999', { token })).status, 400);
    assert.equal((await s.api('/api/turmas/9999', { token })).status, 404);
    assert.equal((await s.api('/api/atividades/0', { token })).status, 400);
});

test('rotas desconhecidas: 404 com login, 401 sem login', async () => {
    assert.equal((await s.api('/api/nao-existe', { token: await s.gestao() })).status, 404);
    assert.equal((await s.api('/api/nao-existe')).status, 401);
    assert.equal((await s.api('/api/turmas/1/extra', { token: await s.gestao() })).status, 404);
});

test('turmas: curso, série e nome obrigatórios e válidos; nome repetido 409', async () => {
    const token = await s.gestao();
    for (const body of [
        { nome_turma: 'X', curso: 'medicina', serie: 1 },
        { nome_turma: 'X', curso: 'redes', serie: 4 },
        { nome_turma: 'X', curso: 'redes', serie: '1' },
        { nome_turma: '', curso: 'redes', serie: 1 },
        { nome_turma: 'x'.repeat(101), curso: 'redes', serie: 1 },
        { curso: 'redes', serie: 1 }
    ]) {
        assert.equal((await s.api('/api/turmas', { method: 'POST', token, body })).status, 400, JSON.stringify(body).slice(0, 60));
    }
    const nome = s.db.prepare('SELECT nome_turma FROM turmas WHERE id_turma = 1').get().nome_turma;
    assert.equal((await s.api('/api/turmas', { method: 'POST', token, body: { nome_turma: nome, curso: 'informatica', serie: 1 } })).status, 409);
});

test('exclusão de turma com histórico é recusada (409)', async () => {
    const r = await s.api('/api/turmas/1', { method: 'DELETE', token: await s.gestao() });
    assert.equal(r.status, 409);
});

test('matrícula: formato, cpf_inicio, turma, e-mail e duplicidade', async () => {
    const token = await s.gestao();
    const base = { matricula: '20269999', nome: 'Aluno Novo', id_turma: 1, cpf_inicio: '1234' };
    const casos = [
        [{ ...base, matricula: '12ab' }, 400],
        [{ ...base, matricula: '12' }, 400],
        [{ ...base, cpf_inicio: '123' }, 400],
        [{ ...base, cpf_inicio: 1234 }, 400],
        [{ ...base, nome: '' }, 400],
        [{ ...base, email: 'invalido' }, 400],
        [{ ...base, senha: 'x' }, 400],
        [{ ...base, id_turma: 9999 }, 404],
        [{ ...base, matricula: s.alunos[0].matricula }, 409]
    ];
    for (const [body, status] of casos) {
        assert.equal((await s.api('/api/matriculas', { method: 'POST', token, body })).status, status, JSON.stringify(body));
    }
    const ok = await s.api('/api/matriculas', { method: 'POST', token, body: { ...base, email: 'novo@exemplo.com' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.deve_trocar_senha, true);
    // E-mail informado pela gestão não vale até a própria pessoa confirmar pelo link.
    assert.equal(ok.body.email ?? null, null);
    assert.equal(ok.body.email_pendente, 'novo@exemplo.com');
    assert.ok(!JSON.stringify(ok.body).includes('1234'), 'o CPF não volta na resposta');
    const login = await s.api('/api/auth/login', { method: 'POST', body: { login: '20269999', senha: 'ceep@1234' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.usuario.deve_trocar_senha, true);
    // O e-mail só passa a pertencer a alguém ao ser confirmado; pedidos pendentes não colidem
    // (a confirmação de quem chegar depois devolve 409 — ver conta.test.js).
    assert.equal((await s.api('/api/matriculas', { method: 'POST', token, body: { ...base, matricula: '20269998', email: 'novo@exemplo.com' } })).status, 201);
});

test('equipe: login, tipo, área e duplicidade; senha provisória exige troca', async () => {
    const token = await s.gestao();
    const base = { login: 'maria.souza', tipo_usuario: 'professor', nome: 'Maria Souza', area: 'humanas' };
    const casos = [
        [{ ...base, login: 'ma' }, 400],
        [{ ...base, login: 'maria souza' }, 400],
        [{ ...base, tipo_usuario: 'aluno' }, 400],
        [{ ...base, area: 'filosofia' }, 400],
        [{ ...base, area: undefined }, 400],
        [{ ...base, tipo_usuario: 'gestao' }, 400],
        [{ ...base, login: s.contas.professor.login }, 409]
    ];
    for (const [body, status] of casos) {
        const r = await s.api('/api/equipe', { method: 'POST', token, body: JSON.parse(JSON.stringify(body)) });
        assert.equal(r.status, status, JSON.stringify(body));
    }
    const ok = await s.api('/api/equipe', { method: 'POST', token, body: base });
    assert.equal(ok.status, 201);
    assert.match(ok.body.senha_provisoria, /^.{10}$/);
    const novo = await s.login('maria.souza', ok.body.senha_provisoria);
    assert.equal((await s.api('/api/me', { token: novo })).body.deve_trocar_senha, true);
    assert.equal((await s.api('/api/painel', { token: novo })).status, 403);
});

test('atividades: data e tipo válidos; disciplina precisa ser da turma', async () => {
    const token = await s.gestao();
    const base = { titulo: 'T', descricao: 'D', id_turma: 1, id_disciplina: 1, prazo: '2099-01-01', tipo: 'atividade' };
    for (const body of [
        { ...base, prazo: '2026-13-01' },
        { ...base, prazo: 'amanhã' },
        { ...base, prazo: '2026-01-01T25:00' },
        { ...base, tipo: 'prova' },
        { ...base, id_disciplina: 5 }
    ]) {
        assert.equal((await s.api('/api/atividades', { method: 'POST', token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await s.api('/api/atividades', { method: 'POST', token, body: { ...base, prazo: '2099-01-01T19:00-03:00' } })).status, 201);
});

test('horários: HH:MM, fim depois do início, dia 1..7', async () => {
    const token = await s.gestao();
    const base = { id_turma: 1, id_disciplina: 1, dia_semana: 6, hora_inicio: '13:00', hora_fim: '13:50' };
    for (const body of [
        { ...base, hora_fim: '12:00' },
        { ...base, hora_inicio: '7:00' },
        { ...base, hora_fim: '24:00' },
        { ...base, dia_semana: 8 },
        { ...base, dia_semana: 0 }
    ]) {
        assert.equal((await s.api('/api/horarios', { method: 'POST', token, body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await s.api('/api/horarios', { method: 'POST', token, body: base })).status, 201);
    assert.equal((await s.api('/api/horarios', { method: 'POST', token, body: base })).status, 409, 'mesmo horário na turma');
});

test('páginas: CSP restritiva e sem acesso fora de public/', async () => {
    const pagina = await s.api('/');
    assert.equal(pagina.status, 200);
    assert.match(pagina.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(pagina.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    for (const rota of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/.env', '/%2e%2e%2f.senha-lucas.txt']) {
        const r = await s.api(rota);
        assert.notEqual(r.status, 200, rota);
        assert.ok(!r.text.includes('createApp'), rota);
    }
});
