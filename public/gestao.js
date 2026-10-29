// Portal da Gestão (C·Warning) — casca da aplicação.
// Página única com navegação por hash (#/secao/sub): sidebar índigo no web e abas inferiores no
// celular (< 900px). Cada seção vive em gestao-*.js e se registra em CwGestao.sections.
// Mensagens usa o componente compartilhado CwMensagens (public/componentes/mensagens.js).

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$, el, icon } = G;

const UNREAD_POLL_MS = 30000;
const MOBILE_TABS = ['visao-geral', 'avisos', 'alunos', 'mensagens'];
const MORE_SECTIONS = ['turmas', 'ocorrencias', 'justificativas', 'relatorios', 'equipe', 'configuracoes', 'mais'];

// Fontes carregadas logo na entrada (usadas por várias telas).
const CORE_SOURCES = ['turmas', 'disciplinas', 'avisos', 'usuarios', 'alunos', 'professores'];

let messagesPanel = null;
let unreadTimer = null;

G.sections.mensagens = {
    title: 'Mensagens',
    description: 'Converse com alunos, professores e a equipe.',
    show: mountMessages,
    hide: unmountMessages
};

G.sections.mais = {
    title: 'Mais',
    description: 'Outras seções do portal.'
};

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
    startUnreadPolling();
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
    document.title = `${section.title} · Portal da Gestão · C·Warning`;
    document.body.dataset.secao = route.section;

    $$('[data-secao]').forEach((link) => setCurrent(link, link.dataset.secao === route.section));
    const tab = MOBILE_TABS.includes(route.section) ? route.section : MORE_SECTIONS.includes(route.section) ? 'mais' : null;
    $$('[data-aba]').forEach((link) => setCurrent(link, link.dataset.aba === tab));

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

// ---------------------------------------------------------------- mensagens

// O componente é montado ao abrir a seção e desmontado ao sair (para o polling da conversa).
function mountMessages() {
    if (messagesPanel) return;
    const container = $('#mensagens');
    if (!window.CwMensagens?.montar) {
        container.replaceChildren(el('div', { class: 'estado-vazio estado-em-breve' },
            icon('chat-circle-dots'),
            el('p', { class: 'estado-titulo', text: 'Mensagens em breve' }),
            el('p', { text: 'A troca de mensagens com alunos e professores está chegando ao portal.' })));
        return;
    }
    try {
        messagesPanel = window.CwMensagens.montar(container, {
            api: G.api,
            usuario: G.state.user,
            aoMudarNaoLidas: setUnread
        }) || {};
    } catch (error) {
        messagesPanel = null;
        container.replaceChildren(G.errorState('Não foi possível abrir as mensagens.', () => mountMessages()));
        console.error(error);
    }
}

G.setUnread = setUnread;

function unmountMessages() {
    messagesPanel?.desmontar?.();
    messagesPanel = null;
}

function setUnread(total) {
    const number = Number(total) || 0;
    G.state.unreadMessages = number;
    $$('[data-contador="mensagens"]').forEach((node) => {
        node.hidden = !number;
        node.textContent = number > 99 ? '99+' : String(number);
        node.setAttribute('aria-label', `${number} não lida(s)`);
    });
    $$('[data-ponto-mensagens]').forEach((node) => { node.hidden = !number; });
}

// Badge de não lidas: polling a cada 30 s só com a aba visível; para se a API não existir.
function startUnreadPolling() {
    const poll = async () => {
        if (document.visibilityState !== 'visible') return;
        try {
            const result = await G.api('/api/mensagens/nao-lidas');
            setUnread(result?.total);
        } catch (error) {
            if ([403, 404, 501].includes(error.status)) {
                clearInterval(unreadTimer);
                unreadTimer = null;
            }
        }
    };
    poll();
    unreadTimer = setInterval(poll, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', () => {
        if (unreadTimer && document.visibilityState === 'visible') poll();
    });
}

// Ponto na aba "Mais" quando há pendências nas seções que ficam lá (celular).
G.updateMoreDot = () => {
    const pending = $$('.lista-mais [data-contador]').some((node) => !node.hidden);
    $$('[data-ponto-mais]').forEach((node) => { node.hidden = !pending; });
};

initialize();
}());
