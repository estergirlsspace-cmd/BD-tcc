// Portal do Aluno (C·Warning).
// Aplicação de página única: navegação por hash (#/secao/sub), dados reais da API,
// renderização só com createElement/textContent (nada de innerHTML com dados).
// Depende de /datas.js (datas no horário de Brasília), /notificacoes.js (notify),
// /preferencias.js (cwAparencia) e /componentes/mensagens.js (CwMensagens).

'use strict';

const TOKEN_KEY = 'cwarning-token';
const token = sessionStorage.getItem(TOKEN_KEY);
const FUSO_ESCOLA = 'America/Sao_Paulo';
const FREQUENCIA_MINIMA = 75;
const MOBILE_QUERY = window.matchMedia('(max-width: 899.98px)');
const UNREAD_POLL_MS = 30000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const JUSTIFY_BUSINESS_DAYS = 5;
const UPLOAD_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

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
    mensagens: { title: 'Mensagens', defaultSub: null },
    ajustes: { title: 'Configurações', defaultSub: 'perfil' }
};

// Situação da falta: derivada de frequencias[].justificativa (ou da lista de justificativas).
const ABSENCE_STATUS = {
    sem: { label: 'Sem justificativa', className: 'selo-vermelho', icon: 'warning-circle' },
    pendente: { label: 'Em análise', className: 'selo-azul', icon: 'hourglass-medium' },
    aceita: { label: 'Justificada', className: 'selo-neutro', icon: 'check-circle' },
    recusada: { label: 'Recusada', className: 'selo-vermelho', icon: 'x-circle' }
};

const NOTIFICATION_TYPES = [
    ['urgente', 'Avisos urgentes', 'Fechamentos, mudanças de sala e emergências', 'warning-circle'],
    ['turma', 'Avisos da turma', 'Comunicados dos seus professores', 'users-three'],
    ['prazos', 'Prazos de atividades', 'Lembrete às 18h do dia anterior ao prazo', 'clipboard-text'],
    ['eventos', 'Eventos da escola', 'Feira, reuniões e datas do calendário', 'calendar-dots'],
    ['mensagens', 'Mensagens', 'Respostas de professores e coordenação', 'chat-circle-dots']
];

const THEMES = [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']];
const TEXT_SIZES = [['pequeno', 'Pequeno'], ['medio', 'Médio'], ['grande', 'Grande']];

const FAQ = [
    ['Como confirmo que li um aviso?',
        'Abra o aviso e toque em "Confirmar leitura". Ele sai da lista de não lidos. Se confirmou por engano, toque de novo para desfazer.'],
    ['Onde encontro os avisos que salvei?',
        'Em Avisos › Salvos. Use o botão "Salvar aviso" dentro do aviso para guardar os mais importantes.'],
    ['Como envio uma atividade?',
        'Em Atividades › Pendentes, toque em "Enviar", escreva sua resposta e confirme antes do prazo. Até o prazo terminar você pode reenviar.'],
    ['Como justifico uma falta?',
        'Em Frequência › Histórico de faltas, toque em "Justificar" na falta, escreva o motivo e anexe o atestado (PDF, JPG ou PNG, até 5 MB). Envie em até 5 dias úteis depois da falta.'],
    ['Minha frequência está abaixo de 75%. E agora?',
        'O mínimo para aprovação é 75% de presença. Procure a coordenação para entender a situação e combinar a reposição.'],
    ['Esqueci minha senha. O que faço?',
        'Na tela de entrada, toque em "Esqueci minha senha". Se você tiver um e-mail cadastrado em Configurações › Perfil, enviamos um link para criar uma senha nova. Sem e-mail, procure a secretaria.']
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
        frequencias: { status: 'loading', data: null, error: null },
        ocorrencias: { status: 'loading', data: null, error: null },
        justificativas: { status: 'loading', data: null, error: null }
    },
    lastUnreadAnnounced: null,
    unreadMessages: null,
    messagesPanel: null,
    pendingEmail: null,
    focusEmailField: false
};

const SOURCE_PATHS = {
    mural: '/api/mural',
    desempenho: '/api/desempenho',
    atividades: '/api/atividades',
    horarios: '/api/horarios',
    frequencias: '/api/frequencias',
    ocorrencias: '/api/ocorrencias',
    justificativas: '/api/justificativas'
};

const $ = (selector) => document.querySelector(selector);

// ---------------------------------------------------------------- API e sessão

// expirou: a sessão caiu sem a pessoa pedir (401). O login mostra o aviso e, depois de entrar,
// volta para a rota guardada. O "Sair" voluntário não grava nada.
function leaveToLogin({ expirou = false } = {}) {
    sessionStorage.removeItem(TOKEN_KEY);
    if (expirou) {
        try {
            sessionStorage.setItem('cw-motivo', 'sessao');
            sessionStorage.setItem('cw-voltar', window.location.pathname + window.location.hash);
        } catch {
            // Sem sessionStorage: volta ao login sem o aviso.
        }
    }
    window.location.replace('/');
}

function apiError(message, status) {
    return Object.assign(new Error(message), { status });
}

async function api(path, options = {}) {
    let response;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                Authorization: `Bearer ${token}`,
                ...options.headers
            }
        });
    } catch {
        throw apiError('Sem conexão. Confira a internet e tente de novo.', 0);
    }
    if (response.status === 401) {
        leaveToLogin({ expirou: true });
        throw apiError('Sua sessão expirou. Entre de novo.', 401);
    }
    let text = '';
    let result = null;
    try {
        text = await response.text();
        result = text ? JSON.parse(text) : null;
    } catch {
        throw apiError('O servidor respondeu de um jeito inesperado. Tente de novo em instantes.', response.status);
    }
    if (response.status === 403 && /termos de uso/.test(result?.erro || '')) window.location.replace('/');
    if (response.status === 501) throw apiError('Este recurso ainda está em construção. Tente de novo mais tarde.', 501);
    if (!response.ok) throw apiError(result?.erro || 'Não foi possível concluir a solicitação.', response.status);
    return result;
}

