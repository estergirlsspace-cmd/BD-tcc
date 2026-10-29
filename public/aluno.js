// Portal do Aluno (C·Warning).
// Aplicação de página única: navegação por hash (#/secao/sub), dados reais da API,
// renderização só com createElement/textContent (nada de innerHTML com dados).
// Depende de /datas.js (datas no horário de Brasília) e /notificacoes.js (notify).

'use strict';

const TOKEN_KEY = 'cwarning-token';
const token = sessionStorage.getItem(TOKEN_KEY);
const FUSO_ESCOLA = 'America/Sao_Paulo';
const FREQUENCIA_MINIMA = 75;
const MOBILE_QUERY = window.matchMedia('(max-width: 899.98px)');

const COURSE_NAMES = { informatica: 'Técnico em Informática', redes: 'Técnico em Redes de Computadores' };
const SERIES_NAMES = { 1: '1ª série', 2: '2ª série', 3: '3ª série' };
const WEEKDAY_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

const CATEGORIES = {
    urgente: { label: 'Urgente', icon: 'warning' },
    turma: { label: 'Minha turma', icon: 'users-three' },
    coordenacao: { label: 'Coordenação', icon: 'buildings' },
    eventos: { label: 'Evento', icon: 'confetti' }
};

const AGENDA_TYPES = {
    aula: { label: 'Aula', icon: 'chalkboard-teacher' },
    evento: { label: 'Evento', icon: 'flag' },
    entrega: { label: 'Entrega', icon: 'upload-simple' },
    prova: { label: 'Prova', icon: 'exam' }
};

const ACTIVITY_STATUS = {
    pendentes: { icon: 'hourglass-medium', button: 'Enviar', buttonIcon: 'upload-simple' },
    entregues: { icon: 'check-circle', button: 'Ver envio', buttonIcon: 'eye' },
    corrigidas: { icon: 'seal-check', button: 'Ver correção', buttonIcon: 'chat-text' }
};

const SECTIONS = {
    inicio: { title: 'Início', defaultSub: null },
    avisos: { title: 'Avisos', defaultSub: 'todos' },
    agenda: { title: 'Agenda', defaultSub: 'hoje' },
    atividades: { title: 'Atividades', defaultSub: 'pendentes' },
    frequencia: { title: 'Frequência', defaultSub: 'resumo' },
    ajustes: { title: 'Ajustes', defaultSub: 'perfil' }
};

const FAQ = [
    ['Como confirmo que li um aviso?',
        'Abra o aviso e toque em "Confirmar leitura". Ele sai da lista de não lidos. Se confirmou por engano, toque de novo para desfazer.'],
    ['Onde encontro os avisos que salvei?',
        'Em Avisos › Salvos. Use o botão "Salvar" dentro do aviso para guardar os mais importantes.'],
    ['Como envio uma atividade?',
        'Em Atividades › Pendentes, toque em "Enviar", escreva sua resposta e confirme antes do prazo. Até o prazo terminar você pode reenviar.'],
    ['Minha frequência está abaixo de 75%. E agora?',
        'O mínimo para aprovação é 75% de presença. Procure a coordenação para entender a situação e combinar a reposição.'],
    ['Esqueci minha senha. O que faço?',
        'Procure a secretaria da escola para redefinir a senha. No primeiro acesso depois disso, você cria uma senha nova.']
];

// ---------------------------------------------------------------- estado

const state = {
    user: null,
    route: { section: 'inicio', sub: null, id: null },
    lastNoticeSub: 'todos',
    search: '',
    sources: {
        mural: { status: 'loading', data: null, error: null },
        desempenho: { status: 'loading', data: null, error: null },
        atividades: { status: 'loading', data: null, error: null },
        horarios: { status: 'loading', data: null, error: null },
        frequencias: { status: 'loading', data: null, error: null }
    },
    lastUnreadAnnounced: null
};

const SOURCE_PATHS = {
    mural: '/api/mural',
    desempenho: '/api/desempenho',
    atividades: '/api/atividades',
    horarios: '/api/horarios',
    frequencias: '/api/frequencias'
};

const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------- API e sessão

function leaveToLogin() {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.replace('/');
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers
        }
    });
    const text = await response.text();
    let result = null;
    try {
        result = text ? JSON.parse(text) : null;
    } catch {
        throw new Error('O servidor retornou uma resposta inválida.');
    }
    if (response.status === 401) {
        leaveToLogin();
        throw new Error('Sua sessão expirou. Entre novamente.');
    }
    if (!response.ok) throw new Error(result?.erro || 'Não foi possível concluir a solicitação.');
    return result;
}

async function logout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch {
        // A sessão local é encerrada mesmo se o servidor não responder.
    }
    leaveToLogin();
}

async function loadSource(name) {
    const source = state.sources[name];
    source.status = 'loading';
    source.error = null;
    render();
    try {
        source.data = await api(SOURCE_PATHS[name]);
        source.status = 'ok';
    } catch (error) {
        source.status = 'error';
        source.error = error.message;
    }
    render();
}

async function initialize() {
    if (!token) {
        leaveToLogin();
        return;
    }
    try {
        state.user = await api('/api/me');
    } catch (error) {
        showFatalError(error.message);
        return;
    }
    if (state.user.tipo_usuario !== 'aluno' || state.user.deve_trocar_senha) {
        leaveToLogin();
        return;
    }

    setupShell();
    applyRoute(parseHash(), { focus: false });
    window.addEventListener('hashchange', () => applyRoute(parseHash(), { focus: true }));
    MOBILE_QUERY.addEventListener('change', render);
    await Promise.all(Object.keys(SOURCE_PATHS).map(loadSource));
}

function showFatalError(message) {
    const main = $('#conteudo');
    main.replaceChildren(errorState(message, () => window.location.reload()));
    $('#titulo-pagina').textContent = 'Portal do Aluno';
}

// ---------------------------------------------------------------- utilidades de DOM

// el('div', { class: 'x', text: 'y', href: '#', on: { click } }, ...filhos)
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'on') {
            for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
        } else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

function icon(name, fill = false) {
    return el('i', { class: `${fill ? 'ph-fill' : 'ph'} ph-${name}`, 'aria-hidden': 'true' });
}

function srText(text) {
    return el('span', { class: 'visually-hidden', text });
}

function emptyState(text, iconName = 'tray') {
    return el('div', { class: 'estado-vazio' }, icon(iconName), el('p', { text }));
}

function errorState(message, retry) {
    return el('div', { class: 'estado-erro', role: 'alert' },
        icon('warning-circle'),
        el('p', { text: message || 'Não foi possível carregar.' }),
        retry ? el('button', { class: 'botao botao-secundario', type: 'button', on: { click: retry } },
            icon('arrow-clockwise'), 'Tentar de novo') : null);
}

function skeletonList(count = 3) {
    return el('div', { class: 'esqueleto-lista', 'aria-busy': 'true' },
        srText('Carregando…'),
        Array.from({ length: count }, () => el('div', { class: 'esqueleto esqueleto-bloco', 'aria-hidden': 'true' })));
}

// Devolve o nó adequado ao estado de uma fonte, ou null quando os dados estão prontos.
function sourceGuard(names, skeletonCount) {
    const list = [].concat(names);
    const failed = list.find((name) => state.sources[name].status === 'error');
    if (failed) return errorState(state.sources[failed].error, () => list.forEach(loadSource));
    if (list.some((name) => state.sources[name].status !== 'ok')) return skeletonList(skeletonCount);
    return null;
}

function card(className, ...children) {
    return el('section', { class: `cartao ${className || ''}`.trim() }, ...children);
}

