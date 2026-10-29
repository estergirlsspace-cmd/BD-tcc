const { ApiError } = require('../errors');
const resources = require('../resources');
const { sendJson } = require('../utils/http');
const { handleCollection, handleRecord } = require('../controllers/resourceController');
const { handleLogin, handleLogout } = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');
const { handleSchoolRequest } = require('../controllers/schoolController');
const { handleArquivosRequest } = require('../controllers/arquivosController');
const { handleJustificativasRequest } = require('../controllers/justificativasController');
const { handleOcorrenciasRequest } = require('../controllers/ocorrenciasController');
const { handleChamadasRequest } = require('../controllers/chamadasController');
const { handlePainelRequest } = require('../controllers/painelController');
const { handleMensagensRequest } = require('../controllers/mensagensController');
const { handleContaRequest, handlePublicAccountRequest } = require('../controllers/contaController');
const { handlePrivacidadeRequest } = require('../controllers/privacidadeController');
const { handleAuditoriaRequest } = require('../controllers/auditoriaController');
const { handleHorariosPdfRequest } = require('../controllers/horariosPdfController');
const { handlePastasRequest, handleSalvosRequest } = require('../controllers/salvosController');
const { handleImportacaoRequest } = require('../controllers/importacaoController');
const database = require('../database');

// Módulos por prefixo: /api/<prefixo>/... → handler(request, response, user, parts, searchParams).
const MODULE_ROUTES = {
    arquivos: handleArquivosRequest,
    justificativas: handleJustificativasRequest,
    ocorrencias: handleOcorrenciasRequest,
    chamadas: handleChamadasRequest,
    painel: handlePainelRequest,
    relatorios: handlePainelRequest,
    mensagens: handleMensagensRequest,
    conta: handleContaRequest,
    privacidade: handlePrivacidadeRequest,
    auditoria: handleAuditoriaRequest,
    'horarios-pdf': handleHorariosPdfRequest,
    pastas: handlePastasRequest,
    salvos: handleSalvosRequest
};
const { handleMuralRequest } = require('../controllers/muralController');

function authorizeResource(user, resourceName, method) {
    if (['usuarios', 'alunos', 'professores'].includes(resourceName)) {
        if (user.tipo_usuario === 'gestao'
            && ['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) return;
        throw new ApiError(403, 'Somente a gestão pode administrar usuários e matrículas.');
    }

    if (['turmas', 'disciplinas'].includes(resourceName)) {
        if (method === 'GET') return;
        if (user.tipo_usuario === 'gestao') return;
        throw new ApiError(403, 'Somente a gestão pode alterar turmas e disciplinas.');
    }

    if (resourceName === 'posts-avisos' && method === 'GET') {
        return;
    }

    if (resourceName === 'posts-avisos'
        && ['professor', 'gestao'].includes(user.tipo_usuario)
        && ['POST', 'PATCH', 'DELETE'].includes(method)) {
        return;
    }

    throw new ApiError(403, 'Seu perfil não tem permissão para esta operação.');
}

async function handleApiRequest(request, response) {
    // Base fixa: um cabeçalho Host malformado não pode derrubar a requisição.
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/' && request.method === 'GET') {
        sendJson(response, 200, {
            mensagem: 'API escolar em funcionamento.',
            recursos: [
                '/api/auth/login',
                '/api/auth/password',
                '/api/me',
                ...Object.keys(resources).map((name) => `/api/${name}`),
                '/api/matriculas',
                '/api/avisos',
                '/api/mural',
                '/api/horarios',
                '/api/atividades',
                '/api/frequencias',
                '/api/desempenho',
                '/api/carga-horaria',
                '/api/horarios-pdf',
                '/api/pastas',
                '/api/salvos'
            ]
        });
        return;
    }

    if (parts[0] !== 'api') {
        throw new ApiError(404, 'Rota não encontrada.');
    }

    if (parts[1] === 'auth' && parts.length === 3 && parts[2] === 'login'
        && request.method === 'POST') {
        await handleLogin(request, response);
        return;
    }

    // Verificação de saúde para o Dokploy/monitoramento: sem login e sem dados.
    if (parts[1] === 'saude' && parts.length === 2 && request.method === 'GET') {
        database.prepare('SELECT 1').get();
        sendJson(response, 200, { status: 'ok' });
        return;
    }

    if (await handlePublicAccountRequest(request, response, parts)) {
        return;
    }

    const user = authenticate(request);

    if (parts[1] === 'auth' && parts.length === 3 && parts[2] === 'logout'
        && request.method === 'POST') {
        await handleLogout(request, response, user);
        return;
    }

    const isPasswordRoute = parts[1] === 'auth' && parts[2] === 'password' && parts.length === 3;
    const isProfileRoute = parts[1] === 'me' && parts.length === 2;
    if (user.deve_trocar_senha && !isPasswordRoute && !isProfileRoute) {
        throw new ApiError(403, 'Crie sua nova senha antes de continuar.');
    }
    // LGPD: sem aceite dos termos, só perfil, troca de senha e as rotas de privacidade.
    const isPrivacyRoute = parts[1] === 'privacidade';
    if (user.termos_pendentes && !isPasswordRoute && !isProfileRoute && !isPrivacyRoute) {
        throw new ApiError(403, 'Aceite os termos de uso e a política de privacidade para continuar.');
    }

    if (MODULE_ROUTES[parts[1]]) {
        await MODULE_ROUTES[parts[1]](request, response, user, parts, url.searchParams);
        return;
    }

    if (parts[1] === 'mural') {
        await handleMuralRequest(request, response, user, parts);
        return;
    }

    if (parts[1] === 'matriculas' && parts[2] === 'importar') {
        await handleImportacaoRequest(request, response, user, parts, url.searchParams);
        return;
    }

    if (await handleSchoolRequest(request, response, user, parts, url.searchParams)) {
        return;
    }

    if (parts[1] === 'avisos') {
        parts[1] = 'posts-avisos';
    }

    if (!resources[parts[1]]) {
        throw new ApiError(404, 'Rota não encontrada.');
    }

    const resource = resources[parts[1]];
    authorizeResource(user, parts[1], request.method);
    if (parts.length === 2) {
        await handleCollection(request, response, resource, user);
        return;
    }

    if (parts.length === 3) {
        await handleRecord(request, response, resource, parts[2], user);
        return;
    }

    throw new ApiError(404, 'Rota não encontrada.');
}

module.exports = { handleApiRequest };
