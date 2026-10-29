const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statSync } = require('node:fs');
const path = require('node:path');
const { usarServidor, ARQUIVOS } = require('./helpers/servidor');

const s = usarServidor();

function enviar(token, conteudo, { tipo = 'application/pdf', nome = 'atestado.pdf', headers = {} } = {}) {
    const finais = { 'content-type': tipo, ...headers };
    if (nome !== null) finais['x-nome-arquivo'] = encodeURIComponent(nome);
    return s.api('/api/arquivos', { method: 'POST', token, body: conteudo, headers: finais });
}

test('upload de PDF, PNG e JPG: 201, tipo pela assinatura, arquivo 600 no disco', async () => {
    const aluno = await s.alunoPronto(0);
    const pdf = await enviar(aluno.token, ARQUIVOS.pdf, { nome: 'Atestado médico.pdf' });
    assert.equal(pdf.status, 201, pdf.text);
    assert.deepEqual(Object.keys(pdf.body).sort(), ['id_arquivo', 'nome', 'tamanho', 'tipo_mime']);
    assert.equal(pdf.body.tipo_mime, 'application/pdf');
    assert.equal(pdf.body.nome, 'Atestado médico.pdf');
    assert.equal(pdf.body.tamanho, ARQUIVOS.pdf.length);
    const modo = statSync(path.join(s.dir, 'arquivos', String(pdf.body.id_arquivo))).mode & 0o777;
    assert.equal(modo, 0o600);

    // Tipo declarado diferente do real: vale o conteúdo.
    const png = await enviar(aluno.token, ARQUIVOS.png, { tipo: 'image/jpeg', nome: 'foto.jpg' });
    assert.equal(png.status, 201);
    assert.equal(png.body.tipo_mime, 'image/png');
    assert.equal(png.body.nome, 'foto.jpg.png');
    const jpg = await enviar(aluno.token, ARQUIVOS.jpg, { tipo: 'image/jpeg', nome: 'foto.jpeg' });
    assert.equal(jpg.body.tipo_mime, 'image/jpeg');
});

test('nome do arquivo é saneado (caminho, controle, extensão enganosa)', async () => {
    const token = await s.gestao();
    const casos = [
        ['../../etc/passwd', '_.._etc_passwd.pdf'],
        ['nota.exe', 'nota.exe.pdf'],
        ['rel‮fdp.exe', 'relfdp.exe.pdf'],
        ['   ', 'arquivo.pdf']
    ];
    for (const [nome, esperado] of casos) {
        const r = await enviar(token, ARQUIVOS.pdf, { nome });
        assert.equal(r.status, 201, nome);
        assert.equal(r.body.nome, esperado, nome);
    }
});

test('upload: tipo declarado não aceito ou conteúdo falso → 415', async () => {
    const token = await s.gestao();
    assert.equal((await enviar(token, ARQUIVOS.pdf, { tipo: 'text/plain' })).status, 415);
    assert.equal((await enviar(token, ARQUIVOS.pdf, { tipo: 'application/json' })).status, 415);
    assert.equal((await enviar(token, Buffer.from('<html>oi</html>'), { tipo: 'application/pdf' })).status, 415);
    assert.equal((await enviar(token, Buffer.from('%PDF-'), { tipo: 'application/pdf' })).status, 415,
        'só a assinatura, sem conteúdo');
});

test('upload: sem nome, nome mal codificado ou corpo vazio → 400', async () => {
    const token = await s.gestao();
    assert.equal((await enviar(token, ARQUIVOS.pdf, { nome: null })).status, 400);
    assert.equal((await enviar(token, ARQUIVOS.pdf, { nome: null, headers: { 'x-nome-arquivo': '%E0%A4%A' } })).status, 400);
    assert.equal((await enviar(token, Buffer.alloc(0))).status, 400);
});

test('upload acima de 5 MB → 413', async () => {
    const token = await s.gestao();
    const grande = Buffer.concat([ARQUIVOS.pdf, Buffer.alloc(5 * 1024 * 1024)]);
    const r = await enviar(token, grande);
    assert.equal(r.status, 413);
});

