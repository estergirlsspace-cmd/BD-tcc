const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usarServidor, dataEscola } = require('./helpers/servidor');

const s = usarServidor();

function linhas(r) {
    assert.equal(r.buffer.subarray(0, 3).toString('hex'), 'efbbbf', 'UTF-8 com BOM');
    const texto = r.text.slice(1);
    assert.ok(texto.endsWith('\r\n'));
    assert.ok(!/[^\r]\n/.test(texto), 'todas as quebras são CRLF');
    return texto.slice(0, -2).split('\r\n');
}

test('frequencia.csv: cabeçalhos HTTP, BOM, separador ;, CRLF e uma linha por aluno e disciplina', async () => {
    const r = await s.api('/api/relatorios/frequencia.csv', { token: await s.gestao() });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(r.headers.get('content-disposition'), `attachment; filename="frequencia-${dataEscola(0)}.csv"`);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const [cabecalho, ...dados] = linhas(r);
    assert.equal(cabecalho, 'Turma;Matrícula;Aluno;Disciplina;Aulas;Presenças;Faltas;Faltas justificadas;Frequência (%)');
    assert.equal(dados.length, 36 * 4);
    const comAulas = dados.map((l) => l.split(';')).find((c) => c[4] === '5' && c[6] === '1');
    assert.equal(comAulas[8], '80', '4 de 5 → 80');
});

test('frequencia.csv: decimal com vírgula e faltas justificadas (só aceitas)', async () => {
    const aluno = s.alunoInfo(s.alunos[0].matricula);
    const prof = s.db.prepare('SELECT id_usuario FROM usuarios WHERE login = ?').get(s.contas.professor.login).id_usuario;
    // Disciplina 2: 3 aulas, 1 falta justificada (aceita) e 1 falta com justificativa recusada.
    const inserir = s.db.prepare(`INSERT INTO frequencias (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente)
        VALUES (?, 2, ?, ?, ?)`);
    inserir.run(aluno.id_aluno, prof, '2026-03-02', 1);
    inserir.run(aluno.id_aluno, prof, '2026-03-03', 0);
    inserir.run(aluno.id_aluno, prof, '2026-03-04', 0);
    const justificar = s.db.prepare(`INSERT INTO justificativas (id_aluno, id_disciplina, data_falta, motivo, situacao)
        VALUES (?, 2, ?, 'x', ?)`);
    justificar.run(aluno.id_aluno, '2026-03-03', 'aceita');
    justificar.run(aluno.id_aluno, '2026-03-04', 'recusada');

    const r = await s.api('/api/relatorios/frequencia.csv', { token: await s.gestao() });
    const linha = linhas(r).map((l) => l.split(';'))
        .find((c) => c[1] === s.alunos[0].matricula && c[3] === 'Banco de Dados');
    assert.deepEqual(linha.slice(4), ['3', '1', '2', '1', '33,3']);
});

test('CSV protege contra injeção de fórmula (= + - @) e escapa aspas e ;', async () => {
    const nomes = ['=HYPERLINK("http://x";"clique")', '+5511', '-2+3', '@SOMA(A1)', 'Ana; "Bia"'];
    const alunos = s.alunos.slice(1, 6).map((a) => s.alunoInfo(a.matricula));
    alunos.forEach((a, i) => s.db.prepare('UPDATE alunos SET nome = ? WHERE id_aluno = ?').run(nomes[i], a.id_aluno));

    const r = await s.api('/api/relatorios/frequencia.csv', { token: await s.gestao() });
    const texto = r.text;
    assert.ok(texto.includes(`;"'=HYPERLINK(""http://x"";""clique"")";`));
    assert.ok(texto.includes(";'+5511;"));
    assert.ok(texto.includes(";'-2+3;"));
    assert.ok(texto.includes(";'@SOMA(A1);"));
    assert.ok(texto.includes(';"Ana; ""Bia""";'));
    for (const linha of linhas(r).slice(1)) {
        assert.equal(linha.split(';').length >= 9, true);
    }
});

test('alunos-em-risco.csv: só quem está abaixo de 75%, do menor para o maior', async () => {
    const vazio = await s.api('/api/relatorios/alunos-em-risco.csv', { token: await s.gestao() });
    assert.equal(vazio.status, 200);
    const antes = linhas(vazio);
    assert.equal(antes[0], 'Turma;Matrícula;Aluno;Aulas;Faltas;Frequência (%);Ocorrências abertas');

    const emRisco = s.alunoInfo(s.alunos[12].matricula);
    const pior = s.alunoInfo(s.alunos[13].matricula);
    s.db.prepare(`UPDATE frequencias SET presente = 0 WHERE id_aluno = ? AND id_frequencia IN (
        SELECT id_frequencia FROM frequencias WHERE id_aluno = ? ORDER BY id_frequencia LIMIT 2)`).run(emRisco.id_aluno, emRisco.id_aluno);
    s.db.prepare('UPDATE frequencias SET presente = 0 WHERE id_aluno = ?').run(pior.id_aluno);

    const r = await s.api('/api/relatorios/alunos-em-risco.csv', { token: await s.gestao() });
    const dados = linhas(r).slice(1).map((l) => l.split(';'));
    const matriculas = dados.map((c) => c[1]);
    assert.ok(matriculas.includes(s.alunos[12].matricula));
    assert.ok(matriculas.includes(s.alunos[13].matricula));
    assert.ok(matriculas.indexOf(s.alunos[13].matricula) < matriculas.indexOf(s.alunos[12].matricula));
    const linhaPior = dados.find((c) => c[1] === s.alunos[13].matricula);
    assert.equal(linhaPior[5], '0');
    for (const c of dados) assert.ok(Number(c[5].replace(',', '.')) < 75);
});

test('relatórios: só a gestão (403); relatório inexistente 404; método 405', async () => {
    const aluno = await s.alunoPronto(20);
    assert.equal((await s.api('/api/relatorios/frequencia.csv', { token: await s.professor() })).status, 403);
    assert.equal((await s.api('/api/relatorios/alunos-em-risco.csv', { token: aluno.token })).status, 403);
    assert.equal((await s.api('/api/relatorios/frequencia.csv')).status, 401);
    assert.equal((await s.api('/api/relatorios/notas.csv', { token: await s.gestao() })).status, 404);
    assert.equal((await s.api('/api/relatorios/frequencia.csv', { method: 'POST', token: await s.gestao() })).status, 405);
});
