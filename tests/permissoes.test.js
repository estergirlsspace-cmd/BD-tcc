const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor } = require('./helpers/servidor');

const s = usarServidor();

test('administração de usuários, alunos e professores é só da gestão (403 para os outros)', async () => {
    const aluno = await s.alunoPronto(0);
    const prof = await s.professor();
    for (const rota of ['/api/usuarios', '/api/alunos', '/api/professores']) {
        assert.equal((await s.api(rota, { token: aluno.token })).status, 403, rota);
        assert.equal((await s.api(rota, { token: prof })).status, 403, rota);
        assert.equal((await s.api(rota, { token: await s.gestao() })).status, 200, rota);
    }
});

test('a lista de usuários nunca expõe o hash da senha', async () => {
    const r = await s.api('/api/usuarios', { token: await s.gestao() });
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 30);
    assert.ok(r.body.every((usuario) => !('senha' in usuario)));
});

test('turmas e disciplinas: leitura conforme o perfil, alteração só pela gestão', async () => {
    const aluno = await s.alunoPronto(0);
    const prof = await s.professor();
    const turmasAluno = await s.api('/api/turmas', { token: aluno.token });
    assert.deepEqual(turmasAluno.body.map((turma) => turma.id_turma), [aluno.id_turma]);
    const disciplinasProf = await s.api('/api/disciplinas', { token: prof });
    const meu = s.db.prepare("SELECT id_professor FROM professores p JOIN usuarios u USING (id_usuario) WHERE u.login = ?")
        .get(s.contas.professor.login).id_professor;
    assert.ok(disciplinasProf.body.length > 0);
    assert.ok(disciplinasProf.body.every((d) => d.id_professor === meu));

    const nova = { nome_turma: 'Turma de teste', curso: 'informatica', serie: 1 };
    assert.equal((await s.api('/api/turmas', { method: 'POST', token: prof, body: nova })).status, 403);
    assert.equal((await s.api('/api/turmas', { method: 'POST', token: aluno.token, body: nova })).status, 403);
    assert.equal((await s.api('/api/turmas', { method: 'POST', token: await s.gestao(), body: nova })).status, 201);
    assert.equal((await s.api('/api/disciplinas/1', {
        method: 'PATCH', token: prof, body: { nome_disciplina: 'X' }
    })).status, 403);
});

test('matrícula, equipe e redefinição de senha são da gestão', async () => {
    const prof = await s.professor();
    const aluno = await s.alunoPronto(0);
    const matricula = { matricula: '99990001', nome: 'Novo', id_turma: 1, cpf_inicio: '1234' };
    assert.equal((await s.api('/api/matriculas', { method: 'POST', token: prof, body: matricula })).status, 403);
    assert.equal((await s.api('/api/equipe', {
        method: 'POST', token: aluno.token, body: { login: 'x.y', tipo_usuario: 'gestao', nome: 'X' }
    })).status, 403);
    assert.equal((await s.api(`/api/matriculas/${aluno.id_aluno}/senha`, {
        method: 'POST', token: prof, body: { cpf_inicio: '1234' }
    })).status, 403);
});

test('painel: professor e gestão; aluno recebe 403', async () => {
    const aluno = await s.alunoPronto(0);
    assert.equal((await s.api('/api/painel', { token: aluno.token })).status, 403);
    const prof = await s.api('/api/painel', { token: await s.professor() });
    assert.equal(prof.status, 200);
    assert.ok(Array.isArray(prof.body.turmas));
    const gestao = await s.api('/api/painel', { token: await s.gestao() });
    assert.equal(gestao.status, 200);
    assert.equal(gestao.body.kpis.alunos, 36);
});

test('aluno só vê dados da própria turma (atividades, horários, frequência)', async () => {
    const aluno = await s.alunoPronto(0);
    const atividades = await s.api('/api/atividades', { token: aluno.token });
    assert.equal(atividades.status, 200);
    assert.ok(atividades.body.length > 0);
    assert.ok(atividades.body.every((a) => a.id_turma === aluno.id_turma));
    const horarios = await s.api('/api/horarios', { token: aluno.token });
    assert.ok(horarios.body.every((h) => h.id_turma === aluno.id_turma));
    assert.ok(horarios.body.every((h) => h.nome_disciplina && 'professor' in h));
    const frequencias = await s.api('/api/frequencias', { token: aluno.token });
    assert.ok(frequencias.body.every((f) => f.id_aluno === aluno.id_aluno));
});

