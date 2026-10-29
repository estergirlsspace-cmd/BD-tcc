// Portal da Gestão (C·Warning) — casca da aplicação.
// Página única com navegação por hash (#/secao/sub): menu lateral escuro no web; no celular
// (≤ 650px) o mesmo menu vira um bloco no topo com os botões em linha, como no protótipo.
// Cada seção vive em gestao-*.js e se registra em CwGestao.sections.

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$ } = G;

// Sobretítulo de cada seção (protótipo .eyebrow).
const EYEBROWS = {
    'visao-geral': 'Painel institucional',
    turmas: 'Organização escolar',
    alunos: 'Organização escolar',
    avisos: 'Central de comunicados',
    ocorrencias: 'Acompanhamento',
    justificativas: 'Acompanhamento',
    relatorios: 'Acompanhamento',
    equipe: 'Organização institucional',
    configuracoes: 'Minha conta'
};

// Fontes carregadas logo na entrada (usadas por várias telas).
const CORE_SOURCES = ['turmas', 'disciplinas', 'avisos', 'usuarios', 'alunos', 'professores'];

// ---------------------------------------------------------------- inicialização

async function initialize() {
    if (!G.token) {
        G.leaveToLogin();
        return;
    }
    try {
        G.state.user = await G.api('/api/me');
    } catch (error) {
        showFatalError(error.message);
        return;
    }
    if (G.state.user.tipo_usuario !== 'gestao' || G.state.user.deve_trocar_senha) {
        G.leaveToLogin();
        return;
    }
    // LGPD: sem o aceite dos termos, volta para a entrada (que retoma a etapa de aceite com esta sessão).
    if (G.state.user.termos_pendentes) {
        window.location.replace('/');
        return;
    }

    fillUser();
    Object.values(G.sections).forEach((section) => section.setup?.());
    $$('[data-sair]').forEach((trigger) => trigger.addEventListener('click', () => logout(trigger)));
    window.addEventListener('hashchange', () => {
        const route = parseHash();
        if (route) applyRoute(route, { focus: true });
    });
    applyRoute(parseHash() || { section: 'visao-geral', sub: null }, { focus: false });

    G.ensureSource('painel');
    await Promise.all(CORE_SOURCES.map((name) => G.loadSource(name)));
}

function showFatalError(message) {
    $('#titulo-pagina').textContent = 'Portal da Gestão';
    const main = $('#conteudo');
    main.replaceChildren(G.errorState(message, () => window.location.reload()));
}

function fillUser() {
    const user = G.state.user;
    const name = user.nome || user.login || 'Gestão';
    $$('[data-nome-usuario]').forEach((node) => { node.textContent = name; });
    $$('[data-login-usuario]').forEach((node) => { node.textContent = user.login ? `Gestão · ${user.login}` : 'Gestão escolar'; });
    $$('[data-avatar]').forEach((node) => { node.textContent = G.avatarInitials(name); });
}

async function logout(trigger) {
    trigger.disabled = true;
    try {
        await G.api('/api/auth/logout', { method: 'POST' });
    } catch {
        // A sessão local é encerrada mesmo se o servidor não responder.
    }
    // Saída voluntária: sem aviso de "sessão expirou" nem rota para voltar.
    try {
        sessionStorage.removeItem('cw-motivo');
        sessionStorage.removeItem('cw-voltar');
    } catch { /* armazenamento indisponível */ }
    G.leaveToLogin();
}

// ---------------------------------------------------------------- rotas

// Só hashes de rota (#/...) navegam; âncoras como #conteudo (pular para o conteúdo) não.
function parseHash() {
    const hash = window.location.hash;
    if (hash && !hash.startsWith('#/')) return null;
    const [section, sub] = window.location.hash.replace(/^#\/?/, '').split('/');
    return { section: G.sections[section] ? section : 'visao-geral', sub: sub || null };
}

function applyRoute(route, { focus }) {
    const previous = G.state.route.section;
    if (previous !== route.section) G.sections[previous]?.hide?.();
    G.state.route = route;
    const section = G.sections[route.section];

    $$('.secao').forEach((node) => { node.hidden = node.dataset.pagina !== route.section; });
    $('#titulo-pagina').textContent = section.title;
    $('#descricao-pagina').textContent = section.description || '';
    $('#sobretitulo-pagina').textContent = EYEBROWS[route.section] || 'Painel institucional';
    document.title = `${section.title} · Portal da Gestão · C·Warning`;
    document.body.dataset.secao = route.section;

    $$('[data-secao]').forEach((link) => setCurrent(link, link.dataset.secao === route.section));
    // No celular o menu rola na horizontal: mantém o item atual à vista.
    $$('.menu [data-secao].ativo').forEach((link) => link.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));

    section.show?.(route.sub);
    if (focus) {
        window.scrollTo(0, 0);
        $('#conteudo').scrollTo?.(0, 0);
        $('#titulo-pagina').focus({ preventScroll: true });
    }
}

function setCurrent(link, active) {
    link.classList.toggle('ativo', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
}

initialize();
}());
