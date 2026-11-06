// Portal do Aluno (C·Warning).
// Aplicação de página única: navegação por hash (#/secao/sub), dados reais da API,
// renderização só com createElement/textContent (nada de innerHTML com dados).
// Depende de /datas.js (datas no horário de Brasília), /notificacoes.js (notify),
// /preferencias.js (cwAparencia). O chat (Mensagens) não faz parte do portal do aluno.

'use strict';

const TOKEN_KEY = 'cwarning-token';
const token = sessionStorage.getItem(TOKEN_KEY);
const FUSO_ESCOLA = 'America/Sao_Paulo';
const FREQUENCIA_MINIMA = 75;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const JUSTIFY_BUSINESS_DAYS = 5;
const UPLOAD_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

const COURSE_NAMES = { informatica: 'Técnico em Informática', redes: 'Técnico em Redes de Computadores' };
const SERIES_NAMES = { 1: '1ª série', 2: '2ª série', 3: '3ª série' };
const CATEGORIES = {
    urgente: { label: 'Urgente', icon: 'warning' },
    turma: { label: 'Minha turma', icon: 'users-three' },
    coordenacao: { label: 'Coordenação', icon: 'buildings' },
    eventos: { label: 'Evento', icon: 'confetti' }
};

const ACTIVITY_STATUS = {
    pendentes: { icon: 'hourglass-medium', button: 'Enviar', buttonIcon: 'upload-simple' },
    entregues: { icon: 'check-circle', button: 'Ver envio', buttonIcon: 'eye' },
    corrigidas: { icon: 'seal-check', button: 'Ver correção', buttonIcon: 'chat-text' }
};

const SECTIONS = {
    inicio: { title: 'Início', defaultSub: null },
    avisos: { title: 'Avisos', defaultSub: 'todos' },
    atividades: { title: 'Atividades', defaultSub: 'pendentes' },
    horarios: { title: 'Horários', defaultSub: null },
    frequencia: { title: 'Frequência', defaultSub: 'resumo' },
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
    ['eventos', 'Eventos da escola', 'Feira, reuniões e datas do calendário', 'calendar-dots']
];

const THEMES = [['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']];
const TEXT_SIZES = [['pequeno', 'Pequeno'], ['medio', 'Médio'], ['grande', 'Grande']];

const FAQ = [
    ['Como confirmo que li um aviso?',
        'Abra o aviso e toque em "Confirmar leitura". Ele sai da lista de não lidos. Se confirmou por engano, toque de novo para desfazer.'],
    ['Onde encontro os avisos que salvei?',
        'Em Avisos › Salvos (ou no Início, em "Avisos salvos"). Use o botão "Salvar aviso" dentro do aviso para guardar os mais importantes. Em Salvos você cria pastas e escolhe a pasta de cada aviso.'],
    ['Onde vejo o horário da minha turma?',
        'Na aba Horários, na barra de baixo: escolha o dia para ver as aulas. Em "Horário em PDF", toque em "Baixar" para abrir o arquivo publicado pela escola.'],
    ['Como envio uma atividade?',
        'Em Atividades › Pendentes, toque em "Enviar", escreva sua resposta e confirme antes do prazo. Até o prazo terminar você pode reenviar.'],
    ['Como justifico uma falta?',
        'No Início, abra Frequência › Histórico de faltas, toque em "Justificar" na falta, escreva o motivo e anexe o atestado (PDF, JPG ou PNG, até 5 MB). Envie em até 5 dias úteis depois da falta.'],
    ['Minha frequência está abaixo de 75%. E agora?',
        'O mínimo para aprovação é 75% de presença. Procure a coordenação para entender a situação e combinar a reposição.'],
    ['Esqueci minha senha. O que faço?',
        'Na tela de entrada, toque em "Esqueci minha senha". Se você tiver um e-mail cadastrado em Perfil, enviamos um link para criar uma senha nova. Sem e-mail, procure a secretaria.']
];

// Perguntas que valem para a conta da turma (sem faltas nem senha própria; entrega só com matrícula + senha).
const CLASS_ACCOUNT_FAQ = new Set([
    'Como confirmo que li um aviso?',
    'Onde encontro os avisos que salvei?',
    'Onde vejo o horário da minha turma?'
]);

// ---------------------------------------------------------------- estado

const state = {
    user: null,
    route: { section: 'inicio', sub: null, id: null },
    // Tela que fica atrás do aviso aberto (o aviso abre num painel por cima dela).
    behind: null,
    openedInApp: false,
    scheduleDay: null,
    lastNoticeSub: 'todos',
    search: '',
    sources: {
        mural: { status: 'loading', data: null, error: null },
        desempenho: { status: 'loading', data: null, error: null },
        atividades: { status: 'loading', data: null, error: null },
        horarios: { status: 'loading', data: null, error: null },
        frequencias: { status: 'loading', data: null, error: null },
        ocorrencias: { status: 'loading', data: null, error: null },
        justificativas: { status: 'loading', data: null, error: null },
        pastas: { status: 'loading', data: null, error: null },
        salvos: { status: 'loading', data: null, error: null },
        horariosPdf: { status: 'loading', data: null, error: null }
    },
    // Filtro da tela Salvos: 'todas', 'sem' (sem pasta) ou o id_pasta.
    savedFolder: 'todas',
    lastUnreadAnnounced: null,
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
    justificativas: '/api/justificativas',
    pastas: '/api/pastas',
    salvos: '/api/salvos',
    horariosPdf: '/api/horarios-pdf'
};

// Fontes da sprint 4: enquanto a rota não existir no servidor, mostram um erro amigável.
const NEW_SOURCES = new Set(['pastas', 'salvos', 'horariosPdf']);
const MAX_FOLDER_NAME = 40;

const $ = (selector) => document.querySelector(selector);

// Conta da turma (login "turma-<id>", compartilhada pelos alunos): sem dados pessoais. A API
// recusa frequência, justificativas, entregas, e-mail, "meus dados" e troca de senha.
const PERSONAL_SOURCES = new Set(['desempenho', 'frequencias', 'justificativas', 'ocorrencias']);

function isClassAccount() {
    return Boolean(state.user?.conta_turma);
}

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
    window.location.replace('/entrar');
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
    if (response.status === 403 && /termos de uso/.test(result?.erro || '')) window.location.replace('/entrar');
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
    // A promessa existe antes do render(): um cartão que chama whenSource() durante o render
    // reaproveita esta carga em vez de disparar outra (antes, isso entrava em recursão infinita).
    source.promise = (async () => {
        try {
            source.data = await api(SOURCE_PATHS[name]);
            source.status = 'ok';
        } catch (error) {
            source.status = 'error';
            source.error = error.status === 404 && NEW_SOURCES.has(name)
                ? 'Este recurso ainda não está disponível. Tente de novo mais tarde.' : error.message;
        }
        render();
        return source;
    })();
    render();
    return source.promise;
}

// Resolve quando a fonte terminou de carregar (com sucesso ou erro).
function whenSource(name) {
    const source = state.sources[name];
    if (source.status === 'ok' || source.status === 'error') return Promise.resolve(source);
    return source.promise || loadSource(name);
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
        window.location.replace('/entrar');
        return;
    }

    setupShell();
    applyRoute(parseHash(), { focus: false });
    window.addEventListener('hashchange', () => applyRoute(parseHash(), { focus: true }));
    const names = Object.keys(SOURCE_PATHS).filter((name) => !isClassAccount() || !PERSONAL_SOURCES.has(name));
    await Promise.all(names.map(loadSource));
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
    const short = text.replace('-feira', '');
    return short.charAt(0).toUpperCase() + short.slice(1);
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

// Só atividades recebem envio pelo portal; avaliações são provas presenciais.
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

// ---------------------------------------------------------------- subseções

function countIf(ready, value) {
    return ready ? value : null;
}

