const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor, dataEscola } = require('./helpers/servidor');

const s = usarServidor();

// Turma 1: disciplinas 1 e 2 do professor de exemplo; 3 e 4 sem professor. Disciplina 2 não tem
// frequência no banco de exemplo (a 1 tem 5 dias).
function alunosDaTurma(idTurma = 1) {
    return s.db.prepare('SELECT id_aluno FROM alunos WHERE id_turma = ? ORDER BY id_aluno').all(idTurma)
        .map((row) => row.id_aluno);
}

test('GET: lista da turma com presença do dia e frequência acumulada', async () => {
    const r = await s.api(`/api/chamadas?id_disciplina=1&data=${dataEscola(-1)}`, { token: await s.professor() });
    assert.equal(r.status, 200);
    assert.equal(r.body.length, 6);
    for (const item of r.body) {
        assert.deepEqual(Object.keys(item).sort(), ['frequencia', 'id_aluno', 'nome', 'presente']);
        assert.equal(typeof item.presente, 'boolean');
        assert.equal(item.frequencia.aulas, 5);
        assert.equal(item.frequencia.faltas, 5 - item.frequencia.presencas);
        assert.equal(item.frequencia.percentual, Math.round((item.frequencia.presencas / 5) * 1000) / 10);
    }
    const semAula = await s.api(`/api/chamadas?id_disciplina=2&data=${dataEscola(0)}`, { token: await s.professor() });
    assert.ok(semAula.body.every((item) => item.presente === null && item.frequencia.percentual === null));
});

test('GET: parâmetros obrigatórios e válidos (400), disciplina alheia (404), aluno (403)', async () => {
    const prof = await s.professor();
    assert.equal((await s.api('/api/chamadas?id_disciplina=1', { token: prof })).status, 400);
    assert.equal((await s.api('/api/chamadas?data=2026-10-01', { token: prof })).status, 400);
    assert.equal((await s.api('/api/chamadas?id_disciplina=1&data=01/10/2026', { token: prof })).status, 400);
    assert.equal((await s.api('/api/chamadas?id_disciplina=abc&data=2026-10-01', { token: prof })).status, 400);
    assert.equal((await s.api('/api/chamadas?id_disciplina=3&data=2026-10-01', { token: prof })).status, 404);
    assert.equal((await s.api('/api/chamadas?id_disciplina=99999&data=2026-10-01', { token: prof })).status, 404);
    const aluno = await s.alunoPronto(0);
    assert.equal((await s.api('/api/chamadas?id_disciplina=1&data=2026-10-01', { token: aluno.token })).status, 403);
});

test('PUT: grava em lote, atualiza (upsert) e recalcula a frequência', async () => {
    const prof = await s.professor();
    const ids = alunosDaTurma();
    const data = dataEscola(0);
    const presencas = ids.map((id, i) => ({ id_aluno: id, presente: i !== 0 }));
    const r = await s.api('/api/chamadas', { method: 'PUT', token: prof, body: { id_disciplina: 2, data_aula: data, presencas } });
    assert.equal(r.status, 200, r.text);
    const primeiro = r.body.find((item) => item.id_aluno === ids[0]);
    assert.equal(primeiro.presente, false);
    assert.deepEqual(primeiro.frequencia, { aulas: 1, presencas: 0, faltas: 1, percentual: 0 });

    const corrigida = await s.api('/api/chamadas', {
        method: 'PUT', token: prof, body: { id_disciplina: 2, data_aula: data, presencas: [{ id_aluno: ids[0], presente: true }] }
    });
    assert.equal(corrigida.status, 200);
    assert.deepEqual(corrigida.body.find((item) => item.id_aluno === ids[0]).frequencia,
        { aulas: 1, presencas: 1, faltas: 0, percentual: 100 });
    const linhas = s.db.prepare('SELECT COUNT(*) AS n FROM frequencias WHERE id_disciplina = 2 AND data_aula = ?').get(data).n;
    assert.equal(linhas, 6, 'upsert não duplica');
});

test('PUT: validação (400) — data futura, aluno de outra turma, repetido, presente não-booleano, lote vazio/grande', async () => {
    const prof = await s.professor();
    const [id] = alunosDaTurma();
    const [deOutraTurma] = alunosDaTurma(2);
    const base = { id_disciplina: 1, data_aula: dataEscola(-1), presencas: [{ id_aluno: id, presente: true }] };
    const casos = [
        { ...base, data_aula: dataEscola(2) },
        { ...base, data_aula: '2026-02-30' },
        { ...base, presencas: [{ id_aluno: deOutraTurma, presente: true }] },
        { ...base, presencas: [{ id_aluno: id, presente: true }, { id_aluno: id, presente: false }] },
        { ...base, presencas: [{ id_aluno: id, presente: 1 }] },
        { ...base, presencas: [{ id_aluno: id, presente: true, obs: 'x' }] },
        { ...base, presencas: [] },
        { ...base, presencas: Array.from({ length: 201 }, (_, i) => ({ id_aluno: i + 1, presente: true })) },
        { ...base, presencas: 'todos' },
        { ...base, presencas: [null] },
        { id_disciplina: 1, data_aula: dataEscola(-1) },
        { ...base, extra: 1 }
    ];
    for (const body of casos) {
        const r = await s.api('/api/chamadas', { method: 'PUT', token: prof, body });
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 120));
    }
});

test('PUT: professor em disciplina de outro → 404; gestão pode; aluno 403; POST 405', async () => {
    const ids = alunosDaTurma();
    const body = { id_disciplina: 3, data_aula: dataEscola(-1), presencas: ids.map((id) => ({ id_aluno: id, presente: true })) };
    assert.equal((await s.api('/api/chamadas', { method: 'PUT', token: await s.professor(), body })).status, 404);
    const aluno = await s.alunoPronto(0);
    assert.equal((await s.api('/api/chamadas', { method: 'PUT', token: aluno.token, body })).status, 403);
    const gestao = await s.api('/api/chamadas', { method: 'PUT', token: await s.gestao(), body });
    assert.equal(gestao.status, 200);
    assert.ok(gestao.body.every((item) => item.presente === true));
    assert.equal((await s.api('/api/chamadas', { method: 'POST', token: await s.gestao(), body })).status, 405);
});

test('POST /api/frequencias também recusa data futura, como PUT /api/chamadas',
    async () => {
        const [id] = alunosDaTurma();
        const r = await s.api('/api/frequencias', {
            method: 'POST', token: await s.professor(),
            body: { id_aluno: id, id_disciplina: 1, data_aula: dataEscola(30), presente: false }
        });
        assert.equal(r.status, 400);
    });
