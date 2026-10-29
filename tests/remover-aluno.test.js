const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { usarServidor, ARQUIVOS } = require('./helpers/servidor');

const s = usarServidor();

function contar(sql, ...params) {
    return s.db.prepare(sql).get(...params).n;
}

// Histórico completo de um aluno: frequência, entrega, justificativa com atestado (arquivo em
// disco), ocorrência, leitura/salvo em pasta, conversa com mensagem e e-mail silenciado.
function criarHistorico(aluno, outroUsuario) {
    const disciplina = s.db.prepare('SELECT id_disciplina FROM disciplinas WHERE id_turma = ? LIMIT 1')
        .get(aluno.id_turma).id_disciplina;
    const gestaoId = s.db.prepare('SELECT id_usuario FROM usuarios WHERE login = ?')
        .get(s.contas.gestao.login).id_usuario;
    s.db.prepare(`
        INSERT INTO frequencias (id_aluno, id_disciplina, id_usuario_registro, data_aula, presente)
        VALUES (?, ?, ?, '2001-02-05', 0)
    `).run(aluno.id_aluno, disciplina, gestaoId);
    const atividade = Number(s.db.prepare(`
        INSERT INTO atividades (titulo, descricao, id_turma, id_disciplina, id_usuario_autor)
        VALUES ('Trabalho', 'Descrição', ?, ?, ?)
    `).run(aluno.id_turma, disciplina, gestaoId).lastInsertRowid);
    s.db.prepare('INSERT INTO entregas_atividades (id_atividade, id_aluno, resposta) VALUES (?, ?, ?)')
        .run(atividade, aluno.id_aluno, 'Minha resposta');
    const arquivo = Number(s.db.prepare(`
        INSERT INTO arquivos (id_usuario, nome, tipo_mime, tamanho, sha256)
        VALUES (?, 'atestado.pdf', 'application/pdf', ?, 'x')
    `).run(aluno.id_usuario, ARQUIVOS.pdf.length).lastInsertRowid);
    mkdirSync(path.join(s.dir, 'arquivos'), { recursive: true });
    const caminho = path.join(s.dir, 'arquivos', String(arquivo));
    writeFileSync(caminho, ARQUIVOS.pdf);
    s.db.prepare(`
        INSERT INTO justificativas (id_aluno, id_disciplina, data_falta, motivo, id_arquivo)
        VALUES (?, ?, '2001-02-05', 'Consulta', ?)
    `).run(aluno.id_aluno, disciplina, arquivo);
    s.db.prepare('INSERT INTO ocorrencias (id_aluno, id_usuario_autor, descricao) VALUES (?, ?, ?)')
        .run(aluno.id_aluno, gestaoId, 'Atraso');
    const pasta = Number(s.db.prepare("INSERT INTO pastas (id_usuario, nome) VALUES (?, 'Provas')")
        .run(aluno.id_usuario).lastInsertRowid);
    const post = s.db.prepare('SELECT id_post FROM posts_avisos LIMIT 1').get().id_post;
    s.db.prepare(`
        INSERT INTO avisos_usuarios (id_post, id_usuario, lido_em, salvo_em, id_pasta)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
    `).run(post, aluno.id_usuario, pasta);
    const [a, b] = [aluno.id_usuario, outroUsuario].sort((x, y) => x - y);
    const conversa = Number(s.db.prepare('INSERT INTO conversas (id_usuario_a, id_usuario_b) VALUES (?, ?)')
        .run(a, b).lastInsertRowid);
    s.db.prepare('INSERT INTO mensagens (id_conversa, id_autor, texto) VALUES (?, ?, ?)')
        .run(conversa, aluno.id_usuario, 'Oi');
    s.db.prepare("INSERT INTO notificacoes_silenciadas (id_usuario, tipo) VALUES (?, 'mensagens')")
        .run(aluno.id_usuario);
    return { arquivo, caminho, conversa };
}

test('DELETE /api/alunos/:id: só a gestão', async () => {
    const aluno = await s.alunoPronto(0);
    const professor = await s.professor();
    for (const token of [aluno.token, professor]) {
        const r = await s.api(`/api/alunos/${aluno.id_aluno}`, { method: 'DELETE', token });
        assert.equal(r.status, 403, r.text);
    }
    assert.equal((await s.api(`/api/alunos/${aluno.id_aluno}`, { method: 'DELETE' })).status, 401);
    assert.equal(contar('SELECT COUNT(*) AS n FROM alunos WHERE id_aluno = ?', aluno.id_aluno), 1);
});

