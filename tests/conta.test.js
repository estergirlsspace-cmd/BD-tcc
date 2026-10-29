const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor, sha256 } = require('./helpers/servidor');

const s = usarServidor();

test('GET /api/conta: e-mail nulo e todas as notificações ligadas', async () => {
    const aluno = await s.alunoPronto(0);
    const r = await s.api('/api/conta', { token: aluno.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
        email: null,
        notificacoes: { urgente: true, turma: true, prazos: true, eventos: true, mensagens: true }
    });
});

test('PUT /api/conta/notificacoes: silencia e religa; validação 400', async () => {
    const aluno = await s.alunoPronto(0);
    const r = await s.api('/api/conta/notificacoes', { method: 'PUT', token: aluno.token, body: { mensagens: false, prazos: false } });
    assert.equal(r.status, 200);
    assert.equal(r.body.notificacoes.mensagens, false);
    assert.equal(r.body.notificacoes.prazos, false);
    assert.equal(r.body.notificacoes.urgente, true);
    const religa = await s.api('/api/conta/notificacoes', { method: 'PUT', token: aluno.token, body: { mensagens: true } });
    assert.equal(religa.body.notificacoes.mensagens, true);
    for (const body of [{}, { mensagens: 'nao' }, { sms: false }]) {
        assert.equal((await s.api('/api/conta/notificacoes', { method: 'PUT', token: aluno.token, body })).status, 400);
    }
});

test('e-mail: pedido não grava até confirmar; token confirma uma vez só', async () => {
    const aluno = await s.alunoPronto(1);
    const pedido = await s.api('/api/conta/email', { method: 'POST', token: aluno.token, body: { email: ' Aluno.Um@Exemplo.com ', senha_atual: aluno.senha } });
    assert.equal(pedido.status, 200);
    assert.equal(pedido.body.email_pendente, 'aluno.um@exemplo.com');
    assert.equal((await s.api('/api/conta', { token: aluno.token })).body.email, null);
    const gerado = s.db.prepare("SELECT dado FROM tokens WHERE id_usuario = ? AND finalidade = 'confirmar_email'").get(aluno.id_usuario);
    assert.equal(gerado.dado, 'aluno.um@exemplo.com');

    const token = s.criarToken(aluno.id_usuario, 'confirmar_email', { dado: 'aluno.um@exemplo.com' });
    const ok = await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.email, 'aluno.um@exemplo.com');
    assert.equal((await s.api('/api/conta', { token: aluno.token })).body.email, 'aluno.um@exemplo.com');
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token } })).status, 400, 'uso único');
});

test('e-mail: inválido 400, igual ao atual 400, de outra conta 409; remover', async () => {
    const aluno = await s.alunoPronto(1);
    const outro = await s.alunoPronto(2);
    assert.equal((await s.api('/api/conta/email', { method: 'POST', token: outro.token, body: { email: 'sem-arroba', senha_atual: outro.senha } })).status, 400);
    assert.equal((await s.api('/api/conta/email', { method: 'POST', token: outro.token, body: { email: 'aluno.um@exemplo.com', senha_atual: outro.senha } })).status, 409);
    assert.equal((await s.api('/api/conta/email', { method: 'POST', token: aluno.token, body: { email: 'aluno.um@exemplo.com', senha_atual: aluno.senha } })).status, 400);
    // Confirmação de um endereço que outra conta confirmou antes → 409.
    const token = s.criarToken(outro.id_usuario, 'confirmar_email', { dado: 'aluno.um@exemplo.com' });
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token } })).status, 409);
    const removido = await s.api('/api/conta/email', { method: 'DELETE', token: aluno.token, body: { senha_atual: aluno.senha } });
    assert.equal(removido.status, 200);
    assert.equal(removido.body.email, null);
});

