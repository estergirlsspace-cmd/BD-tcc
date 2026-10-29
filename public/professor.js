// Portal do Professor (C·Warning).
// Aplicação de página única: navegação por hash (#/secao/...), dados reais da API,
// renderização só com createElement/textContent (nada de innerHTML com dados).
// Depende de /datas.js (datas no horário de Brasília), /notificacoes.js (notify) e
// /componentes/mensagens.js (CwMensagens, componente compartilhado de mensagens).

'use strict';

const TOKEN_KEY = 'cwarning-token';
const token = sessionStorage.getItem(TOKEN_KEY);
const FUSO_ESCOLA = 'America/Sao_Paulo';
const FREQUENCIA_MINIMA = 75;
const ANEXO_MAX_BYTES = 5 * 1024 * 1024;
const POLLING_MENSAGENS_MS = 30000;
const MOBILE_QUERY = window.matchMedia('(max-width: 899.98px)');

const AREAS = {
    natureza: 'Ciências da Natureza',
    humanas: 'Ciências Humanas',
    linguagens: 'Linguagens',
    matematica: 'Matemática',
    informatica: 'Base técnica · Informática',
    redes: 'Base técnica · Redes'
};
const COURSE_NAMES = { informatica: 'Informática', redes: 'Redes de Computadores' };

const SECTIONS = {
    inicio: { title: 'Início', icon: 'house' },
    turmas: { title: 'Turmas', icon: 'users-three' },
    chamada: { title: 'Chamada', icon: 'list-checks' },
    atividades: { title: 'Atividades', icon: 'clipboard-text' },
    avisos: { title: 'Avisos', icon: 'megaphone-simple' },
    ocorrencias: { title: 'Ocorrências', icon: 'warning-octagon' },
    mensagens: { title: 'Mensagens', icon: 'chats-circle' },
    configuracoes: { title: 'Configurações', icon: 'gear-six' },
    mais: { title: 'Mais', icon: 'dots-three-outline' }
};

const SETTINGS_TABS = [
    ['perfil', 'Perfil', 'user-circle'],
    ['notificacoes', 'Notificações', 'bell-simple'],
    ['aparencia', 'Aparência', 'palette'],
    ['seguranca', 'Senha e segurança', 'lock-key']
];

const NOTICE_TYPES = {
    aviso: 'Aviso',
    evento: 'Evento',
    comunicado: 'Comunicado',
    atividade: 'Atividade',
    avaliacao: 'Avaliação'
};

const ACTIVITY_TYPES = {
    atividade: { label: 'Atividade', icon: 'clipboard-text' },
    avaliacao: { label: 'Avaliação', icon: 'exam' },
    evento: { label: 'Evento', icon: 'flag' },
    comunicado: { label: 'Comunicado', icon: 'megaphone-simple' }
};

const NOTIFICATION_TYPES = [
    ['urgente', 'Avisos urgentes', 'Comunicados marcados como urgentes pela escola.'],
    ['turma', 'Avisos das minhas turmas', 'Publicações para as turmas em que você leciona.'],
    ['prazos', 'Prazos', 'Lembretes de prazos de atividades.'],
    ['eventos', 'Eventos', 'Eventos e datas do calendário escolar.'],
    ['mensagens', 'Mensagens', 'Novas mensagens de alunos e da coordenação.']
];

const SOURCE_PATHS = {
    painel: '/api/painel',
    disciplinas: '/api/disciplinas',
    turmas: '/api/turmas',
    horarios: '/api/horarios',
    frequencias: '/api/frequencias',
    atividades: '/api/atividades',
    avisos: '/api/avisos',
    ocorrencias: '/api/ocorrencias',
    conversas: '/api/mensagens',
    conta: '/api/conta',
    sessoes: '/api/conta/sessoes'
};

// ---------------------------------------------------------------- estado

const state = {
    user: null,
    route: { section: 'inicio', parts: [] },
    sources: Object.fromEntries(Object.keys(SOURCE_PATHS)
        .map((name) => [name, { status: 'idle', data: null, error: null, code: null }])),
    rosters: new Map(),      // id_disciplina → { status, alunos, error } (data de hoje)
    submissions: new Map(),  // id_atividade → { status, data, error }
    chamada: null,
    activityFilter: '',
    unreadMessages: 0,
    messagesUnavailable: false
};

// Nós persistentes (formulários e o componente de mensagens) para não perder o que foi digitado
// quando a tela é redesenhada.
const persistent = new Map();

const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------- API e sessão

function leaveToLogin() {
    sessionStorage.removeItem(TOKEN_KEY);
    window.location.replace('/');
}

async function api(path, options = {}) {
    const isJson = options.body !== undefined && typeof options.body === 'string';
    const response = await fetch(path, {
        ...options,
        headers: {
            ...(isJson ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers
        }
    });
    if (response.status === 401) {
        leaveToLogin();
        throw Object.assign(new Error('Sua sessão expirou. Entre novamente.'), { status: 401 });
    }
    const text = await response.text();
    let result = null;
    try {
        result = text ? JSON.parse(text) : null;
    } catch {
        throw Object.assign(new Error('O servidor retornou uma resposta inválida.'), { status: response.status });
    }
    if (!response.ok) {
        const fallback = response.status === 501
            ? 'Esta função ainda está em construção no servidor.'
            : 'Não foi possível concluir a solicitação.';
        throw Object.assign(new Error(result?.erro || fallback), { status: response.status });
    }
    return result;
}

const json = (method, body) => ({ method, body: JSON.stringify(body) });

async function logout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch {
        // A sessão local é encerrada mesmo se o servidor não responder.
    }
    leaveToLogin();
}

function source(name) {
    return state.sources[name];
}

async function loadSource(name) {
    const item = source(name);
    item.status = 'loading';
    item.error = null;
    item.code = null;
    render();
    try {
        item.data = await api(SOURCE_PATHS[name]);
        item.status = 'ok';
    } catch (error) {
        item.status = 'error';
        item.error = error.message;
        item.code = error.status || null;
    }
    render();
}

// Carrega as fontes ainda não pedidas (as que já estão carregando ou prontas ficam como estão).
function ensure(...names) {
    for (const name of names.flat()) {
        if (source(name).status === 'idle') loadSource(name);
    }
}

function reload(...names) {
    names.flat().forEach(loadSource);
}

function isUnavailable(item) {
    return item.code === 501 || item.code === 404;
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
    if (state.user.tipo_usuario !== 'professor' || state.user.deve_trocar_senha) {
        leaveToLogin();
        return;
    }

    setupShell();
    ensure('disciplinas', 'turmas', 'horarios');
    applyRoute(parseHash(), { focus: false });
    window.addEventListener('hashchange', () => applyRoute(parseHash(), { focus: true }));
    MOBILE_QUERY.addEventListener('change', render);
    startUnreadPolling();
}

function showFatalError(message) {
    $('#conteudo').replaceChildren(errorState(message, () => window.location.reload()));
    $('#titulo-pagina').textContent = 'Portal do Professor';
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
        else if (key === 'value') node.value = value;
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
        retry ? el('button', { class: 'botao botao-contorno', type: 'button', on: { click: retry } },
            icon('arrow-clockwise'), 'Tentar de novo') : null);
}

// Função ainda não publicada pelo servidor (501): aviso calmo, sem cara de erro.
function soonState(text) {
    return el('div', { class: 'estado-vazio estado-embreve' }, icon('hourglass-medium'), el('p', { text }));
}

function skeleton(count = 3) {
    return el('div', { class: 'esqueleto-lista', 'aria-busy': 'true' },
        srText('Carregando…'),
        Array.from({ length: count }, () => el('div', { class: 'esqueleto esqueleto-bloco', 'aria-hidden': 'true' })));
}

// Devolve o nó adequado ao estado das fontes, ou null quando os dados estão prontos.
function guard(names, { count = 3, soon } = {}) {
    const list = [].concat(names);
    ensure(list);
    const failed = list.find((name) => source(name).status === 'error');
    if (failed) {
        if (soon && isUnavailable(source(failed))) return soonState(soon);
        return errorState(source(failed).error, () => reload(list.filter((name) => source(name).status === 'error')));
    }
    if (list.some((name) => source(name).status !== 'ok')) return skeleton(count);
    return null;
}

function card(className, ...children) {
    return el('section', { class: `cartao ${className || ''}`.trim() }, ...children);
}

function cardHeader(title, iconName, ...extra) {
    return el('div', { class: 'cartao-cabecalho' },
        iconName ? el('span', { class: 'icone-quadrado' }, icon(iconName)) : null,
        el('h2', { class: 'cartao-titulo', text: title }),
        el('span', { class: 'empurra' }),
        ...extra);
}

function setBarValue(bar, percent) {
    bar.style.setProperty('--valor', `${Math.max(0, Math.min(100, percent))}%`);
    return bar;
}

function progressBar(percent, { alert = false, label } = {}) {
    const bar = el('div', {
        class: `barra${alert ? ' barra-alerta' : ''}`,
        role: 'img',
        'aria-label': label || `${formatPercent(percent)}`
    }, el('span', { class: 'barra-valor' }));
    return setBarValue(bar, percent);
}

function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

function avatar(name, extraClass = '') {
    return el('span', { class: `avatar ${extraClass}`.trim(), 'aria-hidden': 'true', text: initials(name) });
}

function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || 'professor(a)';
}

function plural(count, singular, pluralWord) {
    return `${count} ${count === 1 ? singular : pluralWord}`;
}

function truncate(text, max) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    const rounded = Math.round(Number(value) * 10) / 10;
    return `${rounded.toLocaleString('pt-BR')}%`;
}

function isBelowMinimum(percent) {
    return percent !== null && percent !== undefined && Number(percent) < FREQUENCIA_MINIMA;
}

function announce(text) {
    const status = $('#status-leitor');
    status.textContent = '';
    window.setTimeout(() => { status.textContent = text; }, 50);
}

function field(labelText, control, { hint, id } = {}) {
    const controlId = id || control.id || `campo-${Math.random().toString(36).slice(2, 9)}`;
    control.id = controlId;
    const hintId = hint ? `${controlId}-dica` : null;
    if (hintId) control.setAttribute('aria-describedby', hintId);
    return el('div', { class: 'campo' },
        el('label', { for: controlId, text: labelText }),
        control,
        hint ? el('p', { class: 'campo-dica', id: hintId, text: hint }) : null);
}

function selectOptions(select, options, placeholder) {
    const current = select.value;
    select.replaceChildren(
        placeholder !== undefined ? el('option', { value: '', text: placeholder }) : null,
        ...options.map(([value, label]) => el('option', { value: String(value), text: label }))
    );
    if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function persistentNode(key, build) {
    if (!persistent.has(key)) persistent.set(key, build());
    return persistent.get(key);
}

async function withBusy(button, task) {
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        await task();
    } finally {
        button.disabled = false;
        button.removeAttribute('aria-busy');
    }
}

// ---------------------------------------------------------------- datas (Brasília)

function schoolParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO_ESCOLA, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    const weekdays = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        ymd: `${get('year')}-${get('month')}-${get('day')}`,
        hm: `${get('hour')}:${get('minute')}`,
        hour: Number(get('hour')),
        weekday: weekdays[get('weekday')] // 1 = segunda … 7 = domingo (igual a dia_semana)
    };
}

function todayYmd() {
    return schoolParts().ymd;
}

function todayLongLabel() {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO_ESCOLA, weekday: 'long', day: 'numeric', month: 'long'
    }).format(new Date()).replace('-feira', '').toUpperCase();
}