test('remove a conta em cascata, apaga o atestado e libera a matrícula; auditoria sem nome', async () => {
    const gestao = await s.gestao();
    const aluno = await s.alunoPronto(2);
    const outro = await s.alunoPronto(3);
    const { arquivo, caminho, conversa } = criarHistorico(aluno, outro.id_usuario);
    assert.ok(existsSync(caminho));

    const r = await s.api(`/api/alunos/${aluno.id_aluno}`, { method: 'DELETE', token: gestao });
    assert.equal(r.status, 204, r.text);

    const restos = {
        usuarios: ['SELECT COUNT(*) AS n FROM usuarios WHERE id_usuario = ?', aluno.id_usuario],
        alunos: ['SELECT COUNT(*) AS n FROM alunos WHERE id_aluno = ?', aluno.id_aluno],
        sessoes: ['SELECT COUNT(*) AS n FROM sessoes WHERE id_usuario = ?', aluno.id_usuario],
        frequencias: ['SELECT COUNT(*) AS n FROM frequencias WHERE id_aluno = ?', aluno.id_aluno],
        entregas: ['SELECT COUNT(*) AS n FROM entregas_atividades WHERE id_aluno = ?', aluno.id_aluno],
        justificativas: ['SELECT COUNT(*) AS n FROM justificativas WHERE id_aluno = ?', aluno.id_aluno],
        ocorrencias: ['SELECT COUNT(*) AS n FROM ocorrencias WHERE id_aluno = ?', aluno.id_aluno],
        arquivos: ['SELECT COUNT(*) AS n FROM arquivos WHERE id_arquivo = ?', arquivo],
        leituras: ['SELECT COUNT(*) AS n FROM avisos_usuarios WHERE id_usuario = ?', aluno.id_usuario],
        pastas: ['SELECT COUNT(*) AS n FROM pastas WHERE id_usuario = ?', aluno.id_usuario],
        conversas: ['SELECT COUNT(*) AS n FROM conversas WHERE id_conversa = ?', conversa],
        mensagens: ['SELECT COUNT(*) AS n FROM mensagens WHERE id_conversa = ?', conversa],
        silenciadas: ['SELECT COUNT(*) AS n FROM notificacoes_silenciadas WHERE id_usuario = ?', aluno.id_usuario]
    };
    for (const [nome, [sql, id]] of Object.entries(restos)) {
        assert.equal(contar(sql, id), 0, `sobrou registro em ${nome}`);
    }
    assert.equal(existsSync(caminho), false, 'o atestado sai do disco');
    assert.equal((await s.api('/api/me', { token: aluno.token })).status, 401, 'sessão encerrada');
    assert.equal(contar('SELECT COUNT(*) AS n FROM usuarios WHERE id_usuario = ?', outro.id_usuario), 1);

    const auditoria = s.db.prepare(
        "SELECT alvo FROM auditoria WHERE acao = 'aluno.remover' ORDER BY id_auditoria DESC LIMIT 1"
    ).get();
    assert.equal(auditoria.alvo, `matricula:${aluno.matricula}`);
    assert.ok(!auditoria.alvo.includes(aluno.nome));

    assert.equal((await s.api(`/api/alunos/${aluno.id_aluno}`, { method: 'DELETE', token: gestao })).status, 404);

    // A matrícula fica livre para um novo cadastro.
    const novo = await s.api('/api/matriculas', {
        method: 'POST', token: gestao,
        body: { matricula: aluno.matricula, nome: 'Recadastro', id_turma: aluno.id_turma, cpf_inicio: '1234' }
    });
    assert.equal(novo.status, 201, novo.text);
    assert.equal(novo.body.matricula, aluno.matricula);
});

test('conta de acesso da sala é recusada (400); id inválido 400; inexistente 404', async () => {
    const gestao = await s.gestao();
    const turma = s.db.prepare("SELECT id_turma FROM turmas WHERE nome_turma = '1ª Série — Informática A'").get()
        ?? s.db.prepare('SELECT id_turma FROM turmas WHERE curso IS NOT NULL ORDER BY id_turma LIMIT 1').get();
    const criada = await s.api(`/api/turmas/${turma.id_turma}/senha`, {
        method: 'PUT', token: gestao, body: { senha: 'Senha-da-turma-teste' }
    });
    assert.equal(criada.status, 201, criada.text);
    const sala = s.db.prepare(`
        SELECT a.id_aluno FROM alunos a JOIN usuarios u ON u.id_usuario = a.id_usuario WHERE u.login = ?
    `).get(`turma-${turma.id_turma}`);
    const r = await s.api(`/api/alunos/${sala.id_aluno}`, { method: 'DELETE', token: gestao });
    assert.equal(r.status, 400, r.text);
    assert.equal(contar('SELECT COUNT(*) AS n FROM alunos WHERE id_aluno = ?', sala.id_aluno), 1);

    assert.equal((await s.api('/api/alunos/abc', { method: 'DELETE', token: gestao })).status, 400);
    assert.equal((await s.api('/api/alunos/999999', { method: 'DELETE', token: gestao })).status, 404);
});