test('e-mail: trocar ou remover exige a senha atual (400 sem ela ou com senha errada)', async () => {
    const aluno = await s.alunoPronto(4);
    const semSenha = await s.api('/api/conta/email', { method: 'POST', token: aluno.token, body: { email: 'quatro@exemplo.com' } });
    assert.equal(semSenha.status, 400);
    const errada = await s.api('/api/conta/email', { method: 'POST', token: aluno.token, body: { email: 'quatro@exemplo.com', senha_atual: 'nao-e-essa' } });
    assert.equal(errada.status, 400, 'senha errada não pode ser 401 (as telas tratariam como sessão expirada)');
    assert.equal((await s.api('/api/conta/email', { method: 'DELETE', token: aluno.token })).status, 400);
});

test('confirmar e-mail: token expirado, inventado ou malformado → 400', async () => {
    const aluno = await s.alunoPronto(3);
    const expirado = s.criarToken(aluno.id_usuario, 'confirmar_email', { dado: 'x@exemplo.com', validadeSegundos: -10 });
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token: expirado } })).status, 400);
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token: 'A'.repeat(43) } })).status, 400);
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token: 'curto' } })).status, 400);
    // Token de redefinição de senha não confirma e-mail.
    const outraFinalidade = s.criarToken(aluno.id_usuario, 'redefinir_senha');
    assert.equal((await s.api('/api/conta/email/confirmar', { method: 'POST', body: { token: outraFinalidade } })).status, 400);
});

test('recuperar senha: sempre 200 com a mesma mensagem; token só para conta com e-mail', async () => {
    const aluno = await s.alunoPronto(4);
    s.db.prepare('UPDATE usuarios SET email = ? WHERE id_usuario = ?').run('aluno.quatro@exemplo.com', aluno.id_usuario);
    const comEmail = await s.api('/api/auth/recuperar', { method: 'POST', body: { login: aluno.matricula } });
    const porEmail = await s.api('/api/auth/recuperar', { method: 'POST', body: { login: 'ALUNO.QUATRO@exemplo.com' } });
    const inexistente = await s.api('/api/auth/recuperar', { method: 'POST', body: { login: 'ninguem' } });
    const semEmail = await s.api('/api/auth/recuperar', { method: 'POST', body: { login: s.alunos[5].matricula } });
    for (const r of [comEmail, porEmail, inexistente, semEmail]) {
        assert.equal(r.status, 200);
        assert.equal(r.body.mensagem, comEmail.body.mensagem);
    }
    const tokens = s.db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE finalidade = 'redefinir_senha' AND id_usuario = ?").get(aluno.id_usuario).n;
    assert.equal(tokens, 1, 'o pedido novo substitui o anterior');
    const semEmailInfo = s.alunoInfo(s.alunos[5].matricula);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tokens WHERE id_usuario = ?').get(semEmailInfo.id_usuario).n, 0);
    assert.equal((await s.api('/api/auth/recuperar', { method: 'POST', body: {} })).status, 400);
});

test('recuperar senha: limite de 5 pedidos por IP em 15 min (429)', async () => {
    const ip = '198.51.100.7';
    for (let i = 0; i < 5; i += 1) {
        assert.equal((await s.api('/api/auth/recuperar', { method: 'POST', ip, body: { login: `x${i}` } })).status, 200);
    }
    assert.equal((await s.api('/api/auth/recuperar', { method: 'POST', ip, body: { login: 'x' } })).status, 429);
});

test('redefinir senha com token: troca, zera primeiro acesso, encerra sessões, uso único', async () => {
    const aluno = s.alunos[7];
    const info = s.alunoInfo(aluno.matricula);
    const sessao = await s.login(aluno.matricula, aluno.senha_inicial); // ainda no primeiro acesso
    const token = s.criarToken(info.id_usuario, 'redefinir_senha');
    assert.ok(s.db.prepare('SELECT 1 FROM tokens WHERE token_hash = ?').get(sha256(token)));

    const fraca = await s.api('/api/auth/redefinir', { method: 'POST', body: { token, nova_senha: 'ceep@1234' } });
    assert.equal(fraca.status, 400);
    const ok = await s.api('/api/auth/redefinir', { method: 'POST', body: { token, nova_senha: aluno.senha_inicial + 'x' } });
    assert.equal(ok.status, 200);
    assert.equal((await s.api('/api/me', { token: sessao })).status, 401, 'sessões encerradas');
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token, nova_senha: 'Outra-senha-99' } })).status, 400, 'uso único');

    const nova = await s.login(aluno.matricula, aluno.senha_inicial + 'x');
    assert.equal((await s.api('/api/me', { token: nova })).body.deve_trocar_senha, false);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tokens WHERE id_usuario = ? AND finalidade = 'redefinir_senha'").get(info.id_usuario).n, 0);
});

