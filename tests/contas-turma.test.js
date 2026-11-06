const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { usarServidor, dataEscola, ROOT } = require('./helpers/servidor');

const s = usarServidor();
const SENHA = 'Senha-da-turma-1A';

function turmaPorNome(nome) {
    return s.db.prepare('SELECT id_turma, nome_turma, curso, serie FROM turmas WHERE nome_turma = ?').get(nome);
}

function definirSenha(idTurma, token, body = { senha: SENHA }) {
    return s.api(`/api/turmas/${idTurma}/senha`, { method: 'PUT', token, body });
}

// Roda a migração de novo (outro processo abrindo o mesmo banco), como numa nova subida.
function rodarMigracao() {
    execFileSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(ROOT, 'src', 'database.js'))})`],
        { env: ambienteFilho(), stdio: 'pipe' });
}

function ambienteFilho() {
    const env = { ...process.env, DATA_DIR: s.dir };
    for (const key of Object.keys(env)) {
        if (key.startsWith('NODE_TEST') || key === 'ADMIN_LOGIN' || key === 'ADMIN_SENHA') delete env[key];
    }
    return env;
}

async function entrarTurma(idTurma, senha = SENHA) {
    const r = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${idTurma}`, senha } });
    assert.equal(r.status, 200, r.text);
    // Aceite dos termos continua valendo para a conta da turma.
    await s.api('/api/privacidade/aceite', { method: 'POST', token: r.body.token, body: {} });
    return r.body;
}

test('migração: 12 turmas A/B, as antigas viram "A" com o mesmo id; idempotente', async () => {
    const nomes = s.db.prepare('SELECT nome_turma FROM turmas ORDER BY nome_turma').all().map((t) => t.nome_turma);
    assert.equal(nomes.length, 12);
    for (const serie of [1, 2, 3]) {
        for (const label of ['Informática', 'Redes']) {
            for (const letra of ['A', 'B']) assert.ok(nomes.includes(`${serie}ª Série — ${label} ${letra}`));
        }
    }
    // A turma do seed (id 1, 1ª Informática) foi renomeada: alunos e disciplinas continuam nela.
    const a = turmaPorNome('1ª Série — Informática A');
    assert.equal(a.id_turma, 1);
    assert.deepEqual([a.curso, a.serie], ['informatica', 1]);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM alunos WHERE id_turma = 1').get().n, 6);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM disciplinas WHERE id_turma = 1').get().n, 4);
    const b = turmaPorNome('2ª Série — Redes B');
    assert.deepEqual([b.curso, b.serie], ['redes', 2]);

    // Outros nomes não são tocados; nome antigo quando a "A" já existe também não.
    s.db.prepare("INSERT INTO turmas (nome_turma, curso, serie) VALUES ('Turma Extra', 'redes', 3)").run();
    s.db.prepare("INSERT INTO turmas (nome_turma, curso, serie) VALUES ('1ª Série — Informática', 'informatica', 1)").run();
    const antes = s.db.prepare('SELECT id_turma, nome_turma FROM turmas ORDER BY id_turma').all();
    rodarMigracao();
    rodarMigracao();
    assert.deepEqual(s.db.prepare('SELECT id_turma, nome_turma FROM turmas ORDER BY id_turma').all(), antes);
    s.db.prepare("DELETE FROM turmas WHERE nome_turma = '1ª Série — Informática'").run();
});