function greeting() {
    const hour = schoolParts().hour;
    if (hour < 5) return 'Boa noite';
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
}

function longDate(ymd) {
    const date = parseSchoolDate(ymd);
    if (!date) return ymd || '';
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: FUSO_ESCOLA, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
}

function timeAgo(utcValue) {
    const date = parseSchoolDate(utcValue, { utc: true });
    if (!date) return '';
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return 'agora';
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours} h`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'ontem';
    if (days < 7) return `há ${days} dias`;
    return formatSchoolDate(utcValue, { utc: true }).slice(0, 10);
}

function deadlineLabel(prazo) {
    if (!prazo) return 'Sem prazo';
    const date = parseSchoolDate(prazo);
    if (!date) return prazo;
    const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_ESCOLA, weekday: 'short' })
        .format(date).replace('.', '');
    const day = date.toLocaleDateString('pt-BR', { timeZone: FUSO_ESCOLA, day: '2-digit', month: '2-digit' });
    const time = (/[T ](\d{2}:\d{2})/.exec(prazo)?.[1] || '23:59').replace(':', 'h');
    return `até ${weekday}, ${day} · ${time}`;
}

function deadlinePassed(prazo) {
    if (!prazo) return false;
    const base = parseSchoolDate(prazo);
    if (!base) return false;
    const end = /[T ]\d{2}:\d{2}/.test(prazo) ? base.getTime() : base.getTime() + (24 * 3600 - 1) * 1000;
    return end < Date.now();
}

// ---------------------------------------------------------------- dados derivados

function teachingAssignments() {
    const classes = new Map((source('turmas').data || []).map((item) => [item.id_turma, item]));
    return (source('disciplinas').data || [])
        .map((discipline) => {
            const schoolClass = classes.get(discipline.id_turma);
            return {
                ...discipline,
                nome_turma: schoolClass?.nome_turma || `Turma ${discipline.id_turma}`,
                turma: schoolClass || null
            };
        })
        .sort((a, b) => a.nome_turma.localeCompare(b.nome_turma, 'pt-BR')
            || a.nome_disciplina.localeCompare(b.nome_disciplina, 'pt-BR'));
}

function assignmentLabel(assignment) {
    return `${assignment.nome_disciplina} · ${assignment.nome_turma}`;
}

function findAssignment(disciplineId) {
    return teachingAssignments().find((item) => item.id_disciplina === Number(disciplineId)) || null;
}

function myClasses() {
    const byId = new Map();
    for (const assignment of teachingAssignments()) {
        const entry = byId.get(assignment.id_turma) || {
            id_turma: assignment.id_turma,
            nome_turma: assignment.nome_turma,
            curso: assignment.turma?.curso,
            serie: assignment.turma?.serie,
            disciplinas: []
        };
        entry.disciplinas.push(assignment);
        byId.set(assignment.id_turma, entry);
    }
    return [...byId.values()];
}

function lessonsToday() {
    const weekday = schoolParts().weekday;
    const assignments = new Map(teachingAssignments().map((item) => [item.id_disciplina, item]));
    return (source('horarios').data || [])
        .filter((lesson) => lesson.dia_semana === weekday)
        .map((lesson) => ({
            ...lesson,
            nome_disciplina: lesson.nome_disciplina || assignments.get(lesson.id_disciplina)?.nome_disciplina,
            nome_turma: lesson.nome_turma || assignments.get(lesson.id_disciplina)?.nome_turma
        }))
        .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
}

function lessonNow(lessons) {
    const now = schoolParts().hm;
    return lessons.find((lesson) => lesson.hora_inicio <= now && now < lesson.hora_fim) || null;
}

function lessonNext(lessons) {
    const now = schoolParts().hm;
    return lessons.find((lesson) => lesson.hora_inicio > now) || null;
}

function percentOf(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
    if (typeof value === 'object') {
        if (value.percentual !== undefined) return percentOf(value.percentual);
        if (value.aulas) return Math.round(((value.presencas || 0) / value.aulas) * 1000) / 10;
    }
    return null;
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

// O painel é tolerante ao formato: aceita nomes alternativos de campos e completa o que faltar
// com dados das fontes básicas (horários, disciplinas, frequências).
function dashboard() {
    const panel = source('painel').status === 'ok' ? source('painel').data || {} : null;
    const todayLessons = lessonsToday();
    const lessons = panel && Array.isArray(panel.aulas_hoje || panel.aulas)
        ? (panel.aulas_hoje || panel.aulas).map((lesson) => ({
            ...lesson,
            nome_disciplina: lesson.nome_disciplina || lesson.disciplina?.nome_disciplina || lesson.disciplina,
            nome_turma: lesson.nome_turma || lesson.turma?.nome_turma || lesson.turma
        }))
        : todayLessons;
    const current = panel?.aula_em_andamento || panel?.em_andamento
        || lessons.find((lesson) => lesson.em_andamento) || lessonNow(lessons);

    let classes = null;
    if (panel && Array.isArray(panel.turmas)) {
        classes = panel.turmas.map((item) => ({
            id_turma: item.id_turma,
            nome_turma: item.nome_turma || item.nome,
            alunos: firstDefined(item.alunos, item.total_alunos, item.n_alunos, item.qtd_alunos),
            frequencia: percentOf(firstDefined(item.frequencia, item.percentual, item.frequencia_media))
        }));
    } else if (source('frequencias').status === 'ok') {
        classes = myClasses().map((schoolClass) => {
            const records = (source('frequencias').data || []).filter((record) =>
                schoolClass.disciplinas.some((item) => item.id_disciplina === record.id_disciplina));
            const students = new Set(records.map((record) => record.id_aluno));
            const present = records.filter((record) => record.presente).length;
            return {
                id_turma: schoolClass.id_turma,
                nome_turma: schoolClass.nome_turma,
                alunos: students.size || null,
                frequencia: records.length ? Math.round((present / records.length) * 1000) / 10 : null
            };
        });
    }

    let deliveries = null;
    const rawDeliveries = panel && (panel.entregas || panel.entregas_recebidas || panel.atividades);
    if (Array.isArray(rawDeliveries)) {
        deliveries = rawDeliveries.map((item) => ({
            id_atividade: item.id_atividade,
            titulo: item.titulo,
            nome_turma: item.nome_turma || item.turma,
            nome_disciplina: item.nome_disciplina,
            enviadas: Number(firstDefined(item.enviadas, item.entregues, 0)),
            total: Number(firstDefined(item.total, item.total_alunos, 0))
        }));
    }

    const justifications = panel ? firstDefined(panel.justificativas_pendentes,
        panel.justificativas?.pendentes, Array.isArray(panel.justificativas) ? panel.justificativas.length : undefined,
        typeof panel.justificativas === 'number' ? panel.justificativas : undefined) : null;
    const messages = panel ? firstDefined(panel.mensagens_nao_lidas, panel.mensagens?.nao_lidas,
        typeof panel.mensagens === 'number' ? panel.mensagens : undefined) : null;

    return { panel, lessons, current, next: current ? null : lessonNext(lessons), classes, deliveries, justifications, messages };
}

function normalizeRoster(result) {
    const list = Array.isArray(result) ? result : (result?.alunos || result?.presencas || []);
    return list.map((student) => {
        const presence = firstDefined(student.presente, student.presenca);
        return {
            id_aluno: student.id_aluno ?? student.aluno?.id_aluno,
            nome: student.nome || student.aluno?.nome || 'Aluno',
            presente: presence === undefined || presence === null ? null : Boolean(presence),
            frequencia: percentOf(firstDefined(student.frequencia, student.percentual, student.frequencia_acumulada)),
            aulas: firstDefined(student.frequencia?.aulas, student.aulas),
            faltas: firstDefined(student.frequencia?.faltas, student.faltas)
        };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function fetchRoster(disciplineId, date) {
    const query = new URLSearchParams({ id_disciplina: String(disciplineId), data: date });
    return normalizeRoster(await api(`/api/chamadas?${query}`));
}

// Lista de alunos de uma disciplina (com frequência acumulada), usada em Turmas e Ocorrências.
function roster(disciplineId) {
    const key = Number(disciplineId);
    if (!state.rosters.has(key)) {
        const entry = { status: 'loading', alunos: [], error: null, code: null };
        state.rosters.set(key, entry);
        fetchRoster(key, todayYmd())
            .then((students) => { entry.status = 'ok'; entry.alunos = students; })
            .catch((error) => { entry.status = 'error'; entry.error = error.message; entry.code = error.status; })
            .finally(render);
    }
    return state.rosters.get(key);
}

function retryRoster(disciplineId) {
    state.rosters.delete(Number(disciplineId));
    render();
}

function myNotices() {
    return (source('avisos').data || [])
        .filter((notice) => notice.id_usuario_autor === state.user.id_usuario)
        .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

function className(classId) {
    return myClasses().find((item) => item.id_turma === classId)?.nome_turma || 'Turma';
}

// ---------------------------------------------------------------- navegação

function parseHash() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const [section, ...parts] = raw.split('/').filter(Boolean).map(decodeURIComponent);
    if (!SECTIONS[section]) return { section: 'inicio', parts: [] };
    return { section, parts };
}

function applyRoute(route, { focus }) {
    if (route.section === 'mais' && !MOBILE_QUERY.matches) {
        window.location.replace('#/configuracoes/perfil');
        return;
    }
    state.route = route;
    render();
    window.scrollTo(0, 0);
    if (focus) $('#titulo-pagina').focus({ preventScroll: true });
}

function setupShell() {
    const user = state.user;
    $('#usuario-avatar').textContent = initials(user.nome || user.login);
    $('#usuario-nome').textContent = user.nome || user.login;
    $('#usuario-detalhe').textContent = AREAS[user.area] || 'Professor(a)';
    document.querySelectorAll('[data-sair]').forEach((button) => button.addEventListener('click', logout));

    const dialog = $('#dialogo');
    dialog.querySelector('[data-fechar-dialogo]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });

    window.addEventListener('beforeunload', (event) => {
        if (state.chamada?.dirty) event.preventDefault();
    });
}

function updateNavigation() {
    const current = state.route.section;
    document.querySelectorAll('[data-secao]').forEach((link) => {
        const active = link.dataset.secao === current
            || (link.dataset.secao === 'mais' && ['turmas', 'atividades', 'ocorrencias', 'configuracoes'].includes(current)
                && MOBILE_QUERY.matches);
        link.classList.toggle('ativo', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

function updateUnreadBadges() {
    const total = state.unreadMessages;
    document.querySelectorAll('[data-contador-mensagens]').forEach((badge) => {
        badge.hidden = !total;
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.setAttribute('aria-label', plural(total, 'mensagem não lida', 'mensagens não lidas'));
    });
    document.querySelectorAll('[data-ponto-mensagens]').forEach((dot) => { dot.hidden = !total; });
}

function setUnread(total) {
    const value = Math.max(0, Number(total) || 0);
    if (value === state.unreadMessages) return;
    state.unreadMessages = value;
    updateUnreadBadges();
}

async function pollUnread() {
    if (state.messagesUnavailable || document.visibilityState !== 'visible') return;
    try {
        const result = await api('/api/mensagens/nao-lidas');
        setUnread(result?.total);
    } catch (error) {
        if (error.status === 501 || error.status === 404) state.messagesUnavailable = true;
    }
}

function startUnreadPolling() {
    pollUnread();
    window.setInterval(pollUnread, POLLING_MENSAGENS_MS);
    document.addEventListener('visibilitychange', pollUnread);
}

// ---------------------------------------------------------------- render principal

const RENDERERS = {
    inicio: renderHome,
    turmas: renderClasses,
    chamada: renderAttendance,
    atividades: renderActivities,
    avisos: renderNotices,
    ocorrencias: renderIncidents,
    mensagens: renderMessages,
    configuracoes: renderSettings,
    mais: renderMore
};

let renderQueued = false;

// Agrupa várias mudanças de estado num único redesenho.
function render() {
    if (renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
        renderQueued = false;
        renderNow();
    });
}

function renderNow() {
    if (!state.user) return;
    const { section } = state.route;
    updateNavigation();
    updateUnreadBadges();
    const meta = SECTIONS[section];
    const view = RENDERERS[section]();
    $('#topo-trilha').textContent = view.trail || 'Portal do Professor';
    $('#titulo-pagina').textContent = view.title || meta.title;
    document.title = `${view.title || meta.title} · Portal do Professor · C·Warning`;
    $('#topo-acoes').replaceChildren(...(view.actions || []));
    const main = $('#conteudo');
    main.dataset.secao = section;
    main.replaceChildren(...[].concat(view.content).flat(Infinity).filter(Boolean));
}

// ---------------------------------------------------------------- Início

function renderHome() {
    ensure('painel', 'conversas');
    const panelSource = source('painel');
    if (panelSource.status === 'error') ensure('frequencias');
    const base = guard(['disciplinas', 'turmas', 'horarios'], { count: 4 });
    const header = el('div', { class: 'saudacao' },
        el('p', { class: 'sobretitulo', text: todayLongLabel() }),
        el('p', { class: 'saudacao-titulo', text: `${greeting()}, ${firstName(state.user.nome)}` }));
    if (base) return { title: 'Início', content: [header, base] };
    if (panelSource.status === 'loading' || panelSource.status === 'idle') {
        return { title: 'Início', content: [header, skeleton(4)] };
    }

    const data = dashboard();
    const notice = panelSource.status === 'error'
        ? el('p', { class: 'nota-discreta', role: 'note' }, icon('info'),
            isUnavailable(panelSource)
                ? 'O painel completo ainda está em construção. Mostrando aulas e turmas a partir dos horários.'
                : `Painel indisponível (${panelSource.error}). Mostrando o essencial.`,
            el('button', { class: 'link-botao', type: 'button', on: { click: () => reload('painel') } }, 'Tentar de novo'))
        : null;

    const kpis = [];
    if (data.justifications !== null && data.justifications !== undefined) {
        kpis.push(el('span', { class: 'selo' }, icon('file-text'), plural(Number(data.justifications), 'justificativa pendente', 'justificativas pendentes')));
    }
    const unread = data.messages ?? (state.unreadMessages || null);
    if (unread) {
        kpis.push(el('a', { class: 'selo selo-azul', href: '#/mensagens' }, icon('chats-circle'), plural(Number(unread), 'mensagem não lida', 'mensagens não lidas')));
    }

    return {
        title: 'Início',
        content: [
            header,
            notice,
            kpis.length ? el('div', { class: 'linha-selos' }, kpis) : null,
            el('div', { class: 'grade-inicio' },
                el('div', { class: 'coluna-principal' },
                    lessonHero(data),
                    classesCard(data),
                    deliveriesCard(data)),
                el('div', { class: 'coluna-lateral' },
                    todayLessonsCard(data),
                    shortcutsCard(),
                    recentMessagesCard()))
        ]
    };
}

function lessonHero(data) {
    const today = todayYmd();
    const lesson = data.current || data.next;
    if (!lesson) {
        return el('section', { class: 'cartao destaque-aula destaque-vazio' },
            el('p', { class: 'destaque-rotulo' }, icon('coffee'), 'Sem aula agora'),
            el('h2', { class: 'destaque-titulo', text: data.lessons.length ? 'Suas aulas de hoje já terminaram' : 'Nenhuma aula hoje' }),
            el('a', { class: 'botao botao-claro', href: '#/chamada' }, icon('list-checks'), 'Abrir chamada'));
    }
    const live = Boolean(data.current);
    const disciplineId = lesson.id_disciplina;
    return el('section', { class: 'cartao destaque-aula', 'aria-labelledby': 'destaque-titulo' },
        el('p', { class: 'destaque-rotulo' },
            live ? el('span', { class: 'ponto-ao-vivo', 'aria-hidden': 'true' }) : icon('clock'),
            live ? `Aula em andamento · ${lesson.hora_inicio}–${lesson.hora_fim}` : `Próxima aula · ${lesson.hora_inicio}–${lesson.hora_fim}`),
        el('h2', { class: 'destaque-titulo', id: 'destaque-titulo', text: lesson.nome_disciplina || 'Aula' }),
        el('p', { class: 'destaque-meta', text: [lesson.nome_turma, lesson.sala].filter(Boolean).join(' · ') }),
        disciplineId
            ? el('a', { class: 'botao botao-claro', href: `#/chamada/${disciplineId}/${today}` }, icon('list-checks'), 'Fazer chamada')
            : null);
}