function subnavGroups(section) {
    const muralReady = state.sources.mural.status === 'ok';
    const all = notices();
    const activitiesReady = state.sources.atividades.status === 'ok';
    const countStatus = (status) => deliverables().filter((activity) => activityStatus(activity) === status).length;
    const absencesReady = state.sources.frequencias.status === 'ok';

    const groups = {
        avisos: [
            ['Caixa', [
                ['todos', 'Todos', 'tray', countIf(muralReady, all.length)],
                ['naolidos', 'Não lidos', 'envelope-simple', countIf(muralReady, all.filter(isUnread).length)],
                ['salvos', 'Salvos', 'bookmark-simple', savedCount()]
            ]],
            ['Categorias', [
                ['urgente', 'Urgentes', 'warning-circle', countIf(muralReady, all.filter(NOTICE_FILTERS.urgente).length)],
                ['turma', 'Minha turma', 'users-three', countIf(muralReady, all.filter(NOTICE_FILTERS.turma).length)],
                ['coordenacao', 'Coordenação', 'buildings', countIf(muralReady, all.filter(NOTICE_FILTERS.coordenacao).length)],
                ['eventos', 'Eventos', 'confetti', countIf(muralReady, all.filter(NOTICE_FILTERS.eventos).length)]
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
    if (isClassAccount()) {
        groups.atividades = [['Status', [
            ['pendentes', 'Pendentes', 'hourglass-medium', countIf(activitiesReady, countStatus('pendentes'))]]]];
        groups.ajustes = [
            ['Conta', [['perfil', 'Perfil', 'user-circle', null], ['privacidade', 'Privacidade', 'shield-check', null]]],
            ['Preferências', [['aparencia', 'Aparência', 'paint-brush', null]]],
            ['Suporte', [['ajuda', 'Ajuda', 'question', null]]]
        ];
        delete groups.frequencia;
    }
    return groups[section] || null;
}

function subLabel(section, sub) {
    for (const [, items] of subnavGroups(section) || []) {
        const found = items.find(([key]) => key === sub);
        if (found) return found[1];
    }
    return null;
}

// Subseções como chips roláveis, logo abaixo do título da página.
function chipsNav() {
    const { section, sub } = currentView();
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
    if (isClassAccount()) {
        // Seções pessoais não existem para a conta da turma: volta para o Início / Perfil / Pendentes.
        if (section === 'frequencia') return { section: 'inicio', sub: null, id: null };
        if (section === 'ajustes' && (sub === 'seguranca' || sub === 'notificacoes')) return { section, sub: 'perfil', id: null };
        if (section === 'atividades' && sub !== 'pendentes') return { section, sub: 'pendentes', id: null };
    }
    if (section === 'frequencia' && sub === 'justificar' && /^\d+_\d{4}-\d{2}-\d{2}$/.test(parts[2] || '')) {
        id = parts[2];
    }
    const groups = subnavGroups(section);
    if (groups && !id && !groups.some(([, items]) => items.some(([key]) => key === sub))) {
        sub = SECTIONS[section].defaultSub;
    }
    if (section === 'horarios') sub = null;
    return { section, sub, id };
}

function isNoticeRoute(route) {
    return route.section === 'avisos' && Boolean(route.id);
}

// Tela desenhada no fundo: a própria rota, ou (com um aviso aberto) a tela de onde ele foi aberto.
function currentView() {
    if (!isNoticeRoute(state.route)) return state.route;
    return state.behind || { section: 'avisos', sub: state.lastNoticeSub || 'todos', id: null };
}

function routeHash(route) {
    return `#/${[route.section, route.sub, route.id].filter(Boolean).join('/')}`;
}

function applyRoute(route, { focus }) {
    // Rotas que não existem mais (a antiga #/agenda e o chat #/mensagens) caem no Início sem erro.
    const first = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    if (first && !SECTIONS[first]) window.history.replaceState(null, '', '#/inicio');
    const previous = state.route;
    const leavingNotice = isNoticeRoute(previous) && !isNoticeRoute(route);
    if (!isNoticeRoute(route)) state.behind = route;
    else if (!isNoticeRoute(previous)) state.openedInApp = focus;
    state.route = route;
    if (route.section === 'avisos' && route.sub) state.lastNoticeSub = route.sub;
    render();
    if (isNoticeRoute(route)) return;
    if (leavingNotice) {
        // Fechou o aviso: o foco volta ao cartão que o abriu (ou ao título), sem rolar a tela.
        const opener = $('#conteudo').querySelector(`a[href="#/avisos/${previous.id}"]`);
        (opener || $('#titulo-pagina')).focus({ preventScroll: true });
        return;
    }
    if (focus) {
        window.scrollTo(0, 0);
        if (document.activeElement?.id !== 'busca-lista-campo') $('#titulo-pagina').focus({ preventScroll: true });
    }
}

function navigate(hash) {
    if (window.location.hash === hash) applyRoute(parseHash(), { focus: false });
    else window.location.hash = hash;
}

// Fecha o painel do aviso voltando para a tela de trás (no histórico, quando veio de dentro do portal).
function closeNotice() {
    if (!isNoticeRoute(state.route)) return;
    if (state.openedInApp) window.history.back();
    else navigate(routeHash(currentView()));
}

// ---------------------------------------------------------------- casca (topo, abas, painéis)

function setupShell() {
    const user = state.user;
    document.querySelectorAll('[data-avatar]').forEach((avatar) => {
        avatar.textContent = initials(user.nome);
        avatar.setAttribute('aria-label', isClassAccount()
            ? `Perfil da turma: ${user.nome || 'Turma'}` : `Meu perfil: ${user.nome || 'Aluno(a)'}`);
    });
    // Conta da turma: sem frequência, então o Início não "inclui" essa seção.
    if (isClassAccount()) document.querySelector('.aba[data-secao="inicio"]')?.removeAttribute('data-inclui');

    for (const id of ['#dialogo', '#dialogo-aviso']) {
        const dialog = $(id);
        dialog.querySelector('[data-fechar-dialogo]').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.close();
        });
        dialog.addEventListener('close', placeToasts);
    }
    $('#dialogo-aviso').addEventListener('close', closeNotice);
}

// Painel aberto fica na camada de cima: os toasts vão para dentro dele para continuarem visíveis.
function placeToasts() {
    const region = document.querySelector('.toast-region');
    const open = [...document.querySelectorAll('dialog[open]')].pop();
    if (region) (open || document.body).append(region);
}

function renderShell(pageTitle, view) {
    const { section } = view;
    document.querySelectorAll('.aba').forEach((link) => {
        const active = link.dataset.secao === section;
        // Frequência não tem aba própria: fica "dentro" do Início (atalho no painel).
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
    document.querySelectorAll('[data-contador-naolidos]').forEach((badge) => {
        badge.hidden = !(muralReady && unread > 0);
        badge.textContent = unread > 99 ? '99+' : String(unread);
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

    // No Início o título fica só para leitores de tela: o cartão de saudação faz o papel dele.
    const title = $('#titulo-pagina');
    title.textContent = pageTitle;
    title.classList.toggle('visually-hidden', section === 'inicio');
}

// ---------------------------------------------------------------- renderização

// Telas com formulário ou componente vivo: depois de desenhadas, só redesenham ao mudar de rota
// (não apagam o que o aluno digita quando uma fonte termina de carregar).
function isStableRoute(view) {
    const { section, sub } = view;
    if (section === 'ajustes') return true;
    return section === 'frequencia' && sub === 'justificar' && state.sources.frequencias.status === 'ok';
}

function viewContent(view) {
    const { section, sub } = view;
    if (section === 'inicio') return { title: 'Início', build: renderHome };
    if (section === 'horarios') return { title: 'Horários', build: renderSchedule };
    const label = subLabel(section, sub) || SECTIONS[section].title;
    const renderers = {
        avisos: renderNoticeList,
        atividades: renderActivities,
        frequencia: { faltas: renderAbsences, justificar: renderJustify }[sub] || renderAttendanceSummary,
        ajustes: {
            perfil: renderProfile, seguranca: renderSecurity, notificacoes: renderNotifications,
            aparencia: renderAppearance, ajuda: renderHelp, privacidade: renderPrivacy
        }[sub] || renderProfile
    };
    const title = section === 'ajustes' ? 'Perfil' : SECTIONS[section].title;
    return {
        title: section === 'ajustes' || label === title ? title : `${title} · ${label}`,
        build: () => [chipsNav(), section === 'avisos' && sub !== 'salvos' ? listSearchBar() : null, renderers[section]()]
    };
}

// Devolve o foco ao controle equivalente depois de redesenhar (botões são recriados no render).
function redraw(container, nodes) {
    const keep = container.contains(document.activeElement) ? document.activeElement : null;
    const keepId = keep?.id;
    const keepAction = keep?.dataset?.acao;
    container.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
    if (keepId) document.getElementById(keepId)?.focus({ preventScroll: true });
    else if (keepAction) container.querySelector(`[data-acao="${CSS.escape(keepAction)}"]:not(:disabled)`)?.focus({ preventScroll: true });
}

function render({ force = false } = {}) {
    if (!state.user) return;
    const view = currentView();
    const { title, build } = viewContent(view);
    renderShell(title, view);
    renderNoticePanel();

    const main = $('#conteudo');
    const routeKey = `${view.section}/${view.sub}/${view.id}`;
    if (!force && main.dataset.rota === routeKey && main.dataset.estavel === '1') return;
    main.dataset.rota = routeKey;
    main.dataset.estavel = isStableRoute(view) ? '1' : '0';
    redraw(main, build());
    // No celular os chips rolam de lado: deixa o ativo à vista.
    const chip = main.querySelector('.chip.ativo');
    const row = chip?.closest('ul');
    if (row) row.scrollLeft += chip.getBoundingClientRect().left - row.getBoundingClientRect().left - 16;
}

// Painel do aviso (protótipo: folha que sobe por cima da tela). A rota #/avisos/<id> continua valendo.
function renderNoticePanel() {
    const dialog = $('#dialogo-aviso');
    if (!isNoticeRoute(state.route)) {
        if (dialog.open) dialog.close();
        return;
    }
    const notice = notices().find((item) => item.id_post === state.route.id);
    document.title = `${notice ? truncate(notice.titulo, 46) : 'Aviso'} · C·Warning Aluno`;
    redraw($('#aviso-corpo'), renderNoticeDetail(state.route.id));
    if (!dialog.open) {
        dialog.showModal();
        placeToasts();
        ($('#aviso-titulo') || dialog).focus();
    }
}

// ---------------------------------------------------------------- Início

function renderHome() {
    return [homeGreeting(), homeDeadlines(), homeAreas(), homeNotices(), homeShortcuts()];
}

// Cartão de destaque do Início: turma, saudação e um resumo do que está pendente.
function homeGreeting() {
    const user = state.user;
    const group = user.nome_turma || SERIES_NAMES[user.serie] || null;
    const summary = [];
    if (state.sources.mural.status === 'ok') {
        const unread = unreadCount();
        summary.push(unread ? el('strong', { text: plural(unread, 'aviso não lido', 'avisos não lidos') }) : 'nenhum aviso não lido');
    }
    if (state.sources.atividades.status === 'ok') {
        const pending = deliverables().filter((activity) => activityStatus(activity) === 'pendentes').length;
        summary.push(pending ? el('strong', { text: plural(pending, 'atividade pendente', 'atividades pendentes') }) : 'nenhuma atividade pendente');
    }
    const text = summary.length
        ? ['Você tem ', summary[0], ...(summary[1] ? [' e ', summary[1]] : []), '.']
        : [isClassAccount() ? 'Confira os avisos e as atividades da turma.' : 'Confira seus avisos, atividades e frequência.'];
    return el('section', { class: 'saudacao', 'aria-labelledby': 'saudacao-titulo' },
        el('p', { class: 'saudacao-topo' },
            group ? el('span', { class: 'saudacao-turma', text: group }) : null,
            el('span', { class: 'saudacao-data', text: todayLongLabel() })),
        el('h2', { class: 'saudacao-titulo', id: 'saudacao-titulo', text: isClassAccount() ? 'Olá, turma!' : `Olá, ${firstName(user.nome)}!` }),
        el('p', { class: 'saudacao-resumo' }, ...text));
}

function sectionHeader(id, title, extra) {
    return el('div', { class: 'secao-cabeca' }, el('h2', { class: 'secao-titulo', id, text: title }), extra);
}

// "Prazos a vencer": atividades pendentes com prazo aberto, da mais próxima para a mais distante.
function homeDeadlines() {
    const section = card('cartao-prazos', sectionHeader('prazos-titulo', 'Prazos a vencer',
        el('a', { class: 'link-secao', href: '#/atividades/pendentes', text: 'Ver atividades' })));
    section.setAttribute('aria-labelledby', 'prazos-titulo');
    const guard = sourceGuard('atividades', 2);
    if (guard) {
        section.append(guard);
        return section;
    }
    const upcoming = deliverables()
        .filter((activity) => activityStatus(activity) === 'pendentes' && activity.prazo && !isOverdue(activity))
        .sort((a, b) => deadlineDate(a.prazo) - deadlineDate(b.prazo))
        .slice(0, 4);
    if (!upcoming.length) {
        section.append(el('p', { class: 'meta', text: 'Nenhum prazo aberto agora.' }));
        return section;
    }
    section.append(el('ul', { class: 'lista-prazos' }, upcoming.map((activity) => {
        const days = daysUntil(activity.prazo);
        const badge = days === 0 ? 'Hoje' : plural(days, 'dia', 'dias');
        return el('li', {},
            el('a', { class: `prazo${days <= 1 ? ' prazo-urgente' : ''}`, href: '#/atividades/pendentes' },
                el('span', { class: 'prazo-texto' },
                    el('span', { class: 'prazo-titulo', text: activity.titulo }),
                    el('span', { class: 'meta', text: [activity.nome_disciplina, dueInLabel(activity.prazo)].filter(Boolean).join(' · ') })),
                el('span', { class: 'prazo-dias', 'aria-hidden': 'true', text: badge })));
    })));
    return section;
}

// "Áreas de aviso": as categorias reais do mural, com quantos avisos cada uma tem.
function homeAreas() {
    const ready = state.sources.mural.status === 'ok';
    return el('section', { class: 'secao', 'aria-labelledby': 'areas-titulo' },
        sectionHeader('areas-titulo', 'Áreas de aviso', el('a', { class: 'link-secao', href: '#/avisos/todos', text: 'Ver todos' })),
        el('ul', { class: 'grade-areas' }, Object.entries(CATEGORIES).map(([key, category]) => {
            const count = ready ? notices().filter(NOTICE_FILTERS[key]).length : null;
            return el('li', {},
                el('a', { class: `area area-${key}`, href: `#/avisos/${key}` },
                    el('span', { class: 'area-icone' }, icon(category.icon, true)),
                    el('span', { class: 'area-nome', text: { turma: 'Minha turma', eventos: 'Eventos', urgente: 'Urgentes' }[key] || category.label }),
                    count === null ? null : el('span', { class: 'meta', text: plural(count, 'aviso', 'avisos') })));
        })));
}

function homeNotices() {
    const section = el('section', { class: 'secao', 'aria-labelledby': 'comunicados-titulo' },
        sectionHeader('comunicados-titulo', 'Comunicados',
            state.sources.mural.status === 'ok' ? el('span', { class: 'meta', text: plural(notices().length, 'aviso', 'avisos') }) : null));
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
    section.append(el('ul', { class: 'lista-avisos' }, recent.map((notice) => el('li', {}, noticeCard(notice)))),
        el('a', { class: 'botao botao-contorno botao-largo', href: '#/avisos/todos' }, 'Ver todos os avisos', icon('arrow-right')));
    return section;
}

// Frequência (sem aba própria) e Salvos, com o resumo de cada um.
function homeShortcuts() {
    const shortcut = (href, iconName, label, detail) => el('li', {},
        el('a', { class: 'atalho', href },
            el('span', { class: 'icone-quadrado' }, icon(iconName)),
            el('span', { class: 'atalho-texto' },
                el('span', { class: 'atalho-titulo', text: label }),
                detail ? el('span', { class: 'meta', text: detail }) : null),
            icon('caret-right')));
    const saved = savedCount();
    const items = [shortcut('#/avisos/salvos', 'bookmark-simple', 'Avisos salvos',
        saved === null ? null : saved ? `${plural(saved, 'aviso', 'avisos')} · ${plural(folders().length, 'pasta', 'pastas')}` : 'Nenhum aviso salvo')];
    if (!isClassAccount()) {
        const attendance = state.sources.desempenho.data?.frequencia;
        const toJustify = state.sources.frequencias.status === 'ok' ? absenceGroups().filter(canJustify).length : 0;
        const detail = [attendance?.aulas ? `${Math.round(attendance.percentual)}% de presença` : null,
            toJustify ? plural(toJustify, 'falta para justificar', 'faltas para justificar') : null].filter(Boolean).join(' · ');
        items.unshift(shortcut('#/frequencia/resumo', 'list-checks', 'Frequência', detail || 'Resumo e faltas'));
    }
    return el('nav', { class: 'atalhos', 'aria-label': 'Mais seções' }, el('ul', {}, items));
}

// ---------------------------------------------------------------- Horários

const WEEKDAYS = [[1, 'Seg', 'Segunda-feira'], [2, 'Ter', 'Terça-feira'], [3, 'Qua', 'Quarta-feira'],
    [4, 'Qui', 'Quinta-feira'], [5, 'Sex', 'Sexta-feira'], [6, 'Sáb', 'Sábado']];

function renderSchedule() {
    const nodes = [];
    const guard = sourceGuard('horarios', 3);
    if (guard) nodes.push(guard);
    else {
        const lessons = state.sources.horarios.data || [];
        const days = WEEKDAYS.filter(([day]) => day < 6 || lessons.some((lesson) => lesson.dia_semana === day));
        const today = isoWeekday(schoolParts().weekday);
        if (!days.some(([day]) => day === state.scheduleDay)) {
            state.scheduleDay = days.some(([day]) => day === today) ? today : 1;
        }
        const [, , dayName] = days.find(([day]) => day === state.scheduleDay);
        const ofDay = lessons.filter((lesson) => lesson.dia_semana === state.scheduleDay)
            .sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
        nodes.push(el('div', { class: 'dias', role: 'group', 'aria-label': 'Dia da semana' }, days.map(([day, short, name]) => el('button', {
            class: 'dia', type: 'button', id: `dia-${day}`, 'aria-pressed': String(day === state.scheduleDay), 'aria-label': name,
            on: { click: () => { state.scheduleDay = day; render(); } }
        }, short, day === today ? el('span', { class: 'dia-hoje', 'aria-hidden': 'true', text: 'hoje' }) : null))));
        nodes.push(el('h2', { class: 'secao-titulo', text: state.scheduleDay === today ? `${dayName} · hoje` : dayName }));
        nodes.push(ofDay.length
            ? el('ol', { class: 'lista-aulas' }, ofDay.map((lesson, index) => el('li', { class: 'aula' },
                el('span', { class: 'aula-ordem', text: `${index + 1}ª aula` }),
                el('span', { class: 'aula-nome', text: lesson.nome_disciplina || 'Aula' }),
                [lesson.professor, lesson.sala].some(Boolean)
                    ? el('span', { class: 'meta', text: [lesson.professor, lesson.sala].filter(Boolean).join(' · ') }) : null,
                el('span', { class: 'aula-hora' }, icon('clock'), [lesson.hora_inicio, lesson.hora_fim].filter(Boolean).join(' – ')))))
            : emptyState('Sem aulas neste dia.', 'sun'));
    }
    nodes.push(scheduleFileCard());
    return nodes;
}

// "Horário em PDF": arquivo da turma publicado pela gestão (download autenticado → blob).
function scheduleFileCard() {
    const section = card('cartao-horario', el('h2', { class: 'cartao-titulo', text: 'Horário em PDF' }));
    const guard = sourceGuard('horariosPdf', 1);
    if (guard) {
        section.append(guard);
        return section;
    }
    const schedule = state.sources.horariosPdf.data?.turma;
    if (!schedule?.arquivo) {
        section.append(el('p', { class: 'meta', text: 'A escola ainda não publicou o horário da sua turma em PDF.' }));
        return section;
    }
    const file = { ...schedule.arquivo, nome: schedule.arquivo.nome || 'horario.pdf' };
    const updated = schedule.atualizado_em ? `Atualizado em ${fullDateTime(schedule.atualizado_em)}` : null;
    const button = el('button', {
        class: 'botao botao-contorno botao-pequeno', type: 'button', id: 'baixar-horario',
        'aria-label': `Baixar horário${schedule.nome_turma ? ` da turma ${schedule.nome_turma}` : ''} (PDF, ${formatSize(file.tamanho)})`,
        on: { click: () => downloadFile(file, button) }
    }, icon('download-simple'), 'Baixar');
    section.append(el('div', { class: 'anexo anexo-estatico' },
        el('span', { class: 'icone-quadrado' }, icon('file-pdf')),
        el('span', { class: 'anexo-texto' },
            el('span', { class: 'anexo-nome', text: schedule.nome_turma ? `Horário · ${schedule.nome_turma}` : file.nome }),
            el('span', { class: 'meta', text: ['PDF', formatSize(file.tamanho), updated].filter(Boolean).join(' · ') })),
        button));
    return section;
}

// ---------------------------------------------------------------- Avisos

function renderNoticeList() {
    const { sub } = currentView();
    if (sub === 'salvos') return renderSaved();
    const nodes = [];
    const guard = sourceGuard('mural', 4);
    if (guard) return guard;

    const filter = NOTICE_FILTERS[sub] || NOTICE_FILTERS.todos;
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
            : messages[sub] || 'Nenhum aviso nesta categoria.'));
        return nodes;
    }

    nodes.push(el('ul', { class: 'lista-avisos' }, list.map((notice) => el('li', {}, noticeCard(notice)))));
    return nodes;
}

function clearSearch() {
    state.search = '';
    render();
    const listField = document.getElementById('busca-lista-campo');
    (listField || $('#titulo-pagina')).focus();
}

// Busca do feed no celular (protótipo: campo acima dos chips). O mesmo nó é reaproveitado a cada
// render para o cursor e o foco não se perderem enquanto o aluno digita. No web fica escondida
// (CSS), porque o topo já tem a busca.
let listSearchForm = null;

function listSearchBar() {
    if (!listSearchForm) {
        const field = el('input', {
            id: 'busca-lista-campo', type: 'search', placeholder: 'Buscar avisos, textos ou autores...',
            autocomplete: 'off', maxlength: '100'
        });
        field.addEventListener('input', () => {
            state.search = field.value;
            render();
        });
        listSearchForm = el('form', { class: 'busca-lista', role: 'search', on: { submit: (event) => event.preventDefault() } },
            el('label', { class: 'visually-hidden', for: 'busca-lista-campo', text: 'Buscar avisos' }),
            icon('magnifying-glass'), field);
    }
    const field = listSearchForm.querySelector('input');
    if (field.value !== state.search) field.value = state.search;
    return listSearchForm;
}

// Cartão de aviso do protótipo: faixa lateral (vermelha no urgente), área, título, resumo e autor.
function noticeCard(notice) {
    const category = CATEGORIES[notice.categoria] || CATEGORIES.turma;
    const urgent = notice.categoria === 'urgente' || Boolean(notice.urgente);
    const unread = isUnread(notice);
    const author = notice.autor?.nome || 'Escola';
    const label = notice.categoria !== 'urgente' && urgent ? `${category.label} · Urgente` : category.label;
    return el('a', { class: `cartao-aviso${urgent ? ' urgente' : ''}${unread ? ' nao-lido' : ''}`, href: `#/avisos/${notice.id_post}` },
        el('span', { class: 'aviso-cabeca' },
            el('span', { class: 'aviso-area' }, icon(category.icon, true), label),
            unread ? el('span', { class: 'ponto-novo' }, srText('Não lido')) : null,
            notice.salvo ? el('span', { class: 'marcador' }, icon('bookmark-simple', true), srText('Salvo')) : null),
        el('span', { class: 'aviso-titulo', text: notice.titulo }),
        notice.conteudo ? el('span', { class: 'aviso-resumo', text: truncate(notice.conteudo, 140) }) : null,
        notice.data_evento ? el('span', { class: 'aviso-evento' }, icon('calendar-blank'),
            `Data: ${formatSchoolDate(notice.data_evento)}`) : null,
        el('span', { class: 'meta', text: `${author} · ${timeAgo(notice.criado_em)}` }));
}

function closeNoticeButton() {
    return el('button', { class: 'botao botao-secundario botao-largo', type: 'button', on: { click: () => $('#dialogo-aviso').close() } }, 'Fechar');
}

function renderNoticeDetail(id) {
    const guard = sourceGuard('mural', 2);
    if (guard) return guard;
    const notice = notices().find((item) => item.id_post === id);
    if (!notice) {
        return [el('h2', { class: 'aviso-aberto-titulo', id: 'aviso-titulo', tabindex: '-1', text: 'Aviso indisponível' }),
            emptyState('Este aviso não existe ou não está mais disponível para você.', 'megaphone-simple'),
            closeNoticeButton()];
    }
    const category = CATEGORIES[notice.categoria] || CATEGORIES.turma;
    const urgent = notice.categoria === 'urgente' || Boolean(notice.urgente);
    const read = !isUnread(notice);
    const perfil = notice.autor?.perfil === 'gestao' ? 'Coordenação' : notice.autor?.perfil === 'professor' ? 'Professor(a)' : null;
    const paragraphs = String(notice.conteudo || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);

    return el('article', { class: 'aviso-aberto' },
        el('p', { class: `aviso-area${urgent ? ' urgente' : ''}` }, icon(category.icon, true),
            notice.categoria !== 'urgente' && urgent ? `${category.label} · Urgente` : category.label),
        el('h2', { class: 'aviso-aberto-titulo', id: 'aviso-titulo', tabindex: '-1', text: notice.titulo }),
        el('p', { class: 'meta' }, [notice.autor?.nome || 'Escola', perfil].filter(Boolean).join(' · '), ' · ',
            el('time', { datetime: isoDateTime({ criado_em: notice.criado_em }), text: fullDateTime(notice.criado_em) })),
        notice.data_evento ? el('p', { class: 'aviso-evento' }, icon('calendar-blank'),
            el('span', {}, el('strong', { text: 'Data do evento: ' }), formatSchoolDate(notice.data_evento))) : null,
        el('div', { class: 'aviso-corpo' }, paragraphs.map((text) => el('p', { text }))),
        notice.anexo ? attachmentButton(notice.anexo) : null,
        el('div', { class: 'aviso-acoes' },
            el('button', {
                class: `botao botao-primario${read ? ' confirmado' : ''}`, type: 'button', 'data-acao': 'leitura',
                'aria-pressed': String(read), on: { click: () => toggleRead(notice) }
            }, icon('check-circle', read), 'Confirmar leitura',
            read ? el('span', { class: 'estado-botao', 'aria-hidden': 'true', text: 'Confirmada' }) : null),
            // Rótulo fixo + aria-pressed (o leitor anuncia "Salvar aviso, pressionado"); o estado
            // visível fica num texto à parte, escondido do leitor para não repetir.
            el('button', {
                class: `botao botao-contorno${notice.salvo ? ' ativo' : ''}`, type: 'button', 'data-acao': 'salvar',
                'aria-pressed': String(Boolean(notice.salvo)), on: { click: () => toggleSaved(notice) }
            }, icon('bookmark-simple', notice.salvo), 'Salvar aviso',
            notice.salvo ? el('span', { class: 'estado-botao', 'aria-hidden': 'true', text: 'Salvo' }) : null)),
        read && notice.lido_em ? el('p', { class: 'meta', text: `Leitura confirmada em ${fullDateTime(notice.lido_em)}` }) : null,
        notice.salvo ? noticeFolderField(notice) : null,
        closeNoticeButton());
}

function attachmentButton(file, label = 'Anexo') {
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
    return el('div', { class: 'anexos' }, el('p', { class: 'campo-rotulo', text: label }), button);
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
            syncSaved(notice, notice.salvo);
            render();
            notify(notice.salvo ? 'Aviso salvo.' : 'Aviso removido dos salvos.', 'sucesso');
        },
        () => { notice.salvo = previous; },
        'Não foi possível salvar o aviso.');
}

// ---------------------------------------------------------------- Salvos e pastas

function folders() {
    const data = state.sources.pastas.data;
    return Array.isArray(data) ? data : data?.pastas || [];
}

function savedList() {
    const data = state.sources.salvos.data;
    return Array.isArray(data) ? data : data?.salvos || [];
}

function folderOf(item) {
    return item.id_pasta === null || item.id_pasta === undefined ? null : Number(item.id_pasta);
}

function folderName(id) {
    return folders().find((folder) => Number(folder.id_pasta) === id)?.nome || null;
}

// Total de salvos: da lista de salvos quando ela carregou; senão, do mural.
function savedCount() {
    if (state.sources.salvos.status === 'ok') return savedList().length;
    if (state.sources.mural.status === 'ok') return notices().filter((notice) => notice.salvo).length;
    return null;
}

// Aviso do mural correspondente ao salvo (tem conteúdo e categoria); sem ele, monta o básico.
function noticeForSaved(item) {
    const notice = notices().find((entry) => entry.id_post === item.id_post);
    if (notice) return notice;
    return {
        id_post: item.id_post, titulo: item.titulo, conteudo: '', criado_em: item.criado_em,
        categoria: item.urgente ? 'urgente' : 'turma', salvo: true, lido_em: true,
        autor: typeof item.autor === 'string' ? { nome: item.autor } : item.autor
    };
}

// Mantém a lista de salvos igual ao mural depois de salvar/remover pelo botão do aviso.
function syncSaved(notice, saved) {
    const source = state.sources.salvos;
    if (source.status !== 'ok') return;
    const list = savedList().filter((item) => item.id_post !== notice.id_post);
    if (saved) {
        notice.id_pasta = notice.id_pasta ?? null;
        list.unshift({
            id_post: notice.id_post, titulo: notice.titulo, tipo: notice.tipo, urgente: notice.urgente,
            criado_em: notice.criado_em, autor: notice.autor, id_pasta: notice.id_pasta,
            salvo_em: new Date().toISOString().slice(0, 19).replace('T', ' ')
        });
    }
    source.data = list;
}

function setNoticeFolder(idPost, idFolder) {
    const item = savedList().find((entry) => entry.id_post === idPost);
    if (item) item.id_pasta = idFolder;
    const notice = notices().find((entry) => entry.id_post === idPost);
    if (notice) notice.id_pasta = idFolder;
}

function moveToFolder(idPost, idFolder) {
    const item = savedList().find((entry) => entry.id_post === idPost);
    const notice = notices().find((entry) => entry.id_post === idPost);
    const previous = folderOf(item || notice || {});
    if (previous === idFolder) return undefined;
    return optimistic(
        () => setNoticeFolder(idPost, idFolder),
        async () => {
            await api(`/api/salvos/${idPost}`, { method: 'PUT', body: JSON.stringify({ id_pasta: idFolder }) });
            if (notice) notice.salvo = true;
            const name = idFolder === null ? null : folderName(idFolder);
            notify(name ? `Aviso movido para "${name}".` : 'Aviso movido para "Sem pasta".', 'sucesso');
        },
        () => setNoticeFolder(idPost, previous),
        'Não foi possível mover o aviso.');
}

async function removeSaved(item) {
    const list = savedList();
    const index = list.indexOf(item);
    const notice = notices().find((entry) => entry.id_post === item.id_post);
    const previous = notice ? { salvo: notice.salvo, id_pasta: notice.id_pasta } : null;
    // O foco vai para o próximo salvo da lista (ou para o título, se era o último).
    const next = list.slice(index + 1).concat(list.slice(0, index).reverse())
        .find((entry) => savedVisible(entry));
    // optimistic() aplica e redesenha antes do primeiro await: o foco é ajustado logo depois.
    const pending = optimistic(
        () => {
            list.splice(list.indexOf(item), 1);
            if (notice) Object.assign(notice, { salvo: false, id_pasta: null });
        },
        async () => {
            await api(`/api/salvos/${item.id_post}`, { method: 'DELETE' });
            notify('Aviso removido dos salvos.', 'sucesso');
        },
        () => {
            list.splice(Math.min(index, list.length), 0, item);
            if (notice && previous) Object.assign(notice, previous);
        },
        'Não foi possível remover o aviso dos salvos.');
    const target = next ? document.getElementById(`remover-salvo-${next.id_post}`) : null;
    (target || $('#titulo-pagina')).focus({ preventScroll: true });
    await pending;
}

function savedVisible(item) {
    const current = state.savedFolder;
    if (current === 'todas') return true;
    if (current === 'sem') return folderOf(item) === null;
    return folderOf(item) === current;
}

// Seletor de pasta (card do salvo e aviso aberto). A última opção cria uma pasta nova.
function folderSelect(id, idPost, current) {
    const select = el('select', { class: 'campo-select', id, name: 'pasta' },
        el('option', { value: '', text: 'Sem pasta' }),
        folders().map((folder) => el('option', { value: String(folder.id_pasta), text: folder.nome })),
        el('option', { value: 'nova', text: 'Nova pasta…' }));
    select.value = current === null ? '' : String(current);
    select.addEventListener('change', () => {
        if (select.value === 'nova') {
            select.value = current === null ? '' : String(current);
            openFolderDialog(null, { onCreated: (folder) => moveToFolder(idPost, Number(folder.id_pasta)) });
            return;
        }
        moveToFolder(idPost, select.value === '' ? null : Number(select.value));
        // Num filtro de pasta, o aviso movido sai da lista: o foco não pode cair no <body>.
        if (!document.getElementById(id)) $('#titulo-pagina').focus({ preventScroll: true });
    });
    return select;
}

function noticeFolderField(notice) {
    if (state.sources.pastas.status !== 'ok') return null;
    return el('div', { class: 'campo-pasta' },
        el('label', { class: 'campo-rotulo', for: 'pasta-aviso' }, icon('folder-simple'), 'Pasta'),
        folderSelect('pasta-aviso', notice.id_post, folderOf(notice)));
}

function renderSaved() {
    const guard = sourceGuard(['salvos', 'pastas', 'mural'], 3);
    if (guard) return guard;
    const list = savedList();
    const all = folders();
    let current = state.savedFolder;
    if (typeof current === 'number' && !all.some((folder) => Number(folder.id_pasta) === current)) {
        current = 'todas';
        state.savedFolder = current;
    }
    const countFor = (filter) => list.filter(filter).length;
    const filters = [
        ['todas', 'Todas', countFor(() => true)],
        ['sem', 'Sem pasta', countFor((item) => folderOf(item) === null)],
        ...all.map((folder) => [Number(folder.id_pasta), folder.nome,
            countFor((item) => folderOf(item) === Number(folder.id_pasta))])
    ];
    const shown = list.filter(savedVisible).filter((item) => matchesSearch(noticeForSaved(item)))
        .sort((a, b) => String(b.salvo_em || b.criado_em || '').localeCompare(String(a.salvo_em || a.criado_em || '')));

    const nodes = [];
    nodes.push(el('div', { class: 'barra-pastas' },
        el('ul', { class: 'filtro-pastas', 'aria-label': 'Filtrar salvos por pasta' }, filters.map(([key, label, count]) => {
            const active = key === current;
            return el('li', {}, el('button', {
                class: `pasta-filtro${active ? ' ativo' : ''}`, type: 'button', id: `filtro-pasta-${key}`,
                'aria-pressed': String(active),
                on: { click: () => { state.savedFolder = key; render(); } }
            }, key === 'todas' ? icon('bookmarks-simple') : key === 'sem' ? icon('tray') : icon('folder-simple', active),
            el('span', { text: label }),
            el('span', { class: 'pasta-contador', 'aria-hidden': 'true', text: String(count) }),
            srText(`, ${plural(count, 'aviso', 'avisos')}`)));
        })),
        el('button', {
            class: 'link-botao', type: 'button', id: 'nova-pasta',
            on: { click: () => openFolderDialog(null, { select: true }) }
        }, icon('folder-simple-plus'), 'Nova pasta')));

    if (typeof current === 'number') {
        const folder = all.find((entry) => Number(entry.id_pasta) === current);
        nodes.push(el('div', { class: 'barra-lista' },
            el('p', { class: 'meta' }, icon('folder-simple'), ` ${folder.nome} · ${plural(shown.length, 'aviso', 'avisos')}`),
            el('button', { class: 'link-botao', type: 'button', id: 'renomear-pasta', on: { click: () => openFolderDialog(folder) } },
                icon('pencil-simple'), 'Renomear'),
            el('button', { class: 'link-botao link-perigo', type: 'button', id: 'excluir-pasta', on: { click: () => confirmDeleteFolder(folder) } },
                icon('trash'), 'Excluir pasta')));
    } else {
        nodes.push(el('div', { class: 'barra-lista' },
            el('p', { class: 'meta', text: state.search
                ? `${plural(shown.length, 'resultado', 'resultados')} para "${truncate(state.search, 40)}"`
                : plural(shown.length, 'aviso salvo', 'avisos salvos') }),
            state.search ? el('button', { class: 'link-botao', type: 'button', on: { click: clearSearch } }, icon('x'), 'Limpar busca') : null));
    }

    if (!shown.length) {
        const empty = state.search ? 'Nenhum aviso salvo encontrado para essa busca.'
            : !list.length ? 'Você ainda não salvou nenhum aviso. Abra um aviso e toque em "Salvar aviso".'
                : current === 'sem' ? 'Todos os seus salvos estão em pastas.' : 'Nenhum aviso nesta pasta.';
        nodes.push(emptyState(empty, 'bookmark-simple'));
        return nodes;
    }

    nodes.push(el('ul', { class: 'lista-avisos' }, shown.map((item) => {
        const notice = noticeForSaved(item);
        const selectId = `pasta-salvo-${item.id_post}`;
        return el('li', { class: 'salvo-item' },
            noticeCard(notice),
            el('div', { class: 'salvo-acoes' },
                el('label', { class: 'visually-hidden', for: selectId, text: `Pasta do aviso ${notice.titulo}` }),
                el('span', { class: 'meta salvo-pasta-rotulo', 'aria-hidden': 'true' }, icon('folder-simple'), 'Pasta'),
                folderSelect(selectId, item.id_post, folderOf(item)),
                el('button', {
                    class: 'link-botao', type: 'button', id: `remover-salvo-${item.id_post}`,
                    'aria-label': `Remover dos salvos: ${notice.titulo}`, on: { click: () => removeSaved(item) }
                }, icon('bookmark-simple'), 'Remover')));
    })));
    return nodes;
}

// Criar (folder = null) ou renomear uma pasta. Erros aparecem junto do campo.
function openFolderDialog(folder, { select = false, onCreated = null } = {}) {
    const input = el('input', {
        id: 'pasta-nome', name: 'nome', type: 'text', maxlength: String(MAX_FOLDER_NAME), required: true,
        autocomplete: 'off', 'aria-describedby': 'pasta-nome-ajuda'
    });
    input.value = folder?.nome || '';
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon(folder ? 'check' : 'folder-simple-plus'),
        folder ? 'Salvar nome' : 'Criar pasta');
    const form = el('form', { class: 'formulario', novalidate: true },
        el('div', { class: 'campo' },
            el('label', { class: 'campo-rotulo', for: 'pasta-nome', text: 'Nome da pasta' }),
            el('div', { class: 'linha-campo', 'data-campo-erro-apos': true }, input),
            el('p', { class: 'meta', id: 'pasta-nome-ajuda', text: `Até ${MAX_FOLDER_NAME} caracteres. Ex.: Provas, Passeios, Documentos.` })),
        el('div', { class: 'acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Cancelar'),
            submit));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        CwFormulario.limparTudo(form);
        const name = input.value.replace(/\s+/g, ' ').trim();
        if (!name) return fieldError(input, 'Dê um nome para a pasta.');
        if (name.length > MAX_FOLDER_NAME) return fieldError(input, `Use até ${MAX_FOLDER_NAME} caracteres.`);
        const taken = folders().some((entry) => entry.id_pasta !== folder?.id_pasta && normalize(entry.nome) === normalize(name));
        if (taken) return fieldError(input, 'Você já tem uma pasta com esse nome.');
        if (folder && name === folder.nome) {
            $('#dialogo').close();
            return undefined;
        }
        submit.disabled = true;
        try {
            const result = await api(folder ? `/api/pastas/${folder.id_pasta}` : '/api/pastas', {
                method: folder ? 'PATCH' : 'POST', body: JSON.stringify({ nome: name })
            });
            const list = folders();
            let focusId = null;
            if (folder) {
                folder.nome = result?.nome || name;
                focusId = 'renomear-pasta';
                notify('Pasta renomeada.', 'sucesso');
            } else {
                const created = { id_pasta: Number(result?.id_pasta), nome: result?.nome || name, total: 0 };
                if (Number.isFinite(created.id_pasta)) {
                    list.push(created);
                    list.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
                    state.sources.pastas.data = list;
                    if (select) {
                        state.savedFolder = created.id_pasta;
                        focusId = `filtro-pasta-${created.id_pasta}`;
                    }
                    if (onCreated) onCreated(created);
                } else {
                    loadSource('pastas');
                }
                notify(`Pasta "${created.nome}" criada.`, 'sucesso');
            }
            clearErrorNotifications();
            $('#dialogo').close();
            render();
            const target = focusId ? document.getElementById(focusId) : null;
            if (target) target.focus({ preventScroll: true });
        } catch (error) {
            CwFormulario.mostrar(form, error, input);
            submit.disabled = false;
        }
        return undefined;
    });
    openDialog(folder ? 'Renomear pasta' : 'Nova pasta', form);
    window.setTimeout(() => {
        input.focus();
        input.select();
    }, 0);
}

