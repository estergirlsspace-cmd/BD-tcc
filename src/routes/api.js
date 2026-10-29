const { ApiError } = require('../errors');
const resources = require('../resources');
const { sendJson } = require('../utils/http');
const { handleCollection, handleRecord } = require('../controllers/resourceController');
const { handleLogin, handleLogout } = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');
const { handleSchoolRequest } = require('../controllers/schoolController');
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
                '/api/carga-horaria'
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

    if (parts[1] === 'mural') {
        await handleMuralRequest(request, response, user, parts);
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
