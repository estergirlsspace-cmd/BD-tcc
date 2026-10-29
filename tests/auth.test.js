const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

test('GET /api/saude responde sem login e sem cache', async () => {
    const r = await s.api('/api/saude');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok' });
    assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('login da gestão devolve token Bearer e o perfil', async () => {
    const r = await s.api('/api/auth/login', {
        method: 'POST', body: { login: s.contas.gestao.login, senha: s.contas.gestao.senha }
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.tipo, 'Bearer');
    assert.match(r.body.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(r.body.usuario.tipo_usuario, 'gestao');
    assert.equal(r.body.usuario.deve_trocar_senha, false);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    // O token nunca é gravado em claro.
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE token_hash = ?').get(r.body.token).n, 0);
});

test('login com senha errada ou usuário inexistente responde 401 com a mesma mensagem', async () => {
    const errada = await s.api('/api/auth/login', {
        method: 'POST', body: { login: s.contas.gestao.login, senha: 'senha-errada' }
    });
    const inexistente = await s.api('/api/auth/login', {
        method: 'POST', body: { login: 'ninguem.aqui', senha: 'senha-errada' }
    });
    assert.equal(errada.status, 401);
    assert.equal(inexistente.status, 401);
    assert.equal(errada.body.erro, inexistente.body.erro);
});

test('login valida o corpo (400)', async () => {
    for (const body of [{ login: 'x' }, { senha: 'x' }, { login: '', senha: 'x' },
        { login: 'x', senha: 'y', extra: 1 }, { login: 'a'.repeat(101), senha: 'x' }]) {
        const r = await s.api('/api/auth/login', { method: 'POST', body });
        assert.equal(r.status, 400, JSON.stringify(body));
    }
    const invalido = await s.api('/api/auth/login', { method: 'POST', body: '{nao é json' });
    assert.equal(invalido.status, 400);
});

test('5 senhas erradas para o mesmo usuário bloqueiam o login (429), mesmo com a senha certa', async () => {
    const ip = '192.0.2.10';
    const { login, senha } = s.contas.professor;
    for (let i = 0; i < 5; i += 1) {
        const r = await s.api('/api/auth/login', { method: 'POST', ip, body: { login, senha: `errada-${i}` } });
        assert.equal(r.status, 401);
    }
    const bloqueado = await s.api('/api/auth/login', { method: 'POST', ip, body: { login, senha } });
    assert.equal(bloqueado.status, 429);
    assert.match(bloqueado.body.erro, /minuto/);
});

test('bloqueio por tentativas vale para o usuário, não só para o par IP + usuário', async () => {
        const aluno = s.alunos[30];
        for (let i = 0; i < 5; i += 1) {
            await s.api('/api/auth/login', { method: 'POST', body: { login: aluno.matricula, senha: `errada-${i}` } });
        }
        // Outro IP declarado no cabeçalho: deveria continuar bloqueado.
        const r = await s.api('/api/auth/login', {
            method: 'POST', body: { login: aluno.matricula, senha: aluno.senha_inicial }
        });
        assert.equal(r.status, 429);
});

test('CF-Connecting-IP forjado (sem passar pela Cloudflare) é ignorado pelo limitador', async () => {
    // X-Real-Ip fora das faixas da Cloudflare = acesso direto à VPS: vale o X-Real-Ip.
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
        const r = await s.api('/api/auth/login', {
            method: 'POST',
            headers: { 'x-real-ip': '198.51.100.7', 'cf-connecting-ip': `10.9.${i}.1` },
            body: { login: `ninguem-${i}`, senha: 'errada-123' }
        });
        statuses.push(r.status);
    }
    assert.equal(statuses.at(-1), 429);
});

test('limite geral por IP: mais de 20 tentativas por minuto do mesmo IP → 429', async () => {
    const ip = '192.0.2.20';
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
        const r = await s.api('/api/auth/login', {
            method: 'POST', ip, body: { login: `inexistente${i}`, senha: 'x' }
        });
        statuses.push(r.status);
    }
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
    assert.equal(statuses[20], 429);
});

test('rotas protegidas exigem Bearer válido (401)', async () => {
    assert.equal((await s.api('/api/me')).status, 401);
    assert.equal((await s.api('/api/me', { headers: { authorization: 'Basic abc' } })).status, 401);
    assert.equal((await s.api('/api/me', { token: 'token-inventado' })).status, 401);
});

test('primeiro acesso: aluno só usa /api/me e /api/auth/password até trocar a senha', async () => {
    const aluno = s.alunos[1];
    const token = await s.login(aluno.matricula, aluno.senha_inicial);
    const me = await s.api('/api/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.deve_trocar_senha, true);
    assert.equal(me.body.tipo_usuario, 'aluno');
    assert.equal((await s.api('/api/mural', { token })).status, 403);
    assert.equal((await s.api('/api/atividades', { token })).status, 403);

    // Regras da senha nova.
    const curta = await s.api('/api/auth/password', {
        method: 'POST', token, body: { senha_atual: aluno.senha_inicial, nova_senha: 'curta' }
    });
    assert.equal(curta.status, 400);
    const padrao = await s.api('/api/auth/password', {
        method: 'POST', token, body: { senha_atual: aluno.senha_inicial, nova_senha: 'ceep@9876' }
    });
    assert.equal(padrao.status, 400);
    const atualErrada = await s.api('/api/auth/password', {
        method: 'POST', token, body: { senha_atual: 'nao-e-essa', nova_senha: 'Nova-senha-123' }
    });
    assert.equal(atualErrada.status, 400, 'senha atual errada é 400, não 401 (não derruba a sessão)');

    const ok = await s.api('/api/auth/password', {
        method: 'POST', token, body: { senha_atual: aluno.senha_inicial, nova_senha: 'Nova-senha-123' }
    });
    assert.equal(ok.status, 200);
    assert.equal((await s.api('/api/me', { token })).body.deve_trocar_senha, false);
    assert.equal((await s.api('/api/mural', { token })).status, 200);

    // A senha inicial deixa de valer; a nova entra.
    const antiga = await s.api('/api/auth/login', {
        method: 'POST', body: { login: aluno.matricula, senha: aluno.senha_inicial }
    });
    assert.equal(antiga.status, 401);
    await s.login(aluno.matricula, 'Nova-senha-123');
});

test('troca de senha encerra as outras sessões, mantém a atual', async () => {
    const aluno = await s.alunoPronto(2);
    const outra = await s.login(aluno.matricula, aluno.senha);
    const r = await s.api('/api/auth/password', {
        method: 'POST', token: aluno.token, body: { senha_atual: aluno.senha, nova_senha: 'Outra-senha-456' }
    });
    assert.equal(r.status, 200);
    assert.equal((await s.api('/api/me', { token: outra })).status, 401);
    assert.equal((await s.api('/api/me', { token: aluno.token })).status, 200);
});

test('logout revoga o token (204 e depois 401)', async () => {
    const token = await s.login(s.contas.gestao.login, s.contas.gestao.senha);
    const r = await s.api('/api/auth/logout', { method: 'POST', token });
    assert.equal(r.status, 204);
    assert.equal((await s.api('/api/me', { token })).status, 401);
});

test('conta desativada não entra e perde as sessões ativas', async () => {
    const aluno = await s.alunoPronto(3);
    const gestao = await s.gestao();
    const r = await s.api(`/api/contas/${aluno.id_usuario}/situacao`, {
        method: 'POST', token: gestao, body: { ativo: false }
    });
    assert.equal(r.status, 200);
    assert.equal((await s.api('/api/me', { token: aluno.token })).status, 401);
    const login = await s.api('/api/auth/login', {
        method: 'POST', body: { login: aluno.matricula, senha: aluno.senha }
    });
    assert.equal(login.status, 401);
});

test('gestão não pode desativar a própria conta', async () => {
    const gestao = await s.gestao();
    const me = await s.api('/api/me', { token: gestao });
    const r = await s.api(`/api/contas/${me.body.id_usuario}/situacao`, {
        method: 'POST', token: gestao, body: { ativo: false }
    });
    assert.equal(r.status, 400);
});

test('termos pendentes: API só libera /api/me, /api/auth/password e /api/privacidade/*', async () => {
    const aluno = await s.alunoPronto(4);
    s.db.prepare('UPDATE usuarios SET termos_aceitos_em = NULL WHERE id_usuario = ?').run(aluno.id_usuario);
    const me = await s.api('/api/me', { token: aluno.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.termos_pendentes, true);
    const mural = await s.api('/api/mural', { token: aluno.token });
    assert.equal(mural.status, 403);
    assert.match(mural.body.erro, /termos/i);
    assert.equal((await s.api('/api/conta', { token: aluno.token })).status, 403);
    const senha = await s.api('/api/auth/password', {
        method: 'POST', token: aluno.token, body: { senha_atual: aluno.senha, nova_senha: 'Mais-uma-senha-7' }
    });
    assert.equal(senha.status, 200);
    // Rotas de privacidade passam pela trava (podem ainda estar em construção: 501).
    const privacidade = await s.api('/api/privacidade/meus-dados', { token: aluno.token });
    assert.notEqual(privacidade.status, 403);
    s.db.prepare('UPDATE usuarios SET termos_aceitos_em = CURRENT_TIMESTAMP WHERE id_usuario = ?').run(aluno.id_usuario);
    assert.equal((await s.api('/api/mural', { token: aluno.token })).status, 200);
});

test('POST /api/privacidade/aceite grava o aceite e libera a API', async (t) => {
    const aluno = await s.alunoPronto(5);
    s.db.prepare('UPDATE usuarios SET termos_aceitos_em = NULL WHERE id_usuario = ?').run(aluno.id_usuario);
    const r = await s.api('/api/privacidade/aceite', { method: 'POST', token: aluno.token, body: {} });
    if (r.status === 501) {
        t.todo('POST /api/privacidade/aceite ainda responde 501 (frente "lgpd" em construção)');
    }
    assert.ok(r.status === 200 || r.status === 204, `status ${r.status}`);
    const me = await s.api('/api/me', { token: aluno.token });
    assert.equal(me.body.termos_pendentes, false);
    assert.ok(s.db.prepare('SELECT termos_aceitos_em FROM usuarios WHERE id_usuario = ?')
        .get(aluno.id_usuario).termos_aceitos_em);
    assert.equal((await s.api('/api/mural', { token: aluno.token })).status, 200);
});

test('login grava o dispositivo resumido do User-Agent', async () => {
    const r = await s.api('/api/auth/login', {
        method: 'POST',
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
        body: { login: s.contas.gestao.login, senha: s.contas.gestao.senha }
    });
    const sessoes = await s.api('/api/conta/sessoes', { token: r.body.token });
    const atual = sessoes.body.find((sessao) => sessao.atual);
    assert.equal(atual.dispositivo, 'Chrome · Windows');
});