function setBarValue(bar, percent) {
    bar.style.setProperty('--valor', `${Math.max(0, Math.min(100, percent))}%`);
    return bar;
}

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'aluno(a)';
}

function plural(count, singular, pluralWord) {
    return `${count} ${count === 1 ? singular : pluralWord}`;
}

function truncate(text, max) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

// ---------------------------------------------------------------- datas (Brasília)

function schoolParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO_ESCOLA, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        ymd: `${get('year')}-${get('month')}-${get('day')}`,
        day: get('day'),
        month: Number(get('month')),
        hour: Number(get('hour')),
        weekday: weekdays[get('weekday')]
    };
}

// dia_semana do servidor: 1 = segunda … 7 = domingo.
function isoWeekday(jsWeekday) {
    return jsWeekday === 0 ? 7 : jsWeekday;
}

function todayLongLabel() {
    const text = new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO_ESCOLA, weekday: 'long', day: 'numeric', month: 'long'
    }).format(new Date());
    return text.replace('-feira', '').toUpperCase();
}

function greeting() {
    const hour = schoolParts().hour;
    if (hour < 5) return 'Boa noite';
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
}

function timeAgo(utcValue) {
    const date = parseSchoolDate(utcValue, { utc: true });
    if (!date) return '';
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24 && schoolParts(date).ymd === schoolParts().ymd) return `há ${hours} h`;
    const days = -daysUntil(schoolParts(date).ymd);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return formatSchoolDate(schoolParts(date).ymd);
}

function fullDateTime(utcValue) {
    const date = parseSchoolDate(utcValue, { utc: true });
    if (!date) return '';
    const day = date.toLocaleDateString('pt-BR', { timeZone: FUSO_ESCOLA });
    const time = date.toLocaleTimeString('pt-BR', { timeZone: FUSO_ESCOLA, hour: '2-digit', minute: '2-digit' });
    return `${day} às ${time}`;
}

function hasTime(value) {
    return /[T ]\d{2}:\d{2}/.test(value || '');
}

function timeOf(value) {
    const match = /[T ](\d{2}):(\d{2})/.exec(value || '');
    return match ? `${match[1]}:${match[2]}` : null;
}

// Prazo só com data vale até 23h59 daquele dia (mesma regra do servidor).
function deadlineDate(prazo) {
    if (!prazo) return null;
    if (hasTime(prazo)) return parseSchoolDate(prazo);
    const day = parseSchoolDate(prazo);
    return day ? new Date(day.getTime() + (24 * 3600 - 1) * 1000) : null;
}

function deadlineLabel(prazo) {
    if (!prazo) return 'Sem prazo';
    const date = parseSchoolDate(prazo);
    const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_ESCOLA, weekday: 'short' })
        .format(date).replace('.', '');
    const day = date.toLocaleDateString('pt-BR', { timeZone: FUSO_ESCOLA, day: '2-digit', month: '2-digit' });
    const time = (timeOf(prazo) || '23:59').replace(':', 'h');
    return `até ${weekday}, ${day} · ${time}`;
}

function dueInLabel(prazo) {
    const days = daysUntil(prazo);
    if (days === null) return '';
    if (days < 0) return 'Prazo encerrado';
    if (days === 0) return 'Vence hoje';
    if (days === 1) return 'Vence amanhã';
    return `Vence em ${days} dias`;
}

// ---------------------------------------------------------------- dados derivados

function notices() {
    return state.sources.mural.data?.avisos || [];
}

function isUnread(notice) {
    return !notice.lido_em;
}

function unreadCount() {
    return notices().filter(isUnread).length;
}

function byNewest(a, b) {
    return String(b.criado_em).localeCompare(String(a.criado_em));
}

function matchesSearch(notice) {
    const term = normalize(state.search);
    if (!term) return true;
    return normalize(`${notice.titulo} ${notice.conteudo} ${notice.autor?.nome || ''}`).includes(term);
}

function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const NOTICE_FILTERS = {
    todos: () => true,
    naolidos: isUnread,
    salvos: (notice) => notice.salvo,
    urgente: (notice) => notice.categoria === 'urgente',
    turma: (notice) => notice.categoria === 'turma',
    coordenacao: (notice) => notice.categoria === 'coordenacao',
    eventos: (notice) => notice.categoria === 'eventos'
};

function activities() {
    return (state.sources.atividades.data || [])
        .filter((activity) => activity.tipo !== 'evento' && activity.tipo !== 'comunicado');
}

// Só atividades recebem envio pelo portal; avaliações são provas presenciais (aparecem na Agenda).
function deliverables() {
    return activities().filter((activity) => activity.tipo === 'atividade');
}

function submissionOf(activity) {
    return activity.entrega ?? null;
}

function activityStatus(activity) {
    const submission = submissionOf(activity);
    if (!submission) return 'pendentes';
    if (submission.nota !== null && submission.nota !== undefined) return 'corrigidas';
    return 'entregues';
}

function isOverdue(activity) {
    const deadline = deadlineDate(activity.prazo);
    return Boolean(deadline && deadline.getTime() < Date.now());
}

function nextDelivery() {
    return deliverables()
        .filter((activity) => activityStatus(activity) === 'pendentes' && activity.prazo && !isOverdue(activity))
        .sort((a, b) => deadlineDate(a.prazo) - deadlineDate(b.prazo))[0] || null;
}