function confirmDeleteFolder(folder) {
    const cancel = el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Cancelar');
    const confirm = el('button', { class: 'botao botao-primario botao-perigo-cheio', type: 'button' }, icon('trash'), 'Excluir pasta');
    const id = Number(folder.id_pasta);
    const inside = savedList().filter((item) => folderOf(item) === id).length;
    confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        try {
            await api(`/api/pastas/${id}`, { method: 'DELETE' });
            state.sources.pastas.data = folders().filter((entry) => Number(entry.id_pasta) !== id);
            savedList().filter((item) => folderOf(item) === id).forEach((item) => setNoticeFolder(item.id_post, null));
            notices().filter((notice) => folderOf(notice) === id).forEach((notice) => { notice.id_pasta = null; });
            state.savedFolder = 'todas';
            $('#dialogo').close();
            notify(`Pasta "${folder.nome}" excluída.`, 'sucesso');
            render();
            document.getElementById('filtro-pasta-todas')?.focus({ preventScroll: true });
        } catch (error) {
            notify(error.message || 'Não foi possível excluir a pasta.', 'erro');
            confirm.disabled = false;
        }
    });
    openDialog(`Excluir a pasta "${folder.nome}"?`,
        el('p', { class: 'dialogo-descricao', text: inside
            ? `${plural(inside, 'aviso continua salvo', 'avisos continuam salvos')}, em "Sem pasta". Só a pasta é apagada.`
            : 'A pasta está vazia. Nenhum aviso salvo é afetado.' }),
        el('div', { class: 'acoes' }, cancel, confirm));
    // Ação destrutiva: o foco começa em Cancelar.
    window.setTimeout(() => cancel.focus(), 0);
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

