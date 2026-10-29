// Portal da Gestão — acompanhamento: Visão geral (GET /api/painel), Ocorrências (listar,
// registrar e resolver), Justificativas (pendentes e histórico, anexo, aceitar/recusar) e
// Relatórios (CSV baixados com fetch autenticado).

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$, el, icon, button, option, badge, sourceData, onSource, renderStatusInto, emptyState, matches } = G;

const OCCURRENCE_FILTERS = ['aberta', 'resolvida', 'todas'];
let occurrenceFilter = 'aberta';
let justificationTab = 'pendentes';

function firstDefined(object, ...keys) {
    for (const key of keys) {
        if (object && object[key] !== undefined && object[key] !== null) return object[key];
    }
    return null;
}

function studentInfo(item) {
    const student = typeof item.aluno === 'object' && item.aluno ? item.aluno : {};
    return {
        id: student.id_aluno ?? item.id_aluno ?? null,
        nome: student.nome || item.nome_aluno || (typeof item.aluno === 'string' ? item.aluno : '') || item.nome || 'Aluno',
        turma: G.nameOf(student.turma ?? student.nome_turma ?? item.turma ?? item.nome_turma)
            || (student.id_turma || item.id_turma ? G.className(student.id_turma || item.id_turma) : '')
    };
}

function avatar(name) {
    return el('span', { class: 'avatar avatar-pequeno', 'aria-hidden': 'true', text: G.avatarInitials(name) });
}

// ---------------------------------------------------------------- visão geral

function panelParts(panel) {
    const kpis = panel.kpis || panel.indicadores || panel;
    const classes = firstDefined(panel, 'frequencia_por_turma', 'turmas') || [];
    const attention = firstDefined(panel, 'alunos_atencao', 'alunos_precisam_atencao', 'atencao', 'alunos_em_risco') || [];
    return {
        kpis: {
            alunos: firstDefined(kpis, 'alunos', 'total_alunos'),
            frequencia: firstDefined(kpis, 'frequencia_media', 'frequencia'),
            abaixo: firstDefined(kpis, 'alunos_abaixo_75', 'abaixo_75', 'alunos_em_risco', 'alunos_risco'),
            ocorrencias: firstDefined(kpis, 'ocorrencias_abertas', 'ocorrencias'),
            justificativas: firstDefined(kpis, 'justificativas_pendentes', 'justificativas')
        },
        classes: Array.isArray(classes) ? classes : [],
        attention: Array.isArray(attention) ? attention : []
    };
}

function kpiCard({ label, value, iconName, href, alert }) {
    const content = [
        el('span', { class: 'kpi-icone', 'aria-hidden': 'true' }, icon(iconName)),
        el('span', { class: 'kpi-rotulo', text: label }),
        el('strong', { class: 'kpi-valor', text: value })
    ];
    return href
        ? el('a', { class: `kpi${alert ? ' kpi-alerta' : ''}`, href }, content)
        : el('div', { class: `kpi${alert ? ' kpi-alerta' : ''}` }, content);
}

function frequencyBar(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    const bar = el('span', { class: `barra${value < G.FREQUENCIA_MINIMA ? ' barra-alerta' : ''}`, 'aria-hidden': 'true' },
        el('span', { class: 'barra-valor' }),
        el('span', { class: 'barra-meta' }));
    bar.firstChild.style.setProperty('--valor', `${value}%`);
    return bar;
}