// Download autenticado: o token vai no cabeçalho (nunca na URL); o arquivo vira um link temporário.
async function downloadFile(file, trigger) {
    if (trigger) {
        trigger.disabled = true;
        trigger.setAttribute('aria-busy', 'true');
    }
    try {
        const response = await fetch(`/api/arquivos/${encodeURIComponent(file.id_arquivo)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.status === 401) {
            leaveToLogin({ expirou: true });
            return;
        }
        if (!response.ok) {
            let message = null;
            try {
                message = (await response.json())?.erro;
            } catch {
                // Resposta sem JSON: usa a mensagem padrão.
            }
            throw new Error(response.status === 501 ? 'Download ainda em construção. Tente mais tarde.'
                : message || 'Não foi possível baixar o anexo.');
        }
        const url = URL.createObjectURL(await response.blob());
        const link = el('a', { href: url, download: file.nome || 'anexo' });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
        notify(error instanceof TypeError ? 'Sem conexão. Confira a internet e tente de novo.'
            : error.message || 'Não foi possível baixar o anexo.', 'erro');
    } finally {
        if (trigger) {
            trigger.disabled = false;
            trigger.removeAttribute('aria-busy');
        }
    }
}

// Envia um arquivo cru (POST /api/arquivos) e devolve { id_arquivo, nome, tipo_mime, tamanho }.
function uploadFile(file) {
    return api('/api/arquivos', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': uploadType(file), 'X-Nome-Arquivo': encodeURIComponent(file.name) }
    });
}

function uploadType(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    return Object.values(UPLOAD_TYPES).includes(file.type) ? file.type : UPLOAD_TYPES[extension] || '';
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

async function logout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch {
        // A sessão local é encerrada mesmo se o servidor não responder.
    }
    leaveToLogin();
}

function loadSource(name) {
    const source = state.sources[name];
    source.status = 'loading';
    source.error = null;
    render();
    source.promise = (async () => {
        try {
            source.data = await api(SOURCE_PATHS[name]);
            source.status = 'ok';
        } catch (error) {
            source.status = 'error';
            source.error = error.message;
        }
        render();
        return source;
    })();
    return source.promise;
}

// Resolve quando a fonte terminou de carregar (com sucesso ou erro).
function whenSource(name) {
    const source = state.sources[name];
    if (source.status === 'ok' || source.status === 'error') return Promise.resolve(source);
    return source.promise || loadSource(name);
}

// ---------------------------------------------------------------- mensagens não lidas (badge)

async function refreshUnreadMessages() {
    if (document.hidden) return;
    try {
        const result = await api('/api/mensagens/nao-lidas');
        setUnreadMessages(Number(result?.total) || 0);
    } catch {
        setUnreadMessages(null);
    }
}

function setUnreadMessages(total) {
    const previous = state.unreadMessages;
    state.unreadMessages = total;
    document.querySelectorAll('[data-badge-mensagens]').forEach((badge) => {
        badge.hidden = !total;
        badge.textContent = total > 99 ? '99+' : String(total || '');
    });
    document.querySelectorAll('[data-sr-mensagens]').forEach((span) => {
        span.textContent = total ? `, ${plural(total, 'mensagem não lida', 'mensagens não lidas')}` : '';
    });
    if (previous !== null && total !== null && total > previous) {
        $('#status-contadores').textContent = `${plural(total, 'mensagem não lida', 'mensagens não lidas')}.`;
        if (state.messagesPanel && state.route.section === 'mensagens') state.messagesPanel.atualizar();
    }
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
    // LGPD: sem o aceite dos termos, volta para a entrada (que retoma a etapa de aceite com esta sessão).
    if (state.user.termos_pendentes) {
        window.location.replace('/');
        return;
    }

    setupShell();
    applyRoute(parseHash(), { focus: false });
    window.addEventListener('hashchange', () => applyRoute(parseHash(), { focus: true }));
    MOBILE_QUERY.addEventListener('change', () => render({ force: true }));
    refreshUnreadMessages();
    window.setInterval(refreshUnreadMessages, UNREAD_POLL_MS);
    document.addEventListener('visibilitychange', refreshUnreadMessages);
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

function justifications() {
    const data = state.sources.justificativas.data;
    return Array.isArray(data) ? data : data?.justificativas || [];
}

// Justificativa mais recente para a falta (aluno + disciplina + data), vinda da lista do aluno.
function justificationFor(group) {
    return justifications()
        .filter((item) => String(item.data_falta || '').slice(0, 10) === group.data)
        .filter((item) => {
            const discipline = item.disciplina;
            const id = item.id_disciplina ?? discipline?.id_disciplina;
            if (id !== undefined && id !== null) return Number(id) === Number(group.id_disciplina);
            const name = typeof discipline === 'string' ? discipline : discipline?.nome_disciplina || discipline?.nome;
            return name === group.nome_disciplina;
        })
        .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')))[0] || null;
}

// Faltas agrupadas por disciplina + dia (a justificativa vale para o dia inteiro daquela disciplina).
function absenceGroups() {
    const groups = new Map();
    for (const record of absences()) {
        const data = String(record.data_aula || '').slice(0, 10);
        const key = `${record.id_disciplina}_${data}`;
        const group = groups.get(key) || {
            key, data, id_disciplina: record.id_disciplina, nome_disciplina: record.nome_disciplina || 'Disciplina',
            aulas: 0, situacao: null, observacao: record.observacao || null
        };
        group.aulas += 1;
        if (record.justificativa?.situacao) group.situacao = record.justificativa.situacao;
        groups.set(key, group);
    }
    return [...groups.values()].map((group) => {
        const detail = justificationFor(group);
        const situacao = group.situacao || detail?.situacao || null;
        return { ...group, detalhe: detail, status: ABSENCE_STATUS[situacao] ? situacao : 'sem' };
    }).sort((a, b) => b.data.localeCompare(a.data));
}

// Último dia para justificar: 5 dias úteis (seg–sex) depois da falta.
function justifyDeadline(ymd) {
    const date = new Date(`${ymd}T12:00:00Z`);
    let count = 0;
    while (count < JUSTIFY_BUSINESS_DAYS) {
        date.setUTCDate(date.getUTCDate() + 1);
        const weekday = date.getUTCDay();
        if (weekday !== 0 && weekday !== 6) count += 1;
    }
    return date.toISOString().slice(0, 10);
}

function canJustify(group) {
    return (group.status === 'sem' || group.status === 'recusada') && schoolParts().ymd <= justifyDeadline(group.data);
}

function occurrences() {
    const data = state.sources.ocorrencias.data;
    return Array.isArray(data) ? data : data?.ocorrencias || [];
}

function isOpenOccurrence(item) {
    return (item.situacao || 'aberta') === 'aberta';
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
            ]],
            ['Solicitar', [
                ['justificar', 'Justificar falta', 'file-arrow-up', null]
            ]]
        ],
        ajustes: [
            ['Conta', [
                ['perfil', 'Perfil', 'user-circle', null],
                ['seguranca', 'Senha e segurança', 'lock-key', null],
                ['privacidade', 'Privacidade', 'shield-check', null]
            ]],
            ['Preferências', [
                ['notificacoes', 'Notificações', 'bell-simple', null],
                ['aparencia', 'Aparência', 'paint-brush', null]
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
    if (section === 'frequencia' && sub === 'justificar' && /^\d+_\d{4}-\d{2}-\d{2}$/.test(parts[2] || '')) {
        id = parts[2];
    }
    if (section === 'mensagens') {
        return { section, sub: sub === 'nova' ? 'nova' : null, id: null };
    }
    const groups = subnavGroups(section);
    if (groups && !id && !groups.some(([, items]) => items.some(([key]) => key === sub))) {
        sub = SECTIONS[section].defaultSub;
    }
    return { section, sub, id };
}

function applyRoute(route, { focus }) {
    if (route.section !== 'mensagens' && state.messagesPanel) {
        state.messagesPanel.desmontar();
        state.messagesPanel = null;
    }
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
        // No celular, Atividades e Frequência ficam "dentro" do Início (atalhos no painel).
        const parent = (link.dataset.inclui || '').split(' ').includes(section);
        link.classList.toggle('ativo', active || parent);
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

// Telas com formulário ou componente vivo: depois de desenhadas, só redesenham ao mudar de rota
// (não apagam o que o aluno digita quando uma fonte termina de carregar).
function isStableRoute() {
    const { section, sub } = state.route;
    if (section === 'ajustes' || section === 'mensagens') return true;
    return section === 'frequencia' && sub === 'justificar' && state.sources.frequencias.status === 'ok';
}

function render({ force = false } = {}) {
    if (!state.user) return;
    const { section, sub, id } = state.route;
    let pageTitle = SECTIONS[section].title;
    let trail = ['Aluno'];
    let build;

    if (section === 'inicio') {
        pageTitle = 'Painel do dia';
        trail = ['Aluno', 'Início'];
        build = renderHome;
    } else if (section === 'mensagens') {
        trail = ['Aluno', 'Mensagens'];
        build = renderMessages;
    } else if (section === 'avisos' && id) {
        const notice = notices().find((item) => item.id_post === id);
        pageTitle = notice ? truncate(notice.titulo, 46) : 'Aviso';
        trail = ['Avisos', 'Aviso'];
        build = () => renderNoticeDetail(id);
    } else {
        const label = subLabel(section, sub) || SECTIONS[section].title;
        pageTitle = label;
        trail = [SECTIONS[section].title, label];
        const renderers = {
            avisos: renderNoticeList,
            agenda: renderAgenda,
            atividades: renderActivities,
            frequencia: { faltas: renderAbsences, justificar: renderJustify }[sub] || renderAttendanceSummary,
            ajustes: {
                perfil: renderProfile, seguranca: renderSecurity, notificacoes: renderNotifications,
                aparencia: renderAppearance, ajuda: renderHelp, privacidade: renderPrivacy
            }[sub] || renderProfile
        };
        build = () => [chipsNav(), renderers[section]()];
    }

    renderShell(pageTitle, trail);
    renderSubnav();
    const main = $('#conteudo');
    const routeKey = `${section}/${sub}/${id}`;
    if (!force && main.dataset.rota === routeKey && main.dataset.estavel === '1') return;
    if (force && section === 'mensagens' && main.dataset.rota === routeKey) return;
    const content = build();
    main.dataset.rota = routeKey;
    main.dataset.estavel = isStableRoute() ? '1' : '0';
    const keepFocus = main.contains(document.activeElement) ? document.activeElement : null;
    const keepId = keepFocus?.id;
    // Botões sem id (salvar, confirmar leitura) são recriados no render: devolve o foco ao
    // botão equivalente pelo data-acao, para o foco não cair no <body>.
    const keepAction = keepFocus?.dataset?.acao;
    main.replaceChildren(...[content].flat(Infinity).filter(Boolean));
    main.classList.toggle('conteudo-detalhe', section === 'avisos' && Boolean(id));
    main.classList.toggle('conteudo-mensagens', section === 'mensagens');
    if (keepId) document.getElementById(keepId)?.focus({ preventScroll: true });
    else if (keepAction) main.querySelector(`[data-acao="${CSS.escape(keepAction)}"]:not(:disabled)`)?.focus({ preventScroll: true });
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

    nodes.push(homeShortcuts());
    nodes.push(el('div', { class: 'grade-cartoes' },
        homeAttendanceCard(), homeOccurrencesCard(), homeDeliveryCard()));

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

// Atalhos do celular: Atividades e Frequência não têm aba própria (as abas são Início, Avisos,
// Agenda, Mensagens e Ajustes). No web ficam escondidos, porque o rail já mostra as duas seções.
function homeShortcuts() {
    const pending = state.sources.atividades.status === 'ok'
        ? deliverables().filter((activity) => activityStatus(activity) === 'pendentes').length : null;
    const absencesToJustify = state.sources.frequencias.status === 'ok'
        ? absenceGroups().filter(canJustify).length : null;
    const shortcut = (href, iconName, label, detail) => el('li', {},
        el('a', { class: 'atalho', href },
            el('span', { class: 'icone-quadrado' }, icon(iconName)),
            el('span', { class: 'atalho-texto' },
                el('span', { class: 'atalho-titulo', text: label }),
                detail ? el('span', { class: 'meta', text: detail }) : null),
            icon('caret-right')));
    return el('nav', { class: 'atalhos', 'aria-label': 'Mais seções' },
        el('ul', {},
            shortcut('#/atividades/pendentes', 'clipboard-text', 'Atividades',
                pending === null ? null : pending ? plural(pending, 'pendente', 'pendentes') : 'Tudo entregue'),
            shortcut('#/frequencia/resumo', 'list-checks', 'Frequência',
                absencesToJustify ? plural(absencesToJustify, 'falta para justificar', 'faltas para justificar') : 'Resumo e faltas')));
}

function homeOccurrencesCard() {
    const guard = sourceGuard('ocorrencias', 1);
    if (guard) return card('cartao-kpi', cardHeader('seal-check', 'Ocorrências'), guard);
    const list = occurrences();
    const open = list.filter(isOpenOccurrence).length;
    const link = el('a', { class: 'cartao cartao-link cartao-kpi', href: '#/ajustes/perfil' },
        cardHeader('seal-check', 'Ocorrências'));
    link.append(el('span', { class: 'kpi-valor', text: String(list.length) }),
        el('span', { class: 'meta empurra', text: !list.length ? 'Nenhuma ocorrência registrada'
            : open ? `${open} em aberto · ver em Perfil` : 'Todas resolvidas · ver em Perfil' }));
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
        el('button', { class: 'link-botao', type: 'button', 'data-acao': 'ler-todos', disabled: unread === 0, on: { click: markAllRead } },
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
            // Rótulo fixo + aria-pressed (o leitor anuncia "Salvar aviso, pressionado"); o estado
            // visível fica num texto à parte, escondido do leitor para não repetir.
            el('button', {
                class: `botao botao-contorno${notice.salvo ? ' ativo' : ''}`, type: 'button', 'data-acao': 'salvar',
                'aria-pressed': String(Boolean(notice.salvo)), on: { click: () => toggleSaved(notice) }
            }, icon('bookmark-simple', notice.salvo), 'Salvar aviso',
            notice.salvo ? el('span', { class: 'estado-botao', 'aria-hidden': 'true', text: 'Salvo' }) : null)),
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
        notice.anexo ? attachmentButton(notice.anexo) : null,
        el('div', { class: 'aviso-rodape' },
            el('button', {
                class: `botao botao-primario botao-leitura${read ? ' confirmado' : ''}`, type: 'button', 'data-acao': 'leitura',
                'aria-pressed': String(read), on: { click: () => toggleRead(notice) }
            }, icon('check-circle', read), 'Confirmar leitura',
            read ? el('span', { class: 'estado-botao', 'aria-hidden': 'true', text: 'Confirmada' }) : null),
            read && notice.lido_em ? el('span', { class: 'meta', text: `Confirmada em ${fullDateTime(notice.lido_em)}` }) : null));
}

function attachmentButton(file) {
    const isPdf = /pdf/i.test(file.tipo_mime || file.nome || '');
    const kind = isPdf ? 'PDF' : /png/i.test(file.tipo_mime || '') ? 'PNG' : 'Imagem';
    const button = el('button', {
        class: 'anexo', type: 'button',
        'aria-label': `Baixar anexo ${file.nome || ''} (${kind}, ${formatSize(file.tamanho)})`,
        on: { click: () => downloadFile(file, button) }
    },
    el('span', { class: 'icone-quadrado' }, icon(isPdf ? 'file-pdf' : 'file-image')),
    el('span', { class: 'anexo-texto' },
        el('span', { class: 'anexo-nome', text: file.nome || 'Anexo' }),
        el('span', { class: 'meta', text: `${kind} · ${formatSize(file.tamanho)}` })),
    el('span', { class: 'anexo-baixar' }, icon('download-simple')));
    return el('div', { class: 'anexos' }, el('p', { class: 'campo-rotulo', text: 'Anexo' }), button);
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
            fieldError(textarea, 'Escreva sua resposta antes de enviar.');
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
            if (error.status === 409) {
                // A atividade já foi corrigida: não dá mais para reenviar.
                CwFormulario.erro(textarea, error.message || 'Esta atividade já foi corrigida. Não é possível reenviar.', { focar: true });
                loadSource('atividades');
                return;
            }
            CwFormulario.mostrar(form, error, textarea);
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
    // Entrega com nota não pode ser reenviada (o servidor responde 409).
    const graded = [answer?.nota, submission?.nota].some((nota) => nota !== null && nota !== undefined);
    if (status === 'entregues' && !graded && !isOverdue(activity)) {
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

function statusBadge(status) {
    const config = ABSENCE_STATUS[status];
    return el('span', { class: `selo ${config.className}` }, icon(config.icon), config.label);
}

function renderAbsences() {
    const guard = sourceGuard('frequencias', 3);
    if (guard) return guard;
    const groups = absenceGroups();
    if (!groups.length) return emptyState('Nenhuma falta registrada. Continue assim!', 'calendar-check');
    const toJustify = groups.filter(canJustify).length;
    return [
        el('p', { class: 'meta', text: toJustify
            ? `${plural(toJustify, 'falta pode', 'faltas podem')} ser justificada${toJustify === 1 ? '' : 's'}. Envie em até ${JUSTIFY_BUSINESS_DAYS} dias úteis depois da falta.`
            : `Justificativas são aceitas em até ${JUSTIFY_BUSINESS_DAYS} dias úteis depois da falta.` }),
        card('cartao-tabela',
            el('table', { class: 'tabela tabela-faltas' },
                el('caption', { class: 'visually-hidden', text: 'Histórico de faltas' }),
                el('thead', {}, el('tr', {},
                    el('th', { scope: 'col', text: 'Data' }),
                    el('th', { scope: 'col', text: 'Disciplina' }),
                    el('th', { scope: 'col', text: 'Aulas' }),
                    el('th', { scope: 'col', text: 'Situação' }),
                    el('th', { scope: 'col' }, srText('Ação')))),
                el('tbody', {}, groups.map((group) => {
                    const titleId = `falta-${group.key}`;
                    const answer = group.status === 'recusada' && group.detalhe?.resposta
                        ? el('span', { class: 'meta resposta-justificativa', text: `Resposta: ${group.detalhe.resposta}` }) : null;
                    let action;
                    if (canJustify(group)) {
                        action = el('a', {
                            class: 'botao botao-contorno botao-pequeno', href: `#/frequencia/justificar/${group.key}`,
                            'aria-describedby': titleId
                        }, icon('file-arrow-up'), group.status === 'recusada' ? 'Enviar de novo' : 'Justificar');
                    } else if (group.status === 'sem' || group.status === 'recusada') {
                        action = el('span', { class: 'meta', text: 'Prazo encerrado' });
                    }
                    return el('tr', {},
                        el('td', { class: 'tabela-data', id: titleId, text: formatSchoolDate(group.data) }),
                        el('td', { class: 'tabela-forte', text: group.nome_disciplina }),
                        el('td', { class: 'tabela-aulas', text: plural(group.aulas, 'aula', 'aulas') }),
                        el('td', { class: 'tabela-situacao' }, statusBadge(group.status), answer),
                        el('td', { class: 'tabela-acao' }, action));
                }))))
    ];
}

