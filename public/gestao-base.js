// Portal da Gestão (C·Warning) — base compartilhada pelos módulos gestao-*.js.
// Estado, chamada à API com token, utilidades de DOM (el() sem innerHTML), estados de
// carregamento/erro/vazio, confirmação inline e downloads autenticados (fetch → blob).
// Depende de /datas.js (formatSchoolDate) e /notificacoes.js (notify).
// Tudo fica dentro de uma função e é exposto em window.CwGestao, para não colidir com nomes
// globais de outros scripts da página (como o componente de mensagens).

(function () {
'use strict';

const TOKEN_KEY = 'cwarning-token';
const token = sessionStorage.getItem(TOKEN_KEY);
const FREQUENCIA_MINIMA = 75;
const MOBILE_QUERY = window.matchMedia('(max-width: 899.98px)');
const MAX_ANEXO_BYTES = 5 * 1024 * 1024;

const SERIES_NAMES = { 1: '1ª Série', 2: '2ª Série', 3: '3ª Série' };
const COURSE_NAMES = { redes: 'Redes de Computadores', informatica: 'Informática' };
const TYPE_NAMES = {
    aviso: 'Aviso',
    comunicado: 'Comunicado',
    evento: 'Evento',
    atividade: 'Atividade',
    avaliacao: 'Avaliação'
};
const AREA_NAMES = {
    natureza: 'Natureza',
    humanas: 'Humanas',
    linguagens: 'Linguagens',
    matematica: 'Matemática',
    informatica: 'Base Técnica - Informática',
    redes: 'Base Técnica - Redes'
};
const PROFILE_NAMES = { aluno: 'Aluno', professor: 'Professor', gestao: 'Gestão' };

// Cada fonte de dados tem estado próprio: a tela mostra carregando/erro/vazio por fonte.
const state = {
    user: null,
    route: { section: 'visao-geral', sub: null },
    sources: {},
    unreadMessages: 0
};

const SOURCE_PATHS = {
    turmas: '/api/turmas',
    disciplinas: '/api/disciplinas',
    avisos: '/api/avisos',
    usuarios: '/api/usuarios',
    alunos: '/api/alunos',
    professores: '/api/professores',
    painel: '/api/painel',
    ocorrencias: '/api/ocorrencias',
    justificativas: '/api/justificativas',
    conta: '/api/conta',
    sessoes: '/api/conta/sessoes'
};

// Quem redesenha a tela quando uma fonte muda (preenchido pelos módulos).
const SOURCE_RENDERERS = {};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

// ---------------------------------------------------------------- API e sessão

// expirou: a sessão caiu (401) — o login avisa e, depois de entrar, volta para esta tela.
// Sair por vontade própria não guarda nada.
function leaveToLogin({ expirou = false } = {}) {
    sessionStorage.removeItem(TOKEN_KEY);
    if (expirou) {
        try {
            sessionStorage.setItem('cw-motivo', 'sessao');
            sessionStorage.setItem('cw-voltar', window.location.pathname + window.location.hash);
        } catch { /* armazenamento indisponível: só volta ao login */ }
    }
    window.location.replace('/');
}

const OFFLINE_MESSAGE = 'Sem conexão. Confira a internet e tente de novo.';
const INVALID_RESPONSE_MESSAGE = 'O servidor respondeu de um jeito inesperado. Tente de novo em instantes.';

// data: corpo JSON da resposta de erro (ex.: relatório da importação devolvido com 400).
class ApiFailure extends Error {
    constructor(message, status, data = null) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

async function api(path, options = {}) {
    const isJsonBody = typeof options.body === 'string';
    let response;
    let text;
    try {
        response = await fetch(path, {
            ...options,
            headers: {
                ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
                Authorization: `Bearer ${token}`,
                ...options.headers
            }
        });
        text = await response.text();
    } catch {
        throw new ApiFailure(OFFLINE_MESSAGE, 0);
    }
    if (response.status === 401) {
        leaveToLogin({ expirou: true });
        throw new ApiFailure('Sua sessão expirou. Entre de novo.', 401);
    }
    let result = null;
    try {
        result = text ? JSON.parse(text) : null;
    } catch {
        throw new ApiFailure(INVALID_RESPONSE_MESSAGE, response.status);
    }
    if (response.status === 501) {
        throw new ApiFailure('Esta função ainda está sendo preparada. Tente de novo mais tarde.', 501);
    }
    if (!response.ok) {
        throw new ApiFailure(result?.erro || 'Não foi possível concluir a solicitação.', response.status, result);
    }
    return result;
}

function sendJson(path, method, body) {
    return api(path, { method, body: JSON.stringify(body ?? {}) });
}

function source(name) {
    state.sources[name] ??= { status: 'idle', data: null, error: null };
    return state.sources[name];
}

function sourceData(name, fallback = []) {
    const item = source(name);
    return item.status === 'ok' && item.data !== null ? item.data : fallback;
}

async function loadSource(name, { silent = false } = {}) {
    const item = source(name);
    if (!silent || item.status !== 'ok') {
        item.status = 'loading';
        item.error = null;
        renderSource(name);
    }
    try {
        item.data = await api(SOURCE_PATHS[name]);
        item.status = 'ok';
        item.error = null;
    } catch (error) {
        item.status = 'error';
        item.error = error.message;
        item.errorStatus = error.status;
    }
    renderSource(name);
}

function loadSources(...names) {
    return Promise.all(names.map((name) => loadSource(name, { silent: true })));
}

function ensureSource(name) {
    if (source(name).status === 'idle') loadSource(name);
}

function renderSource(name) {
    (SOURCE_RENDERERS[name] || []).forEach((render) => render());
}

function onSource(names, render) {
    names.forEach((name) => {
        SOURCE_RENDERERS[name] ??= [];
        SOURCE_RENDERERS[name].push(render);
    });
}

// Estado combinado de várias fontes: erro > carregando > ok.
function combinedStatus(...names) {
    const items = names.map(source);
    const failed = items.find((item) => item.status === 'error');
    if (failed) return { status: 'error', error: failed.error };
    if (items.some((item) => item.status !== 'ok')) return { status: 'loading' };
    return { status: 'ok' };
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

function button(content, className, onClick, props = {}) {
    return el('button', { type: 'button', class: className, on: { click: onClick }, ...props }, content);
}

function option(value, text) {
    return el('option', { value: String(value), text });
}

function loadingState(text = 'Carregando…') {
    return el('div', { class: 'estado-carregando', role: 'status' },
        el('span', { class: 'girando', 'aria-hidden': 'true' }), el('p', { text }));
}

function emptyState(text, iconName = 'tray') {
    return el('div', { class: 'estado-vazio' }, icon(iconName), el('p', { text }));
}

function errorState(message, retry) {
    return el('div', { class: 'estado-erro', role: 'alert' },
        icon('warning-circle'),
        el('p', { text: message || 'Não foi possível carregar.' }),
        retry ? button([icon('arrow-clockwise'), 'Tentar de novo'], 'botao botao-secundario', retry) : null);
}

// Mostra carregando/erro da combinação de fontes; devolve true se os dados estão prontos.
function renderStatusInto(container, names, loadingText) {
    const combined = combinedStatus(...names);
    if (combined.status === 'error') {
        container.replaceChildren(errorState(combined.error, () => names.forEach((name) => loadSource(name))));
        return false;
    }
    if (combined.status === 'loading') {
        container.replaceChildren(loadingState(loadingText));
        return false;
    }
    return true;
}

function badge(text, variant) {
    return el('span', { class: `selo selo-${variant}`, text });
}

function avatarInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function normalize(text) {
    return String(text || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matches(query, ...texts) {
    const wanted = normalize(query.trim());
    return !wanted || texts.some((text) => normalize(text).includes(wanted));
}

function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
    return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function formatBytes(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function formatDay(value) {
    return value ? formatSchoolDate(String(value).slice(0, 10)) : '—';
}

function formatCreated(value) {
    return value ? formatSchoolDate(value, { utc: true }) : '';
}

// Nome de algo que a API pode mandar como texto ou como objeto ({ nome } / { nome_turma }).
function nameOf(value, ...keys) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value);
    for (const key of [...keys, 'nome', 'nome_turma', 'nome_disciplina']) {
        if (value[key]) return String(value[key]);
    }
    return '';
}

function className(classId) {
    return sourceData('turmas').find((item) => item.id_turma === classId)?.nome_turma || 'Sem turma';
}

function sortedClasses() {
    return [...sourceData('turmas')].sort((a, b) => (a.curso || '').localeCompare(b.curso || '')
        || (a.serie || 0) - (b.serie || 0)
        || a.nome_turma.localeCompare(b.nome_turma, 'pt-BR'));
}

function fillSelect(select, options, { keepValue = true } = {}) {
    const previous = select.value;
    select.replaceChildren(...options);
    if (keepValue && options.some((item) => item.value === previous)) select.value = previous;
}

function classOptions(firstLabel) {
    return [
        ...(firstLabel ? [option('', firstLabel)] : []),
        ...sortedClasses().map((item) => option(item.id_turma, item.nome_turma))
    ];
}

function showError(text) {
    notify(text, 'erro');
}

function showSuccess(text) {
    notify(text, 'sucesso');
}

// Desabilita o botão enquanto a ação roda; erros viram toast.
async function runAction(trigger, action) {
    if (trigger) trigger.disabled = true;
    clearErrorNotifications();
    try {
        return await action();
    } catch (error) {
        showError(error.message);
        return undefined;
    } finally {
        if (trigger?.isConnected) trigger.disabled = false;
    }
}

// Erro que já sabe em qual campo aparecer (validação local antes de chamar a API).
function fieldError(field, message) {
    return Object.assign(new Error(message), { field });
}

// fieldFor a partir da mensagem da API: [[/regex/, campo], ...] — o primeiro que casar vence.
function fieldByMessage(rules) {
    return (error) => rules.find(([pattern]) => pattern.test(error.message || ''))?.[1] || null;
}

// Como runAction, mas o erro aparece junto do campo (CwFormulario: <p> abaixo dele,
// aria-invalid e aria-describedby). fieldFor(error) escolhe o campo dos erros da API; sem campo,
// o erro fica no fim do formulário e também vira toast.
async function runFormAction(form, trigger, action, { fieldFor } = {}) {
    if (trigger) trigger.disabled = true;
    clearErrorNotifications();
    window.CwFormulario?.limparTudo(form);
    try {
        return await action();
    } catch (error) {
        const field = error.field || fieldFor?.(error) || null;
        if (window.CwFormulario && form?.isConnected) {
            window.CwFormulario.mostrar(form, error, field);
            if (!field) showError(error.message);
        } else {
            showError(error.message);
        }
        return undefined;
    } finally {
        if (trigger?.isConnected) trigger.disabled = false;
    }
}

// Confirmação destrutiva inline (sem window.confirm): troca o conteúdo do contêiner por
// "pergunta + Confirmar + Cancelar" e devolve o foco ao botão original se cancelar.
function confirmInline(container, { question, confirmLabel, onConfirm, onCancel }) {
    const previous = Array.from(container.childNodes);
    const opener = document.activeElement;
    const restore = () => {
        container.replaceChildren(...previous);
        onCancel?.();
        // Volta ao botão que abriu a confirmação (ou ao primeiro botão, se ele foi redesenhado).
        const target = opener?.isConnected && container.contains(opener)
            ? opener
            : container.querySelector('button') || previous.find((node) => node.tagName === 'BUTTON');
        target?.focus();
    };
    const confirm = button(confirmLabel, 'botao botao-perigo botao-pequeno', async () => {
        await runAction(confirm, onConfirm);
    });
    const box = el('span', { class: 'confirmacao', role: 'group', 'aria-label': question },
        el('span', { class: 'confirmacao-texto', text: question }),
        confirm,
        button('Cancelar', 'botao botao-secundario botao-pequeno', restore));
    container.replaceChildren(box);
    // Ação destrutiva: o foco começa no lado seguro (Cancelar).
    box.querySelector('.botao-secundario').focus();
}

// ---------------------------------------------------------------- arquivos

// Download autenticado: o token vai no cabeçalho, nunca na URL.
async function downloadAuthenticated(path, fallbackName) {
    let response;
    try {
        response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    } catch {
        throw new Error(OFFLINE_MESSAGE);
    }
    if (response.status === 401) {
        leaveToLogin({ expirou: true });
        throw new Error('Sua sessão expirou. Entre de novo.');
    }
    if (!response.ok) {
        let message = response.status === 501
            ? 'Esta função ainda está sendo preparada. Tente de novo mais tarde.'
            : 'Não foi possível baixar o arquivo.';
        try {
            message = JSON.parse(await response.text())?.erro || message;
        } catch { /* corpo não é JSON */ }
        throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: fileNameFrom(response) || fallbackName || 'arquivo', hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fileNameFrom(response) {
    const header = response.headers.get('Content-Disposition') || '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (encoded) {
        try {
            return decodeURIComponent(encoded[1].trim());
        } catch { /* nome malformado */ }
    }
    return /filename="?([^";]+)"?/i.exec(header)?.[1] || null;
}

// Upload em corpo binário cru (contrato §2): devolve { id_arquivo, nome, tipo_mime, tamanho }.
async function uploadFile(file) {
    if (file.size > MAX_ANEXO_BYTES) throw new Error('O arquivo passa de 5 MB.');
    return api('/api/arquivos', {
        method: 'POST',
        body: file,
        headers: {
            'Content-Type': file.type || 'application/pdf',
            'X-Nome-Arquivo': encodeURIComponent(file.name)
        }
    });
}

function attachmentButton(anexo) {
    const label = [anexo.nome || 'Anexo', formatBytes(anexo.tamanho)].filter(Boolean).join(' · ');
    const trigger = button([icon('paperclip'), el('span', { text: label })], 'anexo', () =>
        runAction(trigger, () => downloadAuthenticated(`/api/arquivos/${anexo.id_arquivo}`, anexo.nome)));
    trigger.setAttribute('aria-label', `Baixar anexo ${anexo.nome || ''}`.trim());
    return trigger;
}

window.CwGestao = {
    token, FREQUENCIA_MINIMA, MOBILE_QUERY, MAX_ANEXO_BYTES,
    SERIES_NAMES, COURSE_NAMES, TYPE_NAMES, AREA_NAMES, PROFILE_NAMES,
    state, SOURCE_PATHS, $, $$,
    leaveToLogin, api, sendJson, source, sourceData, loadSource, loadSources, ensureSource,
    renderSource, onSource, combinedStatus,
    el, icon, srText, button, option, loadingState, emptyState, errorState, renderStatusInto, badge,
    avatarInitials, normalize, matches, formatPercent, formatBytes, formatDay, formatCreated, nameOf,
    className, sortedClasses, fillSelect, classOptions, showError, showSuccess, runAction, confirmInline,
    fieldError, fieldByMessage, runFormAction,
    downloadAuthenticated, uploadFile, attachmentButton,
    sections: {}
};
}());