function renderPanel() {
    const container = $('#painel');
    if (!renderStatusInto(container, ['painel'], 'Carregando a visão geral…')) return;
    const panel = G.source('painel').data || {};
    const { kpis, classes, attention } = panelParts(panel);
    if (typeof panel.mensagens_nao_lidas === 'number') G.setUnread?.(panel.mensagens_nao_lidas);
    const count = (value) => (value === null ? '—' : Number(value).toLocaleString('pt-BR'));
    const below = Number(kpis.abaixo) || 0;

    const kpiGrid = el('div', { class: 'kpis' },
        kpiCard({ label: 'Alunos', value: count(kpis.alunos), iconName: 'student', href: '#/alunos' }),
        kpiCard({ label: 'Frequência média', value: G.formatPercent(kpis.frequencia), iconName: 'chart-line-up' }),
        kpiCard({ label: 'Alunos abaixo de 75%', value: count(kpis.abaixo), iconName: 'warning-circle', alert: below > 0, href: '#/relatorios' }),
        kpiCard({ label: 'Ocorrências abertas', value: count(kpis.ocorrencias), iconName: 'warning-octagon', href: '#/ocorrencias' }),
        kpiCard({ label: 'Justificativas pendentes', value: count(kpis.justificativas), iconName: 'file-text', href: '#/justificativas/pendentes' }));

    const classList = classes.length
        ? el('ul', { class: 'lista-barras' }, classes.map((item) => {
            const percent = firstDefined(item, 'frequencia', 'frequencia_media');
            const name = item.nome_turma || G.nameOf(item.turma) || G.className(item.id_turma);
            return el('li', {},
                el('span', { class: 'lista-barras-nome', text: name }),
                frequencyBar(percent),
                el('span', { class: `lista-barras-valor${percent !== null && percent < G.FREQUENCIA_MINIMA ? ' texto-alerta' : ''}`,
                    text: percent === null ? 'Sem aulas' : G.formatPercent(percent) }));
        }))
        : emptyState('Ainda não há frequência lançada.', 'chart-bar');

    const attentionList = attention.length
        ? el('ul', { class: 'lista-pessoas' }, attention.map((item) => {
            const student = studentInfo(item);
            const percent = firstDefined(item, 'frequencia', 'frequencia_media');
            const reason = item.motivo || (percent !== null && percent < G.FREQUENCIA_MINIMA ? 'Frequência abaixo de 75%' : '');
            const openOccurrences = firstDefined(item, 'ocorrencias_abertas', 'ocorrencias');
            return el('li', { class: 'pessoa' },
                avatar(student.nome),
                el('span', { class: 'pessoa-texto' },
                    el('strong', { text: student.nome }),
                    el('small', { class: 'texto-suave', text: [student.turma, reason,
                        openOccurrences ? `${openOccurrences} ${Number(openOccurrences) === 1 ? 'ocorrência aberta' : 'ocorrências abertas'}` : ''].filter(Boolean).join(' · ') })),
                percent !== null
                    ? el('span', { class: `pessoa-valor${percent < G.FREQUENCIA_MINIMA ? ' texto-alerta' : ''}`, text: G.formatPercent(percent) })
                    : null);
        }))
        : emptyState('Nenhum aluno precisa de atenção agora.', 'seal-check');

    container.replaceChildren(
        kpiGrid,
        el('div', { class: 'grade-painel' },
            el('section', { class: 'cartao', 'aria-labelledby': 'titulo-freq-turma' },
                el('div', { class: 'cartao-cabecalho' },
                    el('h2', { id: 'titulo-freq-turma', text: 'Frequência por turma' }),
                    el('p', { class: 'texto-suave', text: 'A linha marca o mínimo de 75%.' })),
                classList),
            el('section', { class: 'cartao', 'aria-labelledby': 'titulo-atencao' },
                el('div', { class: 'cartao-cabecalho' },
                    el('h2', { id: 'titulo-atencao', text: 'Alunos que precisam de atenção' })),
                attentionList)));
    updateCounters();
}