function renderJustify() {
    const guard = sourceGuard('frequencias', 2);
    if (guard) return guard;
    const eligible = absenceGroups().filter(canJustify);
    const chosen = state.route.id ? absenceGroups().find((group) => group.key === state.route.id) : null;

    if (chosen && !canJustify(chosen)) {
        return [emptyState(chosen.status === 'pendente' ? 'Essa falta já tem uma justificativa em análise.'
            : chosen.status === 'aceita' ? 'Essa falta já foi justificada.'
                : `O prazo para justificar essa falta terminou (${JUSTIFY_BUSINESS_DAYS} dias úteis).`, 'calendar-x'),
        el('a', { class: 'link-seta', href: '#/frequencia/faltas' }, icon('arrow-left'), 'Voltar ao histórico de faltas')];
    }
    if (!eligible.length) {
        return [emptyState(`Nenhuma falta para justificar agora. Só dá para justificar faltas sem justificativa, em até ${JUSTIFY_BUSINESS_DAYS} dias úteis.`, 'calendar-check'),
            el('a', { class: 'link-seta', href: '#/frequencia/faltas' }, icon('arrow-left'), 'Ver histórico de faltas')];
    }

    const absenceLabel = (group) => `${formatSchoolDate(group.data)} · ${group.nome_disciplina} · ${plural(group.aulas, 'aula', 'aulas')}`;
    let selector;
    if (chosen) {
        selector = el('div', { class: 'grade-campos' },
            el('div', { class: 'campo' },
                el('label', { class: 'campo-rotulo', for: 'just-data', text: 'Data da falta' }),
                el('input', { class: 'campo-leitura', id: 'just-data', type: 'text', readonly: true, value: formatSchoolDate(chosen.data) })),
            el('div', { class: 'campo' },
                el('label', { class: 'campo-rotulo', for: 'just-disciplina', text: 'Disciplina' }),
                el('input', {
                    class: 'campo-leitura', id: 'just-disciplina', type: 'text', readonly: true,
                    value: `${chosen.nome_disciplina} · ${plural(chosen.aulas, 'aula', 'aulas')}`
                })));
    } else {
        const select = el('select', { id: 'just-falta', name: 'falta', class: 'campo-select', required: true },
            el('option', { value: '', text: 'Escolha a falta' }),
            eligible.map((group) => el('option', { value: group.key, text: absenceLabel(group) })));
        if (eligible.length === 1) select.value = eligible[0].key;
        selector = el('div', { class: 'campo' },
            el('label', { class: 'campo-rotulo', for: 'just-falta', text: 'Falta a justificar' }), select);
    }

    const motive = el('textarea', {
        id: 'just-motivo', name: 'motivo', rows: '4', maxlength: '1000', required: true,
        placeholder: 'Descreva brevemente o motivo da falta', 'aria-describedby': 'just-motivo-ajuda'
    });
    const picker = filePicker();
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Enviar justificativa');
    const form = el('form', { class: 'cartao formulario cartao-justificar', novalidate: true, 'aria-labelledby': 'titulo-pagina' },
        el('p', { class: 'meta', text: `Envie em até ${JUSTIFY_BUSINESS_DAYS} dias úteis depois da falta. A coordenação analisa e você acompanha a situação em Histórico de faltas.` }),
        selector,
        el('div', { class: 'campo' },
            el('label', { class: 'campo-rotulo', for: 'just-motivo', text: 'Motivo' }),
            motive,
            el('p', { class: 'meta', id: 'just-motivo-ajuda', text: 'Até 1.000 caracteres.' })),
        picker.node,
        el('div', { class: 'acoes' },
            el('a', { class: 'botao botao-contorno', href: '#/frequencia/faltas' }, 'Cancelar'),
            submit));

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        CwFormulario.limparTudo(form);
        const key = chosen ? chosen.key : form.querySelector('#just-falta').value;
        const group = absenceGroups().find((item) => item.key === key);
        if (!group) return fieldError(form.querySelector('#just-falta'), 'Escolha a falta que você quer justificar.');
        const reason = motive.value.trim();
        if (reason.length < 5) return fieldError(motive, 'Escreva o motivo da falta (pelo menos 5 caracteres).');
        if (picker.error()) {
            picker.input.focus();
            return undefined;
        }

        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
        try {
            let fileId;
            const file = picker.file();
            if (file) {
                submit.replaceChildren(icon('upload-simple'), 'Enviando anexo…');
                fileId = (await uploadFile(file))?.id_arquivo;
            }
            submit.replaceChildren(icon('paper-plane-tilt'), 'Enviando…');
            await api('/api/justificativas', {
                method: 'POST',
                body: JSON.stringify({
                    id_disciplina: Number(group.id_disciplina), data_falta: group.data, motivo: reason,
                    ...(fileId ? { id_arquivo: fileId } : {})
                })
            });
            clearErrorNotifications();
            notify('Justificativa enviada! A coordenação vai analisar.', 'sucesso');
            loadSource('justificativas');
            loadSource('frequencias');
            navigate('#/frequencia/faltas');
        } catch (error) {
            const anexo = /anexo|arquivo/i.test(error.message);
            if (anexo) {
                notify(error.message, 'erro');
                picker.input.focus();
            } else {
                CwFormulario.mostrar(form, error, /motivo/i.test(error.message) ? motive : null);
            }
        } finally {
            submit.disabled = false;
            submit.removeAttribute('aria-busy');
            submit.replaceChildren(icon('paper-plane-tilt'), 'Enviar justificativa');
        }
        return undefined;
    });
    return form;
}

