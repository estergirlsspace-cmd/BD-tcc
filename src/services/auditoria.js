// Registro de auditoria (LGPD art. 37): grava quem fez o quê sobre qual alvo.
// Nunca guarda conteúdo pessoal (senha, texto de mensagem, motivo), só a ação e o identificador.
// Uso: registrar(user, 'aluno.matricular', 'aluno:21').
const database = require('../database');

// Ações registradas e a descrição mostrada na tela de auditoria da gestão.
const ACOES = {
    'auth.login': 'Entrou no sistema',
    'senha.trocar': 'Trocou a própria senha',
    'senha.redefinir_link': 'Redefiniu a senha pelo link de e-mail',
    'senha.redefinir_aluno': 'Redefiniu a senha de um aluno',
    'senha.redefinir_equipe': 'Redefiniu a senha de professor ou gestão',
    'senha.redefinir_conta': 'Definiu a senha provisória de uma conta',
    'aluno.matricular': 'Matriculou um aluno',
    'aluno.importar': 'Importou alunos por planilha',
    'horario.publicar': 'Publicou ou substituiu um horário em PDF',
    'horario.remover': 'Removeu um horário em PDF',
    'conta.criar': 'Criou uma conta',
    'conta.excluir': 'Excluiu uma conta',
    'aluno.criar': 'Vinculou um aluno a uma turma',
    'aluno.excluir': 'Excluiu a matrícula de um aluno',
    'conta.desativar': 'Desativou uma conta',
    'conta.reativar': 'Reativou uma conta',
    'justificativa.analisar': 'Analisou uma justificativa de falta',
    'ocorrencia.registrar': 'Registrou uma ocorrência',
    'ocorrencia.resolver': 'Resolveu uma ocorrência',
    'atestado.baixar': 'Baixou um atestado',
    'relatorio.exportar': 'Exportou um relatório',
    'privacidade.aceitar': 'Aceitou os termos e a política de privacidade',
    'privacidade.exportar': 'Baixou os próprios dados',
    'email.alterar': 'Confirmou um e-mail novo na conta',
    'email.alterar_sem_aviso': 'Trocou o e-mail sem aviso ao endereço anterior (sem modelo de e-mail)',
    'email.remover': 'Removeu o e-mail da conta'
};

const ACAO_PATTERN = /^[a-z_]+\.[a-z_]+$/;
const ALVO_PATTERN = /^[a-z_]+:[A-Za-z0-9._-]{1,60}$/;

// Nunca interrompe a ação principal: uma falha ao auditar só vai para o log (sem dados pessoais).
function registrar(user, acao, alvo = null) {
    try {
        if (!ACAO_PATTERN.test(acao)) throw new Error(`ação inválida "${acao}"`);
        if (alvo !== null && !ALVO_PATTERN.test(alvo)) throw new Error(`alvo inválido na ação "${acao}"`);
        const userId = Number.isSafeInteger(user?.id_usuario) ? user.id_usuario : null;
        database.prepare('INSERT INTO auditoria (id_usuario, acao, alvo) VALUES (?, ?, ?)')
            .run(userId, acao, alvo);
    } catch (error) {
        console.error(`[auditoria] não foi possível registrar: ${error.message}`);
    }
}

module.exports = { registrar, ACOES };
