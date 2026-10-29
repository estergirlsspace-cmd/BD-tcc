const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { usarServidor, dataEscola, ARQUIVOS, ROOT } = require('./helpers/servidor');
const { addBusinessDays, schoolNow } = require(path.join(ROOT, 'src', 'utils', 'calendario.js'));

let aluno;
let outroAluno;
let profId;
const s = usarServidor({}, async (ambiente) => {
    aluno = await ambiente.alunoPronto(0);
    outroAluno = await ambiente.alunoPronto(1);
    profId = ambiente.db.prepare('SELECT id_usuario FROM usuarios WHERE login = ?')
        .get(ambiente.contas.professor.login).id_usuario;
});

// Disciplinas da turma 1: 1 e 2 do professor de exemplo, 3 e 4 sem professor.
const DISC = 2;

// Por padrão a falta é lançada no próprio dia da aula (meio-dia em Brasília = 15h UTC).
function falta(idAluno, data, presente = 0, disciplina = DISC, lancadaEm = `${data} 15:00:00`) {
    s.db.prepare(`
        INSERT INTO frequencias (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente, criado_em)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(idAluno, disciplina, profId, data, presente, lancadaEm);
}

function justificar(token, body) {
    return s.api('/api/justificativas', { method: 'POST', token, body });
}

test('aluno justifica falta recente: 201 com o item completo, pendente', async () => {
    const data = dataEscola(-1);
    falta(aluno.id_aluno, data);
    const r = await justificar(aluno.token, { id_disciplina: DISC, data_falta: data, motivo: 'Consulta médica' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.situacao, 'pendente');
    assert.equal(r.body.data_falta, data);
    assert.equal(r.body.aluno.id_aluno, aluno.id_aluno);
    assert.equal(r.body.id_disciplina, DISC);
    assert.equal(r.body.anexo, null);
    assert.equal(r.body.resposta, null);

    const repetida = await justificar(aluno.token, { id_disciplina: DISC, data_falta: data, motivo: 'De novo' });
    assert.equal(repetida.status, 409);
});

test('prazo de 5 dias úteis: último dia aceito, dia anterior recusado (409)', async () => {
    const hoje = schoolNow().data;
    // Falta mais antiga ainda no prazo: addBusinessDays(d, 5) >= hoje.
    let limite = hoje;
    for (let i = 1; i < 15; i += 1) {
        const candidato = dataEscola(-i);
        if (addBusinessDays(candidato, 5) >= hoje) limite = candidato;
        else break;
    }
    const foraDoPrazo = new Date(Date.parse(`${limite}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
    falta(outroAluno.id_aluno, limite);
    falta(outroAluno.id_aluno, foraDoPrazo);
    const dentro = await justificar(outroAluno.token, { id_disciplina: DISC, data_falta: limite, motivo: 'Doença' });
    assert.equal(dentro.status, 201, `${limite}: ${dentro.text}`);
    const fora = await justificar(outroAluno.token, { id_disciplina: DISC, data_falta: foraDoPrazo, motivo: 'Doença' });
    assert.equal(fora.status, 409, foraDoPrazo);
    assert.match(fora.body.erro, /prazo/);

    falta(outroAluno.id_aluno, dataEscola(-30));
    assert.equal((await justificar(outroAluno.token, { id_disciplina: DISC, data_falta: dataEscola(-30), motivo: 'x' })).status, 409);
});

test('falta lançada com atraso: o prazo conta a partir do lançamento, não da aula', async () => {
    const antiga = dataEscola(-20);
    const lancadaHoje = new Date().toISOString().slice(0, 19).replace('T', ' ');
    falta(outroAluno.id_aluno, antiga, 0, DISC, lancadaHoje);
    const r = await justificar(outroAluno.token, { id_disciplina: DISC, data_falta: antiga, motivo: 'Consulta' });
    assert.equal(r.status, 201, r.text);
});

test('sem falta registrada (presença, outro dia, outra disciplina) → 404', async () => {
    const data = dataEscola(-2);
    falta(aluno.id_aluno, data, 1);
    assert.equal((await justificar(aluno.token, { id_disciplina: DISC, data_falta: data, motivo: 'x' })).status, 404);
    assert.equal((await justificar(aluno.token, { id_disciplina: 4, data_falta: dataEscola(-1), motivo: 'x' })).status, 404);
    // Falta de outro aluno não pode ser justificada por este.
    const alheia = dataEscola(-3);
    falta(outroAluno.id_aluno, alheia);
    assert.equal((await justificar(aluno.token, { id_disciplina: DISC, data_falta: alheia, motivo: 'x' })).status, 404);
});

test('validação do corpo (400)', async () => {
    const base = { id_disciplina: DISC, data_falta: dataEscola(-1), motivo: 'x' };
    const casos = [
        { ...base, motivo: undefined },
        { ...base, motivo: '   ' },
        { ...base, motivo: 'x'.repeat(2001) },
        { ...base, data_falta: '2026-02-30' },
        { ...base, data_falta: '2026-10-01T10:00' },
        { ...base, id_disciplina: 'um' },
        { ...base, id_disciplina: -1 },
        { ...base, extra: true },
        { ...base, id_arquivo: 'abc' }
    ];
    for (const body of casos) {
        const r = await justificar(aluno.token, JSON.parse(JSON.stringify(body)));
        assert.equal(r.status, 400, JSON.stringify(body));
    }
});