function attendanceByDiscipline() {
    const groups = new Map();
    for (const record of state.sources.frequencias.data || []) {
        const name = record.nome_disciplina || 'Disciplina';
        const group = groups.get(name) || { nome: name, aulas: 0, presencas: 0 };
        group.aulas += 1;
        if (record.presente) group.presencas += 1;
        groups.set(name, group);
    }
    return [...groups.values()]
        .map((group) => ({ ...group, faltas: group.aulas - group.presencas, percentual: Math.round((group.presencas / group.aulas) * 100) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function absences() {
    return (state.sources.frequencias.data || []).filter((record) => !record.presente);
}

// Itens da agenda dos próximos 7 dias: aulas semanais, prazos e eventos.
function agendaDays() {
    const today = schoolParts();
    const days = [];
    const base = parseSchoolDate(today.ymd);
    for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(base.getTime() + offset * 86400000 + 12 * 3600000);
        const parts = schoolParts(date);
        days.push({ ymd: parts.ymd, weekday: parts.weekday, day: parts.day, month: parts.month, isToday: offset === 0, items: [] });
    }
    const byDate = new Map(days.map((day) => [day.ymd, day]));

    for (const day of days) {
        for (const lesson of state.sources.horarios.data || []) {
            if (lesson.dia_semana !== isoWeekday(day.weekday)) continue;
            day.items.push({
                kind: 'aula',
                time: lesson.hora_inicio,
                title: lesson.nome_disciplina || 'Aula',
                detail: [lesson.sala, lesson.professor, lesson.hora_fim ? `até ${lesson.hora_fim}` : null].filter(Boolean).join(' · ')
            });
        }
    }

    for (const activity of state.sources.atividades.data || []) {
        if (!activity.prazo) continue;
        const day = byDate.get(activity.prazo.slice(0, 10));
        if (!day) continue;
        const kind = activity.tipo === 'avaliacao' ? 'prova' : activity.tipo === 'evento' ? 'evento' : 'entrega';
        const status = activityStatus(activity);
        const detail = [activity.nome_disciplina,
            kind === 'entrega' ? (status === 'pendentes' ? 'envio pela aba Atividades' : 'enviada') : null]
            .filter(Boolean).join(' · ');
        day.items.push({ kind, time: timeOf(activity.prazo) || '23:59', title: activity.titulo, detail, href: kind === 'evento' ? null : `#/atividades/${status}` });
    }

    for (const notice of notices()) {
        if (!notice.data_evento) continue;
        const day = byDate.get(notice.data_evento.slice(0, 10));
        if (!day) continue;
        day.items.push({ kind: 'evento', time: timeOf(notice.data_evento) || '—', title: notice.titulo, detail: notice.autor?.nome || '', href: `#/avisos/${notice.id_post}` });
    }

    for (const day of days) {
        day.items.sort((a, b) => (a.time === '—' ? '' : a.time).localeCompare(b.time === '—' ? '' : b.time));
    }
    return days;
}

const AGENDA_FILTERS = {
    hoje: { day: (day) => day.isToday, item: () => true },
    semana: { day: () => true, item: () => true },
    provas: { day: () => true, item: (item) => item.kind === 'prova' || item.kind === 'entrega' },
    eventos: { day: () => true, item: (item) => item.kind === 'evento' }
};

// ---------------------------------------------------------------- subnavegação

function countIf(ready, value) {
    return ready ? value : null;
}

function subnavGroups(section) {
    const muralReady = state.sources.mural.status === 'ok';
    const all = notices();
    const agendaReady = ['horarios', 'atividades', 'mural'].every((name) => state.sources[name].status === 'ok');
    const days = agendaReady ? agendaDays() : [];
    const agendaCount = (filter) => days.filter(filter.day).reduce((sum, day) => sum + day.items.filter(filter.item).length, 0);
    const activitiesReady = state.sources.atividades.status === 'ok';
    const countStatus = (status) => deliverables().filter((activity) => activityStatus(activity) === status).length;
    const absencesReady = state.sources.frequencias.status === 'ok';

    const groups = {
        avisos: [
            ['Caixa', [
                ['todos', 'Todos', 'tray', countIf(muralReady, all.length)],
                ['naolidos', 'Não lidos', 'envelope-simple', countIf(muralReady, all.filter(isUnread).length)],
                ['salvos', 'Salvos', 'bookmark-simple', countIf(muralReady, all.filter((n) => n.salvo).length)]
            ]],
            ['Categorias', [
                ['urgente', 'Urgentes', 'warning-circle', countIf(muralReady, all.filter(NOTICE_FILTERS.urgente).length)],
                ['turma', 'Minha turma', 'users-three', countIf(muralReady, all.filter(NOTICE_FILTERS.turma).length)],
                ['coordenacao', 'Coordenação', 'buildings', countIf(muralReady, all.filter(NOTICE_FILTERS.coordenacao).length)],
                ['eventos', 'Eventos', 'confetti', countIf(muralReady, all.filter(NOTICE_FILTERS.eventos).length)]
            ]]
        ],
        agenda: [
            ['Visualizar', [
                ['hoje', 'Hoje', 'sun', countIf(agendaReady, agendaCount(AGENDA_FILTERS.hoje))],
                ['semana', 'Esta semana', 'calendar-blank', null]
            ]],
            ['Filtrar', [
                ['provas', 'Provas e entregas', 'exam', countIf(agendaReady, agendaCount(AGENDA_FILTERS.provas))],
                ['eventos', 'Eventos da escola', 'flag', countIf(agendaReady, agendaCount(AGENDA_FILTERS.eventos))]
            ]]
        ],
        atividades: [
            ['Status', [
                ['pendentes', 'Pendentes', 'hourglass-medium', countIf(activitiesReady, countStatus('pendentes'))],
                ['entregues', 'Entregues', 'check-circle', countIf(activitiesReady, countStatus('entregues'))],
                ['corrigidas', 'Corrigidas', 'seal-check', countIf(activitiesReady, countStatus('corrigidas'))]
            ]]
        ],
        frequencia: [
            ['Acompanhar', [
                ['resumo', 'Resumo', 'chart-bar', null],
                ['faltas', 'Histórico de faltas', 'calendar-x', countIf(absencesReady, absences().length)]
            ]]
        ],
        ajustes: [
            ['Conta', [
                ['perfil', 'Perfil', 'user-circle', null],
                ['seguranca', 'Senha e segurança', 'lock-key', null]
            ]],
            ['Suporte', [
                ['ajuda', 'Ajuda', 'question', null]
            ]]
        ]
    };
    return groups[section] || null;
}

function subLabel(section, sub) {
    for (const [, items] of subnavGroups(section) || []) {
        const found = items.find(([key]) => key === sub);
        if (found) return found[1];
    }
    return null;
}

function renderSubnav() {
    const { section, sub, id } = state.route;
    const groups = subnavGroups(section);
    const subnav = $('#subnav');
    subnav.hidden = !groups;
    if (!groups) return;
    const activeSub = section === 'avisos' && id ? state.lastNoticeSub : sub;
    $('#subnav-titulo').textContent = SECTIONS[section].title;
    $('#subnav-grupos').replaceChildren(...groups.map(([title, items]) => {
        const titleId = `subnav-grupo-${section}-${normalize(title)}`;
        return el('div', { class: 'subnav-grupo' },
            el('p', { class: 'subnav-grupo-titulo', id: titleId, text: title }),
            el('ul', { 'aria-labelledby': titleId }, items.map(([key, label, iconName, count]) => {
                const active = key === activeSub;
                return el('li', {},
                    el('a', {
                        class: `subnav-item${active ? ' ativo' : ''}`,
                        href: `#/${section}/${key}`,
                        'aria-current': active ? 'page' : null
                    }, icon(iconName), el('span', { class: 'subnav-rotulo', text: label }),
                    count !== null && count !== undefined ? el('span', { class: 'contador', 'aria-hidden': 'true', text: String(count) }) : null,
                    count !== null && count !== undefined ? srText(`, ${count}`) : null));
            })));
    }));
}

// Subseções como chips roláveis no celular.
function chipsNav() {
    const { section, sub } = state.route;
    const groups = subnavGroups(section);
    if (!groups) return null;
    const items = groups.flatMap(([, list]) => list);
    return el('nav', { class: 'chips', 'aria-label': `Subseções de ${SECTIONS[section].title}` },
        el('ul', {}, items.map(([key, label, , count]) => el('li', {},
            el('a', {
                class: `chip${key === sub ? ' ativo' : ''}`,
                href: `#/${section}/${key}`,
                'aria-current': key === sub ? 'page' : null
            }, label, count ? el('span', { class: 'chip-contador', text: String(count) }) : null)))));
}

// ---------------------------------------------------------------- roteamento

function parseHash() {
    const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const section = SECTIONS[parts[0]] ? parts[0] : 'inicio';
    let sub = parts[1] || SECTIONS[section].defaultSub;
    let id = null;
    if (section === 'avisos' && /^\d+$/.test(sub || '')) {
        id = Number(sub);
        sub = null;
    }
    const groups = subnavGroups(section);
    if (groups && !id && !groups.some(([, items]) => items.some(([key]) => key === sub))) {
        sub = SECTIONS[section].defaultSub;
    }
    return { section, sub, id };
}

function applyRoute(route, { focus }) {
    state.route = route;
    if (route.section === 'avisos' && route.sub) state.lastNoticeSub = route.sub;
    render();
    if (focus) {
        $('#conteudo').scrollTop = 0;
        window.scrollTo(0, 0);
        if (document.activeElement !== $('#busca-campo')) $('#titulo-pagina').focus({ preventScroll: true });
    }
}

function navigate(hash) {
    if (window.location.hash === hash) applyRoute(parseHash(), { focus: false });
    else window.location.hash = hash;
}

// ---------------------------------------------------------------- casca (rail, topo, abas)

function setupShell() {
    const user = state.user;
    $('#rail-avatar').textContent = initials(user.nome);
    $('#rail-avatar').setAttribute('aria-label', `Meu perfil: ${user.nome || 'Aluno(a)'}`);
    document.querySelectorAll('[data-sair]').forEach((button) => button.addEventListener('click', logout));

    const searchField = $('#busca-campo');
    $('#busca').addEventListener('submit', (event) => event.preventDefault());
    searchField.addEventListener('input', () => {
        state.search = searchField.value;
        if (state.route.section !== 'avisos' || state.route.id) navigate('#/avisos/todos');
        else render();
    });
    $('#botao-busca').addEventListener('click', () => {
        const open = !document.body.classList.contains('busca-aberta');
        document.body.classList.toggle('busca-aberta', open);
        $('#botao-busca').setAttribute('aria-expanded', String(open));
        if (open) searchField.focus();
    });

    const dialog = $('#dialogo');
    dialog.querySelector('[data-fechar-dialogo]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });
}

function renderShell(pageTitle, trail) {
    const { section, id } = state.route;
    document.querySelectorAll('.rail-item, .aba').forEach((link) => {
        const active = link.dataset.secao === section;
        link.classList.toggle('ativo', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    const unread = unreadCount();
    const muralReady = state.sources.mural.status === 'ok';
    document.querySelectorAll('[data-ponto-naolidos]').forEach((dot) => {
        dot.hidden = !(muralReady && unread > 0);
    });
    document.querySelectorAll('[data-sr-naolidos]').forEach((span) => {
        span.textContent = muralReady && unread > 0 ? `, ${plural(unread, 'não lido', 'não lidos')}` : '';
    });
    $('#sino').setAttribute('aria-label', muralReady && unread > 0
        ? `Avisos não lidos: ${unread}` : 'Avisos não lidos: nenhum');
    if (muralReady && state.lastUnreadAnnounced !== null && state.lastUnreadAnnounced !== unread) {
        $('#status-contadores').textContent = unread
            ? `${plural(unread, 'aviso não lido', 'avisos não lidos')}.` : 'Todos os avisos foram lidos.';
    }
    if (muralReady) state.lastUnreadAnnounced = unread;

    $('#titulo-pagina').textContent = pageTitle;
    $('#topo-trilha').replaceChildren(...trail.flatMap((part, index) => (index
        ? [el('i', { class: 'ph ph-caret-right', 'aria-hidden': 'true' }), el('span', { text: part })]
        : [el('span', { text: part })])));
    document.title = `${pageTitle} · C·Warning Aluno`;

    const detail = section === 'avisos' && Boolean(id);
    document.body.classList.toggle('detalhe-aberto', detail);
    const back = $('#topo-voltar');
    back.hidden = !detail;
    back.href = `#/avisos/${state.lastNoticeSub || 'todos'}`;
    if ($('#busca-campo').value !== state.search) $('#busca-campo').value = state.search;
}

// ---------------------------------------------------------------- renderização

function render() {
    if (!state.user) return;
    const { section, sub, id } = state.route;
    let pageTitle = SECTIONS[section].title;
    let trail = ['Aluno'];
    let content;

    if (section === 'inicio') {
        pageTitle = 'Painel do dia';
        trail = ['Aluno', 'Início'];
        content = renderHome();
    } else if (section === 'avisos' && id) {
        const notice = notices().find((item) => item.id_post === id);
        pageTitle = notice ? truncate(notice.titulo, 46) : 'Aviso';
        trail = ['Avisos', 'Aviso'];
        content = renderNoticeDetail(id);
    } else {
        const label = subLabel(section, sub) || SECTIONS[section].title;
        pageTitle = label;
        trail = [SECTIONS[section].title, label];
        const renderers = {
            avisos: renderNoticeList,
            agenda: renderAgenda,
            atividades: renderActivities,
            frequencia: sub === 'faltas' ? renderAbsences : renderAttendanceSummary,
            ajustes: { perfil: renderProfile, seguranca: renderSecurity, ajuda: renderHelp }[sub] || renderProfile
        };
        content = [chipsNav(), renderers[section]()];
    }

    renderShell(pageTitle, trail);
    renderSubnav();
    const main = $('#conteudo');
    // Ajustes não dependem das fontes carregadas: não redesenhar evita apagar o que o aluno digita.
    const routeKey = `${section}/${sub}/${id}`;
    if (section === 'ajustes' && main.dataset.rota === routeKey) return;
    main.dataset.rota = routeKey;
    const keepFocus = main.contains(document.activeElement) ? document.activeElement : null;
    const keepId = keepFocus?.id;
    main.replaceChildren(...[content].flat(Infinity).filter(Boolean));
    main.classList.toggle('conteudo-detalhe', section === 'avisos' && Boolean(id));
    if (keepId) document.getElementById(keepId)?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- Início

function renderHome() {
    const nodes = [];
    nodes.push(el('div', { class: 'saudacao' },
        el('p', { class: 'sobretitulo', text: todayLongLabel() }),
        el('h2', { class: 'saudacao-titulo', text: `${greeting()}, ${firstName(state.user.nome)}` })));

    if (state.sources.mural.status === 'ok') {
        const urgent = notices().filter((notice) => notice.urgente && isUnread(notice)).sort(byNewest)[0];
        if (urgent) {
            nodes.push(el('a', { class: 'faixa-urgente', href: `#/avisos/${urgent.id_post}` },
                el('span', { class: 'faixa-icone' }, icon('warning')),
                el('span', { class: 'faixa-texto' },
                    el('span', { class: 'faixa-meta' },
                        el('span', { class: 'rotulo-urgente', text: 'Urgente' }),
                        el('span', { class: 'meta', text: `${urgent.autor?.nome || 'Escola'} · ${timeAgo(urgent.criado_em)}` })),
                    el('span', { class: 'faixa-titulo', text: urgent.titulo })),
                el('span', { class: 'link-seta', 'aria-hidden': 'true' }, 'Ler aviso', icon('caret-right'))));
        }
    }

    nodes.push(el('div', { class: 'grade-cartoes' },
        homeAttendanceCard(), homeUnreadCard(), homeDeliveryCard()));

    nodes.push(el('div', { class: 'grade-inicio' }, homeRecentNotices(), homeLessonsToday()));
    return nodes;
}

function cardHeader(iconName, title) {
    return el('div', { class: 'cartao-cabecalho' },
        el('span', { class: 'icone-quadrado' }, icon(iconName)),
        el('h3', { class: 'cartao-rotulo', text: title }));
}

function homeAttendanceCard() {
    const guard = sourceGuard('desempenho', 1);
    if (guard) return card('cartao-kpi', cardHeader('list-checks', 'Frequência geral'), guard);
    const link = el('a', { class: 'cartao cartao-link cartao-kpi', href: '#/frequencia/resumo' },
        cardHeader('list-checks', 'Frequência geral'));
    const attendance = state.sources.desempenho.data?.frequencia || { aulas: 0, percentual: 0 };
    if (!attendance.aulas) {
        link.append(el('span', { class: 'kpi-valor', text: '—' }),
            el('span', { class: 'meta', text: 'Nenhuma aula registrada ainda' }));
        return link;
    }
    const percent = Math.round(attendance.percentual);
    link.append(el('span', { class: 'kpi-valor', text: `${percent}%` }),
        attendanceBar(percent),
        el('span', { class: 'meta', text: `Mínimo ${FREQUENCIA_MINIMA}%` }));
    return link;
}

function attendanceBar(percent) {
    const bar = el('span', { class: `barra${percent < FREQUENCIA_MINIMA ? ' barra-alerta' : ''}`, 'aria-hidden': 'true' },
        el('span', { class: 'barra-valor' }), el('span', { class: 'barra-minimo' }));
    return setBarValue(bar, percent);
}

function homeUnreadCard() {
    const guard = sourceGuard('mural', 1);
    if (guard) return card('cartao-kpi', cardHeader('envelope-simple', 'Avisos não lidos'), guard);
    const link = el('a', { class: 'cartao cartao-link cartao-kpi', href: '#/avisos/naolidos' },
        cardHeader('envelope-simple', 'Avisos não lidos'));
    const unread = unreadCount();
    link.append(el('span', { class: 'kpi-valor', text: String(unread) }),
        el('span', { class: 'meta empurra', text: unread ? 'Confirme a leitura em Avisos' : 'Tudo em dia' }));
    return link;
}

function homeDeliveryCard() {
    const guard = sourceGuard('atividades', 1);
    if (guard) return card('cartao-entrega', el('h3', { class: 'sobretitulo', text: 'Próxima entrega' }), guard);
    const next = nextDelivery();
    if (!next) {
        return el('a', { class: 'cartao cartao-link cartao-entrega', href: '#/atividades/pendentes' },
            el('h3', { class: 'sobretitulo', text: 'Próxima entrega' }),
            el('span', { class: 'entrega-titulo', text: 'Nenhuma entrega pendente' }),
            el('span', { class: 'meta empurra', text: 'Bom trabalho!' }));
    }
    const days = daysUntil(next.prazo);
    const badge = days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`;
    return el('a', { class: 'cartao cartao-link cartao-entrega', href: '#/atividades/pendentes' },
        el('div', { class: 'linha-entre' },
            el('h3', { class: 'sobretitulo', text: 'Próxima entrega' }),
            el('span', { class: 'selo selo-azul', text: badge })),
        el('span', { class: 'entrega-titulo', text: next.titulo }),
        el('span', { class: 'meta empurra', text: `${next.nome_disciplina || 'Atividade'} · ${deadlineLabel(next.prazo)}` }));
}

function categoryChip(notice, size = 'md') {
    const category = CATEGORIES[notice.categoria] || CATEGORIES.turma;
    return el('span', { class: `chip-categoria chip-${size} cat-${notice.categoria}` }, icon(category.icon));
}

function homeRecentNotices() {
    const section = card('cartao-lista',
        el('div', { class: 'linha-entre' },
            el('h2', { class: 'cartao-titulo', text: 'Avisos recentes' }),
            el('a', { class: 'link-seta', href: '#/avisos/todos' }, 'Ver todos', icon('caret-right'))));
    const guard = sourceGuard('mural', 3);
    if (guard) {
        section.append(guard);
        return section;
    }
    const recent = [...notices()].sort(byNewest).slice(0, 5);
    if (!recent.length) {
        section.append(emptyState('Nenhum aviso publicado para você ainda.'));
        return section;
    }
    section.append(el('ul', { class: 'lista-simples' }, recent.map((notice) => el('li', {},
        el('a', { class: 'linha-aviso', href: `#/avisos/${notice.id_post}` },
            categoryChip(notice, 'sm'),
            el('span', { class: 'linha-texto' },
                el('span', { class: 'linha-titulo', text: notice.titulo }),
                el('span', { class: 'meta', text: `${notice.autor?.nome || 'Escola'} · ${timeAgo(notice.criado_em)}` })),
            isUnread(notice) ? el('span', { class: 'ponto-novo' }, srText('Não lido')) : null)))));
    return section;
}

function homeLessonsToday() {
    const section = card('cartao-lista',
        el('div', { class: 'linha-entre' },
            el('h2', { class: 'cartao-titulo', text: 'Aulas de hoje' }),
            el('a', { class: 'link-seta', href: '#/agenda/hoje' }, 'Agenda', icon('caret-right'))));
    const guard = sourceGuard('horarios', 3);
    if (guard) {
        section.append(guard);
        return section;
    }
    const weekday = isoWeekday(schoolParts().weekday);
    const lessons = (state.sources.horarios.data || []).filter((lesson) => lesson.dia_semana === weekday);
    if (!lessons.length) {
        section.append(emptyState('Sem aulas hoje.', 'sun'));
        return section;
    }
    section.append(el('ul', { class: 'lista-aulas' }, lessons.map((lesson) => el('li', { class: 'linha-aula' },
        el('span', { class: 'hora', text: lesson.hora_inicio }),
        el('span', { class: 'linha-texto' },
            el('span', { class: 'linha-titulo', text: lesson.nome_disciplina || 'Aula' }),
            el('span', { class: 'meta', text: [lesson.sala, lesson.professor].filter(Boolean).join(' · ') || `até ${lesson.hora_fim}` }))))));
    return section;
}

// ---------------------------------------------------------------- Avisos

function renderNoticeList() {
    const nodes = [];
    const guard = sourceGuard('mural', 4);
    if (guard) return guard;

    const filter = NOTICE_FILTERS[state.route.sub] || NOTICE_FILTERS.todos;
    const list = notices().filter(filter).filter(matchesSearch);
    const unread = unreadCount();

    nodes.push(el('div', { class: 'barra-lista' },
        el('p', { class: 'meta', text: state.search
            ? `${plural(list.length, 'resultado', 'resultados')} para "${truncate(state.search, 40)}"`
            : `${plural(list.length, 'aviso', 'avisos')} · ${plural(unread, 'não lido', 'não lidos')}` }),
        state.search ? el('button', { class: 'link-botao', type: 'button', on: { click: clearSearch } }, icon('x'), 'Limpar busca') : null,
        el('button', { class: 'link-botao', type: 'button', disabled: unread === 0, on: { click: markAllRead } },
            icon('checks'), 'Marcar todos como lidos')));

    if (!list.length) {
        const messages = {
            naolidos: 'Nenhum aviso não lido. Você está em dia!',
            salvos: 'Você ainda não salvou nenhum aviso.'
        };
        nodes.push(emptyState(state.search ? 'Nenhum aviso encontrado para essa busca.'
            : messages[state.route.sub] || 'Nenhum aviso nesta categoria.'));
        return nodes;
    }

    nodes.push(el('ul', { class: 'lista-avisos' }, list.map((notice) => el('li', {}, noticeCard(notice)))));
    return nodes;
}

function clearSearch() {
    state.search = '';
    render();
    $('#busca-campo').focus();
}

function noticeCard(notice) {
    const category = CATEGORIES[notice.categoria] || CATEGORIES.turma;
    const unread = isUnread(notice);
    return el('a', { class: `cartao-aviso${unread ? ' nao-lido' : ''}`, href: `#/avisos/${notice.id_post}` },
        categoryChip(notice),
        el('span', { class: 'aviso-texto' },
            el('span', { class: 'aviso-meta' },
                el('span', { class: `etiqueta cat-${notice.categoria}`, text: category.label }),
                el('span', { class: 'meta', text: `${notice.autor?.nome || 'Escola'} · ${timeAgo(notice.criado_em)}` })),
            el('span', { class: 'aviso-titulo', text: notice.titulo }),
            el('span', { class: 'aviso-resumo', text: truncate(notice.conteudo, 180) }),
            notice.data_evento ? el('span', { class: 'aviso-evento' }, icon('calendar-blank'),
                `Data: ${formatSchoolDate(notice.data_evento)}`) : null),
        el('span', { class: 'aviso-lateral' },
            unread ? el('span', { class: 'ponto-novo' }, srText('Não lido')) : el('span', { class: 'ponto-vazio' }),
            el('span', { class: `marcador${notice.salvo ? ' salvo' : ''}` }, icon('bookmark-simple', notice.salvo),
                notice.salvo ? srText('Salvo') : null)));
}

function renderNoticeDetail(id) {
    const guard = sourceGuard('mural', 2);
    if (guard) return guard;
    const notice = notices().find((item) => item.id_post === id);
    const backHref = `#/avisos/${state.lastNoticeSub || 'todos'}`;
    if (!notice) {
        return [emptyState('Este aviso não existe ou não está mais disponível para você.', 'megaphone-simple'),
            el('a', { class: 'link-seta', href: backHref }, icon('arrow-left'), 'Voltar para avisos')];
    }
    const category = CATEGORIES[notice.categoria] || CATEGORIES.turma;
    const read = !isUnread(notice);
    const perfil = notice.autor?.perfil === 'gestao' ? 'Coordenação' : notice.autor?.perfil === 'professor' ? 'Professor(a)' : null;

    const paragraphs = String(notice.conteudo || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);

    return el('article', { class: 'cartao aviso-aberto', 'aria-labelledby': 'aviso-titulo' },
        el('div', { class: 'linha-entre aviso-topo' },
            el('a', { class: 'link-seta voltar-desktop', href: backHref }, icon('arrow-left'), 'Voltar para avisos'),
            el('button', {
                class: `botao botao-contorno${notice.salvo ? ' ativo' : ''}`, type: 'button',
                'aria-pressed': String(Boolean(notice.salvo)), on: { click: () => toggleSaved(notice) }
            }, icon('bookmark-simple', notice.salvo), notice.salvo ? 'Salvo' : 'Salvar')),
        el('div', {}, el('span', { class: `etiqueta cat-${notice.categoria}`, text: category.label })),
        el('h2', { class: 'aviso-aberto-titulo', id: 'aviso-titulo', text: notice.titulo }),
        el('div', { class: 'autor' },
            el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(notice.autor?.nome) }),
            el('span', { class: 'autor-texto' },
                el('span', { class: 'autor-nome', text: [notice.autor?.nome || 'Escola', perfil].filter(Boolean).join(' · ') }),
                el('span', { class: 'meta' }, el('time', { datetime: isoDateTime({ criado_em: notice.criado_em }), text: fullDateTime(notice.criado_em) })))),
        notice.data_evento ? el('p', { class: 'aviso-data-evento' }, icon('calendar-blank'),
            el('span', {}, el('strong', { text: 'Data do evento: ' }), formatSchoolDate(notice.data_evento))) : null,
        el('div', { class: 'aviso-corpo' }, paragraphs.map((text) => el('p', { text }))),
        el('div', { class: 'aviso-rodape' },
            el('button', {
                class: `botao botao-primario botao-leitura${read ? ' confirmado' : ''}`, type: 'button',
                'aria-pressed': String(read), on: { click: () => toggleRead(notice) }
            }, icon('check-circle', read), read ? 'Leitura confirmada' : 'Confirmar leitura'),
            read && notice.lido_em ? el('span', { class: 'meta', text: `Confirmada em ${fullDateTime(notice.lido_em)}` }) : null));
}

// Atualização otimista: aplica, chama a API e desfaz em caso de erro.
async function optimistic(apply, request, rollback, errorMessage) {
    apply();
    render();
    try {
        await request();
    } catch (error) {
        rollback();
        render();
        notify(error.message || errorMessage, 'erro');
    }
}

function toggleRead(notice) {
    const previous = notice.lido_em;
    const markRead = !previous;
    return optimistic(
        () => { notice.lido_em = markRead ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null; },
        async () => {
            const result = await api(`/api/mural/${notice.id_post}/leitura`, { method: markRead ? 'PUT' : 'DELETE' });
            if (result && 'lido_em' in result) notice.lido_em = result.lido_em;
            render();
        },
        () => { notice.lido_em = previous; },
        'Não foi possível atualizar a leitura.');
}

function toggleSaved(notice) {
    const previous = Boolean(notice.salvo);
    return optimistic(
        () => { notice.salvo = !previous; },
        async () => {
            const result = await api(`/api/mural/${notice.id_post}/salvo`, {
                method: 'PUT', body: JSON.stringify({ salvo: !previous })
            });
            if (result && 'salvo' in result) notice.salvo = Boolean(result.salvo);
            render();
            notify(notice.salvo ? 'Aviso salvo.' : 'Aviso removido dos salvos.', 'sucesso');
        },
        () => { notice.salvo = previous; },
        'Não foi possível salvar o aviso.');
}

function markAllRead() {
    const unread = notices().filter(isUnread);
    if (!unread.length) return undefined;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return optimistic(
        () => unread.forEach((notice) => { notice.lido_em = now; }),
        async () => {
            await api('/api/mural/leitura', { method: 'POST' });
            notify('Todos os avisos foram marcados como lidos.', 'sucesso');
        },
        () => unread.forEach((notice) => { notice.lido_em = null; }),
        'Não foi possível marcar os avisos como lidos.');
}

// ---------------------------------------------------------------- Agenda

function renderAgenda() {
    const guard = sourceGuard(['horarios', 'atividades', 'mural'], 3);
    if (guard) return guard;
    const filter = AGENDA_FILTERS[state.route.sub] || AGENDA_FILTERS.semana;
    const days = agendaDays()
        .filter(filter.day)
        .map((day) => ({ ...day, items: day.items.filter(filter.item) }))
        .filter((day) => day.items.length);

    if (!days.length) {
        const messages = {
            hoje: 'Nada marcado para hoje.',
            provas: 'Nenhuma prova ou entrega nos próximos 7 dias.',
            eventos: 'Nenhum evento da escola nos próximos 7 dias.'
        };
        return emptyState(messages[state.route.sub] || 'Nada marcado para os próximos 7 dias.', 'calendar-blank');
    }

    const monthShort = (month) => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })
        .format(new Date(Date.UTC(2000, month - 1, 15))).replace('.', '');

    return el('ol', { class: 'agenda' }, days.map((day) => el('li', { class: 'agenda-dia' },
        el('h2', { class: `agenda-data${day.isToday ? ' hoje' : ''}` },
            el('span', { class: 'agenda-sem', text: WEEKDAY_SHORT[day.weekday] }),
            el('span', { class: 'agenda-num', text: day.day }),
            el('span', { class: 'agenda-extra', text: day.isToday ? 'Hoje' : monthShort(day.month) })),
        el('ul', { class: 'cartao agenda-itens' }, day.items.map((item) => {
            const type = AGENDA_TYPES[item.kind];
            const title = item.href ? el('a', { class: 'linha-titulo link-discreto', href: item.href, text: item.title })
                : el('span', { class: 'linha-titulo', text: item.title });
            return el('li', { class: 'agenda-item' },
                el('span', { class: 'hora', text: item.time }),
                el('span', { class: 'chip-tipo' }, icon(type.icon)),
                el('span', { class: 'linha-texto' }, title, item.detail ? el('span', { class: 'meta', text: item.detail }) : null),
                el('span', { class: `selo tipo-${item.kind}`, text: type.label }));
        })))));
}