// Contadores do menu: preferem a lista carregada; senão, os KPIs do painel.
function updateCounters() {
    const panel = G.source('painel').status === 'ok' ? panelParts(G.source('painel').data || {}).kpis : {};
    const occurrences = G.source('ocorrencias').status === 'ok'
        ? sourceData('ocorrencias').filter((item) => item.situacao !== 'resolvida').length
        : panel.ocorrencias;
    const justifications = G.source('justificativas').status === 'ok'
        ? sourceData('justificativas').filter((item) => item.situacao === 'pendente').length
        : panel.justificativas;
    setCounter('ocorrencias', occurrences, ['aberta', 'abertas']);
    setCounter('justificativas', justifications, ['pendente', 'pendentes']);
}

function setCounter(name, value, [singular, plural]) {
    const number = Number(value) || 0;
    $$(`[data-contador="${name}"]`).forEach((node) => {
        node.hidden = !number;
        node.textContent = number > 99 ? '99+' : String(number);
        node.setAttribute('aria-label', `${number} ${number === 1 ? singular : plural}`);
    });
    G.updateMoreDot?.();
}

// ---------------------------------------------------------------- ocorrências

function renderOccurrences() {
    const list = $('#lista-ocorrencias');
    $$('[data-filtro-ocorrencia]').forEach((node) =>
        node.setAttribute('aria-pressed', String(node.dataset.filtroOcorrencia === occurrenceFilter)));
    if (!renderStatusInto(list, ['ocorrencias', 'turmas'], 'Carregando ocorrências…')) return;
    const query = $('#busca-ocorrencias').value;
    const classFilter = Number($('#filtro-turma-ocorrencias').value) || null;
    const className = classFilter ? G.className(classFilter) : null;
    const all = sourceData('ocorrencias');
    const items = all
        .filter((item) => occurrenceFilter === 'todas'
            || (occurrenceFilter === 'resolvida' ? item.situacao === 'resolvida' : item.situacao !== 'resolvida'))
        .filter((item) => {
            const student = studentInfo(item);
            return (!classFilter || student.turma === className || item.id_turma === classFilter
                || item.aluno?.id_turma === classFilter)
                && matches(query, student.nome, item.descricao);
        })
        .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
    if (!items.length) {
        list.replaceChildren(emptyState(all.length
            ? 'Nenhuma ocorrência neste filtro.'
            : 'Nenhuma ocorrência registrada.', 'seal-check'));
        return;
    }
    list.replaceChildren(el('ul', { class: 'lista-registros' }, items.map(occurrenceItem)));
}

function occurrenceItem(item) {
    const student = studentInfo(item);
    const resolved = item.situacao === 'resolvida';
    const author = item.autor
        ? [G.nameOf(item.autor), G.PROFILE_NAMES[item.autor.perfil || item.autor.tipo_usuario]].filter(Boolean).join(' · ')
        : item.nome_autor || '';
    const actions = el('div', { class: 'acoes' });
    if (!resolved) {
        const resolve = button([icon('check-circle'), 'Marcar como resolvida'], 'botao botao-secundario botao-pequeno', () =>
            G.runAction(resolve, async () => {
                await G.sendJson(`/api/ocorrencias/${item.id_ocorrencia}`, 'PATCH', { situacao: 'resolvida' });
                G.showSuccess(`Ocorrência de ${student.nome} marcada como resolvida.`);
                await Promise.all([G.loadSource('ocorrencias', { silent: true }), G.loadSource('painel', { silent: true })]);
            }));
        actions.append(resolve);
    }
    return el('li', { class: 'registro' },
        avatar(student.nome),
        el('div', { class: 'registro-corpo' },
            el('div', { class: 'registro-topo' },
                el('strong', { text: student.nome }),
                student.turma ? el('span', { class: 'texto-suave', text: student.turma }) : null,
                resolved ? badge('Resolvida', 'ok') : badge('Aberta', 'alerta')),
            el('p', { class: 'registro-texto', text: item.descricao || '' }),
            el('p', { class: 'texto-suave registro-meta', text: [
                item.criado_em ? `Registrada em ${G.formatCreated(item.criado_em)}` : '',
                author ? `por ${author}` : '',
                resolved && item.resolvida_em ? `resolvida em ${G.formatCreated(item.resolvida_em)}` : ''
            ].filter(Boolean).join(' · ') })),
        actions);
}

