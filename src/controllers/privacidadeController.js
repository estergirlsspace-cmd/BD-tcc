const database = require('../database');
const { ApiError } = require('../errors');
const { readBody, sendJson } = require('../utils/http');
const { registrar } = require('../services/auditoria');
const { TERMOS_VERSAO, termosPendentes } = require('../utils/termos');

// LGPD: aceite dos termos e exportação dos dados do próprio usuário (art. 18, II e V).
//   GET  /api/privacidade/termos     → versão vigente e situação do aceite
//   POST /api/privacidade/aceite     → grava usuarios.termos_aceitos_em
//   GET  /api/privacidade/meus-dados → JSON com todos os dados da pessoa (registrado na auditoria)


function termsStatus(userId) {
    const row = database.prepare('SELECT termos_aceitos_em FROM usuarios WHERE id_usuario = ?')
        .get(userId);
    const acceptedAt = row?.termos_aceitos_em || null;
    return {
        versao: TERMOS_VERSAO,
        aceitos_em: acceptedAt,
        pendente: termosPendentes(acceptedAt)
    };
}

async function acceptTerms(request, response, user) {
    const body = await readBody(request);
    if (Object.keys(body).some((field) => field !== 'versao')) {
        throw new ApiError(400, 'Use somente o campo "versao".');
    }
    if (body.versao !== undefined && body.versao !== TERMOS_VERSAO) {
        throw new ApiError(409, 'Os termos foram atualizados. Recarregue a página e leia a nova versão.');
    }
    database.prepare('UPDATE usuarios SET termos_aceitos_em = CURRENT_TIMESTAMP WHERE id_usuario = ?')
        .run(user.id_usuario);
    registrar(user, 'privacidade.aceitar', `termos:${TERMOS_VERSAO}`);
    sendJson(response, 200, termsStatus(user.id_usuario));
}

const all = (sql, ...params) => database.prepare(sql).all(...params);
const get = (sql, ...params) => database.prepare(sql).get(...params);

function studentData(studentId) {
    return {
        frequencias: all(`
            SELECT d.nome_disciplina AS disciplina, f.data_aula, f.presente = 1 AS presente,
                   f.observacao, f.criado_em AS registrado_em
            FROM frequencias f JOIN disciplinas d ON d.id_disciplina = f.id_disciplina
            WHERE f.id_aluno = ? ORDER BY f.data_aula, d.nome_disciplina
        `, studentId).map((row) => ({ ...row, presente: row.presente === 1 })),
        entregas: all(`
            SELECT at.titulo AS atividade, d.nome_disciplina AS disciplina, e.resposta,
                   e.enviado_em, e.nota, e.feedback, arq.nome AS anexo_nome, arq.tipo_mime AS anexo_tipo
            FROM entregas_atividades e
            JOIN atividades at ON at.id_atividade = e.id_atividade
            JOIN disciplinas d ON d.id_disciplina = at.id_disciplina
            LEFT JOIN arquivos arq ON arq.id_arquivo = e.id_arquivo
            WHERE e.id_aluno = ? ORDER BY e.enviado_em
        `, studentId),
        justificativas: all(`
            SELECT d.nome_disciplina AS disciplina, j.data_falta, j.motivo, j.situacao, j.resposta,
                   j.analisado_em, j.criado_em, arq.nome AS anexo_nome, arq.tipo_mime AS anexo_tipo
            FROM justificativas j
            JOIN disciplinas d ON d.id_disciplina = j.id_disciplina
            LEFT JOIN arquivos arq ON arq.id_arquivo = j.id_arquivo
            WHERE j.id_aluno = ? ORDER BY j.data_falta
        `, studentId),
        // Ocorrências sobre a pessoa: como no portal do aluno, mostra o perfil do autor, sem o nome.
        ocorrencias: all(`
            SELECT o.descricao, o.situacao, o.criado_em, o.resolvida_em,
                   u.tipo_usuario AS registrada_por_perfil
            FROM ocorrencias o JOIN usuarios u ON u.id_usuario = o.id_usuario_autor
            WHERE o.id_aluno = ? ORDER BY o.criado_em
        `, studentId)
    };
}

function staffData(userId, teacherId) {
    return {
        disciplinas: teacherId ? all(`
            SELECT d.nome_disciplina AS disciplina, t.nome_turma AS turma
            FROM disciplinas d JOIN turmas t ON t.id_turma = d.id_turma
            WHERE d.id_professor = ? ORDER BY t.nome_turma, d.nome_disciplina
        `, teacherId) : [],
        avisos_publicados: all(`
            SELECT titulo, tipo, criado_em FROM posts_avisos
            WHERE id_usuario_autor = ? ORDER BY criado_em
        `, userId),
        atividades_publicadas: all(`
            SELECT titulo, tipo, prazo, criado_em FROM atividades
            WHERE id_usuario_autor = ? ORDER BY criado_em
        `, userId)
    };
}