test('redefinir senha: token expirado, de outra finalidade, malformado, senha igual à atual → 400', async () => {
    const aluno = await s.alunoPronto(8);
    const expirado = s.criarToken(aluno.id_usuario, 'redefinir_senha', { validadeSegundos: -1 });
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: expirado, nova_senha: 'Senha-nova-123' } })).status, 400);
    const confirmar = s.criarToken(aluno.id_usuario, 'confirmar_email', { dado: 'a@b.com' });
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: confirmar, nova_senha: 'Senha-nova-123' } })).status, 400);
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: '../../x', nova_senha: 'Senha-nova-123' } })).status, 400);
    const valido = s.criarToken(aluno.id_usuario, 'redefinir_senha');
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: valido, nova_senha: aluno.senha } })).status, 400);
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: valido, nova_senha: 'Senha-nova-123', extra: 1 } })).status, 400);
    // Conta desativada: o token deixa de valer.
    s.db.prepare('UPDATE usuarios SET ativo = 0 WHERE id_usuario = ?').run(aluno.id_usuario);
    assert.equal((await s.api('/api/auth/redefinir', { method: 'POST', body: { token: valido, nova_senha: 'Senha-nova-123' } })).status, 400);
    s.db.prepare('UPDATE usuarios SET ativo = 1 WHERE id_usuario = ?').run(aluno.id_usuario);
});

test('sessões: lista sem expor token, encerra uma, encerra as outras', async () => {
    const aluno = await s.alunoPronto(9);
    const segunda = await s.login(aluno.matricula, aluno.senha);
    const terceira = await s.login(aluno.matricula, aluno.senha);
    const lista = await s.api('/api/conta/sessoes', { token: aluno.token });
    assert.equal(lista.status, 200);
    assert.equal(lista.body.length, 3);
    assert.equal(lista.body.filter((x) => x.atual).length, 1);
    for (const sessao of lista.body) {
        assert.match(sessao.id, /^[a-f0-9]{16}$/);
        assert.ok(![aluno.token, segunda, terceira].includes(sessao.id));
    }
    const idSegunda = sha256(segunda).slice(0, 16);
    assert.equal((await s.api(`/api/conta/sessoes/${idSegunda}`, { method: 'DELETE', token: aluno.token })).status, 204);
    assert.equal((await s.api('/api/me', { token: segunda })).status, 401);
    assert.equal((await s.api(`/api/conta/sessoes/${idSegunda}`, { method: 'DELETE', token: aluno.token })).status, 404);
    assert.equal((await s.api('/api/conta/sessoes/xyz', { method: 'DELETE', token: aluno.token })).status, 400);

    // Sessão de outra pessoa não pode ser encerrada (404).
    const gestao = await s.gestao();
    const idGestao = sha256(gestao).slice(0, 16);
    assert.equal((await s.api(`/api/conta/sessoes/${idGestao}`, { method: 'DELETE', token: aluno.token })).status, 404);
    assert.equal((await s.api('/api/me', { token: gestao })).status, 200);

    const todas = await s.api('/api/conta/sessoes', { method: 'DELETE', token: aluno.token });
    assert.equal(todas.status, 200);
    assert.equal(todas.body.encerradas, 1);
    assert.equal((await s.api('/api/me', { token: terceira })).status, 401);
    assert.equal((await s.api('/api/me', { token: aluno.token })).status, 200);
});