// ---------------------------------------------------------------- Atividades

function renderActivities() {
    const guard = sourceGuard('atividades', 3);
    if (guard) return guard;
    const status = state.route.sub;
    const list = deliverables().filter((activity) => activityStatus(activity) === status);
    if (status === 'pendentes') list.sort((a, b) => (deadlineDate(a.prazo) || Infinity) - (deadlineDate(b.prazo) || Infinity));
    if (!list.length) {
        const messages = {
            pendentes: 'Nenhuma atividade pendente. Tudo entregue!',
            entregues: 'Nenhuma atividade aguardando correção.',
            corrigidas: 'Nenhuma atividade corrigida ainda.'
        };
        return emptyState(messages[status], 'clipboard-text');
    }
    return el('ul', { class: 'lista-atividades' }, list.map((activity) => el('li', {}, activityCard(activity, status))));
}

function activityCard(activity, status) {
    const config = ACTIVITY_STATUS[status];
    const submission = submissionOf(activity);
    const overdue = status === 'pendentes' && isOverdue(activity);
    let info = activity.descricao || '';
    let tag = 'Pendente';
    let when = deadlineLabel(activity.prazo);
    if (status === 'pendentes') tag = activity.prazo ? dueInLabel(activity.prazo) : 'Sem prazo';
    if (status === 'entregues') {
        info = 'Aguardando correção';
        tag = 'Entregue';
        when = `entregue em ${formatSchoolDate(submission.enviado_em, { utc: true })}`;
    }
    if (status === 'corrigidas') {
        info = submission.feedback ? `“${submission.feedback}”` : 'Corrigida sem comentário.';
        tag = `Nota ${formatGrade(submission.nota)}`;
        when = `entregue em ${formatSchoolDate(submission.enviado_em, { utc: true })}`;
    }
    const titleId = `atividade-${activity.id_atividade}`;
    return el('article', { class: `cartao cartao-atividade status-${status}`, 'aria-labelledby': titleId },
        el('span', { class: 'chip-status' }, icon(config.icon)),
        el('div', { class: 'atividade-texto' },
            el('p', { class: 'atividade-disciplina', text: activity.nome_disciplina || '' }),
            el('h2', { class: 'atividade-titulo', id: titleId, text: activity.titulo }),
            info ? el('p', { class: 'atividade-info', text: truncate(info, 200) }) : null),
        el('div', { class: 'atividade-lateral' },
            el('span', { class: `selo${overdue ? ' selo-vermelho' : ''}`, text: tag }),
            el('span', { class: 'meta', text: when })),
        overdue
            ? el('span', { class: 'meta atividade-encerrada', text: 'Envio encerrado' })
            : el('button', {
                class: `botao ${status === 'pendentes' ? 'botao-primario' : 'botao-contorno'}`, type: 'button',
                'aria-describedby': titleId,
                on: { click: () => (status === 'pendentes' ? openSubmitDialog(activity) : openSubmissionDialog(activity, status)) }
            }, icon(config.buttonIcon), config.button));
}