// Campo de anexo opcional (PDF, JPG ou PNG até 5 MB), com arrastar e soltar.
function filePicker() {
    let chosen = null;
    let problem = null;
    const input = el('input', {
        class: 'visually-hidden', id: 'just-anexo', type: 'file', name: 'anexo',
        accept: '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png', 'aria-describedby': 'just-anexo-ajuda'
    });
    const info = el('div', { class: 'anexo-escolhido', 'aria-live': 'polite' });
    const zone = el('label', { class: 'zona-anexo', for: 'just-anexo' },
        el('span', { class: 'icone-quadrado' }, icon('file-arrow-up')),
        el('span', { class: 'zona-anexo-texto' },
            el('span', { class: 'zona-anexo-titulo', text: 'Anexar atestado ou declaração (opcional)' }),
            el('span', { class: 'meta', id: 'just-anexo-ajuda', text: 'PDF, JPG ou PNG · até 5 MB. Toque para escolher ou arraste o arquivo.' })));

    function choose(file) {
        chosen = null;
        problem = null;
        if (file) {
            if (!uploadType(file)) problem = 'O anexo precisa ser PDF, JPG ou PNG.';
            else if (file.size > MAX_UPLOAD_BYTES) problem = 'O anexo passa de 5 MB. Escolha um arquivo menor.';
            else chosen = file;
        }
        paint();
    }

    function paint() {
        zone.classList.toggle('com-erro', Boolean(problem));
        // O erro do anexo fica junto da zona (o input é escondido) e é ligado por aria-describedby.
        if (problem) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'just-anexo-ajuda just-anexo-erro');
            info.replaceChildren(el('p', { class: 'cw-campo-erro', id: 'just-anexo-erro' }, icon('warning-circle'), el('span', { text: problem })));
            return;
        }
        input.removeAttribute('aria-invalid');
        input.setAttribute('aria-describedby', 'just-anexo-ajuda');
        if (!chosen) {
            info.replaceChildren();
            return;
        }
        info.replaceChildren(el('div', { class: 'anexo anexo-estatico' },
            el('span', { class: 'icone-quadrado' }, icon(/pdf/.test(uploadType(chosen)) ? 'file-pdf' : 'file-image')),
            el('span', { class: 'anexo-texto' },
                el('span', { class: 'anexo-nome', text: chosen.name }),
                el('span', { class: 'meta', text: formatSize(chosen.size) })),
            el('button', {
                class: 'botao-icone', type: 'button', 'aria-label': `Remover anexo ${chosen.name}`,
                on: { click: () => { input.value = ''; choose(null); input.focus(); } }
            }, icon('x'))));
    }

    input.addEventListener('change', () => choose(input.files[0] || null));
    zone.addEventListener('dragover', (event) => {
        event.preventDefault();
        zone.classList.add('arrastando');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('arrastando'));
    zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('arrastando');
        choose(event.dataTransfer?.files?.[0] || null);
    });

    return {
        node: el('div', { class: 'campo' }, input, zone, info),
        input,
        file: () => chosen,
        error: () => problem
    };
}