test('upload exige login (401) e método certo (405)', async () => {
    assert.equal((await enviar(undefined, ARQUIVOS.pdf)).status, 401);
    assert.equal((await s.api('/api/arquivos', { token: await s.gestao() })).status, 405);
});

test('download: cabeçalhos de segurança e conteúdo íntegro', async () => {
    const token = await s.gestao();
    const up = await enviar(token, ARQUIVOS.pdf, { nome: 'Relatório ção.pdf' });
    const r = await s.api(`/api/arquivos/${up.body.id_arquivo}`, { token });
    assert.equal(r.status, 200);
    assert.ok(r.buffer.equals(ARQUIVOS.pdf));
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="Relatorio cao\.pdf"; filename\*=UTF-8''Relat%C3%B3rio%20%C3%A7%C3%A3o\.pdf$/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('content-security-policy'), 'sandbox');
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
});

test('download: outro aluno recebe 404; dono e gestão baixam; id inválido 400', async () => {
    const dono = await s.alunoPronto(1);
    const outro = await s.alunoPronto(2);
    const up = await enviar(dono.token, ARQUIVOS.png, { tipo: 'image/png', nome: 'x.png' });
    const id = up.body.id_arquivo;
    assert.equal((await s.api(`/api/arquivos/${id}`, { token: dono.token })).status, 200);
    assert.equal((await s.api(`/api/arquivos/${id}`, { token: outro.token })).status, 404);
    assert.equal((await s.api(`/api/arquivos/${id}`, { token: await s.professor() })).status, 404);
    assert.equal((await s.api(`/api/arquivos/${id}`, { token: await s.gestao() })).status, 200);
    assert.equal((await s.api('/api/arquivos/999999', { token: await s.gestao() })).status, 404);
    assert.equal((await s.api('/api/arquivos/abc', { token: await s.gestao() })).status, 400);
});

test('anexo de aviso: quem vê o aviso baixa; aluno de outra turma recebe 404', async () => {
    const gestao = await s.gestao();
    const daTurma = await s.alunoPronto(0);
    const deOutra = await s.alunoPronto(6); // 2ª série
    assert.notEqual(daTurma.id_turma, deOutra.id_turma);
    const up = await enviar(gestao, ARQUIVOS.pdf, { nome: 'circular.pdf' });
    const aviso = await s.api('/api/avisos', {
        method: 'POST', token: gestao,
        body: { titulo: 'Circular', conteudo: 'Veja o anexo', id_turma: daTurma.id_turma, id_arquivo: up.body.id_arquivo }
    });
    assert.equal(aviso.status, 201);
    assert.deepEqual(aviso.body.anexo, up.body);
    const mural = await s.api('/api/mural', { token: daTurma.token });
    assert.deepEqual(mural.body.avisos.find((a) => a.id_post === aviso.body.id_post).anexo, up.body);
    assert.equal((await s.api(`/api/arquivos/${up.body.id_arquivo}`, { token: daTurma.token })).status, 200);
    assert.equal((await s.api(`/api/arquivos/${up.body.id_arquivo}`, { token: deOutra.token })).status, 404);
    assert.equal((await s.api(`/api/arquivos/${up.body.id_arquivo}`, { token: await s.professor() })).status, 200);
});

test('aviso só aceita anexo enviado por quem publica (400)', async () => {
    const aluno = await s.alunoPronto(3);
    const up = await enviar(aluno.token, ARQUIVOS.pdf);
    const r = await s.api('/api/avisos', {
        method: 'POST', token: await s.gestao(),
        body: { titulo: 'x', conteudo: 'y', id_turma: 1, id_arquivo: up.body.id_arquivo }
    });
    assert.equal(r.status, 400);
});

test('cota: no máximo 10 arquivos não vinculados por pessoa em 24 h (429)', async () => {
    const aluno = await s.alunoPronto(4);
    for (let i = 0; i < 10; i += 1) {
        assert.equal((await enviar(aluno.token, ARQUIVOS.pdf)).status, 201);
    }
    assert.equal((await enviar(aluno.token, ARQUIVOS.pdf)).status, 429);
});
