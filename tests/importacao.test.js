const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { usarServidor, ROOT } = require('./helpers/servidor');

const s = usarServidor();
const TURMA = '1ª Série — Informática A';
const CPF_COMPLETO = '987.654.321-00';

function importar(token, csv, { simular = false, tipo = 'text/csv; charset=utf-8' } = {}) {
    return s.api(`/api/matriculas/importar${simular ? '?simular=1' : ''}`, {
        method: 'POST', token, body: csv, headers: { 'content-type': tipo }
    });
}

function contarAlunos() {
    return s.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE tipo_usuario = 'aluno'").get().n;
}

test('simular: relatório por linha, prévia dos válidos e nada gravado', async () => {
    const gestao = await s.gestao();
    const existente = s.alunos[0].matricula;
    const csv = [
        'Matrícula;Nome;TURMA;CPF;E-mail',
        `7000001;Ana Teste;${TURMA};1234;`,
        `7000002;Bruno Teste;1a serie - informatica;${CPF_COMPLETO};bruno.teste@example.com`,
        '7000001;Repetida;' + TURMA + ';1234;',
        `${existente};Já existe;${TURMA};1234;`,
        'abc;Sem número;' + TURMA + ';1234;',
        `7000003;;${TURMA};1234;`,
        `7000004;Turma errada;9ª Série;1234;`,
        `7000005;CPF ruim;${TURMA};12;`,
        `7000006;Email ruim;${TURMA};1234;nao-e-email`,
        `7000007;Email repetido;${TURMA};1234;BRUNO.teste@example.com`,
        `7000008;${'x'.repeat(151)};${TURMA};1234;`
    ].join('\r\n');
    const antes = contarAlunos();
    const r = await importar(gestao, csv, { simular: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.body).sort(), ['alunos', 'erros', 'total', 'validos']);
    assert.equal(r.body.total, 11);
    assert.equal(r.body.validos, 2);
    assert.deepEqual(r.body.alunos, [
        { linha: 2, matricula: '7000001', nome: 'Ana Teste', turma: TURMA },
        { linha: 3, matricula: '7000002', nome: 'Bruno Teste', turma: TURMA }
    ]);
    const por = (linha) => r.body.erros.filter((e) => e.linha === linha);
    assert.match(por(4)[0].mensagem, /repetida.*linha 2/);
    assert.equal(por(4)[0].campo, 'matricula');
    assert.match(por(5)[0].mensagem, /Já existe/);
    assert.equal(por(6)[0].campo, 'matricula');
    assert.equal(por(7)[0].campo, 'nome');
    assert.equal(por(8)[0].campo, 'turma');
    assert.match(por(8)[0].mensagem, /Turmas válidas: .*Informática/);
    assert.deepEqual(por(9), [{ linha: 9, campo: 'cpf', mensagem: 'CPF inválido na linha 9.' }]);
    assert.equal(por(10)[0].campo, 'email');
    assert.match(por(11)[0].mensagem, /repetido.*linha 3/);
    assert.equal(por(12)[0].campo, 'nome');
    assert.equal(contarAlunos(), antes, 'simular não grava');

    // Sem simular e com erros: 400 com o mesmo relatório, nada gravado.
    const real = await importar(gestao, csv);
    assert.equal(real.status, 400);
    assert.deepEqual(real.body, r.body);
    assert.equal(contarAlunos(), antes);
    assert.ok(!real.text.includes('987') && !real.text.includes(CPF_COMPLETO), 'CPF nunca volta');
});

test('importar: grava todos numa transação, senha inicial pelo CPF, e-mail pendente, auditoria', async () => {
    const gestao = await s.gestao();
    // Vírgula como separador, BOM, aspas com vírgula e quebra de linha no nome, LF.
    const csv = '﻿matricula,nome,turma,cpf,email\n'
        + `7100001,"Silva, Carla",${TURMA},${CPF_COMPLETO},carla.import@example.com\n`
        + `7100002,=HYPERLINK("x"),2ª Série — Redes,5555,\n`
        + '\n';
    const antes = contarAlunos();
    const r = await importar(gestao, csv);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.importados, 2);
    assert.equal(r.body.total, 2);
    assert.deepEqual(r.body.erros, []);
    assert.equal(contarAlunos(), antes + 2);

    const conta = s.db.prepare(`
        SELECT u.id_usuario, u.email, u.deve_trocar_senha, u.curso, u.serie, a.nome, t.nome_turma
        FROM usuarios u JOIN alunos a ON a.id_usuario = u.id_usuario JOIN turmas t ON t.id_turma = a.id_turma
        WHERE u.login = '7100001'
    `).get();
    assert.equal(conta.nome, 'Silva, Carla');
    assert.equal(conta.nome_turma, TURMA);
    assert.equal(conta.deve_trocar_senha, 1);
    assert.equal(conta.email, null, 'e-mail só depois de confirmado');
    assert.equal(conta.curso, 'informatica');
    assert.ok(s.db.prepare(
        "SELECT 1 FROM tokens WHERE id_usuario = ? AND finalidade = 'confirmar_email' AND dado = ?"
    ).get(conta.id_usuario, 'carla.import@example.com'));
    // Fórmula fica só como texto.
    assert.equal(s.db.prepare("SELECT a.nome FROM alunos a JOIN usuarios u USING (id_usuario) WHERE u.login = '7100002'").get().nome,
        '=HYPERLINK("x")');

    // Login com a senha inicial "ceep@" + 4 primeiros dígitos do CPF.
    const login = await s.api('/api/auth/login', { method: 'POST', body: { login: '7100001', senha: 'ceep@9876' } });
    assert.equal(login.status, 200, login.text);
    assert.equal((await s.api('/api/auth/login', { method: 'POST', body: { login: '7100002', senha: 'ceep@5555' } })).status, 200);

    const auditoria = s.db.prepare("SELECT alvo FROM auditoria WHERE acao = 'aluno.importar'").all();
    assert.deepEqual(auditoria.map((row) => row.alvo), ['lote:2']);

    // O CPF não fica no banco nem no log do servidor.
    const dump = JSON.stringify(s.db.prepare('SELECT * FROM usuarios').all())
        + JSON.stringify(s.db.prepare('SELECT * FROM alunos').all())
        + JSON.stringify(s.db.prepare('SELECT * FROM auditoria').all());
    assert.ok(!dump.includes('98765432100') && !dump.includes(CPF_COMPLETO));
    assert.ok(!s.log().includes(CPF_COMPLETO) && !s.log().includes('98765432100'));

    // Reimportar a mesma planilha: matrículas já existem.
    const deNovo = await importar(gestao, csv);
    assert.equal(deNovo.status, 400);
    assert.deepEqual(deNovo.body.erros.map((e) => e.campo), ['matricula', 'matricula'],
        'e-mail ainda pendente de confirmação não conta como em uso (igual à matrícula individual)');
});