test('desempenho: aluno só o próprio; professor não acessa', async () => {
    const aluno = await s.alunoPronto(0);
    const outro = s.alunoInfo(s.alunos[1].matricula);
    assert.equal((await s.api('/api/desempenho', { token: aluno.token })).status, 200);
    assert.equal((await s.api(`/api/desempenho?id_aluno=${outro.id_aluno}`, { token: aluno.token })).status, 403);
    assert.equal((await s.api('/api/desempenho?id_aluno=1', { token: await s.professor() })).status, 403);
    assert.equal((await s.api(`/api/desempenho?id_aluno=${outro.id_aluno}`, { token: await s.gestao() })).status, 200);
});

test('professor só publica atividade na própria disciplina (403 em disciplina de outro)', async () => {
    const prof = await s.professor();
    const base = { titulo: 'Lista', descricao: 'Fazer', id_turma: 1, prazo: '2099-12-01', tipo: 'atividade' };
    const propria = await s.api('/api/atividades', { method: 'POST', token: prof, body: { ...base, id_disciplina: 1 } });
    assert.equal(propria.status, 201);
    const alheia = await s.api('/api/atividades', { method: 'POST', token: prof, body: { ...base, id_disciplina: 3 } });
    assert.equal(alheia.status, 403);
    const turmaErrada = await s.api('/api/atividades', {
        method: 'POST', token: prof, body: { ...base, id_turma: 2, id_disciplina: 1 }
    });
    assert.ok([400, 403].includes(turmaErrada.status));
});

test('entregas: professor da disciplina corrige; outro professor recebe 404; aluno 403', async () => {
    const aluno = await s.alunoPronto(0);
    const atividade = s.db.prepare(`
        SELECT id_atividade, id_disciplina FROM atividades
        WHERE id_turma = ? AND tipo = 'atividade' AND prazo > date('now') ORDER BY id_atividade LIMIT 1
    `).get(aluno.id_turma);
    const entrega = await s.api(`/api/atividades/${atividade.id_atividade}/entregas`, {
        method: 'POST', token: aluno.token, body: { resposta: 'Minha resposta' }
    });
    assert.equal(entrega.status, 201);
    const id = entrega.body.id_entrega;

    const outro = s.criarProfessor('prof.permissoes', 'Senha-prof-123');
    const tokenOutro = await s.login('prof.permissoes', 'Senha-prof-123');
    assert.equal((await s.api(`/api/entregas/${id}`, { method: 'PATCH', token: tokenOutro, body: { nota: 9 } })).status, 404);
    assert.equal((await s.api(`/api/atividades/${atividade.id_atividade}/entregas`, { token: tokenOutro })).status, 404);
    assert.equal((await s.api(`/api/entregas/${id}`, { method: 'PATCH', token: aluno.token, body: { nota: 10 } })).status, 403);
    assert.ok(outro.id_professor);

    const corrigida = await s.api(`/api/entregas/${id}`, {
        method: 'PATCH', token: await s.professor(), body: { nota: 8.5, feedback: 'Bom' }
    });
    assert.equal(corrigida.status, 200);
    assert.equal(corrigida.body.nota, 8.5);
    const notaInvalida = await s.api(`/api/entregas/${id}`, {
        method: 'PATCH', token: await s.professor(), body: { nota: 11 }
    });
    assert.equal(notaInvalida.status, 400);
    const minhas = await s.api('/api/atividades', { token: aluno.token });
    const item = minhas.body.find((a) => a.id_atividade === atividade.id_atividade);
    assert.equal(item.entrega.nota, 8.5);
});

test('avaliação não recebe entrega (400); prazo vencido 409; outra turma 404', async () => {
    const aluno = await s.alunoPronto(0);
    const pegar = (sql) => s.db.prepare(sql).get(aluno.id_turma).id_atividade;
    const avaliacao = pegar("SELECT id_atividade FROM atividades WHERE id_turma = ? AND tipo = 'avaliacao'");
    const vencida = pegar("SELECT id_atividade FROM atividades WHERE id_turma = ? AND tipo = 'atividade' AND prazo < date('now')");
    const outraTurma = s.db.prepare('SELECT id_atividade FROM atividades WHERE id_turma != ? LIMIT 1')
        .get(aluno.id_turma).id_atividade;
    const enviar = (id) => s.api(`/api/atividades/${id}/entregas`, {
        method: 'POST', token: aluno.token, body: { resposta: 'x' }
    });
    assert.equal((await enviar(avaliacao)).status, 400);
    assert.equal((await enviar(vencida)).status, 409);
    assert.equal((await enviar(outraTurma)).status, 404);
    assert.equal((await enviar(999999)).status, 404);
});

test('professor só lança frequência (POST /api/frequencias) na própria disciplina', async () => {
    const prof = await s.professor();
    const aluno = s.alunoInfo(s.alunos[0].matricula);
    const r = await s.api('/api/frequencias', {
        method: 'POST', token: prof,
        body: { id_aluno: aluno.id_aluno, id_disciplina: 3, data_aula: '2026-01-05', presente: true }
    });
    assert.equal(r.status, 403);
});