test('PUT/DELETE /api/turmas/:id/senha: só a gestão, validações', async () => {
    const gestao = await s.gestao();
    const aluno = await s.alunoPronto(0);
    const id = turmaPorNome('1ª Série — Informática A').id_turma;
    assert.equal((await definirSenha(id, undefined)).status, 401);
    assert.equal((await definirSenha(id, await s.professor())).status, 403);
    assert.equal((await definirSenha(id, aluno.token)).status, 403);
    assert.equal((await s.api(`/api/turmas/${id}/senha`, { method: 'DELETE', token: aluno.token })).status, 403);
    assert.equal((await definirSenha(id, gestao, { senha: 'curta' })).status, 400);
    assert.equal((await definirSenha(id, gestao, { senha: SENHA, extra: 1 })).status, 400);
    assert.equal((await definirSenha(999999, gestao)).status, 404);
    assert.equal((await definirSenha('abc', gestao)).status, 400);
    const extra = turmaPorNome('Turma Extra').id_turma;
    assert.equal((await definirSenha(extra, gestao)).status, 400);
    assert.equal((await s.api(`/api/turmas/${id}/senha`, { method: 'POST', token: gestao, body: {} })).status, 405);
    assert.equal((await s.api(`/api/turmas/${id}/senha`, { method: 'DELETE', token: gestao })).status, 404);

    const criada = await definirSenha(id, gestao);
    assert.equal(criada.status, 201, criada.text);
    assert.deepEqual(criada.body, {
        id_turma: id, login: `turma-${id}`, usuario: '1info-a', tem_senha: true, mensagem: 'Acesso da turma criado.'
    });
    const conta = s.db.prepare(`
        SELECT u.id_usuario, u.tipo_usuario, u.curso, u.serie, u.ativo, u.deve_trocar_senha, u.email,
               a.nome, a.id_turma
        FROM usuarios u JOIN alunos a ON a.id_usuario = u.id_usuario WHERE u.login = ?
    `).get(`turma-${id}`);
    assert.deepEqual({ ...conta, id_usuario: undefined }, {
        id_usuario: undefined, tipo_usuario: 'aluno', curso: 'informatica', serie: 1, ativo: 1,
        deve_trocar_senha: 0, email: null, nome: '1ª Série — Informática A', id_turma: id
    });
    const auditoria = s.db.prepare("SELECT alvo FROM auditoria WHERE acao = 'turma.senha'").all();
    assert.deepEqual(auditoria.map((r) => r.alvo), [`turma:${id}`]);

    const turmas = (await s.api('/api/turmas', { token: gestao })).body;
    assert.equal(turmas.find((t) => t.id_turma === id).tem_senha, true);
    assert.equal(turmas.find((t) => t.id_turma === id).usuario, '1info-a');
    assert.equal(turmas.find((t) => t.nome_turma === '3ª Série — Redes B').usuario, '3redes-b');
    assert.equal(turmas.find((t) => t.nome_turma === 'Turma Extra').usuario, null);
    assert.ok(turmas.filter((t) => t.id_turma !== id).every((t) => t.tem_senha === false));
    // Aluno/professor não recebem o campo.
    assert.equal((await s.api('/api/turmas', { token: aluno.token })).body[0].tem_senha, undefined);

    // Trocar a senha: 200, mesma conta, sessões revogadas, senha antiga deixa de valer.
    const sessao = await entrarTurma(id);
    const trocada = await definirSenha(id, gestao, { senha: 'Outra-senha-1A' });
    assert.equal(trocada.status, 200);
    assert.equal(trocada.body.mensagem, 'Senha da turma atualizada.');
    assert.equal((await s.api('/api/me', { token: sessao.token })).status, 401);
    const velha = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${id}`, senha: SENHA } });
    assert.equal(velha.status, 401);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE login = ?").get(`turma-${id}`).n, 1);
    assert.equal((await definirSenha(id, gestao)).status, 200);
});

function entrar(login, senha = SENHA) {
    return s.api('/api/auth/login', { method: 'POST', body: { login, senha } });
}

test('usuário da sala legível ("1info-a") entra na conta da turma', async () => {
    const id = turmaPorNome('1ª Série — Informática A').id_turma;
    for (const login of ['1info-a', '1INFOA', '1informatica-a', '1Informática-A', ' 1info-a ']) {
        const r = await entrar(login);
        assert.equal(r.status, 200, `${login}: ${r.text}`);
        assert.equal(r.body.usuario.login, `turma-${id}`);
        assert.equal(r.body.usuario.conta_turma, true);
    }
    const outra = turmaPorNome('3ª Série — Redes B').id_turma;
    const criada = await definirSenha(outra, await s.gestao());
    assert.equal(criada.status, 201);
    assert.equal(criada.body.usuario, '3redes-b');
    assert.equal((await entrar('3redes-b')).body.usuario.id_turma, outra);

    // Turma sem acesso, turma inexistente ou senha errada: mesmo 401 genérico.
    for (const [login, senha] of [['1info-b', SENHA], ['9info-a', SENHA], ['1info-a', 'senha-errada']]) {
        const r = await entrar(login, senha);
        assert.equal(r.status, 401, login);
        assert.match(r.text, /Usuário ou senha inválidos\./);
    }
});

test('bloqueio progressivo conta na conta resolvida, qualquer que seja a grafia', async () => {
    const id = turmaPorNome('2ª Série — Redes A').id_turma;
    assert.equal((await definirSenha(id, await s.gestao())).status, 201);
    for (const login of ['2redes-a', '2REDESA', `turma-${id}`, '2redes-A', '2 redes a']) {
        assert.equal((await entrar(login, 'senha-errada')).status, 401, login);
    }
    assert.equal((await entrar('2redes-a')).status, 429);
    assert.equal((await entrar(`turma-${id}`)).status, 429);
});

test('login "turma-<id>": sem primeiro acesso, me.conta_turma, termos continuam valendo', async () => {
    const id = turmaPorNome('2ª Série — Informática B').id_turma;
    assert.equal((await definirSenha(id, await s.gestao())).status, 201);
    const r = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${id}`, senha: SENHA } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.usuario.conta_turma, true);
    assert.equal(r.body.usuario.deve_trocar_senha, false);
    assert.equal(r.body.usuario.id_turma, id);
    assert.equal(r.body.usuario.nome_turma, '2ª Série — Informática B');

    // A conta nova ainda não aceitou os termos: só perfil e privacidade.
    const pendente = await s.api('/api/me', { token: r.body.token });
    assert.equal(pendente.body.termos_pendentes, true);
    assert.equal((await s.api('/api/mural', { token: r.body.token })).status, 403);
    const aceite = await s.api('/api/privacidade/aceite', { method: 'POST', token: r.body.token, body: {} });
    assert.equal(aceite.status, 200);

    const me = (await s.api('/api/me', { token: r.body.token })).body;
    assert.equal(me.conta_turma, true);
    assert.equal(me.deve_trocar_senha, false);
    assert.equal(me.termos_pendentes, false);
    assert.equal(me.id_turma, id);
    assert.equal(me.nome, '2ª Série — Informática B');

    const aluno = await s.alunoPronto(1);
    assert.equal((await s.api('/api/me', { token: aluno.token })).body.conta_turma, false);

    // Bloqueio progressivo por conta continua valendo.
    let status;
    for (let i = 0; i < 5; i += 1) {
        status = (await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${id}`, senha: 'errada-123' } })).status;
    }
    assert.equal(status, 401);
    const bloqueado = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${id}`, senha: SENHA } });
    assert.equal(bloqueado.status, 429);
});