test('cabeçalho: tab como separador; coluna faltando ou repetida vira erro da linha 1', async () => {
    const gestao = await s.gestao();
    const tab = await importar(gestao, `matricula\tnome\tturma\tcpf\n7200001\tTab Teste\t${TURMA}\t1111\n`, { simular: true });
    assert.equal(tab.status, 200);
    assert.equal(tab.body.validos, 1);

    const falta = await importar(gestao, `matricula;nome;turma\n7200002;X;${TURMA}\n`, { simular: true });
    assert.equal(falta.status, 200);
    assert.deepEqual(falta.body.erros, [{ linha: 1, campo: 'cabecalho', mensagem: 'Falta a coluna "cpf" no cabeçalho.' }]);
    assert.equal(falta.body.validos, 0);
    const semSimular = await importar(gestao, `matricula;nome;turma\n7200002;X;${TURMA}\n`);
    assert.equal(semSimular.status, 400);

    const repetida = await importar(gestao, 'cpf;matricula;nome;turma;CPF\n', { simular: true });
    assert.match(repetida.body.erros[0].mensagem, /mais de uma vez/);

    const vazia = await importar(gestao, 'matricula;nome;turma;cpf\r\n');
    assert.equal(vazia.status, 400);
    assert.match(vazia.body.erros[0].mensagem, /nenhum aluno/);

    const aspas = await importar(gestao, `matricula;nome;turma;cpf\n7200003;"sem fim;${TURMA};1234\n`);
    assert.equal(aspas.status, 400);
    assert.match(aspas.body.erro, /Aspas/);
});

test('limites e permissões: 403, 415, 413, 2.000 linhas, UTF-8', async () => {
    const gestao = await s.gestao();
    const csv = `matricula;nome;turma;cpf\n7300001;X;${TURMA};1234\n`;
    assert.equal((await importar(await s.professor(), csv)).status, 403);
    const aluno = await s.alunoPronto(1);
    assert.equal((await importar(aluno.token, csv)).status, 403);
    assert.equal((await importar(gestao, csv, { tipo: 'application/json' })).status, 415);
    assert.equal((await importar(undefined, csv)).status, 401);
    assert.equal((await s.api('/api/matriculas/importar', { token: gestao })).status, 405);

    const grande = 'matricula;nome;turma;cpf\n' + 'x'.repeat(1024 * 1024);
    assert.equal((await importar(gestao, grande)).status, 413);

    const linhas = ['matricula;nome;turma;cpf'];
    for (let i = 0; i < 2001; i += 1) linhas.push(`${8000000 + i};Aluno ${i};${TURMA};1234`);
    const muitas = await importar(gestao, linhas.join('\n'), { simular: true });
    assert.equal(muitas.status, 400);
    assert.match(muitas.body.erro, /2000/);

    const latin1 = Buffer.from(`matricula;nome;turma;cpf\n7300002;Jo\xe3o;${TURMA};1234\n`, 'latin1');
    const r = await importar(gestao, latin1, { simular: true });
    assert.equal(r.status, 400);
    assert.match(r.body.erro, /UTF-8/);

    assert.equal((await importar(gestao, csv, { simular: false })).status, 201);
    assert.equal((await s.api('/api/matriculas/importar?simular=talvez', {
        method: 'POST', token: gestao, body: csv, headers: { 'content-type': 'text/csv' }
    })).status, 400);
});

test('modelo public/modelos/alunos.csv é servido e passa na simulação', async () => {
    const r = await s.api('/modelos/alunos.csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /^text\/csv/);
    const local = readFileSync(path.join(ROOT, 'public', 'modelos', 'alunos.csv'));
    assert.ok(r.buffer.equals(local));
    const sim = await importar(await s.gestao(), r.buffer, { simular: true });
    assert.equal(sim.status, 200, sim.text);
    assert.equal(sim.body.total, 2);
    assert.deepEqual(sim.body.erros, []);
});