// ---------------------------------------------------------------- Mensagens

function renderMessages() {
    if (state.messagesPanel) {
        state.messagesPanel.desmontar();
        state.messagesPanel = null;
    }
    if (!window.CwMensagens) return errorState('Não foi possível carregar as mensagens.', () => window.location.reload());
    const host = el('div', { class: 'mensagens-host' });
    state.messagesPanel = window.CwMensagens.montar(host, {
        api,
        usuario: state.user,
        aoMudarNaoLidas: (total) => setUnreadMessages(total)
    });
    if (state.route.sub === 'nova') {
        const panel = state.messagesPanel;
        window.setTimeout(() => panel.novaConversa(), 0);
        window.history.replaceState(null, '', '#/mensagens');
    }
    return host;
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
        emailCard(),
        occurrencesCard(),
        logoutCard()
    ];
}

// ---------------------------------------------------------------- Ajustes: conta (e-mail)

let accountPromise = null;

function loadAccount({ force = false } = {}) {
    if (force || !accountPromise) {
        accountPromise = api('/api/conta').catch((error) => {
            accountPromise = null;
            throw error;
        });
    }
    return accountPromise;
}

// Cartão que carrega os próprios dados (não depende do render global, que não redesenha Ajustes).
function asyncCard(className, title, load, paint, { titleId } = {}) {
    const body = el('div', { class: 'cartao-corpo' });
    const section = card(className, el('h2', { class: 'cartao-titulo', id: titleId, tabindex: '-1', text: title }), body);
    const controller = {
        node: section,
        data: null,
        async reload(options) {
            body.replaceChildren(skeletonList(1));
            try {
                controller.data = await load(options);
                controller.repaint();
            } catch (error) {
                body.replaceChildren(errorState(error.message, () => controller.reload({ force: true })));
            }
        },
        repaint() {
            body.replaceChildren(...[paint(controller.data, controller)].flat().filter(Boolean));
        }
    };
    controller.reload();
    return { node: section, controller };
}

