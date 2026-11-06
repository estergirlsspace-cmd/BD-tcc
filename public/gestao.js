// Portal da Gestão (C-Warning) — casca da aplicação.
// Página única com navegação por hash (#/secao/sub): menu lateral marinho no web; no celular
// (≤ 650px) o mesmo menu vira um bloco no topo com os botões em linha. Faixa do topo com a
// busca geral (comunicados, turmas e alunos) e a identificação de quem está logado.
// Cada seção vive em gestao-*.js e se registra em CwGestao.sections.

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$ } = G;

// Sobretítulo de cada seção (protótipo .eyebrow).
const EYEBROWS = {
    'visao-geral': 'Painel institucional',
    avisos: 'Painel institucional',
    urgentes: 'Atenção institucional',
    salvos: 'Organização institucional',
    turmas: 'Organização acadêmica',
    alunos: 'Organização acadêmica',
    horarios: 'Organização escolar',
    equipe: 'Organização institucional',
    ocorrencias: 'Acompanhamento',
    justificativas: 'Acompanhamento',
    relatorios: 'Acompanhamento',
    configuracoes: 'Dados institucionais'
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
        window.location.replace('/entrar');
        return;
    }

    fillUser();
    setupSearch();
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
    document.title = `${section.title} · Portal da Gestão · C-Warning`;
    document.body.dataset.secao = route.section;

    $$('[data-secao]').forEach((link) => setCurrent(link, link.dataset.secao === route.section));
    // No celular o menu rola na horizontal: mantém o item atual à vista.
    $$('.menu [data-secao].ativo').forEach((link) => link.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));

    closeSearch();
    // show() devolve true quando já pôs o foco num campo da seção.
    const focused = section.show?.(route.sub) === true;
    if (focus && !focused) {
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

// ---------------------------------------------------------------- busca geral (faixa do topo)

const SEARCH_LIMIT = 5;

// Leva à seção e aplica o termo na busca/filtro dela.
function goTo(hash, fill) {
    closeSearch();
    $('#busca-geral-campo').value = '';
    window.location.hash = hash;
    // A seção já existe no DOM; o filtro vale mesmo antes do hashchange.
    fill?.();
}

function fillField(selector, value, eventName = 'input') {
    const field = $(selector);
    field.value = value;
    field.dispatchEvent(new Event(eventName));
}

function searchGroups(query) {
    const notices = G.sourceData('avisos')
        .filter((notice) => G.matches(query, notice.titulo, notice.conteudo))
        .sort((a, b) => b.id_post - a.id_post)
        .map((notice) => ({
            icon: notice.urgente ? 'warning-circle' : 'megaphone-simple',
            text: notice.titulo,
            detail: G.formatCreated(notice.criado_em),
            go: () => goTo('#/avisos', () => fillField('#busca-avisos', notice.titulo))
        }));
    const classes = G.sortedClasses()
        .filter((item) => G.matches(query, item.nome_turma))
        .map((item) => ({
            icon: 'users-three',
            text: item.nome_turma,
            detail: 'Ver alunos da turma',
            go: () => goTo('#/alunos', () => {
                fillField('#busca-alunos', '');
                fillField('#filtro-turma-alunos', String(item.id_turma), 'change');
            })
        }));
    // A matrícula do aluno é o login da conta dele.
    const logins = new Map(G.sourceData('usuarios').map((user) => [user.id_usuario, user.login]));
    const students = G.sourceData('alunos')
        .map((student) => ({ ...student, login: logins.get(student.id_usuario) || '' }))
        .filter((student) => G.matches(query, student.nome, student.login))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map((student) => ({
            icon: 'student',
            text: student.nome,
            detail: [student.login && `Matrícula ${student.login}`, G.className(student.id_turma)].filter(Boolean).join(' · '),
            go: () => goTo('#/alunos', () => {
                fillField('#filtro-turma-alunos', '', 'change');
                fillField('#busca-alunos', student.login || student.nome);
            })
        }));
    return [['Comunicados', notices], ['Turmas', classes], ['Alunos', students]]
        .filter(([, items]) => items.length);
}

function renderSearch() {
    const input = $('#busca-geral-campo');
    const box = $('#busca-geral-resultados');
    const query = input.value.trim();
    if (query.length < 2) {
        closeSearch();
        return;
    }
    const groups = searchGroups(query);
    box.replaceChildren(...(groups.length
        ? groups.map(([title, items]) => G.el('div', { class: 'busca-grupo' },
            G.el('p', { class: 'busca-grupo-titulo', text: title }),
            G.el('ul', {}, items.slice(0, SEARCH_LIMIT).map((item) => G.el('li', {},
                G.button([G.icon(item.icon), G.el('span', { class: 'busca-item-texto' },
                    G.el('strong', { text: item.text }),
                    item.detail ? G.el('small', { text: item.detail }) : null)], 'busca-item', item.go))))))
        : [G.el('p', { class: 'busca-vazia', role: 'status', text: 'Nada encontrado.' })]));
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

function closeSearch() {
    $('#busca-geral-resultados').hidden = true;
    $('#busca-geral-campo').setAttribute('aria-expanded', 'false');
}

function setupSearch() {
    const form = $('#busca-geral');
    const input = $('#busca-geral-campo');
    input.addEventListener('input', renderSearch);
    input.addEventListener('focus', renderSearch);
    // Enter abre o primeiro resultado.
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        form.querySelector('.busca-item')?.click();
    });
    form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !$('#busca-geral-resultados').hidden) {
            closeSearch();
            input.focus();
        }
    });
    form.addEventListener('focusout', (event) => {
        if (!form.contains(event.relatedTarget)) closeSearch();
    });
    G.onSource(['avisos', 'turmas', 'alunos', 'usuarios'], () => {
        if (!$('#busca-geral-resultados').hidden) renderSearch();
    });
}

initialize();
}());