function fillOccurrenceSelects() {
    G.fillSelect($('#filtro-turma-ocorrencias'), G.classOptions('Todas as turmas'));
    G.fillSelect($('#ocorrencia-turma'), G.classOptions('Selecione a turma'));
    fillOccurrenceStudents();
}

function fillOccurrenceStudents() {
    const classId = Number($('#ocorrencia-turma').value) || null;
    const students = sourceData('alunos')
        .filter((student) => !classId || student.id_turma === classId)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    G.fillSelect($('#ocorrencia-aluno'), [
        option('', classId ? 'Selecione o aluno' : 'Escolha a turma primeiro'),
        ...(classId ? students.map((student) => option(student.id_aluno, student.nome)) : [])
    ]);
}

async function submitOccurrence(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    await G.runFormAction(form, submit, async () => {
        await G.sendJson('/api/ocorrencias', 'POST', {
            id_aluno: Number($('#ocorrencia-aluno').value),
            descricao: $('#ocorrencia-descricao').value.trim()
        });
        form.reset();
        fillOccurrenceStudents();
        G.showSuccess('Ocorrência registrada.');
        occurrenceFilter = 'aberta';
        await Promise.all([G.loadSource('ocorrencias', { silent: true }), G.loadSource('painel', { silent: true })]);
    }, {
        fieldFor: G.fieldByMessage([
            [/aluno/i, $('#ocorrencia-aluno')],
            [/./, $('#ocorrencia-descricao')]
        ])
    });
}

// ---------------------------------------------------------------- justificativas

const JUSTIFICATION_STATUS = {
    pendente: ['Pendente', 'pendente'],
    aceita: ['Aceita', 'ok'],
    recusada: ['Recusada', 'alerta']
};

function renderJustifications() {
    const list = $('#lista-justificativas');
    $$('[data-aba-justificativa]').forEach((node) => {
        const active = node.dataset.abaJustificativa === justificationTab;
        node.classList.toggle('ativo', active);
        if (active) node.setAttribute('aria-current', 'page');
        else node.removeAttribute('aria-current');
    });
    if (!renderStatusInto(list, ['justificativas'], 'Carregando justificativas…')) return;
    const all = sourceData('justificativas');
    const pending = justificationTab === 'pendentes';
    const items = all
        .filter((item) => (item.situacao === 'pendente') === pending)
        .sort((a, b) => pending
            ? String(a.criado_em || '').localeCompare(String(b.criado_em || ''))
            : String(b.analisado_em || b.criado_em || '').localeCompare(String(a.analisado_em || a.criado_em || '')));
    if (!items.length) {
        list.replaceChildren(emptyState(pending
            ? 'Nenhuma justificativa aguardando análise.'
            : 'Nenhuma justificativa analisada ainda.', pending ? 'seal-check' : 'file-text'));
        return;
    }
    list.replaceChildren(el('ul', { class: 'lista-justificativas' }, items.map(justificationCard)));
}