function formatGrade(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(value);
}

function openDialog(title, ...content) {
    const dialog = $('#dialogo');
    $('#dialogo-titulo').textContent = title;
    $('#dialogo-corpo').replaceChildren(...content);
    if (!dialog.open) dialog.showModal();
    return dialog;
}

function openSubmitDialog(activity, previousAnswer = '') {
    const textarea = el('textarea', {
        id: 'resposta-atividade', name: 'resposta', rows: '8', maxlength: '10000', required: true,
        'aria-describedby': 'resposta-ajuda'
    });
    textarea.value = previousAnswer;
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Enviar resposta');
    const form = el('form', { class: 'formulario', novalidate: true },
        el('p', { class: 'meta', text: `${activity.nome_disciplina || 'Atividade'} · ${deadlineLabel(activity.prazo)}` }),
        activity.descricao ? el('p', { class: 'dialogo-descricao', text: activity.descricao }) : null,
        el('label', { class: 'campo-rotulo', for: 'resposta-atividade', text: 'Sua resposta' }),
        textarea,
        el('p', { class: 'meta', id: 'resposta-ajuda', text: 'Até 10.000 caracteres. Você pode reenviar até o prazo terminar.' }),
        el('div', { class: 'acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Cancelar'),
            submit));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const answer = textarea.value.trim();
        if (!answer) {
            notify('Escreva sua resposta antes de enviar.', 'erro');
            textarea.focus();
            return;
        }
        submit.disabled = true;
        try {
            const result = await api(`/api/atividades/${activity.id_atividade}/entregas`, {
                method: 'POST', body: JSON.stringify({ resposta: answer })
            });
            activity.entrega = { enviado_em: result?.enviado_em || null, nota: null, feedback: null };
            $('#dialogo').close();
            clearErrorNotifications();
            notify('Atividade enviada!', 'sucesso');
            loadSource('atividades');
        } catch (error) {
            notify(error.message, 'erro');
            submit.disabled = false;
        }
    });
    openDialog(previousAnswer ? `Reenviar: ${activity.titulo}` : activity.titulo, form);
    textarea.focus();
}