function emailCard() {
    const { node } = asyncCard('cartao-email', 'E-mail', (options) => loadAccount(options), (account, controller) => {
        const nodes = [];
        if (account.email) {
            nodes.push(el('div', { class: 'email-atual' },
                el('span', { class: 'icone-quadrado' }, icon('envelope-simple')),
                el('span', { class: 'email-texto' },
                    el('span', { class: 'email-endereco', text: account.email }),
                    el('span', { class: 'meta', text: 'Confirmado · usado para recuperar a senha e receber notificações' }))));
        } else {
            nodes.push(el('p', { class: 'meta', text: 'Cadastre um e-mail para recuperar a senha sozinho(a) e receber avisos importantes por e-mail.' }));
        }
        if (state.pendingEmail) {
            nodes.push(el('div', { class: 'caixa-info', role: 'status' }, icon('paper-plane-tilt'),
                el('p', {}, 'Enviamos um link de confirmação para ', el('strong', { text: state.pendingEmail }),
                    '. Abra o e-mail e toque no link para concluir. Não chegou? Confira o spam ou envie de novo.')));
        }

        const field = el('input', {
            id: 'email-novo', name: 'email', type: 'email', autocomplete: 'email', inputmode: 'email',
            maxlength: '254', required: true, placeholder: 'seuemail@exemplo.com', spellcheck: 'false'
        });
        const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Enviar link de confirmação');
        // Trocar o e-mail de recuperação exige a senha atual (uma sessão roubada não basta).
        const passwordBlock = passwordField('email-senha', 'Senha atual', 'current-password');
        const password = passwordBlock.querySelector('input');
        const form = el('form', { class: 'formulario-email', novalidate: true },
            el('div', { class: 'campo' },
                el('label', { class: 'campo-rotulo', for: 'email-novo', text: account.email ? 'Trocar por outro e-mail' : 'Seu e-mail' }),
                el('div', { class: 'linha-campo', 'data-campo-erro-apos': true }, field)),
            passwordBlock,
            el('div', { class: 'acoes' }, submit));
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            CwFormulario.limparTudo(form);
            const email = field.value.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fieldError(field, 'Digite um e-mail válido, como nome@exemplo.com.');
            if (!password.value) return fieldError(password, 'Digite a sua senha atual para confirmar a troca.');
            submit.disabled = true;
            try {
                const result = await api('/api/conta/email', {
                    method: 'POST', body: JSON.stringify({ email, senha_atual: password.value })
                });
                state.pendingEmail = result?.email_pendente || email;
                clearErrorNotifications();
                notify(`Enviamos um link de confirmação para ${state.pendingEmail}.`, 'sucesso');
                controller.repaint();
            } catch (error) {
                CwFormulario.mostrar(form, error, /senha/i.test(error.message) ? password : field);
                submit.disabled = false;
            }
            return undefined;
        });
        nodes.push(form);

        if (account.email) {
            nodes.push(el('button', {
                class: 'link-botao link-perigo', type: 'button',
                on: { click: () => confirmRemoveEmail(account, controller) }
            }, icon('trash'), 'Remover e-mail'));
        }
        if (state.focusEmailField) {
            state.focusEmailField = false;
            window.setTimeout(() => field.focus(), 0);
        }
        return nodes;
    }, { titleId: 'email-titulo' });
    return node;
}