function todayLessonsCard(data) {
    const nowLesson = data.current;
    const list = data.lessons.length
        ? el('ol', { class: 'lista-aulas' }, data.lessons.map((lesson) => {
            const live = nowLesson && lesson.hora_inicio === nowLesson.hora_inicio && lesson.id_disciplina === nowLesson.id_disciplina;
            return el('li', { class: `linha-aula${live ? ' agora' : ''}` },
                el('span', { class: 'hora', text: lesson.hora_inicio }),
                el('span', { class: 'linha-texto' },
                    el('strong', { text: lesson.nome_disciplina || 'Aula' }),
                    el('span', { class: 'meta', text: [lesson.nome_turma, lesson.sala, lesson.hora_fim ? `até ${lesson.hora_fim}` : null].filter(Boolean).join(' · ') })),
                live ? el('span', { class: 'selo selo-azul', text: 'Agora' }) : null,
                lesson.chamada_feita ? el('span', { class: 'selo', title: 'Chamada lançada hoje' }, icon('check'), 'Chamada') : null);
        }))
        : emptyState('Nenhuma aula no seu horário de hoje.', 'calendar-blank');
    return card('', cardHeader('Aulas de hoje', 'calendar-dots'), list);
}

function classesCard(data) {
    let body;
    if (data.classes === null) {
        const freq = source('frequencias');
        body = freq.status === 'error' ? errorState(freq.error, () => reload('frequencias')) : skeleton(2);
    } else if (!data.classes.length) {
        body = emptyState('Nenhuma turma vinculada ao seu perfil.', 'users-three');
    } else {
        body = el('ul', { class: 'grade-turmas' }, data.classes.map((item) => {
            const low = isBelowMinimum(item.frequencia);
            return el('li', {},
                el('a', { class: `cartao-turma${low ? ' alerta' : ''}`, href: item.id_turma ? `#/turmas/${item.id_turma}` : '#/turmas' },
                    el('strong', { class: 'turma-nome', text: item.nome_turma }),
                    el('span', { class: 'meta', text: item.alunos !== null && item.alunos !== undefined ? plural(Number(item.alunos), 'aluno', 'alunos') : 'Alunos' }),
                    el('span', { class: 'turma-frequencia' },
                        el('span', { class: 'turma-percentual', text: formatPercent(item.frequencia) }),
                        el('span', { class: 'meta', text: low ? 'abaixo do mínimo' : 'frequência' })),
                    progressBar(item.frequencia ?? 0, { alert: low, label: `Frequência ${formatPercent(item.frequencia)}` })));
        }));
    }
    return card('', cardHeader('Minhas turmas', 'users-three', el('a', { class: 'link-seta', href: '#/turmas' }, 'Ver todas', icon('arrow-right'))), body);
}

function deliveriesCard(data) {
    let body;
    if (data.deliveries === null) {
        body = source('painel').status === 'error' && !isUnavailable(source('painel'))
            ? errorState(source('painel').error, () => reload('painel'))
            : soonState('O resumo de entregas aparece aqui assim que o painel estiver disponível.');
    } else if (!data.deliveries.length) {
        body = emptyState('Nenhuma atividade com entrega no momento.', 'clipboard-text');
    } else {
        body = el('ul', { class: 'lista-barras' }, data.deliveries.map((item) => {
            const percent = item.total ? (item.enviadas / item.total) * 100 : 0;
            return el('li', {},
                el('a', { class: 'linha-barra', href: item.id_atividade ? `#/atividades/${item.id_atividade}` : '#/atividades' },
                    el('span', { class: 'linha-entre' },
                        el('strong', { text: item.titulo || 'Atividade' }),
                        el('span', { class: 'meta', text: `${item.enviadas}/${item.total}` })),
                    el('span', { class: 'meta', text: [item.nome_disciplina, item.nome_turma].filter(Boolean).join(' · ') }),
                    progressBar(percent, { label: `${item.enviadas} de ${item.total} entregas` })));
        }));
    }
    return card('', cardHeader('Entregas recebidas', 'tray-arrow-down', el('a', { class: 'link-seta', href: '#/atividades' }, 'Atividades', icon('arrow-right'))), body);
}

function shortcutsCard() {
    return card('', cardHeader('Atalhos', 'lightning'),
        el('div', { class: 'atalhos' },
            el('a', { class: 'atalho', href: '#/avisos' }, el('span', { class: 'icone-quadrado' }, icon('megaphone-simple')), 'Enviar aviso à turma'),
            el('a', { class: 'atalho', href: '#/ocorrencias' }, el('span', { class: 'icone-quadrado icone-alerta' }, icon('warning-octagon')), 'Registrar ocorrência')));
}

function conversationList() {
    const data = source('conversas').data;
    return Array.isArray(data) ? data : (data?.conversas || []);
}

function recentMessagesCard() {
    const conv = source('conversas');
    let body;
    if (conv.status === 'error') {
        body = isUnavailable(conv)
            ? soonState('As mensagens chegam em breve.')
            : errorState(conv.error, () => reload('conversas'));
    } else if (conv.status !== 'ok') {
        body = skeleton(2);
    } else {
        const items = conversationList().slice(0, 4);
        body = items.length
            ? el('ul', { class: 'lista-mensagens' }, items.map((item) => el('li', {},
                el('a', { class: 'linha-mensagem', href: '#/mensagens' },
                    avatar(item.com?.nome),
                    el('span', { class: 'linha-texto' },
                        el('span', { class: 'linha-entre' },
                            el('strong', { text: item.com?.nome || 'Contato' }),
                            el('span', { class: 'meta', text: timeAgo(item.ultima?.criado_em) })),
                        el('span', { class: 'meta', text: `${item.ultima?.minha ? 'Você: ' : ''}${truncate(item.ultima?.texto, 60)}` })),
                    item.nao_lidas ? el('span', { class: 'contador', text: String(item.nao_lidas) }, srText(' não lidas')) : null))))
            : emptyState('Nenhuma conversa ainda.', 'chats-circle');
    }
    return card('', cardHeader('Mensagens recentes', 'chats-circle', el('a', { class: 'link-seta', href: '#/mensagens' }, 'Abrir', icon('arrow-right'))), body);
}

// ---------------------------------------------------------------- Turmas