test('conta da turma: 403 no que é pessoal; mural, salvos, atividades e horários funcionam', async () => {
    const id = turmaPorNome('3ª Série — Redes B').id_turma;
    const { token } = await entrarTurma(id);

    const pessoais = [
        ['GET', '/api/justificativas'], ['POST', '/api/justificativas'],
        ['GET', '/api/frequencias'], ['GET', '/api/desempenho'],
        ['GET', '/api/mensagens'], ['GET', '/api/mensagens/contatos'], ['POST', '/api/mensagens'],
        ['POST', '/api/conta/email'], ['DELETE', '/api/conta/email'],
        ['GET', '/api/conta/sessoes'], ['DELETE', '/api/conta/sessoes'],
        ['GET', '/api/privacidade/meus-dados'],
        ['POST', '/api/auth/password'],
        ['GET', '/api/atividades/1/entregas']
    ];
    for (const [method, rota] of pessoais) {
        const r = await s.api(rota, { method, token, body: method === 'GET' ? undefined : {} });
        assert.equal(r.status, 403, `${method} ${rota} → ${r.status}`);
    }

    const gestao = await s.gestao();
    const aviso = await s.api('/api/avisos', {
        method: 'POST', token: gestao, body: { titulo: 'Aviso 3B', conteudo: 'Só para a 3ª Redes B.', id_turma: id }
    });
    assert.equal(aviso.status, 201, aviso.text);
    const mural = await s.api('/api/mural', { token });
    assert.equal(mural.status, 200);
    assert.ok(mural.body.avisos.some((a) => a.id_post === aviso.body.id_post));

    const pasta = await s.api('/api/pastas', { method: 'POST', token, body: { nome: 'Provas' } });
    assert.equal(pasta.status, 201);
    const salvo = await s.api(`/api/salvos/${aviso.body.id_post}`, {
        method: 'PUT', token, body: { id_pasta: pasta.body.id_pasta }
    });
    assert.equal(salvo.status, 200, salvo.text);
    // Salvos são da turma: outra sessão da mesma conta vê o mesmo.
    const outra = await entrarTurma(id);
    const salvos = await s.api('/api/salvos', { token: outra.token });
    assert.deepEqual(salvos.body.map((a) => a.id_post), [aviso.body.id_post]);

    for (const rota of ['/api/atividades', '/api/horarios', '/api/horarios-pdf', '/api/avisos', '/api/conta']) {
        assert.equal((await s.api(rota, { token })).status, 200, rota);
    }
    assert.equal((await s.api('/api/atividades', { method: 'POST', token, body: {} })).status, 403);
});