function justificationCard(item) {
    const student = studentInfo(item);
    const [statusLabel, statusVariant] = JUSTIFICATION_STATUS[item.situacao] || [item.situacao, 'neutro'];
    const discipline = G.nameOf(item.disciplina, 'nome_disciplina') || item.nome_disciplina || '';
    const card = el('li', { class: 'cartao justificativa' },
        el('div', { class: 'registro-topo' },
            avatar(student.nome),
            el('span', { class: 'pessoa-texto' },
                el('strong', { text: student.nome }),
                el('small', { class: 'texto-suave', text: student.turma })),
            badge(statusLabel, statusVariant)),
        el('dl', { class: 'detalhes' },
            el('div', {}, el('dt', { text: 'Disciplina' }), el('dd', { text: discipline || '—' })),
            el('div', {}, el('dt', { text: 'Dia da falta' }), el('dd', { text: G.formatDay(item.data_falta) })),
            el('div', {}, el('dt', { text: 'Enviada em' }), el('dd', { text: G.formatCreated(item.criado_em) || '—' }))),
        el('div', { class: 'justificativa-motivo' },
            el('h3', { text: 'Motivo' }),
            el('p', { text: item.motivo || '—' })),
        item.anexo ? el('div', { class: 'aviso-anexo' }, G.attachmentButton(item.anexo)) : null);

    if (item.situacao === 'pendente') {
        card.append(reviewForm(item, student));
    } else if (item.resposta || item.analisado_em) {
        card.append(el('div', { class: 'justificativa-resposta' },
            item.resposta ? el('h3', { text: 'Resposta da gestão' }) : null,
            item.resposta ? el('p', { text: item.resposta }) : null,
            item.analisado_em ? el('p', { class: 'texto-suave', text: `Analisada em ${G.formatCreated(item.analisado_em)}` }) : null));
    }
    return card;
}

function reviewForm(item, student) {
    const answerId = `resposta-${item.id_justificativa}`;
    const answer = el('textarea', { id: answerId, rows: 2, maxlength: 1000, placeholder: 'Explique a decisão ao aluno (opcional ao aceitar)' });
    const decide = (situacao, trigger) => G.runFormAction(box, trigger, async () => {
        const text = answer.value.trim();
        if (situacao === 'recusada' && !text) {
            throw G.fieldError(answer, 'Escreva uma resposta explicando por que a justificativa foi recusada.');
        }
        await G.sendJson(`/api/justificativas/${item.id_justificativa}`, 'PATCH',
            { situacao, ...(text ? { resposta: text } : {}) });
        G.showSuccess(`Justificativa de ${student.nome} ${situacao === 'aceita' ? 'aceita' : 'recusada'}.`);
        await Promise.all([G.loadSource('justificativas', { silent: true }), G.loadSource('painel', { silent: true })]);
    }, { fieldFor: G.fieldByMessage([[/resposta/i, answer]]) });
    const accept = button([icon('check'), 'Aceitar'], 'botao botao-primario', () => decide('aceita', accept));
    const refuse = button([icon('x'), 'Recusar'], 'botao botao-perigo', () => decide('recusada', refuse));
    const box = el('div', { class: 'justificativa-analise' },
        el('div', { class: 'campo' }, el('label', { for: answerId, text: 'Resposta ao aluno' }), answer),
        el('div', { class: 'linha-botoes' }, accept, refuse));
    return box;
}

// ---------------------------------------------------------------- registro das seções

G.sections['visao-geral'] = {
    title: 'Visão geral',
    description: 'Como está a escola hoje.',
    setup() {
        onSource(['painel', 'turmas'], renderPanel);
        onSource(['ocorrencias', 'justificativas'], updateCounters);
    },
    show() {
        if (G.source('painel').status === 'ok') G.loadSource('painel', { silent: true });
        else G.ensureSource('painel');
    }
};

G.sections.ocorrencias = {
    title: 'Ocorrências',
    description: 'Ocorrências registradas por professores e pela gestão.',
    setup() {
        $$('[data-filtro-ocorrencia]').forEach((node) => node.addEventListener('click', () => {
            occurrenceFilter = OCCURRENCE_FILTERS.includes(node.dataset.filtroOcorrencia) ? node.dataset.filtroOcorrencia : 'aberta';
            renderOccurrences();
        }));
        $('#busca-ocorrencias').addEventListener('input', renderOccurrences);
        $('#filtro-turma-ocorrencias').addEventListener('change', renderOccurrences);
        $('#ocorrencia-turma').addEventListener('change', fillOccurrenceStudents);
        $('#form-ocorrencia').addEventListener('submit', submitOccurrence);
        onSource(['ocorrencias', 'turmas', 'alunos'], renderOccurrences);
        onSource(['turmas', 'alunos'], fillOccurrenceSelects);
    },
    show() {
        G.ensureSource('ocorrencias');
    }
};