function renderClasses() {
    const [classIdText] = state.route.parts;
    const blocked = guard(['disciplinas', 'turmas']);
    if (blocked) return { title: 'Turmas', content: blocked };
    const classes = myClasses();
    if (classIdText) {
        const schoolClass = classes.find((item) => item.id_turma === Number(classIdText));
        if (!schoolClass) {
            return { title: 'Turmas', content: emptyState('Turma não encontrada entre as suas.', 'users-three') };
        }
        return renderClassDetail(schoolClass);
    }
    if (!classes.length) {
        return { title: 'Turmas', content: emptyState('Nenhuma turma vinculada ao seu perfil. Fale com a coordenação.', 'users-three') };
    }
    ensure('painel');
    const panelClasses = source('painel').status === 'ok' ? dashboard().classes || [] : [];
    return {
        title: 'Turmas',
        content: [
            el('p', { class: 'introducao', text: 'Turmas e disciplinas em que você leciona. Abra uma turma para ver os alunos e a frequência.' }),
            el('ul', { class: 'grade-cartoes' }, classes.map((schoolClass) => {
                const summary = panelClasses.find((item) => item.id_turma === schoolClass.id_turma);
                const low = isBelowMinimum(summary?.frequencia);
                return el('li', {},
                    el('a', { class: `cartao cartao-link cartao-turma-grande${low ? ' alerta' : ''}`, href: `#/turmas/${schoolClass.id_turma}` },
                        el('span', { class: 'linha-entre' },
                            el('strong', { class: 'turma-nome', text: schoolClass.nome_turma }),
                            icon('caret-right')),
                        el('span', { class: 'meta', text: [COURSE_NAMES[schoolClass.curso], summary?.alunos !== undefined && summary?.alunos !== null ? plural(Number(summary.alunos), 'aluno', 'alunos') : null].filter(Boolean).join(' · ') }),
                        el('span', { class: 'chips' }, schoolClass.disciplinas.map((item) => el('span', { class: 'chip', text: item.nome_disciplina }))),
                        summary && summary.frequencia !== null
                            ? el('span', { class: 'turma-frequencia' },
                                el('span', { class: 'turma-percentual', text: formatPercent(summary.frequencia) }),
                                el('span', { class: 'meta', text: low ? 'frequência abaixo do mínimo' : 'frequência média' }))
                            : null));
            }))
        ]
    };
}

function renderClassDetail(schoolClass) {
    const [, disciplineText] = state.route.parts;
    const selected = schoolClass.disciplinas.find((item) => item.id_disciplina === Number(disciplineText))
        || schoolClass.disciplinas[0];
    const tabs = el('div', { class: 'segmentado', role: 'group', 'aria-label': 'Disciplina' },
        schoolClass.disciplinas.map((item) => el('a', {
            class: `segmento${item === selected ? ' ativo' : ''}`,
            href: `#/turmas/${schoolClass.id_turma}/${item.id_disciplina}`,
            'aria-current': item === selected ? 'true' : null,
            text: item.nome_disciplina
        })));
    const entry = roster(selected.id_disciplina);
    let body;
    if (entry.status === 'loading') body = skeleton(4);
    else if (entry.status === 'error') {
        body = isUnavailable(entry)
            ? soonState('A lista de alunos com frequência aparece aqui quando a chamada estiver disponível no servidor.')
            : errorState(entry.error, () => retryRoster(selected.id_disciplina));
    } else if (!entry.alunos.length) body = emptyState('Nenhum aluno matriculado nesta turma.', 'user');
    else {
        const low = entry.alunos.filter((student) => isBelowMinimum(student.frequencia));
        body = [
            low.length ? el('p', { class: 'alerta-faixa', role: 'note' }, icon('warning'),
                `${plural(low.length, 'aluno está', 'alunos estão')} abaixo do mínimo de ${FREQUENCIA_MINIMA}% em ${selected.nome_disciplina}.`) : null,
            el('div', { class: 'tabela-rolagem' },
                el('table', { class: 'tabela' },
                    el('caption', { class: 'visually-hidden', text: `Alunos de ${schoolClass.nome_turma} em ${selected.nome_disciplina}` }),
                    el('thead', {}, el('tr', {},
                        el('th', { scope: 'col', text: 'Nº' }),
                        el('th', { scope: 'col', text: 'Aluno' }),
                        el('th', { scope: 'col', text: 'Frequência' }),
                        el('th', { scope: 'col', class: 'col-numero', text: 'Faltas' }))),
                    el('tbody', {}, entry.alunos.map((student, index) => {
                        const isLow = isBelowMinimum(student.frequencia);
                        return el('tr', { class: isLow ? 'linha-alerta' : null },
                            el('td', { class: 'col-numero', text: String(index + 1).padStart(2, '0') }),
                            el('th', { scope: 'row' }, el('span', { class: 'aluno-celula' }, avatar(student.nome, 'avatar-pequeno'), student.nome)),
                            el('td', {}, el('span', { class: 'frequencia-celula' },
                                el('span', { class: isLow ? 'texto-alerta' : null, text: formatPercent(student.frequencia) }),
                                progressBar(student.frequencia ?? 0, { alert: isLow, label: `Frequência ${formatPercent(student.frequencia)}` }),
                                isLow ? el('span', { class: 'selo selo-vermelho', text: 'abaixo do mínimo' }) : null)),
                            el('td', { class: 'col-numero', text: student.faltas ?? '—' }));
                    }))))
        ];
    }
    return {
        title: schoolClass.nome_turma,
        trail: 'Turmas',
        actions: [el('a', { class: 'botao botao-primario', href: `#/chamada/${selected.id_disciplina}/${todayYmd()}` }, icon('list-checks'), 'Fazer chamada')],
        content: [
            el('a', { class: 'voltar', href: '#/turmas' }, icon('arrow-left'), 'Todas as turmas'),
            tabs,
            card('', cardHeader(`Alunos · ${selected.nome_disciplina}`, 'student'), body)
        ]
    };
}

// ---------------------------------------------------------------- Chamada

function defaultAttendanceDiscipline() {
    const lessons = lessonsToday();
    const lesson = lessonNow(lessons) || lessonNext(lessons) || lessons[0];
    return lesson?.id_disciplina || teachingAssignments()[0]?.id_disciplina || null;
}

function attendanceCounts(chamada) {
    let present = 0;
    let absent = 0;
    for (const value of chamada.marks.values()) {
        if (value === true) present += 1;
        else if (value === false) absent += 1;
    }
    return { present, absent, unmarked: chamada.alunos.length - present - absent };
}

function loadAttendance(disciplineId, date) {
    const key = `${disciplineId}|${date}`;
    if (state.chamada?.key === key) return state.chamada;
    const chamada = {
        key, disciplineId, date, status: 'loading', alunos: [], marks: new Map(), error: null, code: null,
        dirty: false, launched: false
    };
    state.chamada = chamada;
    fetchRoster(disciplineId, date)
        .then((students) => {
            if (state.chamada !== chamada) return;
            chamada.status = 'ok';
            chamada.alunos = students;
            students.forEach((student) => chamada.marks.set(student.id_aluno, student.presente));
            chamada.launched = students.some((student) => student.presente !== null);
        })
        .catch((error) => {
            if (state.chamada !== chamada) return;
            chamada.status = 'error';
            chamada.error = error.message;
            chamada.code = error.status;
        })
        .finally(render);
    return chamada;
}

function renderAttendance() {
    const blocked = guard(['disciplinas', 'turmas', 'horarios']);
    if (blocked) return { title: 'Chamada', content: blocked };
    const assignments = teachingAssignments();
    if (!assignments.length) {
        return { title: 'Chamada', content: emptyState('Nenhuma disciplina vinculada ao seu perfil.', 'list-checks') };
    }
    const [disciplineText, dateText] = state.route.parts;
    const assignment = findAssignment(disciplineText);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(dateText || '') && dateText <= todayYmd();
    if (!assignment || !validDate) {
        const fallback = assignment?.id_disciplina || defaultAttendanceDiscipline();
        window.location.replace(`#/chamada/${fallback}/${validDate ? dateText : todayYmd()}`);
        return { title: 'Chamada', content: skeleton(3) };
    }

    const chamada = loadAttendance(assignment.id_disciplina, dateText);
    const picker = attendancePicker(assignment, dateText);
    let body;
    if (chamada.status === 'loading') body = skeleton(5);
    else if (chamada.status === 'error') {
        body = isUnavailable(chamada)
            ? soonState('O lançamento de chamada ainda está em construção no servidor.')
            : errorState(chamada.error, () => { state.chamada = null; render(); });
    } else if (!chamada.alunos.length) body = emptyState('Nenhum aluno matriculado nesta turma.', 'user');
    else body = attendanceSheet(assignment, chamada);

    return {
        title: 'Chamada',
        trail: assignmentLabel(assignment),
        content: [picker, body]
    };
}

function attendancePicker(assignment, date) {
    const select = el('select', { id: 'chamada-disciplina' },
        teachingAssignments().map((item) => el('option', { value: String(item.id_disciplina), text: assignmentLabel(item) })));
    select.value = String(assignment.id_disciplina);
    const dateInput = el('input', { type: 'date', id: 'chamada-data', value: date, max: todayYmd(), required: true });
    const go = () => {
        if (!dateInput.value) return;
        if (state.chamada?.dirty) {
            confirmDialog({
                title: 'Descartar alterações?',
                message: 'A chamada atual tem marcações que ainda não foram salvas.',
                confirmLabel: 'Descartar',
                danger: true,
                onConfirm: () => {
                    state.chamada.dirty = false;
                    window.location.hash = `#/chamada/${select.value}/${dateInput.value}`;
                },
                onCancel: () => {
                    select.value = String(assignment.id_disciplina);
                    dateInput.value = date;
                }
            });
            return;
        }
        window.location.hash = `#/chamada/${select.value}/${dateInput.value}`;
    };
    select.addEventListener('change', go);
    dateInput.addEventListener('change', go);
    return el('div', { class: 'cartao filtros-chamada' },
        field('Disciplina e turma', select),
        field('Data da aula', dateInput, { hint: longDate(date) }));
}