test('matrícula individual inalterada; conta da turma fora da chamada e dos contatos', async () => {
    const aluno = await s.alunoPronto(2);
    assert.equal((await s.api('/api/justificativas', { token: aluno.token })).status, 200);
    assert.equal((await s.api('/api/frequencias', { token: aluno.token })).status, 200);
    const me = (await s.api('/api/me', { token: aluno.token })).body;
    assert.equal(me.conta_turma, false);
    assert.equal(me.nome_turma, '1ª Série — Informática A');

    // A turma 1 tem conta da turma ativa: a chamada continua com os 6 alunos de verdade.
    const chamada = await s.api(`/api/chamadas?id_disciplina=1&data=${dataEscola(-1)}`, { token: await s.professor() });
    assert.equal(chamada.status, 200);
    assert.equal(chamada.body.length, 6);
    const contatos = (await s.api('/api/mensagens/contatos', { token: await s.professor() })).body;
    const idConta = s.db.prepare("SELECT id_usuario FROM usuarios WHERE login = 'turma-1'").get().id_usuario;
    assert.ok(!contatos.some((c) => c.id_usuario === idConta));
});

test('DELETE /api/turmas/:id/senha desativa a conta e encerra as sessões', async () => {
    const gestao = await s.gestao();
    const id = turmaPorNome('3ª Série — Redes B').id_turma;
    const { token } = await entrarTurma(id);
    const r = await s.api(`/api/turmas/${id}/senha`, { method: 'DELETE', token: gestao });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { id_turma: id, tem_senha: false, mensagem: 'Acesso da turma desativado.' });
    assert.equal(s.db.prepare('SELECT ativo FROM usuarios WHERE login = ?').get(`turma-${id}`).ativo, 0);
    assert.equal((await s.api('/api/me', { token })).status, 401);
    const login = await s.api('/api/auth/login', { method: 'POST', body: { login: `turma-${id}`, senha: SENHA } });
    assert.equal(login.status, 401);
    assert.equal((await entrar('3redes-b')).status, 401);
    assert.equal((await s.api('/api/turmas', { token: gestao })).body.find((t) => t.id_turma === id).tem_senha, false);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'turma.desativar_acesso'").get().n, 1);

    // Definir de novo reativa a mesma conta (sem criar outra).
    assert.equal((await definirSenha(id, gestao)).status, 200);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE login = ?').get(`turma-${id}`).n, 1);
    await entrarTurma(id);
});

test('conta da turma: envia atividade identificando o aluno com matrícula + senha pessoal', async () => {
    const aluno = await s.alunoPronto(1);
    const { token } = await entrarTurma(aluno.id_turma);
    const atividade = s.db.prepare(`
        SELECT id_atividade FROM atividades
        WHERE id_turma = ? AND tipo = 'atividade' AND prazo > date('now') ORDER BY id_atividade LIMIT 1
    `).get(aluno.id_turma);
    const rota = `/api/atividades/${atividade.id_atividade}/entregas`;
    const enviar = (body) => s.api(rota, { method: 'POST', token, body });

    assert.equal((await enviar({ resposta: 'Sem identificação' })).status, 400);
    const errada = await enviar({ resposta: 'x', matricula: aluno.matricula, senha: 'senha-errada-123' });
    assert.equal(errada.status, 400, 'senha errada não derruba a sessão da turma (nada de 401)');

    const ok = await enviar({ resposta: 'Resposta enviada pela sala', matricula: aluno.matricula, senha: aluno.senha });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.id_aluno, aluno.id_aluno);
    const gravada = s.db.prepare('SELECT resposta FROM entregas_atividades WHERE id_entrega = ?').get(ok.body.id_entrega);
    assert.equal(gravada.resposta, 'Resposta enviada pela sala');
    // A conta da turma continua sem ver as entregas pessoais.
    assert.equal((await s.api(rota, { token })).status, 403);

    // Aluno de outra turma não envia por esta turma; quem não fez o primeiro acesso também não
    // (índices 0 a 2 já criaram a senha pessoal nos testes acima).
    const outraTurma = s.db.prepare(`
        SELECT u.login FROM usuarios u JOIN alunos a ON a.id_usuario = u.id_usuario
        WHERE u.tipo_usuario = 'aluno' AND a.id_turma <> ? AND u.login NOT LIKE 'turma-%' LIMIT 1
    `).get(aluno.id_turma);
    if (outraTurma) {
        assert.equal((await enviar({ resposta: 'x', matricula: outraTurma.login, senha: aluno.senha })).status, 400);
    }
    const semPrimeiroAcesso = s.alunos.find((a, i) => i > 2
        && s.db.prepare('SELECT a.id_turma FROM alunos a JOIN usuarios u ON u.id_usuario = a.id_usuario WHERE u.login = ?').get(a.matricula)?.id_turma === aluno.id_turma);
    if (semPrimeiroAcesso) {
        const r = await enviar({ resposta: 'x', matricula: semPrimeiroAcesso.matricula, senha: semPrimeiroAcesso.senha_inicial });
        assert.equal(r.status, 403, r.text);
    }
});