async function openSubmissionDialog(activity, status) {
    const submission = submissionOf(activity);
    const body = el('div', { class: 'envio' }, skeletonList(1));
    openDialog(activity.titulo, body);
    let answer = null;
    try {
        const list = await api(`/api/atividades/${activity.id_atividade}/entregas`);
        answer = Array.isArray(list) ? list[0] : list;
    } catch (error) {
        body.replaceChildren(errorState(error.message, () => openSubmissionDialog(activity, status)));
        return;
    }
    const nodes = [
        el('p', { class: 'meta', text: `${activity.nome_disciplina || 'Atividade'} · enviada em ${fullDateTime(answer?.enviado_em || submission?.enviado_em)}` })
    ];
    if (status === 'corrigidas') {
        nodes.push(el('div', { class: 'correcao' },
            el('p', { class: 'correcao-nota' }, el('span', { class: 'meta', text: 'Nota' }), el('strong', { text: formatGrade(submission.nota) })),
            el('div', {}, el('p', { class: 'campo-rotulo', text: 'Comentário do professor' }),
                el('p', { class: 'texto-livre', text: submission.feedback || 'Sem comentário.' }))));
    }
    nodes.push(el('p', { class: 'campo-rotulo', text: 'Sua resposta' }),
        el('p', { class: 'texto-livre caixa-resposta', text: answer?.resposta || 'Resposta não encontrada.' }));
    const actions = el('div', { class: 'acoes' },
        el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Fechar'));
    if (status === 'entregues' && !isOverdue(activity)) {
        actions.append(el('button', {
            class: 'botao botao-primario', type: 'button',
            on: { click: () => openSubmitDialog(activity, answer?.resposta || '') }
        }, icon('pencil-simple'), 'Reenviar'));
    }
    nodes.push(actions);
    body.replaceChildren(...nodes);
}

// ---------------------------------------------------------------- Frequência

function renderAttendanceSummary() {
    const guard = sourceGuard(['frequencias', 'desempenho'], 3);
    if (guard) return guard;
    const attendance = state.sources.desempenho.data?.frequencia || { aulas: 0, presencas: 0, faltas: 0, percentual: 0 };
    const disciplines = attendanceByDiscipline();
    const totalAbsences = attendance.faltas ?? absences().length;
    const below = disciplines.filter((item) => item.percentual < FREQUENCIA_MINIMA).length;

    const kpi = (label, value, note) => card('cartao-kpi',
        el('h2', { class: 'cartao-rotulo', text: label }),
        el('span', { class: 'kpi-valor', text: value }),
        el('span', { class: 'meta', text: note }));

    const nodes = [el('div', { class: 'grade-kpis' },
        kpi('Frequência geral', attendance.aulas ? `${Math.round(attendance.percentual)}%` : '—', `Mínimo para aprovação: ${FREQUENCIA_MINIMA}%`),
        kpi('Faltas', String(totalAbsences), below ? `${plural(below, 'disciplina', 'disciplinas')} abaixo do mínimo` : 'Nenhuma disciplina abaixo do mínimo'),
        kpi('Aulas registradas', String(attendance.aulas), `${plural(attendance.presencas, 'presença', 'presenças')}`))];

    const section = card('cartao-disciplinas',
        el('div', { class: 'linha-entre' },
            el('h2', { class: 'cartao-titulo', text: 'Por disciplina' }),
            el('span', { class: 'meta legenda-minimo' }, el('span', { class: 'traco-minimo', 'aria-hidden': 'true' }), `mínimo ${FREQUENCIA_MINIMA}%`)));
    if (!disciplines.length) {
        section.append(emptyState('Nenhuma aula registrada ainda.', 'list-checks'));
    } else {
        section.append(el('ul', { class: 'lista-disciplinas' }, disciplines.map((item) => el('li', { class: 'linha-disciplina' },
            el('span', { class: 'disciplina-nome', text: item.nome }),
            attendanceBar(item.percentual),
            el('span', { class: `disciplina-pct${item.percentual < FREQUENCIA_MINIMA ? ' alerta' : ''}`, text: `${item.percentual}%` }),
            el('span', { class: 'meta disciplina-faltas', text: item.faltas ? plural(item.faltas, 'falta', 'faltas') : 'sem faltas' })))));
    }
    nodes.push(section);
    return nodes;
}

function renderAbsences() {
    const guard = sourceGuard('frequencias', 3);
    if (guard) return guard;
    const list = absences();
    if (!list.length) return emptyState('Nenhuma falta registrada. Continue assim!', 'calendar-check');
    return card('cartao-tabela',
        el('table', { class: 'tabela' },
            el('caption', { class: 'visually-hidden', text: 'Histórico de faltas' }),
            el('thead', {}, el('tr', {},
                el('th', { scope: 'col', text: 'Data' }),
                el('th', { scope: 'col', text: 'Disciplina' }),
                el('th', { scope: 'col', text: 'Observação' }))),
            el('tbody', {}, list.map((record) => el('tr', {},
                el('td', { class: 'tabela-data', 'data-rotulo': 'Data', text: formatSchoolDate(record.data_aula) }),
                el('td', { class: 'tabela-forte', 'data-rotulo': 'Disciplina', text: record.nome_disciplina || '—' }),
                el('td', { 'data-rotulo': 'Observação', text: record.observacao || '—' }))))));
}

// ---------------------------------------------------------------- Ajustes

function renderProfile() {
    const user = state.user;
    const course = COURSE_NAMES[user.curso] || user.curso || '—';
    const series = SERIES_NAMES[user.serie] || (user.serie ? `${user.serie}ª série` : '—');
    const rows = [
        ['Nome', user.nome || '—'],
        ['Matrícula', user.login || (user.conta_compartilhada ? 'Conta compartilhada da turma' : '—')],
        ['Curso', course],
        ['Série', series],
        ['Turma', user.nome_turma || '—']
    ];
    return [
        card('perfil-topo',
            el('span', { class: 'avatar avatar-grande', 'aria-hidden': 'true', text: initials(user.nome) }),
            el('div', { class: 'perfil-texto' },
                el('h2', { class: 'perfil-nome', text: user.nome || 'Aluno(a)' }),
                el('p', { class: 'meta', text: [course, user.nome_turma, user.login ? `Matrícula ${user.login}` : null].filter(Boolean).join(' · ') }))),
        card('cartao-dados',
            el('h2', { class: 'cartao-titulo', text: 'Dados escolares' }),
            el('dl', { class: 'dados' }, rows.map(([key, value]) => el('div', { class: 'dado' },
                el('dt', { text: key }), el('dd', { text: value })))),
            el('p', { class: 'meta', text: 'Algum dado errado? Procure a secretaria da escola.' })),
        logoutCard()
    ];
}

function logoutCard() {
    return card('cartao-sair',
        el('div', {}, el('h2', { class: 'cartao-titulo', text: 'Sair da conta' }),
            el('p', { class: 'meta', text: 'Encerra a sessão neste aparelho.' })),
        el('button', { class: 'botao botao-contorno botao-perigo', type: 'button', on: { click: logout } }, icon('sign-out'), 'Sair'));
}

function passwordField(id, label, autocomplete) {
    const input = el('input', { id, name: id, type: 'password', autocomplete, required: true, minlength: '8', maxlength: '128' });
    const toggle = el('button', {
        class: 'botao-icone olho', type: 'button', 'aria-label': `Mostrar ${label.toLowerCase()}`, 'aria-pressed': 'false',
        on: {
            click: () => {
                const show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                toggle.setAttribute('aria-pressed', String(show));
                toggle.replaceChildren(icon(show ? 'eye-slash' : 'eye'));
            }
        }
    }, icon('eye'));
    return el('div', { class: 'campo' },
        el('label', { class: 'campo-rotulo', for: id, text: label }),
        el('div', { class: 'campo-senha' }, input, toggle));
}

function renderSecurity() {
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, 'Salvar nova senha');
    const form = el('form', { class: 'cartao formulario cartao-senha', novalidate: true, 'aria-labelledby': 'senha-titulo' },
        el('h2', { class: 'cartao-titulo', id: 'senha-titulo', text: 'Alterar senha' }),
        passwordField('senha-atual', 'Senha atual', 'current-password'),
        passwordField('senha-nova', 'Nova senha', 'new-password'),
        passwordField('senha-confirmar', 'Confirmar nova senha', 'new-password'),
        el('p', { class: 'meta', text: 'Use pelo menos 8 caracteres. Ao trocar, as outras sessões abertas são encerradas.' }),
        submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const current = form.querySelector('#senha-atual');
        const next = form.querySelector('#senha-nova');
        const confirm = form.querySelector('#senha-confirmar');
        if (!current.value) return fieldError(current, 'Informe a senha atual.');
        if (next.value.length < 8) return fieldError(next, 'A nova senha deve ter pelo menos 8 caracteres.');
        if (next.value !== confirm.value) return fieldError(confirm, 'A confirmação não confere com a nova senha.');
        if (next.value === current.value) return fieldError(next, 'A nova senha precisa ser diferente da atual.');
        submit.disabled = true;
        try {
            const result = await api('/api/auth/password', {
                method: 'POST', body: JSON.stringify({ senha_atual: current.value, nova_senha: next.value })
            });
            form.reset();
            clearErrorNotifications();
            notify(result?.mensagem || 'Senha atualizada com sucesso.', 'sucesso');
        } catch (error) {
            notify(error.message, 'erro');
        } finally {
            submit.disabled = false;
        }
        return undefined;
    });
    return [form];
}

function fieldError(input, message) {
    notify(message, 'erro');
    input.setAttribute('aria-invalid', 'true');
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'), { once: true });
    input.focus();
}

function renderHelp() {
    return el('div', { class: 'grade-ajuda' },
        card('cartao-faq',
            el('h2', { class: 'visually-hidden', text: 'Perguntas frequentes' }),
            FAQ.map(([question, answer], index) => {
                const details = el('details', { class: 'faq' },
                    el('summary', {}, el('span', { text: question }), icon('plus')),
                    el('p', { text: answer }));
                if (index === 0) details.open = true;
                return details;
            })),
        card('cartao-contato',
            icon('headset'),
            el('h2', { class: 'cartao-titulo', text: 'Precisa falar com alguém?' }),
            el('p', { class: 'meta', text: 'Procure a secretaria ou a coordenação do CEEP Lourdinha Guerra, de segunda a sexta, no horário de funcionamento da escola.' })));
}

// ---------------------------------------------------------------- início

initialize();