test('só aluno envia justificativa (403 para professor e gestão)', async () => {
    const body = { id_disciplina: DISC, data_falta: dataEscola(-1), motivo: 'x' };
    assert.equal((await justificar(await s.professor(), body)).status, 403);
    assert.equal((await justificar(await s.gestao(), body)).status, 403);
});

test('atestado: só arquivo próprio; aluno dono, professor da disciplina e gestão baixam', async () => {
    const data = dataEscola(-4);
    falta(aluno.id_aluno, data);
    const deOutro = await s.api('/api/arquivos', {
        method: 'POST', token: outroAluno.token, body: ARQUIVOS.pdf,
        headers: { 'content-type': 'application/pdf', 'x-nome-arquivo': 'a.pdf' }
    });
    const recusado = await justificar(aluno.token, { id_disciplina: DISC, data_falta: data, motivo: 'x', id_arquivo: deOutro.body.id_arquivo });
    assert.equal(recusado.status, 400);

    const meu = await s.api('/api/arquivos', {
        method: 'POST', token: aluno.token, body: ARQUIVOS.pdf,
        headers: { 'content-type': 'application/pdf', 'x-nome-arquivo': 'atestado.pdf' }
    });
    const r = await justificar(aluno.token, { id_disciplina: DISC, data_falta: data, motivo: 'Atestado', id_arquivo: meu.body.id_arquivo });
    assert.equal(r.status, 201);
    assert.deepEqual(r.body.anexo, meu.body);

    const baixar = (token) => s.api(`/api/arquivos/${meu.body.id_arquivo}`, { token });
    assert.equal((await baixar(aluno.token)).status, 200);
    // Minimização (LGPD): atestado é dado de saúde; o professor não baixa, só aluno e gestão.
    assert.equal((await baixar(await s.professor())).status, 404);
    assert.equal((await baixar(await s.gestao())).status, 200);
    assert.equal((await baixar(outroAluno.token)).status, 404);
    s.criarProfessor('prof.just', 'Senha-prof-123');
    assert.equal((await baixar(await s.login('prof.just', 'Senha-prof-123'))).status, 404);
});

test('listagem: aluno as próprias, professor das suas disciplinas, gestão todas; filtro', async () => {
    const minhas = await s.api('/api/justificativas', { token: aluno.token });
    assert.equal(minhas.status, 200);
    assert.ok(minhas.body.length >= 2);
    assert.ok(minhas.body.every((j) => j.aluno.id_aluno === aluno.id_aluno));
    const todas = await s.api('/api/justificativas', { token: await s.gestao() });
    assert.ok(todas.body.length > minhas.body.length);
    const prof = await s.api('/api/justificativas', { token: await s.professor() });
    assert.equal(prof.body.length, todas.body.length, 'todas são da disciplina do professor de exemplo');
    assert.ok(prof.body.every((j) => j.motivo === undefined && j.anexo === undefined && j.resposta === undefined),
        'professor vê só a situação (sem motivo, anexo ou resposta)');
    const outroProf = await s.api('/api/justificativas', { token: await s.login('prof.just', 'Senha-prof-123') });
    assert.deepEqual(outroProf.body, []);
    const pendentes = await s.api('/api/justificativas?situacao=pendente', { token: await s.gestao() });
    assert.ok(pendentes.body.every((j) => j.situacao === 'pendente'));
    assert.equal((await s.api('/api/justificativas?situacao=qualquer', { token: await s.gestao() })).status, 400);
});

test('análise pela gestão: aceita/recusada; frequência mostra a justificativa', async () => {
    const [primeira] = (await s.api('/api/justificativas?situacao=pendente', { token: aluno.token })).body;
    const url = `/api/justificativas/${primeira.id_justificativa}`;
    assert.equal((await s.api(url, { method: 'PATCH', token: await s.professor(), body: { situacao: 'aceita' } })).status, 403);
    assert.equal((await s.api(url, { method: 'PATCH', token: aluno.token, body: { situacao: 'aceita' } })).status, 403);
    assert.equal((await s.api(url, { method: 'PATCH', token: await s.gestao(), body: { situacao: 'talvez' } })).status, 400);
    assert.equal((await s.api(url, { method: 'PATCH', token: await s.gestao(), body: { situacao: 'aceita', resposta: 5 } })).status, 400);
    assert.equal((await s.api('/api/justificativas/999999', { method: 'PATCH', token: await s.gestao(), body: { situacao: 'aceita' } })).status, 404);

    const ok = await s.api(url, { method: 'PATCH', token: await s.gestao(), body: { situacao: 'aceita', resposta: 'Ok' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.situacao, 'aceita');
    assert.equal(ok.body.resposta, 'Ok');
    assert.ok(ok.body.analisado_em);

    const freq = await s.api('/api/frequencias', { token: aluno.token });
    const registro = freq.body.find((f) => f.id_disciplina === primeira.id_disciplina && f.data_aula === primeira.data_falta);
    assert.deepEqual(registro.justificativa, { situacao: 'aceita' });
    assert.ok(freq.body.filter((f) => f.presente === 1 || f.presente === true).every((f) => f.justificativa === null));
});

test('métodos não suportados → 405', async () => {
    assert.equal((await s.api('/api/justificativas', { method: 'DELETE', token: aluno.token })).status, 405);
    assert.equal((await s.api('/api/justificativas/1', { method: 'GET', token: aluno.token })).status, 405);
});