function messages(userId) {
    return all(`
        SELECT m.id_conversa, CASE WHEN m.id_autor = ? THEN 'enviada' ELSE 'recebida' END AS direcao,
               COALESCE(al.nome, p.nome, o.nome, o.login) AS outra_pessoa,
               o.tipo_usuario AS outra_pessoa_perfil, m.texto, m.criado_em, m.lida_em
        FROM mensagens m
        JOIN conversas c ON c.id_conversa = m.id_conversa
        JOIN usuarios o ON o.id_usuario = CASE WHEN c.id_usuario_a = ? THEN c.id_usuario_b
                                                ELSE c.id_usuario_a END
        LEFT JOIN alunos al ON al.id_usuario = o.id_usuario
        LEFT JOIN professores p ON p.id_usuario = o.id_usuario
        WHERE c.id_usuario_a = ? OR c.id_usuario_b = ?
        ORDER BY m.id_conversa, m.id_mensagem
    `, userId, userId, userId, userId);
}

function myData(user) {
    const userId = user.id_usuario;
    const account = get(`
        SELECT u.id_usuario, u.login, COALESCE(a.nome, p.nome, u.nome) AS nome, u.tipo_usuario,
               u.curso, u.serie, u.email, u.ativo = 1 AS ativo, u.termos_aceitos_em
        FROM usuarios u
        LEFT JOIN alunos a ON a.id_usuario = u.id_usuario
        LEFT JOIN professores p ON p.id_usuario = u.id_usuario
        WHERE u.id_usuario = ?
    `, userId);
    const enrollment = user.id_aluno ? get(`
        SELECT a.id_aluno, u.login AS matricula, a.nome, t.nome_turma AS turma, t.curso, t.serie
        FROM alunos a JOIN usuarios u ON u.id_usuario = a.id_usuario
        LEFT JOIN turmas t ON t.id_turma = a.id_turma
        WHERE a.id_aluno = ?
    `, user.id_aluno) : null;
    const teacher = user.id_professor
        ? get('SELECT id_professor, nome, area FROM professores WHERE id_professor = ?', user.id_professor)
        : null;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const toIso = (seconds) => (seconds ? new Date(seconds * 1000).toISOString() : null);

    return {
        sobre_este_arquivo: {
            gerado_em: new Date().toISOString(),
            sistema: 'C-Warning — CEEP Lourdinha Guerra',
            descricao: 'Cópia dos seus dados pessoais guardados no C-Warning (art. 18 da LGPD). '
                + 'Datas sem fuso estão em UTC (horário de Brasília + 3 horas).',
            versao_termos: TERMOS_VERSAO
        },
        perfil: { ...account, ativo: account.ativo === 1 },
        matricula: enrollment,
        professor: teacher,
        ...(user.id_aluno ? studentData(user.id_aluno) : {}),
        ...(user.tipo_usuario !== 'aluno' ? staffData(userId, user.id_professor) : {}),
        mensagens: messages(userId),
        avisos: all(`
            SELECT p.titulo, au.lido_em, au.salvo_em
            FROM avisos_usuarios au JOIN posts_avisos p ON p.id_post = au.id_post
            WHERE au.id_usuario = ? ORDER BY COALESCE(au.lido_em, au.salvo_em)
        `, userId),
        arquivos_enviados: all(`
            SELECT nome, tipo_mime, tamanho, criado_em FROM arquivos
            WHERE id_usuario = ? ORDER BY criado_em
        `, userId),
        notificacoes_desligadas: all(
            'SELECT tipo FROM notificacoes_silenciadas WHERE id_usuario = ? ORDER BY tipo', userId
        ).map((row) => row.tipo),
        sessoes: all(`
            SELECT dispositivo, ultimo_acesso, expira_em FROM sessoes
            WHERE id_usuario = ? AND expira_em > ? ORDER BY ultimo_acesso DESC
        `, userId, nowSeconds).map((row) => ({
            dispositivo: row.dispositivo || 'Dispositivo desconhecido',
            ultimo_acesso: toIso(row.ultimo_acesso),
            expira_em: toIso(row.expira_em)
        })),
        registro_de_atividades: all(`
            SELECT acao, alvo, criado_em FROM auditoria
            WHERE id_usuario = ? ORDER BY id_auditoria
        `, userId)
    };
}

async function handlePrivacidadeRequest(request, response, user, parts) {
    const route = parts.length === 3 ? parts[2] : null;
    if (route === 'termos') {
        if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        sendJson(response, 200, termsStatus(user.id_usuario));
        return;
    }
    if (route === 'aceite') {
        if (request.method !== 'POST') throw new ApiError(405, 'Método não permitido.');
        await acceptTerms(request, response, user);
        return;
    }
    if (route === 'meus-dados') {
        if (request.method !== 'GET') throw new ApiError(405, 'Método não permitido.');
        const data = myData(user);
        registrar(user, 'privacidade.exportar', `usuario:${user.id_usuario}`);
        sendJson(response, 200, data);
        return;
    }
    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handlePrivacidadeRequest, TERMOS_VERSAO };