function confirmRemoveEmail(account, controller) {
    const confirm = el('button', { class: 'botao botao-primario botao-perigo-cheio', type: 'submit' }, 'Remover e-mail');
    const cancel = el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Cancelar');
    const passwordBlock = passwordField('email-remover-senha', 'Senha atual', 'current-password');
    const password = passwordBlock.querySelector('input');
    const form = el('form', { class: 'formulario', novalidate: true },
        el('p', { class: 'dialogo-descricao', text: `Sem e-mail você não recebe notificações e não consegue recuperar a senha sozinho(a). Remover ${account.email}?` }),
        passwordBlock,
        el('div', { class: 'acoes' }, cancel, confirm));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        CwFormulario.limparTudo(form);
        if (!password.value) return fieldError(password, 'Digite a sua senha atual para remover o e-mail.');
        confirm.disabled = true;
        try {
            await api('/api/conta/email', { method: 'DELETE', body: JSON.stringify({ senha_atual: password.value }) });
            account.email = null;
            $('#dialogo').close();
            notify('E-mail removido.', 'sucesso');
            controller.repaint();
        } catch (error) {
            CwFormulario.mostrar(form, error, password);
            confirm.disabled = false;
        }
        return undefined;
    });
    openDialog('Remover e-mail?', form);
    // Ação destrutiva: o foco começa no campo de senha, nunca no botão de remover.
    window.setTimeout(() => password.focus(), 0);
}

function occurrencesCard() {
    const { node } = asyncCard('cartao-ocorrencias', 'Ocorrências', async () => {
        let source = await whenSource('ocorrencias');
        if (source.status === 'error') source = await loadSource('ocorrencias');
        if (source.status === 'error') throw new Error(source.error);
        return occurrences();
    }, (list) => {
        if (!list.length) return emptyState('Nenhuma ocorrência registrada. Continue assim!', 'seal-check');
        const sorted = [...list].sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
        return el('ul', { class: 'lista-ocorrencias' }, sorted.map((item) => {
            const open = isOpenOccurrence(item);
            // Para o aluno, o servidor manda só o perfil do autor ({ perfil }).
            const author = item.autor?.nome
                || { professor: 'Registrada por professor(a)', gestao: 'Registrada pela coordenação' }[item.autor?.perfil] || null;
            return el('li', { class: 'ocorrencia' },
                el('span', { class: `selo ${open ? 'selo-vermelho' : 'selo-neutro'}`, text: open ? 'Em aberto' : 'Resolvida' }),
                el('p', { class: 'ocorrencia-texto', text: item.descricao || '' }),
                el('p', { class: 'meta', text: [item.criado_em ? formatSchoolDate(item.criado_em, { utc: true }) : null,
                    author, item.disciplina?.nome_disciplina || item.nome_disciplina].filter(Boolean).join(' · ') }));
        }));
    }, { titleId: 'ocorrencias' });
    return node;
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
        CwFormulario.limparTudo(form);
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
            form.dispatchEvent(new CustomEvent('senha-alterada'));
        } catch (error) {
            CwFormulario.mostrar(form, error, /atual|incorreta/i.test(error.message) ? current : next);
        } finally {
            submit.disabled = false;
        }
        return undefined;
    });
    const sessions = sessionsCard();
    // Depois de trocar a senha, as outras sessões são encerradas: atualiza a lista.
    form.addEventListener('senha-alterada', () => sessions.controller.reload());
    return el('div', { class: 'grade-seguranca' }, form, sessions.node);
}

function deviceIcon(name) {
    const text = normalize(name);
    if (/android|iphone|ios|celular|mobile/.test(text)) return 'device-mobile';
    if (/ipad|tablet/.test(text)) return 'device-tablet';
    return 'desktop';
}