// ---------------------------------------------------------------- Atividades

function renderActivities() {
    const guard = sourceGuard('atividades', 3);
    if (guard) return guard;
    const status = state.route.sub;
    const list = deliverables().filter((activity) => activityStatus(activity) === status);
    if (status === 'pendentes') list.sort((a, b) => (deadlineDate(a.prazo) || Infinity) - (deadlineDate(b.prazo) || Infinity));
    if (!list.length) {
        const messages = {
            pendentes: isClassAccount() ? 'Nenhuma atividade com prazo no momento.' : 'Nenhuma atividade pendente. Tudo entregue!',
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
    // Mesmo desenho do cartão de aviso do protótipo: etiqueta + selo no topo, título, texto e
    // rodapé com o prazo e a ação.
    return el('article', { class: `cartao cartao-atividade status-${status}${overdue ? ' atrasada' : ''}`, 'aria-labelledby': titleId },
        el('div', { class: 'atividade-cabeca' },
            activity.nome_disciplina ? el('p', { class: 'etiqueta atividade-disciplina', text: activity.nome_disciplina }) : el('span'),
            el('span', { class: `selo${overdue ? ' selo-vermelho' : ''}` }, icon(overdue ? 'warning' : config.icon, true), tag)),
        el('h2', { class: 'atividade-titulo', id: titleId, text: activity.titulo }),
        info ? el('p', { class: 'atividade-info', text: truncate(info, 200) }) : null,
        activity.anexo ? activityFileLink(activity.anexo) : null,
        el('div', { class: 'atividade-rodape' },
            el('span', { class: 'atividade-quando' }, icon('clock'), when),
            overdue
                ? el('span', { class: 'atividade-encerrada', text: 'Envio encerrado' })
                : el('button', {
                    class: `botao botao-pequeno ${status === 'pendentes' ? 'botao-primario' : 'botao-contorno'}`, type: 'button',
                    'aria-describedby': titleId,
                    on: { click: () => (status === 'pendentes' ? openSubmitDialog(activity) : openSubmissionDialog(activity, status)) }
                }, icon(config.buttonIcon), config.button)));
}

// Anexo do professor no cartão: link compacto que baixa o arquivo.
function activityFileLink(file) {
    const button = el('button', {
        class: 'link-botao atividade-anexo', type: 'button',
        'aria-label': `Baixar arquivo da atividade: ${file.nome || 'anexo'} (${formatSize(file.tamanho)})`,
        on: { click: () => downloadFile(file, button) }
    }, icon('paperclip'), el('span', { text: file.nome || 'Arquivo da atividade' }));
    return button;
}

function formatGrade(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : String(value);
}

function openDialog(title, ...content) {
    const dialog = $('#dialogo');
    $('#dialogo-titulo').textContent = title;
    $('#dialogo-corpo').replaceChildren(...content);
    if (!dialog.open) {
        dialog.showModal();
        placeToasts();
    }
    return dialog;
}

// previous: entrega atual ({ resposta, anexo }) ao reenviar. Resposta escrita, arquivo ou os dois.
function openSubmitDialog(activity, previous = null) {
    const textarea = el('textarea', {
        id: 'resposta-atividade', name: 'resposta', rows: '8', maxlength: '10000',
        'aria-describedby': 'resposta-ajuda'
    });
    textarea.value = previous?.resposta || '';
    const picker = filePicker({
        id: 'entrega-anexo', title: 'Arquivo (PDF, JPG ou PNG, até 5 MB)',
        help: 'Opcional. Toque para escolher o arquivo ou tirar uma foto.',
        accept: 'application/pdf,image/jpeg,image/png'
    });
    // Reenvio: o arquivo já enviado continua, salvo se for removido ou trocado por outro.
    let keptFile = previous?.anexo || null;
    const keptBox = keptFile ? el('div', { class: 'anexo-mantido' },
        attachmentButton(keptFile, 'Arquivo enviado'),
        el('button', {
            class: 'link-botao link-perigo', type: 'button',
            on: { click: () => { keptFile = null; keptBox.remove(); picker.input.focus(); } }
        }, icon('trash'), 'Remover arquivo enviado'),
        el('p', { class: 'meta', text: 'Para trocar, escolha outro arquivo abaixo.' })) : null;
    let uploaded = null; // { file, id }: não reenvia o mesmo arquivo se só a senha estava errada
    const submit = el('button', { class: 'botao botao-primario', type: 'submit' }, icon('paper-plane-tilt'), 'Enviar resposta');
    // Acesso da turma: o login é da sala, então quem envia se identifica com a matrícula e a senha pessoal.
    const fromClass = isClassAccount();
    const matricula = fromClass ? el('input', {
        id: 'entrega-matricula', name: 'matricula', type: 'text', inputmode: 'numeric', autocomplete: 'off',
        maxlength: '20', required: true, 'aria-describedby': 'entrega-identificacao'
    }) : null;
    const senha = fromClass ? el('input', {
        id: 'entrega-senha', name: 'senha', type: 'password', autocomplete: 'off', maxlength: '128', required: true,
        'aria-describedby': 'entrega-identificacao'
    }) : null;
    const form = el('form', { class: 'formulario', novalidate: true },
        el('p', { class: 'meta', text: `${activity.nome_disciplina || 'Atividade'} · ${deadlineLabel(activity.prazo)}` }),
        activity.descricao ? el('p', { class: 'dialogo-descricao', text: activity.descricao }) : null,
        activity.anexo ? attachmentButton(activity.anexo, 'Arquivo do professor') : null,
        el('label', { class: 'campo-rotulo', for: 'resposta-atividade', text: 'Sua resposta' }),
        textarea,
        el('p', { class: 'meta', id: 'resposta-ajuda', text: 'Escreva a resposta, envie um arquivo ou os dois. Até 10.000 caracteres; você pode reenviar até o prazo terminar.' }),
        keptBox,
        picker.node,
        fromClass ? el('fieldset', { class: 'entrega-identificacao' },
            el('legend', { class: 'campo-rotulo', text: 'Quem está enviando?' }),
            el('p', { class: 'meta', id: 'entrega-identificacao', text: 'Este é o acesso da sala: confirme com a sua matrícula e a sua senha pessoal para a atividade ir para o seu nome.' }),
            el('label', { class: 'campo-rotulo', for: 'entrega-matricula', text: 'Matrícula' }), matricula,
            el('label', { class: 'campo-rotulo', for: 'entrega-senha', text: 'Senha pessoal' }), senha) : null,
        el('div', { class: 'acoes' },
            el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Cancelar'),
            submit));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        CwFormulario.limparTudo(form);
        const answer = textarea.value.trim();
        if (picker.error()) {
            picker.input.focus();
            return;
        }
        const file = picker.file();
        if (!answer && !file && !keptFile) {
            fieldError(textarea, 'Escreva sua resposta ou anexe um arquivo antes de enviar.');
            return;
        }
        if (fromClass && !matricula.value.trim()) {
            fieldError(matricula, 'Digite a sua matrícula.');
            return;
        }
        if (fromClass && !senha.value) {
            fieldError(senha, 'Digite a sua senha pessoal.');
            return;
        }
        const payload = fromClass ? { matricula: matricula.value.trim(), senha: senha.value } : {};
        if (answer) payload.resposta = answer;
        submit.disabled = true;
        try {
            if (file && uploaded?.file !== file) {
                submit.replaceChildren(icon('upload-simple'), 'Enviando arquivo…');
                uploaded = { file, id: (await uploadFile(file))?.id_arquivo };
            }
            const fileId = file ? uploaded.id : keptFile?.id_arquivo;
            if (fileId) payload.id_arquivo = fileId;
            submit.replaceChildren(icon('paper-plane-tilt'), 'Enviando…');
            const result = await api(`/api/atividades/${activity.id_atividade}/entregas`, {
                method: 'POST', body: JSON.stringify(payload)
            });
            // Pela sala a entrega fica no nome do aluno, não na conta compartilhada.
            if (!fromClass) activity.entrega = { enviado_em: result?.enviado_em || null, nota: null, feedback: null };
            $('#dialogo').close();
            clearErrorNotifications();
            notify(fromClass && result?.nome ? `Atividade enviada no nome de ${result.nome}!` : 'Atividade enviada!', 'sucesso');
            loadSource('atividades');
        } catch (error) {
            submit.replaceChildren(icon('paper-plane-tilt'), 'Enviar resposta');
            if (error.status === 409) {
                // A atividade já foi corrigida: não dá mais para reenviar.
                CwFormulario.erro(textarea, error.message || 'Esta atividade já foi corrigida. Não é possível reenviar.', { focar: true });
                loadSource('atividades');
                return;
            }
            if (fromClass) senha.value = '';
            submit.disabled = false;
            if (/anexo|arquivo/i.test(error.message)) {
                notify(error.message, 'erro');
                picker.input.focus();
                return;
            }
            CwFormulario.mostrar(form, error, fromClass ? matricula : textarea);
        }
    });
    openDialog(previous ? `Reenviar: ${activity.titulo}` : activity.titulo, form);
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
    if (activity.anexo) nodes.push(attachmentButton(activity.anexo, 'Arquivo do professor'));
    if (answer?.resposta || !answer?.anexo) {
        nodes.push(el('p', { class: 'campo-rotulo', text: 'Sua resposta' }),
            el('p', { class: 'texto-livre caixa-resposta', text: answer?.resposta || 'Resposta não encontrada.' }));
    }
    if (answer?.anexo) nodes.push(attachmentButton(answer.anexo, 'Arquivo enviado'));
    const actions = el('div', { class: 'acoes' },
        el('button', { class: 'botao botao-contorno', type: 'button', on: { click: () => $('#dialogo').close() } }, 'Fechar'));
    // Entrega com nota não pode ser reenviada (o servidor responde 409).
    const graded = [answer?.nota, submission?.nota].some((nota) => nota !== null && nota !== undefined);
    if (status === 'entregues' && !graded && !isOverdue(activity)) {
        actions.append(el('button', {
            class: 'botao botao-primario', type: 'button',
            on: { click: () => openSubmitDialog(activity, answer || { resposta: '' }) }
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

function attendanceBar(percent) {
    const bar = el('span', { class: `barra${percent < FREQUENCIA_MINIMA ? ' barra-alerta' : ''}`, 'aria-hidden': 'true' },
        el('span', { class: 'barra-valor' }), el('span', { class: 'barra-minimo' }));
    return setBarValue(bar, percent);
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

// Campo de anexo opcional (PDF, JPG ou PNG até 5 MB), com arrastar e soltar. `id` nomeia o
// input (e a ajuda/erro ligados a ele); `accept` só com tipos MIME deixa o celular oferecer a câmera.
function filePicker({ id = 'just-anexo', title = 'Anexar atestado ou declaração (opcional)',
    help = 'PDF, JPG ou PNG · até 5 MB. Toque para escolher ou arraste o arquivo.',
    accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png' } = {}) {
    let chosen = null;
    let problem = null;
    const input = el('input', {
        class: 'visually-hidden', id, type: 'file', name: 'anexo', accept, 'aria-describedby': `${id}-ajuda`
    });
    const info = el('div', { class: 'anexo-escolhido', 'aria-live': 'polite' });
    const zone = el('label', { class: 'zona-anexo', for: id },
        el('span', { class: 'icone-quadrado' }, icon('file-arrow-up')),
        el('span', { class: 'zona-anexo-texto' },
            el('span', { class: 'zona-anexo-titulo', text: title }),
            el('span', { class: 'meta', id: `${id}-ajuda`, text: help })));

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
            input.setAttribute('aria-describedby', `${id}-ajuda ${id}-erro`);
            info.replaceChildren(el('p', { class: 'cw-campo-erro', id: `${id}-erro` }, icon('warning-circle'), el('span', { text: problem })));
            return;
        }
        input.removeAttribute('aria-invalid');
        input.setAttribute('aria-describedby', `${id}-ajuda`);
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

// ---------------------------------------------------------------- Ajustes

function renderProfile() {
    if (isClassAccount()) return renderClassProfile();
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
    // Cartão de perfil do protótipo: faixa azul-marinho, avatar grande, nome, matrícula e selos.
    // "Ativo" é fato: só contas ativas conseguem entrar no portal.
    return [
        card('perfil-topo',
            el('span', { class: 'perfil-faixa', 'aria-hidden': 'true' }),
            el('span', { class: 'avatar avatar-grande', 'aria-hidden': 'true', text: initials(user.nome) }),
            el('div', { class: 'perfil-texto' },
                el('h2', { class: 'perfil-nome', text: user.nome || 'Aluno(a)' }),
                el('p', { class: 'meta', text: [user.login ? `Matrícula: ${user.login}` : null, user.nome_turma || series].filter(Boolean).join(' • ') }),
                el('p', { class: 'perfil-selos' },
                    el('span', { class: 'selo selo-verde', text: 'Ativo' }),
                    course !== '—' ? el('span', { class: 'selo selo-azul', text: course.replace(/^Técnico em /, '') }) : null))),
        card('cartao-dados',
            el('h2', { class: 'cartao-titulo', text: 'Informações da turma' }),
            el('dl', { class: 'dados' }, rows.map(([key, value]) => el('div', { class: 'dado' },
                el('dt', { text: key }), el('dd', { text: value })))),
            el('p', { class: 'meta', text: 'Algum dado errado? Procure a secretaria da escola.' })),
        emailCard(),
        occurrencesCard(),
        logoutCard()
    ];
}

// Perfil da conta da turma: mostra a turma; sem matrícula, e-mail nem ocorrências (pessoais).
function renderClassProfile() {
    const user = state.user;
    const course = COURSE_NAMES[user.curso] || user.curso || '—';
    const series = SERIES_NAMES[user.serie] || (user.serie ? `${user.serie}ª série` : '—');
    const group = user.nome_turma || user.nome || 'Turma';
    const rows = [['Turma', group], ['Curso', course], ['Série', series]];
    return [
        card('perfil-topo',
            el('span', { class: 'perfil-faixa', 'aria-hidden': 'true' }),
            el('span', { class: 'avatar avatar-grande', 'aria-hidden': 'true', text: initials(group) }),
            el('div', { class: 'perfil-texto' },
                el('h2', { class: 'perfil-nome', text: group }),
                el('p', { class: 'meta', text: 'Conta da turma, compartilhada pelos alunos' }),
                el('p', { class: 'perfil-selos' },
                    el('span', { class: 'selo selo-verde', text: 'Ativo' }),
                    course !== '—' ? el('span', { class: 'selo selo-azul', text: course.replace(/^Técnico em /, '') }) : null))),
        card('cartao-dados',
            el('h2', { class: 'cartao-titulo', text: 'Informações da turma' }),
            el('dl', { class: 'dados' }, rows.map(([key, value]) => el('div', { class: 'dado' },
                el('dt', { text: key }), el('dd', { text: value })))),
            el('p', { class: 'meta', text: 'Frequência e justificativas ficam na sua conta individual: entre com a sua matrícula. Atividades podem ser enviadas por aqui, confirmando com a sua matrícula e senha. A senha da turma é trocada pela gestão.' })),
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
    // Botão largo "Sair do Portal" do protótipo (vermelho suave; cheio no hover).
    return el('button', { class: 'botao-sair-portal', type: 'button', on: { click: logout } },
        icon('sign-out', true), 'Sair do Portal');
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
    const policy = card('cartao-privacidade',
        el('h2', { class: 'cartao-titulo', text: 'Privacidade' }),
        el('p', { class: 'meta', text: 'Seus dados são usados só para a comunicação da escola. Quem vê: você, seus professores e a gestão do CEEP.' }),
        el('a', { class: 'botao botao-contorno', href: '/privacidade', target: '_blank', rel: 'noopener' },
            icon('shield-check'), 'Ler a política de privacidade', srText(' (abre em nova aba)')));
    // Conta da turma não guarda dados pessoais: não há "Baixar meus dados".
    if (isClassAccount()) return [policy];
    return [
        policy,
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
            FAQ.filter(([question]) => !isClassAccount() || CLASS_ACCOUNT_FAQ.has(question)).map(([question, answer], index) => {
                const details = el('details', { class: 'faq' },
                    el('summary', {}, el('span', { text: question }), icon('plus')),
                    el('p', { text: answer }));
                if (index === 0) details.open = true;
                return details;
            })),
        card('cartao-contato',
            icon('headset'),
            el('h2', { class: 'cartao-titulo', text: 'Precisa falar com alguém?' }),
            el('p', { class: 'meta', text: 'Fale com a coordenação ou com seus professores, ou procure a secretaria do CEEP Lourdinha Guerra, de segunda a sexta, no horário de funcionamento da escola.' })));
}

// ---------------------------------------------------------------- início

initialize();