G.sections.justificativas = {
    title: 'Justificativas',
    description: 'Analise as justificativas de falta enviadas pelos alunos.',
    setup() {
        onSource(['justificativas', 'turmas'], renderJustifications);
    },
    show(sub) {
        justificationTab = sub === 'historico' ? 'historico' : 'pendentes';
        G.ensureSource('justificativas');
        renderJustifications();
    }
};

// ---------------------------------------------------------------- auditoria (LGPD)

// Registro de quem fez o quê (GET /api/auditoria), montado aqui dentro de Relatórios.
// Mostra só ação e alvo (ex.: "aluno:21"), nunca conteúdo pessoal.
const AUDIT_PROFILE = { aluno: 'Aluno', professor: 'Professor', gestao: 'Gestão' };
const audit = { page: 1, userId: null, userName: '', loaded: false, actions: [], request: 0 };

function auditField(label, control) {
    return el('label', { class: 'campo campo-filtro' }, el('span', { text: label }), control);
}

function setupAudit() {
    const section = $('[data-pagina="relatorios"]');
    if (!section || $('#auditoria')) return;
    const actionSelect = el('select', { id: 'auditoria-acao' }, option('', 'Todas as ações'));
    const from = el('input', { id: 'auditoria-de', type: 'date' });
    const to = el('input', { id: 'auditoria-ate', type: 'date' });
    const apply = button([icon('funnel'), 'Filtrar'], 'botao botao-secundario', () => loadAudit(1));
    const filters = el('form', { class: 'filtros', id: 'auditoria-filtros', 'aria-label': 'Filtros da auditoria' },
        auditField('Ação', actionSelect), auditField('De', from), auditField('Até', to),
        el('div', { id: 'auditoria-pessoa' }), apply);
    filters.addEventListener('submit', (event) => {
        event.preventDefault();
        loadAudit(1);
    });
    [actionSelect, from, to].forEach((control) => control.addEventListener('change', () => loadAudit(1)));
    section.append(el('section', { class: 'cartao', id: 'auditoria', 'aria-labelledby': 'auditoria-titulo' },
        el('div', { class: 'cartao-cabecalho' },
            el('h2', { id: 'auditoria-titulo', text: 'Registro de auditoria' }),
            el('p', { class: 'texto-suave', text: 'Quem entrou no sistema e quem fez ações sensíveis (matrículas, senhas, justificativas, ocorrências, atestados, exportações). Guardado por 2 anos, sem conteúdo pessoal.' })),
        filters,
        el('div', { id: 'auditoria-lista', 'aria-live': 'polite' }),
        el('div', { class: 'linha-botoes', id: 'auditoria-paginas' })));
}

function auditQuery(page) {
    const params = new URLSearchParams({ pagina: String(page), por_pagina: '25' });
    const action = $('#auditoria-acao').value;
    if (action) params.set('acao', action);
    if ($('#auditoria-de').value) params.set('de', $('#auditoria-de').value);
    if ($('#auditoria-ate').value) params.set('ate', $('#auditoria-ate').value);
    if (audit.userId) params.set('id_usuario', String(audit.userId));
    return params;
}

function filterByPerson(user) {
    audit.userId = user ? user.id_usuario : null;
    audit.userName = user ? (user.nome || user.login || `#${user.id_usuario}`) : '';
    const holder = $('#auditoria-pessoa');
    holder.replaceChildren(user
        ? button([icon('x'), `Pessoa: ${audit.userName}`], 'botao botao-texto botao-pequeno', () => filterByPerson(null),
            { 'aria-label': `Remover filtro da pessoa ${audit.userName}` })
        : '');
    loadAudit(1);
}