function attendanceSheet(assignment, chamada) {
    const counters = el('div', { class: 'contadores', 'aria-live': 'polite' });
    const saveButton = el('button', { class: 'botao botao-primario', type: 'button' }, icon('floppy-disk'), 'Salvar chamada');
    const saveHint = el('p', { class: 'meta dica-salvar' });
    const rows = new Map();

    const refresh = () => {
        const { present, absent, unmarked } = attendanceCounts(chamada);
        counters.replaceChildren(
            el('span', { class: 'contador-chamada presente' }, icon('check-circle', true), el('strong', { text: String(present) }), ' presentes'),
            el('span', { class: 'contador-chamada falta' }, icon('x-circle', true), el('strong', { text: String(absent) }), absent === 1 ? ' falta' : ' faltas'),
            el('span', { class: 'contador-chamada pendente' }, icon('circle-dashed'), el('strong', { text: String(unmarked) }), ' sem marcação'));
        saveButton.disabled = unmarked > 0 || chamada.saving;
        saveHint.textContent = unmarked > 0
            ? `Marque todos os alunos para salvar (${unmarked === 1 ? 'falta 1' : `faltam ${unmarked}`}).`
            : (chamada.dirty ? 'Alterações ainda não salvas.' : (chamada.launched ? 'Chamada salva.' : ''));
        for (const [studentId, row] of rows) updateRow(row, chamada.marks.get(studentId));
    };

    const mark = (studentId, value) => {
        chamada.marks.set(studentId, value);
        chamada.dirty = true;
        refresh();
    };

    const markAll = el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => {
        chamada.alunos.forEach((student) => chamada.marks.set(student.id_aluno, true));
        chamada.dirty = true;
        refresh();
        announce('Todos os alunos marcados como presentes.');
    } } }, icon('checks'), 'Marcar todos como presentes');

    const lowStudents = chamada.alunos.filter((student) => isBelowMinimum(student.frequencia));
    const list = el('ol', { class: 'lista-chamada' }, chamada.alunos.map((student, index) => {
        const nameId = `aluno-${student.id_aluno}`;
        const presentButton = el('button', { class: 'opcao-presenca presente', type: 'button', 'aria-pressed': 'false', 'aria-describedby': nameId,
            on: { click: () => mark(student.id_aluno, true) } }, icon('check'), 'Presente');
        const absentButton = el('button', { class: 'opcao-presenca falta', type: 'button', 'aria-pressed': 'false', 'aria-describedby': nameId,
            on: { click: () => mark(student.id_aluno, false) } }, icon('x'), 'Falta');
        const isLow = isBelowMinimum(student.frequencia);
        const row = el('li', { class: 'linha-chamada' },
            el('span', { class: 'numero', 'aria-hidden': 'true', text: String(index + 1).padStart(2, '0') }),
            avatar(student.nome, 'avatar-pequeno'),
            el('span', { class: 'linha-texto' },
                el('strong', { id: nameId, text: student.nome }),
                el('span', { class: `meta${isLow ? ' texto-alerta' : ''}` },
                    student.frequencia !== null ? `Frequência ${formatPercent(student.frequencia)}` : 'Sem registros de frequência',
                    isLow ? ' · abaixo do mínimo' : '')),
            el('span', { class: 'grupo-presenca', role: 'group', 'aria-label': `Presença de ${student.nome}` }, presentButton, absentButton));
        rows.set(student.id_aluno, { row, presentButton, absentButton });
        return row;
    }));

    saveButton.addEventListener('click', () => {
        const { present, absent } = attendanceCounts(chamada);
        confirmDialog({
            title: 'Salvar chamada?',
            message: `${assignmentLabel(assignment)} — ${longDate(chamada.date)}. ${plural(present, 'presente', 'presentes')} e ${plural(absent, 'falta', 'faltas')}.${chamada.launched ? ' A chamada já lançada para este dia será substituída.' : ''}`,
            confirmLabel: 'Salvar chamada',
            onConfirm: () => saveAttendance(assignment, chamada, saveButton, refresh)
        });
    });

    refresh();
    return [
        el('div', { class: 'cartao barra-chamada' },
            counters,
            el('span', { class: 'empurra' }),
            markAll),
        chamada.launched && !chamada.dirty ? el('p', { class: 'nota-discreta', role: 'note' }, icon('info'), 'Esta chamada já foi lançada. Você pode corrigir e salvar de novo.') : null,
        lowStudents.length ? el('p', { class: 'alerta-faixa', role: 'note' }, icon('warning'),
            `${plural(lowStudents.length, 'aluno está', 'alunos estão')} abaixo do mínimo de ${FREQUENCIA_MINIMA}% de frequência nesta disciplina.`) : null,
        card('cartao-lista-chamada', list),
        el('div', { class: 'rodape-acoes rodape-fixo' }, saveHint, saveButton)
    ];
}

function updateRow({ row, presentButton, absentButton }, value) {
    presentButton.setAttribute('aria-pressed', String(value === true));
    absentButton.setAttribute('aria-pressed', String(value === false));
    row.classList.toggle('marcado-presente', value === true);
    row.classList.toggle('marcado-falta', value === false);
}

async function saveAttendance(assignment, chamada, button, refresh) {
    chamada.saving = true;
    refresh();
    try {
        await api('/api/chamadas', json('PUT', {
            id_disciplina: assignment.id_disciplina,
            data_aula: chamada.date,
            presencas: chamada.alunos.map((student) => ({ id_aluno: student.id_aluno, presente: chamada.marks.get(student.id_aluno) === true }))
        }));
        chamada.dirty = false;
        chamada.launched = true;
        state.rosters.delete(assignment.id_disciplina);
        if (source('painel').status !== 'idle') reload('painel');
        if (source('frequencias').status !== 'idle') reload('frequencias');
        notify('Chamada salva.');
        // Recarrega para trazer a frequência acumulada já com esta aula.
        state.chamada = null;
        render();
    } catch (error) {
        notify(error.message, 'erro');
    } finally {
        chamada.saving = false;
        refresh();
        button.focus();
    }
}

// ---------------------------------------------------------------- diálogos

function openDialog(title, ...content) {
    const dialog = $('#dialogo');
    $('#dialogo-titulo').textContent = title;
    $('#dialogo-corpo').replaceChildren(...content.flat().filter(Boolean));
    if (!dialog.open) dialog.showModal();
    return dialog;
}

function closeDialog() {
    $('#dialogo').close();
}