function sessionsCard() {
    return asyncCard('cartao-dispositivos', 'Dispositivos conectados', async () => {
        const result = await api('/api/conta/sessoes');
        return Array.isArray(result) ? result : result?.sessoes || [];
    }, (list, controller) => {
        if (!list.length) return emptyState('Nenhuma sessão ativa encontrada.', 'devices');
        const others = list.filter((item) => !item.atual);
        const sorted = [...list].sort((a, b) => Number(Boolean(b.atual)) - Number(Boolean(a.atual))
            || String(b.ultimo_acesso || '').localeCompare(String(a.ultimo_acesso || '')));
        const nodes = [el('p', { class: 'meta', text: 'Aparelhos em que sua conta está aberta agora. Desconecte os que você não reconhece.' }),
            el('ul', { class: 'lista-dispositivos' }, sorted.map((item) => {
                const name = item.dispositivo || 'Aparelho desconhecido';
                const info = item.atual ? 'Este aparelho · ativo agora'
                    : item.ultimo_acesso ? `Último acesso ${timeAgo(item.ultimo_acesso)}` : 'Sem acesso recente';
                const button = item.atual ? el('span', { class: 'selo selo-azul', text: 'Este aparelho' })
                    : el('button', {
                        class: 'botao botao-contorno botao-pequeno', type: 'button', 'aria-label': `Desconectar ${name}`,
                        on: {
                            click: async () => {
                                button.disabled = true;
                                try {
                                    await api(`/api/conta/sessoes/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
                                    controller.data = controller.data.filter((other) => other !== item);
                                    notify(`${name} foi desconectado.`, 'sucesso');
                                    controller.repaint();
                                    controller.node?.querySelector('.cartao-titulo')?.focus();
                                } catch (error) {
                                    notify(error.message, 'erro');
                                    button.disabled = false;
                                }
                            }
                        }
                    }, 'Desconectar');
                return el('li', { class: 'dispositivo' },
                    el('span', { class: 'icone-quadrado' }, icon(deviceIcon(name))),
                    el('span', { class: 'dispositivo-texto' },
                        el('span', { class: 'dispositivo-nome', text: name }),
                        el('span', { class: 'meta', text: info })),
                    button);
            }))];
        if (others.length > 1) {
            const all = el('button', { class: 'link-botao link-perigo', type: 'button' }, icon('sign-out'), 'Desconectar todos os outros aparelhos');
            all.addEventListener('click', async () => {
                all.disabled = true;
                try {
                    await api('/api/conta/sessoes', { method: 'DELETE' });
                    controller.data = controller.data.filter((item) => item.atual);
                    notify('Os outros aparelhos foram desconectados.', 'sucesso');
                    controller.repaint();
                } catch (error) {
                    notify(error.message, 'erro');
                    all.disabled = false;
                }
            });
            nodes.push(all);
        }
        return nodes;
    });
}

// ---------------------------------------------------------------- Ajustes: privacidade (LGPD)

// Data de hoje em Brasília (AAAA-MM-DD) para o nome do arquivo exportado.
function schoolTodayIso() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

// "Baixar meus dados": fetch autenticado (token no cabeçalho, nunca na URL) → arquivo .json.
async function downloadMyData(trigger) {
    trigger.disabled = true;
    trigger.setAttribute('aria-busy', 'true');
    try {
        const response = await fetch('/api/privacidade/meus-dados', { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 401) {
            leaveToLogin({ expirou: true });
            return;
        }
        if (!response.ok) {
            const result = await response.json().catch(() => null);
            throw new Error(result?.erro || 'Não foi possível gerar o arquivo com os seus dados.');
        }
        const url = URL.createObjectURL(await response.blob());
        const link = el('a', { href: url, download: `cw-meus-dados-${schoolTodayIso()}.json`, hidden: true });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        notify('Arquivo com os seus dados baixado.', 'sucesso');
    } catch (error) {
        notify(error instanceof TypeError ? 'Sem conexão. Confira a internet e tente de novo.' : error.message, 'erro');
    } finally {
        trigger.disabled = false;
        trigger.removeAttribute('aria-busy');
    }
}

function renderPrivacy() {
    const download = el('button', { class: 'botao botao-primario', type: 'button' }, icon('download-simple'), 'Baixar meus dados');
    download.addEventListener('click', () => downloadMyData(download));
    return [
        card('cartao-privacidade',
            el('h2', { class: 'cartao-titulo', text: 'Privacidade' }),
            el('p', { class: 'meta', text: 'Seus dados são usados só para a comunicação da escola. Quem vê: você, seus professores e a gestão do CEEP.' }),
            el('a', { class: 'botao botao-contorno', href: '/privacidade', target: '_blank', rel: 'noopener' },
                icon('shield-check'), 'Ler a política de privacidade', srText(' (abre em nova aba)'))),
        card('cartao-privacidade',
            el('h2', { class: 'cartao-titulo', text: 'Seus dados' }),
            el('p', { class: 'meta', text: 'Baixe uma cópia de tudo o que o C·Warning guarda sobre você: perfil, frequência, entregas, justificativas, ocorrências, mensagens e acessos. Para corrigir algum dado, procure a secretaria.' }),
            download)
    ];
}

// ---------------------------------------------------------------- Ajustes: notificações e aparência

function renderNotifications() {
    const { node } = asyncCard('cartao-notificacoes', 'Notificações por e-mail', (options) => loadAccount(options), (account) => {
        const prefs = account.notificacoes || {};
        const nodes = [el('p', { class: 'meta', text: 'Escolha o que você quer receber por e-mail. Aqui no C·Warning tudo continua aparecendo normalmente.' })];
        if (!account.email) {
            nodes.push(el('div', { class: 'caixa-info caixa-alerta' }, icon('envelope-simple'),
                el('div', {},
                    el('p', { text: 'Você ainda não tem e-mail cadastrado, então não recebe nada fora do C·Warning. Cadastre e confirme um e-mail para ligar as notificações (e poder recuperar a senha sozinho).' }),
                    el('a', {
                        class: 'botao botao-primario botao-pequeno', href: '#/ajustes/perfil',
                        on: { click: () => { state.focusEmailField = true; } }
                    }, icon('plus'), 'Adicionar e-mail'))));
        }
        const status = el('p', { class: 'visually-hidden', role: 'status' });
        nodes.push(el('ul', { class: 'lista-preferencias' }, NOTIFICATION_TYPES.map(([key, label, description, iconName]) => {
            const id = `notif-${key}`;
            const toggle = el('input', {
                class: 'interruptor', id, type: 'checkbox', role: 'switch',
                'aria-describedby': `${id}-desc`, disabled: !account.email
            });
            toggle.checked = Boolean(prefs[key]) && Boolean(account.email);
            toggle.addEventListener('change', async () => {
                const value = toggle.checked;
                toggle.disabled = true;
                try {
                    await api('/api/conta/notificacoes', { method: 'PUT', body: JSON.stringify({ [key]: value }) });
                    prefs[key] = value;
                    account.notificacoes = prefs;
                    status.textContent = `${label}: e-mail ${value ? 'ligado' : 'desligado'}.`;
                } catch (error) {
                    toggle.checked = !value;
                    notify(error.message, 'erro');
                } finally {
                    toggle.disabled = false;
                }
            });
            return el('li', { class: 'preferencia' },
                el('span', { class: 'icone-quadrado' }, icon(iconName)),
                el('span', { class: 'preferencia-texto' },
                    el('label', { class: 'preferencia-nome', for: id, text: label }),
                    el('span', { class: 'meta', id: `${id}-desc`, text: description })),
                toggle);
        })), status);
        return nodes;
    });
    return node;
}

function renderAppearance() {
    const prefs = window.cwAparencia?.read() || { tema: 'claro', texto: 'medio' };
    const save = (changes) => {
        if (window.cwAparencia) window.cwAparencia.save(changes);
    };
    const themes = el('fieldset', { class: 'cartao grupo-opcoes' },
        el('legend', { class: 'cartao-titulo', text: 'Tema' }),
        el('div', { class: 'grade-temas' }, THEMES.map(([value, label]) => {
            const input = el('input', { class: 'visually-hidden', type: 'radio', name: 'tema', id: `tema-${value}`, value });
            input.checked = prefs.tema === value;
            input.addEventListener('change', () => save({ tema: value }));
            return el('label', { class: 'opcao-tema', for: `tema-${value}` }, input,
                el('span', { class: `previa-tema previa-${value}`, 'aria-hidden': 'true' },
                    el('span', { class: 'previa-barra' }), el('span', { class: 'previa-linha' })),
                el('span', { class: 'opcao-rotulo' }, el('span', { class: 'radio-falso', 'aria-hidden': 'true' }), label));
        })),
        el('p', { class: 'meta', text: 'Automático segue o tema do seu aparelho. A escolha vale só para este navegador.' }));
    const sizes = el('fieldset', { class: 'cartao grupo-opcoes grupo-tamanho' },
        el('legend', { class: 'cartao-titulo', text: 'Tamanho do texto' }),
        el('div', { class: 'segmentado' }, TEXT_SIZES.map(([value, label]) => {
            const input = el('input', { class: 'visually-hidden', type: 'radio', name: 'texto', id: `texto-${value}`, value });
            input.checked = prefs.texto === value;
            input.addEventListener('change', () => save({ texto: value }));
            return el('label', { class: `segmento texto-${value}`, for: `texto-${value}` }, input, el('span', { text: label }));
        })));
    return [themes, sizes];
}

// Erro de validação junto do campo (aria-invalid + aria-describedby), sem toast.
function fieldError(input, message) {
    CwFormulario.erro(input, message, { focar: true });
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
            el('p', { class: 'meta', text: 'Mande uma mensagem para a coordenação ou um professor, ou procure a secretaria do CEEP Lourdinha Guerra, de segunda a sexta, no horário de funcionamento da escola.' }),
            el('a', { class: 'botao botao-primario', href: '#/mensagens/nova' }, icon('chat-circle-dots'), 'Enviar mensagem')));
}

// ---------------------------------------------------------------- início

initialize();