function auditRow(item) {
    const user = item.usuario;
    const who = user
        ? button(`${user.nome || user.login}${AUDIT_PROFILE[user.tipo_usuario] ? ` · ${AUDIT_PROFILE[user.tipo_usuario]}` : ''}`,
            'botao botao-texto botao-pequeno', () => filterByPerson(user),
            { title: 'Mostrar só as ações desta pessoa' })
        : el('span', { class: 'texto-suave', text: 'Conta removida' });
    return el('tr', {},
        el('td', { 'data-rotulo': 'Quando', text: G.formatCreated(item.criado_em) }),
        el('td', { 'data-rotulo': 'Ação', text: item.descricao }),
        el('td', { 'data-rotulo': 'Quem' }, who),
        el('td', { 'data-rotulo': 'Alvo', text: item.alvo || '—' }));
}

async function loadAudit(page = audit.page) {
    if (!$('#auditoria')) return;
    const list = $('#auditoria-lista');
    const pages = $('#auditoria-paginas');
    // Só a resposta do pedido mais recente é desenhada (filtros trocados durante o carregamento).
    const request = ++audit.request;
    list.replaceChildren(G.loadingState('Carregando auditoria…'));
    try {
        const result = await G.api(`/api/auditoria?${auditQuery(page).toString()}`);
        if (request !== audit.request) return;
        audit.page = result.pagina;
        if (!audit.actions.length && result.acoes?.length) {
            audit.actions = result.acoes;
            const select = $('#auditoria-acao');
            const current = select.value;
            G.fillSelect(select, [option('', 'Todas as ações'), ...result.acoes.map((item) => option(item.acao, item.descricao))]);
            select.value = current;
        }
        list.replaceChildren(result.itens.length
            ? el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region', 'aria-label': 'Registro de auditoria' },
                el('table', { class: 'tabela tabela-cartoes' },
                    el('caption', { class: 'visually-hidden', text: `Registro de auditoria, página ${result.pagina} de ${result.paginas}` }),
                    el('thead', {}, el('tr', {}, ['Quando', 'Ação', 'Quem', 'Alvo'].map((label) => el('th', { scope: 'col', text: label })))),
                    el('tbody', {}, result.itens.map(auditRow))))
            : emptyState('Nenhum registro encontrado com esses filtros.', 'list-magnifying-glass'));
        pages.replaceChildren(...(result.paginas > 1 ? [
            button([icon('caret-left'), 'Anteriores'], 'botao botao-secundario botao-pequeno', () => loadAudit(audit.page - 1),
                { disabled: result.pagina <= 1 }),
            el('span', { class: 'texto-suave', text: `Página ${result.pagina} de ${result.paginas} · ${result.total} registros` }),
            button(['Próximos', icon('caret-right')], 'botao botao-secundario botao-pequeno', () => loadAudit(audit.page + 1),
                { disabled: result.pagina >= result.paginas })
        ] : [el('span', { class: 'texto-suave', text: `${result.total} registro${result.total === 1 ? '' : 's'}` })]));
        audit.loaded = true;
    } catch (error) {
        if (request !== audit.request) return;
        list.replaceChildren(G.errorState(error.message, () => loadAudit(page)));
        pages.replaceChildren();
    }
}

G.sections.relatorios = {
    title: 'Relatórios',
    description: 'Baixe planilhas da frequência e consulte o registro de auditoria.',
    setup() {
        $$('[data-relatorio]').forEach((trigger) => trigger.addEventListener('click', () => {
            const name = trigger.dataset.relatorio;
            G.runAction(trigger, async () => {
                await G.downloadAuthenticated(`/api/relatorios/${name}.csv`, `${name}.csv`);
                G.showSuccess('Relatório baixado.');
            });
        }));
        setupAudit();
    },
    show() {
        loadAudit(audit.loaded ? audit.page : 1);
    }
};

G.updateCounters = updateCounters;
}());