// Confirmação acessível (sem window.confirm).
function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, onConfirm, onCancel }) {
    const dialog = $('#dialogo');
    let confirmed = false;
    const confirmButton = el('button', { class: `botao ${danger ? 'botao-perigo' : 'botao-primario'}`, type: 'button', on: { click: async () => {
        confirmed = true;
        closeDialog();
        await onConfirm?.();
    } } }, confirmLabel);
    openDialog(title,
        el('p', { class: 'dialogo-texto', text: message }),
        el('div', { class: 'dialogo-acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: closeDialog } }, 'Cancelar'),
            confirmButton));
    dialog.addEventListener('close', () => { if (!confirmed) onCancel?.(); }, { once: true });
    confirmButton.focus();
}

// ---------------------------------------------------------------- Atividades

function activityType(activity) {
    return ACTIVITY_TYPES[activity.tipo] || ACTIVITY_TYPES.atividade;
}

function renderActivities() {
    const [activityIdText] = state.route.parts;
    const blocked = guard(['disciplinas', 'turmas', 'atividades']);
    if (blocked) return { title: 'Atividades', content: blocked };
    if (activityIdText) return renderActivityDetail(Number(activityIdText));

    const all = (source('atividades').data || [])
        .filter((activity) => activity.tipo === 'atividade' || activity.tipo === 'avaliacao')
        .sort((a, b) => String(b.prazo || b.criado_em).localeCompare(String(a.prazo || a.criado_em)));
    const classes = myClasses();
    const filter = el('select', { id: 'filtro-turma' },
        el('option', { value: '', text: 'Todas as turmas' }),
        classes.map((item) => el('option', { value: String(item.id_turma), text: item.nome_turma })));
    filter.value = state.activityFilter;
    filter.addEventListener('change', () => { state.activityFilter = filter.value; render(); });
    const visible = all.filter((activity) => !state.activityFilter || String(activity.id_turma) === state.activityFilter);
    const deliveries = source('painel').status === 'ok' ? dashboard().deliveries || [] : [];

    const groups = new Map();
    for (const activity of visible) {
        const name = activity.nome_turma || className(activity.id_turma);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(activity);
    }

    const list = visible.length
        ? [...groups.entries()].map(([name, items]) => el('section', { class: 'grupo-lista' },
            el('h2', { class: 'grupo-titulo', text: name }),
            el('ul', { class: 'lista-cartoes' }, items.map((activity) => activityCard(activity, deliveries)))))
        : emptyState(all.length ? 'Nenhuma atividade para esta turma.' : 'Você ainda não criou atividades. Use "Nova atividade".', 'clipboard-text');

    return {
        title: 'Atividades',
        actions: [el('button', { class: 'botao botao-primario', type: 'button', on: { click: openActivityForm } }, icon('plus'), 'Nova atividade')],
        content: [
            el('div', { class: 'barra-filtros' }, field('Turma', filter)),
            list
        ]
    };
}

function activityCard(activity, deliveries) {
    const type = activityType(activity);
    const passed = deadlinePassed(activity.prazo);
    const summary = deliveries.find((item) => item.id_atividade === activity.id_atividade);
    return el('li', {},
        el('article', { class: 'cartao cartao-atividade' },
            el('span', { class: 'icone-quadrado' }, icon(type.icon)),
            el('div', { class: 'atividade-texto' },
                el('p', { class: 'meta' }, el('span', { class: 'chip', text: type.label }), ' ', activity.nome_disciplina || ''),
                el('h3', { class: 'atividade-titulo', text: activity.titulo }),
                el('p', { class: `meta${passed ? '' : ' destaque-prazo'}` }, icon('clock'), ` ${deadlineLabel(activity.prazo)}${passed ? ' · encerrada' : ''}`),
                summary ? el('div', { class: 'atividade-progresso' },
                    progressBar(summary.total ? (summary.enviadas / summary.total) * 100 : 0, { label: `${summary.enviadas} de ${summary.total} entregas` }),
                    el('span', { class: 'meta', text: `${summary.enviadas}/${summary.total} entregas` })) : null),
            activity.tipo === 'atividade'
                ? el('a', { class: 'botao botao-contorno', href: `#/atividades/${activity.id_atividade}` }, icon('tray-arrow-down'), 'Ver entregas')
                : el('span', { class: 'meta', text: 'Presencial' })));
}

function openActivityForm() {
    const assignments = teachingAssignments();
    if (!assignments.length) {
        notify('Nenhuma disciplina vinculada ao seu perfil.', 'erro');
        return;
    }
    const selectAssignment = el('select', { required: true, name: 'vinculo' },
        assignments.map((item) => el('option', { value: String(item.id_disciplina), text: assignmentLabel(item) })));
    const typeAtividade = el('input', { type: 'radio', name: 'tipo', value: 'atividade', id: 'tipo-atividade', checked: true });
    const typeAvaliacao = el('input', { type: 'radio', name: 'tipo', value: 'avaliacao', id: 'tipo-avaliacao' });
    const title = el('input', { type: 'text', name: 'titulo', maxlength: 200, required: true, autocomplete: 'off' });
    const description = el('textarea', { name: 'descricao', rows: 5, maxlength: 10000, required: true });
    const dueDate = el('input', { type: 'date', name: 'prazo', required: true, min: todayYmd() });
    const dueTime = el('input', { type: 'time', name: 'hora', value: '23:59' });

    const form = el('form', { class: 'formulario', novalidate: true },
        field('Disciplina e turma', selectAssignment),
        el('fieldset', { class: 'grupo-opcoes' },
            el('legend', { text: 'Tipo' }),
            el('label', { class: 'opcao', for: 'tipo-atividade' }, typeAtividade, el('span', {}, el('strong', { text: 'Atividade' }), el('span', { class: 'meta', text: 'Os alunos enviam a resposta pelo portal.' }))),
            el('label', { class: 'opcao', for: 'tipo-avaliacao' }, typeAvaliacao, el('span', {}, el('strong', { text: 'Avaliação' }), el('span', { class: 'meta', text: 'Prova presencial; aparece na agenda dos alunos.' })))),
        field('Título', title),
        field('Descrição', description, { hint: 'Orientações, critérios e materiais.' }),
        el('div', { class: 'campos-linha' },
            field('Prazo (data)', dueDate),
            field('Horário', dueTime, { hint: 'Padrão: 23h59.' })),
        el('div', { class: 'dialogo-acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: closeDialog } }, 'Cancelar'),
            el('button', { class: 'botao botao-primario', type: 'submit' }, icon('check'), 'Criar')));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('[type="submit"]');
        if (!title.value.trim() || !description.value.trim() || !dueDate.value) {
            notify('Preencha título, descrição e prazo.', 'erro');
            (!title.value.trim() ? title : !description.value.trim() ? description : dueDate).focus();
            return;
        }
        const assignment = findAssignment(selectAssignment.value);
        await withBusy(button, async () => {
            try {
                await api('/api/atividades', json('POST', {
                    titulo: title.value.trim(),
                    descricao: description.value.trim(),
                    id_turma: assignment.id_turma,
                    id_disciplina: assignment.id_disciplina,
                    tipo: typeAvaliacao.checked ? 'avaliacao' : 'atividade',
                    prazo: dueTime.value ? `${dueDate.value}T${dueTime.value}` : dueDate.value
                }));
                closeDialog();
                notify(typeAvaliacao.checked ? 'Avaliação criada.' : 'Atividade criada.');
                reload('atividades');
                if (source('painel').status !== 'idle') reload('painel');
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    openDialog('Nova atividade', form);
    title.focus();
}

function submissionsOf(activityId) {
    if (!state.submissions.has(activityId)) {
        const entry = { status: 'loading', data: [], error: null, code: null };
        state.submissions.set(activityId, entry);
        api(`/api/atividades/${activityId}/entregas`)
            .then((data) => { entry.status = 'ok'; entry.data = Array.isArray(data) ? data : (data?.entregas || []); })
            .catch((error) => { entry.status = 'error'; entry.error = error.message; entry.code = error.status; })
            .finally(render);
    }
    return state.submissions.get(activityId);
}

function renderActivityDetail(activityId) {
    const activity = (source('atividades').data || []).find((item) => item.id_atividade === activityId);
    const back = el('a', { class: 'voltar', href: '#/atividades' }, icon('arrow-left'), 'Atividades');
    if (!activity) return { title: 'Atividade', trail: 'Atividades', content: [back, emptyState('Atividade não encontrada.', 'clipboard-text')] };

    // A lista de entregas é montada uma vez por carga: os formulários de correção abertos não se perdem.
    const entry = submissionsOf(activityId);
    const rosterEntry = roster(activity.id_disciplina);
    const key = `entregas-${activityId}-${entry.status}`;
    let body;
    if (entry.status === 'loading') body = skeleton(3);
    else if (entry.status === 'error') body = errorState(entry.error, () => { state.submissions.delete(activityId); render(); });
    else body = persistentNode(key, () => submissionsList(activity, entry.data));

    const total = rosterEntry.status === 'ok' ? rosterEntry.alunos.length : null;
    const sent = entry.status === 'ok' ? entry.data.length : null;
    const graded = entry.status === 'ok' ? entry.data.filter((item) => item.nota !== null && item.nota !== undefined).length : null;
    const missing = rosterEntry.status === 'ok' && entry.status === 'ok'
        ? rosterEntry.alunos.filter((student) => !entry.data.some((item) => item.id_aluno === student.id_aluno))
        : [];

    return {
        title: activity.titulo,
        trail: `Atividades · ${activity.nome_disciplina || ''} · ${activity.nome_turma || className(activity.id_turma)}`,
        content: [
            back,
            card('resumo-atividade',
                el('p', { class: 'meta' }, el('span', { class: 'chip', text: activityType(activity).label }), ` ${deadlineLabel(activity.prazo)}${deadlinePassed(activity.prazo) ? ' · encerrada' : ''}`),
                el('p', { class: 'texto-longo', text: activity.descricao || '' }),
                sent !== null ? el('div', { class: 'linha-selos' },
                    el('span', { class: 'selo selo-azul' }, icon('tray-arrow-down'), total !== null ? `${sent} de ${total} enviaram` : plural(sent, 'entrega', 'entregas')),
                    el('span', { class: 'selo' }, icon('seal-check'), plural(graded, 'corrigida', 'corrigidas'))) : null),
            card('', cardHeader('Entregas', 'tray-arrow-down'), body),
            missing.length ? card('', cardHeader('Ainda não enviaram', 'hourglass-medium'),
                el('ul', { class: 'lista-simples' }, missing.map((student) => el('li', {}, avatar(student.nome, 'avatar-pequeno'), student.nome)))) : null
        ]
    };
}

function submissionsList(activity, submissions) {
    if (!submissions.length) return emptyState('Nenhuma entrega recebida ainda.', 'tray');
    return el('ul', { class: 'lista-entregas' }, submissions.map((submission) => submissionRow(submission)));
}

function submissionStatus(submission) {
    const graded = submission.nota !== null && submission.nota !== undefined;
    return graded
        ? el('span', { class: 'selo selo-azul' }, icon('seal-check'), `Nota ${Number(submission.nota).toLocaleString('pt-BR')}`)
        : el('span', { class: 'selo' }, icon('hourglass-medium'), 'Aguardando correção');
}

function submissionRow(submission) {
    const item = el('li', { class: 'entrega' });
    const fill = () => {
        const graded = submission.nota !== null && submission.nota !== undefined;
        const toggle = el('button', { class: 'botao botao-contorno', type: 'button', 'aria-expanded': 'false' },
            icon('pencil-simple'), graded ? 'Editar correção' : 'Corrigir');
        const formHost = el('div', { class: 'entrega-correcao', hidden: true });
        toggle.addEventListener('click', () => {
            const opening = formHost.hidden;
            formHost.hidden = !opening;
            toggle.setAttribute('aria-expanded', String(opening));
            if (opening) {
                formHost.replaceChildren(gradeForm(submission, () => fill()));
                formHost.querySelector('input').focus();
            }
        });
        item.replaceChildren(
            el('div', { class: 'entrega-cabecalho' },
                avatar(submission.nome),
                el('span', { class: 'linha-texto' },
                    el('strong', { text: submission.nome || 'Aluno' }),
                    el('span', { class: 'meta', text: submission.enviado_em ? `Enviado ${formatSchoolDate(submission.enviado_em, { utc: true })}` : '' })),
                submissionStatus(submission),
                toggle),
            el('details', { class: 'entrega-resposta' },
                el('summary', { text: 'Ver resposta' }),
                el('p', { class: 'texto-longo', text: submission.resposta || '(sem texto)' })),
            submission.feedback ? el('p', { class: 'entrega-feedback' }, icon('chat-text'), ` ${submission.feedback}`) : null,
            formHost);
    };
    fill();
    return item;
}

function gradeForm(submission, done) {
    const grade = el('input', { type: 'number', min: 0, max: 10, step: 0.1, inputmode: 'decimal', required: true,
        value: submission.nota !== null && submission.nota !== undefined ? String(submission.nota) : '' });
    const comment = el('textarea', { rows: 3, maxlength: 2000, value: submission.feedback || '' });
    const form = el('form', { class: 'formulario formulario-correcao', novalidate: true },
        el('div', { class: 'campos-linha' },
            field('Nota (0 a 10)', grade),
            field('Comentário para o aluno', comment)),
        el('div', { class: 'dialogo-acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: done } }, 'Cancelar'),
            el('button', { class: 'botao botao-primario', type: 'submit' }, icon('check'), 'Salvar correção')));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = Number(String(grade.value).replace(',', '.'));
        if (grade.value === '' || Number.isNaN(value) || value < 0 || value > 10) {
            notify('Informe uma nota entre 0 e 10.', 'erro');
            grade.focus();
            return;
        }
        await withBusy(form.querySelector('[type="submit"]'), async () => {
            try {
                const updated = await api(`/api/entregas/${submission.id_entrega}`, json('PATCH', {
                    nota: Math.round(value * 10) / 10,
                    feedback: comment.value.trim() || null
                }));
                submission.nota = updated?.nota ?? Math.round(value * 10) / 10;
                submission.feedback = updated?.feedback ?? (comment.value.trim() || null);
                notify(`Correção de ${firstName(submission.nome)} salva.`);
                if (source('painel').status !== 'idle') reload('painel');
                done();
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    return form;
}

// ---------------------------------------------------------------- Avisos

function renderNotices() {
    const blocked = guard(['disciplinas', 'turmas']);
    if (blocked) return { title: 'Avisos', content: blocked };
    ensure('avisos');
    const form = persistentNode('form-aviso', noticeForm);
    syncNoticeForm(form);

    const notices = source('avisos');
    let list;
    if (notices.status === 'error') list = errorState(notices.error, () => reload('avisos'));
    else if (notices.status !== 'ok') list = skeleton(3);
    else {
        const mine = myNotices();
        list = mine.length
            ? el('ul', { class: 'lista-cartoes' }, mine.map(noticeCard))
            : emptyState('Você ainda não publicou avisos.', 'megaphone-simple');
    }
    return {
        title: 'Avisos',
        content: el('div', { class: 'grade-avisos' },
            card('cartao-formulario', cardHeader('Novo aviso', 'megaphone-simple'), form),
            el('section', { class: 'coluna-avisos', 'aria-labelledby': 'meus-avisos-titulo' },
                el('h2', { class: 'grupo-titulo', id: 'meus-avisos-titulo', text: 'Meus avisos' }),
                list))
    };
}

function syncNoticeForm(form) {
    const select = form.querySelector('select[name="turma"]');
    selectOptions(select, myClasses().map((item) => [item.id_turma, item.nome_turma]), 'Selecione a turma');
}

function noticeForm() {
    const classSelect = el('select', { name: 'turma', required: true });
    const type = el('select', { name: 'tipo' },
        ['aviso', 'evento', 'comunicado'].map((value) => el('option', { value, text: NOTICE_TYPES[value] })));
    const title = el('input', { type: 'text', name: 'titulo', maxlength: 200, required: true, autocomplete: 'off' });
    const content = el('textarea', { name: 'conteudo', rows: 5, maxlength: 10000, required: true });
    const eventDate = el('input', { type: 'datetime-local', name: 'data_evento' });
    const urgent = el('input', { type: 'checkbox', name: 'urgente', id: 'aviso-urgente' });
    const file = el('input', { type: 'file', name: 'anexo', accept: 'application/pdf,.pdf' });
    const fileInfo = el('p', { class: 'campo-dica', 'aria-live': 'polite' });
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Publicar aviso');

    file.addEventListener('change', () => {
        const chosen = file.files[0];
        if (!chosen) { fileInfo.textContent = 'Opcional · PDF de até 5 MB.'; return; }
        if (chosen.size > ANEXO_MAX_BYTES) {
            fileInfo.textContent = 'O arquivo passa de 5 MB. Escolha um PDF menor.';
            file.value = '';
            return;
        }
        if (chosen.type && chosen.type !== 'application/pdf') {
            fileInfo.textContent = 'Envie apenas arquivos PDF.';
            file.value = '';
            return;
        }
        fileInfo.textContent = `${chosen.name} · ${formatSize(chosen.size)}`;
    });
    fileInfo.textContent = 'Opcional · PDF de até 5 MB.';

    const form = el('form', { class: 'formulario', novalidate: true },
        field('Turma', classSelect, { hint: 'Os alunos da turma recebem o aviso no mural.' }),
        el('div', { class: 'campos-linha' },
            field('Tipo', type),
            field('Data do evento (opcional)', eventDate)),
        field('Título', title),
        field('Mensagem', content),
        el('label', { class: 'opcao-caixa', for: 'aviso-urgente' }, urgent,
            el('span', {}, el('strong', { text: 'Marcar como urgente' }), el('span', { class: 'meta', text: 'Aparece em destaque e no topo do mural.' }))),
        el('div', { class: 'campo' },
            el('label', { for: 'aviso-anexo', text: 'Anexo PDF' }),
            Object.assign(file, { id: 'aviso-anexo' }),
            fileInfo),
        el('div', { class: 'rodape-acoes' }, submit));
    file.setAttribute('aria-describedby', 'aviso-anexo-dica');
    fileInfo.id = 'aviso-anexo-dica';

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const classId = Number(classSelect.value);
        if (!classId) { notify('Selecione a turma.', 'erro'); classSelect.focus(); return; }
        if (!title.value.trim()) { notify('Escreva o título do aviso.', 'erro'); title.focus(); return; }
        if (!content.value.trim()) { notify('Escreva a mensagem do aviso.', 'erro'); content.focus(); return; }
        await withBusy(submit, async () => {
            try {
                const payload = {
                    titulo: title.value.trim(),
                    conteudo: content.value.trim(),
                    id_turma: classId,
                    tipo: type.value,
                    urgente: urgent.checked
                };
                if (eventDate.value) payload.data_evento = eventDate.value;
                if (file.files[0]) {
                    const uploaded = await uploadFile(file.files[0]);
                    payload.id_arquivo = uploaded.id_arquivo;
                }
                await api('/api/avisos', json('POST', payload));
                form.reset();
                fileInfo.textContent = 'Opcional · PDF de até 5 MB.';
                notify(`Aviso publicado para ${className(classId)}.`);
                reload('avisos');
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    return form;
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

async function uploadFile(fileObject) {
    try {
        return await api('/api/arquivos', {
            method: 'POST',
            body: fileObject,
            headers: {
                'Content-Type': fileObject.type || 'application/pdf',
                'X-Nome-Arquivo': encodeURIComponent(fileObject.name)
            }
        });
    } catch (error) {
        throw new Error(`Não foi possível enviar o anexo: ${error.message}`);
    }
}

// Download autenticado: o arquivo vem com o token no cabeçalho e é salvo pelo navegador.
async function downloadFile(fileId, fallbackName, button) {
    await withBusy(button, async () => {
        try {
            const response = await fetch(`/api/arquivos/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
            if (response.status === 401) { leaveToLogin(); return; }
            if (!response.ok) throw new Error('Não foi possível baixar o anexo.');
            const disposition = response.headers.get('Content-Disposition') || '';
            const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
            const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
            const name = encoded ? decodeURIComponent(encoded) : (plain || fallbackName || 'anexo.pdf');
            const url = URL.createObjectURL(await response.blob());
            const link = el('a', { href: url, download: name, hidden: true });
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch (error) {
            notify(error.message, 'erro');
        }
    });
}

function noticeCard(notice) {
    const reads = notice.leituras;
    const total = Number(reads?.publico_total || 0);
    const confirmed = Number(reads?.confirmadas || 0);
    const attachment = notice.anexo || (notice.id_arquivo ? { id_arquivo: notice.id_arquivo, nome: 'Anexo PDF' } : null);
    const downloadButton = attachment
        ? el('button', { class: 'link-botao', type: 'button' }, icon('file-pdf'), attachment.nome || 'Anexo PDF')
        : null;
    downloadButton?.addEventListener('click', () => downloadFile(attachment.id_arquivo, attachment.nome, downloadButton));
    const removeButton = el('button', { class: 'botao-icone botao-icone-perigo', type: 'button', 'aria-label': `Excluir o aviso "${notice.titulo}"`, title: 'Excluir' }, icon('trash'));
    removeButton.addEventListener('click', () => confirmDialog({
        title: 'Excluir aviso?',
        message: `"${notice.titulo}" será removido do mural de ${className(notice.id_turma)}. Esta ação não pode ser desfeita.`,
        confirmLabel: 'Excluir',
        danger: true,
        onConfirm: async () => {
            try {
                await api(`/api/avisos/${notice.id_post}`, { method: 'DELETE' });
                notify('Aviso excluído.');
                reload('avisos');
            } catch (error) {
                notify(error.message, 'erro');
            }
        }
    }));

    return el('li', {},
        el('article', { class: `cartao cartao-aviso${notice.urgente ? ' urgente' : ''}` },
            el('div', { class: 'aviso-topo' },
                el('span', { class: 'chips' },
                    notice.urgente ? el('span', { class: 'chip chip-urgente' }, icon('warning', true), 'Urgente') : null,
                    el('span', { class: 'chip', text: NOTICE_TYPES[notice.tipo] || 'Aviso' }),
                    el('span', { class: 'chip', text: className(notice.id_turma) })),
                el('span', { class: 'empurra' }),
                removeButton),
            el('h3', { class: 'aviso-titulo', text: notice.titulo }),
            el('p', { class: 'aviso-resumo', text: truncate(notice.conteudo, 220) }),
            el('p', { class: 'meta' },
                `Publicado ${timeAgo(notice.criado_em)}`,
                notice.data_evento ? ` · Evento em ${formatSchoolDate(notice.data_evento)}` : ''),
            downloadButton,
            reads
                ? el('div', { class: 'leituras' },
                    el('span', { class: 'linha-entre' },
                        el('span', { class: 'meta' }, icon('eye'), ' Leituras confirmadas'),
                        el('strong', { text: `${confirmed}/${total}` })),
                    progressBar(total ? (confirmed / total) * 100 : 0, { label: `${confirmed} de ${total} alunos confirmaram a leitura` }))
                : el('p', { class: 'meta' }, icon('eye'), ' Contagem de leituras indisponível.')));
}

// ---------------------------------------------------------------- Ocorrências

function incidentList() {
    const data = source('ocorrencias').data;
    return (Array.isArray(data) ? data : (data?.ocorrencias || []))
        .slice()
        .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

function renderIncidents() {
    const blocked = guard(['disciplinas', 'turmas']);
    if (blocked) return { title: 'Ocorrências', content: blocked };
    ensure('ocorrencias');
    const form = persistentNode('form-ocorrencia', incidentForm);
    form.sync();

    const incidents = source('ocorrencias');
    let list;
    if (incidents.status === 'error') {
        list = isUnavailable(incidents)
            ? soonState('O registro de ocorrências ainda está em construção no servidor.')
            : errorState(incidents.error, () => reload('ocorrencias'));
    } else if (incidents.status !== 'ok') list = skeleton(3);
    else {
        const items = incidentList();
        list = items.length
            ? el('ul', { class: 'lista-cartoes' }, items.map(incidentCard))
            : emptyState('Nenhuma ocorrência registrada por você.', 'warning-octagon');
    }
    return {
        title: 'Ocorrências',
        content: el('div', { class: 'grade-avisos' },
            card('cartao-formulario', cardHeader('Registrar ocorrência', 'warning-octagon'), form.node),
            el('section', { class: 'coluna-avisos', 'aria-labelledby': 'ocorrencias-titulo' },
                el('h2', { class: 'grupo-titulo', id: 'ocorrencias-titulo', text: 'Registradas por você' }),
                list))
    };
}

function incidentForm() {
    const classSelect = el('select', { name: 'turma', required: true });
    const studentSelect = el('select', { name: 'aluno', required: true, disabled: true });
    const studentHint = el('p', { class: 'campo-dica', 'aria-live': 'polite' });
    const description = el('textarea', { name: 'descricao', rows: 5, maxlength: 2000, required: true });
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('check'), 'Registrar');

    const studentField = field('Aluno', studentSelect);
    studentField.append(studentHint);

    const sync = () => {
        selectOptions(classSelect, myClasses().map((item) => [item.id_turma, item.nome_turma]), 'Selecione a turma');
        const schoolClass = myClasses().find((item) => item.id_turma === Number(classSelect.value));
        if (!schoolClass) {
            studentSelect.disabled = true;
            selectOptions(studentSelect, [], 'Escolha a turma primeiro');
            studentHint.textContent = '';
            return;
        }
        const entry = roster(schoolClass.disciplinas[0].id_disciplina);
        if (entry.status === 'loading') {
            studentSelect.disabled = true;
            selectOptions(studentSelect, [], 'Carregando alunos…');
            studentHint.textContent = '';
        } else if (entry.status === 'error') {
            studentSelect.disabled = true;
            selectOptions(studentSelect, [], 'Lista indisponível');
            studentHint.textContent = isUnavailable(entry)
                ? 'A lista de alunos ainda não está disponível no servidor.'
                : entry.error;
        } else {
            studentSelect.disabled = false;
            selectOptions(studentSelect, entry.alunos.map((student) => [student.id_aluno, student.nome]), 'Selecione o aluno');
            studentHint.textContent = '';
        }
    };
    classSelect.addEventListener('change', () => { studentSelect.value = ''; sync(); });

    const form = el('form', { class: 'formulario', novalidate: true },
        field('Turma', classSelect),
        studentField,
        field('Descrição', description, { hint: 'Descreva o fato de forma objetiva: o que aconteceu, quando e onde.' }),
        el('div', { class: 'rodape-acoes' }, submit));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const studentId = Number(studentSelect.value);
        if (!studentId) { notify('Selecione o aluno.', 'erro'); (studentSelect.disabled ? classSelect : studentSelect).focus(); return; }
        if (!description.value.trim()) { notify('Descreva a ocorrência.', 'erro'); description.focus(); return; }
        await withBusy(submit, async () => {
            try {
                await api('/api/ocorrencias', json('POST', { id_aluno: studentId, descricao: description.value.trim() }));
                description.value = '';
                notify('Ocorrência registrada.');
                reload('ocorrencias');
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    return { node: form, sync };
}

function incidentCard(incident) {
    const student = incident.aluno || {};
    const name = student.nome || incident.aluno_nome || incident.nome_aluno || incident.nome || 'Aluno';
    const classLabel = student.turma || student.nome_turma || incident.nome_turma || incident.turma || '';
    const resolved = incident.situacao === 'resolvida';
    return el('li', {},
        el('article', { class: 'cartao cartao-ocorrencia' },
            el('div', { class: 'aviso-topo' },
                avatar(name),
                el('span', { class: 'linha-texto' },
                    el('strong', { text: name }),
                    el('span', { class: 'meta', text: [classLabel, incident.criado_em ? formatSchoolDate(incident.criado_em, { utc: true }) : null].filter(Boolean).join(' · ') })),
                el('span', { class: 'empurra' }),
                el('span', { class: `selo${resolved ? ' selo-azul' : ' selo-vermelho'}` },
                    icon(resolved ? 'check-circle' : 'circle'), resolved ? 'Resolvida' : 'Aberta')),
            el('p', { class: 'texto-longo', text: incident.descricao || '' })));
}

// ---------------------------------------------------------------- Mensagens

function messagesHost() {
    return persistentNode('mensagens', () => {
        const host = el('div', { class: 'mensagens-host' });
        if (window.CwMensagens && typeof window.CwMensagens.montar === 'function') {
            try {
                window.CwMensagens.montar(host, {
                    api,
                    usuario: state.user,
                    aoMudarNaoLidas: setUnread
                });
            } catch (error) {
                host.replaceChildren(errorState(`Não foi possível abrir as mensagens: ${error.message}`));
            }
        } else {
            host.replaceChildren(soonState('As mensagens chegam em breve. Assim que o recurso estiver pronto, suas conversas com alunos e coordenação aparecem aqui.'));
        }
        return host;
    });
}

function renderMessages() {
    return { title: 'Mensagens', content: messagesHost() };
}

// ---------------------------------------------------------------- Mais (celular)

function renderMore() {
    const links = [
        ['#/turmas', 'Turmas', 'users-three'],
        ['#/atividades', 'Atividades', 'clipboard-text'],
        ['#/ocorrencias', 'Ocorrências', 'warning-octagon'],
        ['#/configuracoes/perfil', 'Configurações', 'gear-six']
    ];
    return {
        title: 'Mais',
        content: [
            el('div', { class: 'cartao perfil-resumo' },
                avatar(state.user.nome, 'avatar-grande'),
                el('span', { class: 'linha-texto' },
                    el('strong', { text: state.user.nome || state.user.login }),
                    el('span', { class: 'meta', text: AREAS[state.user.area] || 'Professor(a)' }))),
            el('ul', { class: 'lista-menu cartao' }, links.map(([href, label, iconName]) => el('li', {},
                el('a', { href, class: 'item-menu' }, el('span', { class: 'icone-quadrado' }, icon(iconName)), label, el('span', { class: 'empurra' }), icon('caret-right'))))),
            el('button', { class: 'botao botao-contorno botao-largo', type: 'button', on: { click: logout } }, icon('sign-out'), 'Sair da conta')
        ]
    };
}

// ---------------------------------------------------------------- Configurações

function renderSettings() {
    const [tab = 'perfil'] = state.route.parts;
    const current = SETTINGS_TABS.find(([id]) => id === tab) || SETTINGS_TABS[0];
    const tabs = el('nav', { class: 'segmentado', 'aria-label': 'Configurações' },
        SETTINGS_TABS.map(([id, label, iconName]) => el('a', {
            class: `segmento${id === current[0] ? ' ativo' : ''}`,
            href: `#/configuracoes/${id}`,
            'aria-current': id === current[0] ? 'page' : null
        }, icon(iconName), label)));
    const builders = {
        perfil: settingsProfile,
        notificacoes: settingsNotifications,
        aparencia: settingsAppearance,
        seguranca: settingsSecurity
    };
    return {
        title: current[1],
        trail: 'Configurações',
        content: [tabs, ...[].concat(builders[current[0]]())]
    };
}

function settingsProfile() {
    const user = state.user;
    const assignments = teachingAssignments();
    return [
        card('perfil-resumo',
            avatar(user.nome, 'avatar-grande'),
            el('span', { class: 'linha-texto' },
                el('strong', { class: 'perfil-nome', text: user.nome || user.login }),
                el('span', { class: 'meta', text: [`Login: ${user.login}`, AREAS[user.area]].filter(Boolean).join(' · ') }))),
        card('', cardHeader('Turmas e disciplinas', 'chalkboard-teacher'),
            assignments.length
                ? el('ul', { class: 'lista-simples' }, assignments.map((item) => el('li', { text: assignmentLabel(item) })))
                : emptyState('Nenhuma disciplina vinculada.', 'chalkboard-teacher'),
            el('p', { class: 'meta', text: 'Para alterar seus dados ou vínculos, fale com a coordenação.' })),
        emailCard()
    ];
}

function emailCard() {
    ensure('conta');
    const account = source('conta');
    let body;
    if (account.status === 'error') {
        body = isUnavailable(account)
            ? soonState('O cadastro de e-mail estará disponível em breve.')
            : errorState(account.error, () => reload('conta'));
    } else if (account.status !== 'ok') body = skeleton(1);
    else if (account.data?.email) {
        const remove = el('button', { class: 'botao botao-contorno', type: 'button' }, icon('trash'), 'Remover e-mail');
        remove.addEventListener('click', () => confirmDialog({
            title: 'Remover e-mail?',
            message: 'Você deixará de receber notificações e não poderá recuperar a senha por e-mail.',
            confirmLabel: 'Remover',
            danger: true,
            onConfirm: async () => {
                try {
                    await api('/api/conta/email', { method: 'DELETE' });
                    notify('E-mail removido.');
                    reload('conta');
                } catch (error) {
                    notify(error.message, 'erro');
                }
            }
        }));
        body = [
            el('p', { class: 'email-atual' }, icon('envelope-simple'), el('strong', { text: account.data.email }), el('span', { class: 'selo selo-azul', text: 'Confirmado' })),
            el('div', { class: 'rodape-acoes' }, remove)
        ];
    } else {
        body = persistentNode('form-email', emailForm);
    }
    return card('', cardHeader('E-mail', 'envelope-simple'),
        el('p', { class: 'meta', text: 'Usado para notificações e para recuperar a senha.' }), body);
}

function emailForm() {
    const input = el('input', { type: 'email', name: 'email', autocomplete: 'email', maxlength: 254, required: true });
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Enviar confirmação');
    const form = el('form', { class: 'formulario', novalidate: true },
        field('Seu e-mail', input, { hint: 'Enviaremos um link de confirmação. O e-mail só passa a valer depois de confirmado.' }),
        el('div', { class: 'rodape-acoes' }, submit));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!input.checkValidity() || !input.value.trim()) {
            notify('Informe um e-mail válido.', 'erro');
            input.focus();
            return;
        }
        await withBusy(submit, async () => {
            try {
                const result = await api('/api/conta/email', json('POST', { email: input.value.trim() }));
                notify(result?.mensagem || `Enviamos um link de confirmação para ${input.value.trim()}.`);
                input.value = '';
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    return form;
}

function settingsNotifications() {
    ensure('conta');
    const account = source('conta');
    if (account.status === 'error') {
        return card('', isUnavailable(account)
            ? soonState('As preferências de notificação estarão disponíveis em breve.')
            : errorState(account.error, () => reload('conta')));
    }
    if (account.status !== 'ok') return skeleton(3);
    const prefs = account.data?.notificacoes || {};
    const hasEmail = Boolean(account.data?.email);
    return card('',
        cardHeader('Notificações por e-mail', 'bell-simple'),
        hasEmail ? null : el('p', { class: 'nota-discreta', role: 'note' }, icon('info'),
            'Cadastre um e-mail em ', el('a', { href: '#/configuracoes/perfil', text: 'Perfil' }), ' para receber as notificações.'),
        el('ul', { class: 'lista-alternancias' }, NOTIFICATION_TYPES.map(([key, label, description]) => {
            const id = `notif-${key}`;
            const input = el('input', { type: 'checkbox', role: 'switch', id, class: 'alternancia', checked: prefs[key] !== false, disabled: !hasEmail });
            input.addEventListener('change', async () => {
                const value = input.checked;
                input.disabled = true;
                try {
                    await api('/api/conta/notificacoes', json('PUT', { [key]: value }));
                    prefs[key] = value;
                    announce(`${label}: ${value ? 'ativado' : 'desativado'}.`);
                } catch (error) {
                    input.checked = !value;
                    notify(error.message, 'erro');
                } finally {
                    input.disabled = false;
                }
            });
            return el('li', { class: 'linha-alternancia' },
                el('label', { for: id, class: 'linha-texto' },
                    el('strong', { text: label }),
                    el('span', { class: 'meta', text: description })),
                input);
        })));
}

function settingsAppearance() {
    const prefs = window.cwAparencia?.read() || { tema: 'claro', texto: 'medio' };
    const group = (name, legend, options, current) => el('fieldset', { class: 'grupo-opcoes grupo-aparencia' },
        el('legend', { text: legend }),
        options.map(([value, label, iconName]) => {
            const id = `${name}-${value}`;
            const input = el('input', { type: 'radio', name, value, id, checked: current === value });
            input.addEventListener('change', () => {
                window.cwAparencia?.save({ [name]: value });
                announce(`${legend}: ${label}.`);
            });
            return el('label', { class: 'opcao opcao-cartao', for: id }, input, icon(iconName), el('span', { text: label }));
        }));
    return card('',
        cardHeader('Aparência', 'palette'),
        el('p', { class: 'meta', text: 'Vale só para este aparelho.' }),
        group('tema', 'Tema', [['claro', 'Claro', 'sun'], ['escuro', 'Escuro', 'moon'], ['auto', 'Automático', 'circle-half']], prefs.tema),
        group('texto', 'Tamanho do texto', [['pequeno', 'Pequeno', 'text-aa'], ['medio', 'Médio', 'text-aa'], ['grande', 'Grande', 'text-aa']], prefs.texto));
}

function settingsSecurity() {
    return [
        card('', cardHeader('Alterar senha', 'lock-key'), persistentNode('form-senha', passwordForm)),
        sessionsCard()
    ];
}

function passwordForm() {
    const current = el('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    const next = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, maxlength: 128 });
    const confirm = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, maxlength: 128 });
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('check'), 'Salvar nova senha');
    const form = el('form', { class: 'formulario', novalidate: true },
        field('Senha atual', current),
        field('Nova senha', next, { hint: 'Mínimo de 8 caracteres.' }),
        field('Confirme a nova senha', confirm),
        el('div', { class: 'rodape-acoes' }, submit));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!current.value) { notify('Informe a senha atual.', 'erro'); current.focus(); return; }
        if (next.value.length < 8) { notify('A nova senha precisa ter pelo menos 8 caracteres.', 'erro'); next.focus(); return; }
        if (next.value !== confirm.value) { notify('A confirmação não é igual à nova senha.', 'erro'); confirm.focus(); return; }
        await withBusy(submit, async () => {
            try {
                await api('/api/auth/password', json('POST', { senha_atual: current.value, nova_senha: next.value }));
                form.reset();
                notify('Senha alterada. Os outros aparelhos foram desconectados.');
                if (source('sessoes').status !== 'idle') reload('sessoes');
            } catch (error) {
                notify(error.message, 'erro');
            }
        });
    });
    return form;
}

function sessionList() {
    const data = source('sessoes').data;
    return Array.isArray(data) ? data : (data?.sessoes || []);
}

function sessionsCard() {
    ensure('sessoes');
    const sessions = source('sessoes');
    let body;
    if (sessions.status === 'error') {
        body = isUnavailable(sessions)
            ? soonState('A lista de aparelhos conectados estará disponível em breve.')
            : errorState(sessions.error, () => reload('sessoes'));
    } else if (sessions.status !== 'ok') body = skeleton(2);
    else {
        const items = sessionList();
        const others = items.filter((item) => !item.atual);
        body = [
            el('ul', { class: 'lista-dispositivos' }, items.map((item) => {
                const disconnect = item.atual ? null : el('button', { class: 'botao botao-contorno', type: 'button' }, 'Desconectar');
                disconnect?.addEventListener('click', () => withBusy(disconnect, async () => {
                    try {
                        await api(`/api/conta/sessoes/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                        notify('Aparelho desconectado.');
                        reload('sessoes');
                    } catch (error) {
                        notify(error.message, 'erro');
                    }
                }));
                const device = item.dispositivo || 'Aparelho desconhecido';
                return el('li', { class: 'linha-dispositivo' },
                    el('span', { class: 'icone-quadrado' }, icon(/android|iphone|ios|celular|mobile/i.test(device) ? 'device-mobile' : 'desktop')),
                    el('span', { class: 'linha-texto' },
                        el('strong', { text: device }),
                        el('span', { class: 'meta', text: item.atual ? 'Este aparelho' : (item.ultimo_acesso ? `Último acesso ${timeAgo(item.ultimo_acesso)}` : '') })),
                    item.atual ? el('span', { class: 'selo selo-azul', text: 'Atual' }) : disconnect);
            })),
            others.length ? el('div', { class: 'rodape-acoes' },
                el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => confirmDialog({
                    title: 'Desconectar os outros aparelhos?',
                    message: `${plural(others.length, 'aparelho será desconectado', 'aparelhos serão desconectados')}. Este continua conectado.`,
                    confirmLabel: 'Desconectar',
                    danger: true,
                    onConfirm: async () => {
                        try {
                            await api('/api/conta/sessoes', { method: 'DELETE' });
                            notify('Os outros aparelhos foram desconectados.');
                            reload('sessoes');
                        } catch (error) {
                            notify(error.message, 'erro');
                        }
                    }
                }) } }, icon('sign-out'), 'Desconectar os outros')) : null
        ];
    }
    return card('', cardHeader('Aparelhos conectados', 'devices'), body);
}

// ---------------------------------------------------------------- início

initialize();
