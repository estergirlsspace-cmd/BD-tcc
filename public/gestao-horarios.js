// Portal da Gestão — horários em PDF (seção Turmas): um PDF por turma e um para os professores.
// Publicar/substituir = POST /api/arquivos (binário) + PUT /api/horarios-pdf/...; remover = DELETE
// com confirmação inline. Alunos veem o da própria turma; professores, o deles e o das turmas.

(function () {
'use strict';

const G = window.CwGestao;
const { $, el, icon, button, onSource, emptyState } = G;

G.SOURCE_PATHS.horarios = '/api/horarios-pdf';

// Abas do protótipo (.schedule-tabs): horário das turmas | horário dos professores.
const TABS = {
    turmas: { label: 'Horário das turmas', help: 'Cada PDF aparece na página dos alunos da turma e na dos professores que dão aula nela.' },
    professores: { label: 'Horário dos professores', help: 'Este PDF aparece na página dos professores.' }
};
let activeTab = 'turmas';

function isPdf(file) {
    return file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name));
}

function cell(label, ...content) {
    return el('td', { 'data-rotulo': label }, ...content);
}

// Alvos na ordem da tela: professores primeiro, depois as turmas (curso, série, nome).
function targets() {
    const data = G.source('horarios').data || {};
    const byClass = new Map((data.turmas || []).map((item) => [item.id_turma, item]));
    if (activeTab === 'professores') {
        return [{ label: 'Professores', name: 'dos professores', path: '/api/horarios-pdf/professores', item: data.professores || null }];
    }
    return [
        ...G.sortedClasses().map((schoolClass) => ({
            label: schoolClass.nome_turma,
            name: `de ${schoolClass.nome_turma}`,
            path: `/api/horarios-pdf/turma/${schoolClass.id_turma}`,
            item: byClass.get(schoolClass.id_turma) || null
        }))
    ];
}

function renderSchedules() {
    const container = $('#lista-horarios');
    const status = G.source('horarios');
    // API ainda não publicada neste servidor: aviso calmo em vez de erro.
    if (status.status === 'error' && [404, 501].includes(status.errorStatus)) {
        container.replaceChildren(emptyState('A publicação de horários ainda não está disponível neste servidor.', 'calendar-blank'));
        return;
    }
    if (!G.renderStatusInto(container, ['horarios', 'turmas'], 'Carregando horários…')) return;
    const tabs = el('div', { class: 'segmentos', role: 'group', 'aria-label': 'Horários' },
        Object.entries(TABS).map(([key, tab]) => button(tab.label, 'segmento', () => {
            if (activeTab === key) return;
            activeTab = key;
            renderSchedules();
            container.querySelector(`[data-aba-horario="${key}"]`)?.focus();
        }, { 'aria-pressed': String(activeTab === key), dataset: { abaHorario: key } })));
    container.replaceChildren(tabs, el('p', { class: 'aviso-info' }, icon('info'), el('span', { text: TABS[activeTab].help })), el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region', 'aria-label': 'Tabela de horários em PDF' },
        el('table', { class: 'tabela tabela-cartoes' },
            el('thead', {}, el('tr', {},
                el('th', { scope: 'col', text: 'Horário' }),
                el('th', { scope: 'col', text: 'Arquivo' }),
                el('th', { scope: 'col', text: 'Atualizado em' }),
                el('th', { scope: 'col' }, G.srText('Ações')))),
            el('tbody', {}, targets().map(scheduleRow)))));
}

function scheduleRow(target) {
    const { item } = target;
    const file = item?.arquivo;
    const actions = el('div', { class: 'acoes' });
    const picker = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, tabindex: '-1' });

    const fillActions = () => {
        actions.replaceChildren();
        const publish = button([icon('upload-simple'), item ? 'Substituir' : 'Publicar PDF'],
            `botao ${item ? 'botao-texto' : 'botao-secundario'} botao-pequeno`, () => picker.click(),
            { 'aria-label': `${item ? 'Substituir' : 'Publicar'} horário ${target.name}` });
        picker.onchange = () => {
            const chosen = picker.files[0];
            picker.value = '';
            if (chosen) publishPdf(target, chosen, publish);
        };
        actions.append(picker, publish);
        if (!item) return;
        const download = button([icon('download-simple'), 'Baixar'], 'botao botao-texto botao-pequeno', () =>
            G.runAction(download, () => G.downloadAuthenticated(`/api/arquivos/${file.id_arquivo}`, file.nome)),
        { 'aria-label': `Baixar horário ${target.name}` });
        const remove = button([icon('trash'), 'Remover'], 'botao botao-texto botao-perigo-texto botao-pequeno', () =>
            G.confirmInline(actions, {
                question: `Remover o horário ${target.name}? Ele deixa de aparecer para quem acessa.`,
                confirmLabel: 'Remover',
                onCancel: fillActions,
                onConfirm: async () => {
                    await G.api(target.path, { method: 'DELETE' });
                    await G.loadSource('horarios', { silent: true });
                    G.showSuccess(`Horário ${target.name} removido.`);
                    focusRow(target.path);
                }
            }), { 'aria-label': `Remover horário ${target.name}` });
        actions.append(download, remove);
    };
    fillActions();

    return el('tr', { dataset: { alvo: target.path } },
        cell('Horário', el('strong', { text: target.label })),
        cell('Arquivo', file
            ? el('span', {}, file.nome || 'horario.pdf', file.tamanho ? el('small', { class: 'texto-suave', text: ` · ${G.formatBytes(file.tamanho)}` }) : null)
            : el('span', { class: 'texto-suave', text: 'Nenhum PDF publicado' })),
        cell('Atualizado em', item?.atualizado_em ? G.formatCreated(item.atualizado_em) : '—'),
        cell('Ações', actions));
}

async function publishPdf(target, file, trigger) {
    if (!isPdf(file)) {
        G.showError('O horário deve ser um arquivo PDF.');
        return;
    }
    if (file.size > G.MAX_ANEXO_BYTES) {
        G.showError('O PDF passa de 5 MB. Escolha um arquivo menor.');
        return;
    }
    await G.runAction(trigger, async () => {
        trigger.lastChild.textContent = 'Enviando…';
        try {
            const uploaded = await G.uploadFile(file);
            await G.sendJson(target.path, 'PUT', { id_arquivo: uploaded.id_arquivo });
            await G.loadSource('horarios', { silent: true });
            G.showSuccess(`Horário ${target.name} publicado.`);
        } finally {
            // Redesenha (volta o rótulo se falhou) e devolve o foco à linha.
            renderSchedules();
            focusRow(target.path);
        }
    });
}

function focusRow(path) {
    const row = Array.from(document.querySelectorAll('#lista-horarios tr[data-alvo]')).find((node) => node.dataset.alvo === path);
    row?.querySelector('button')?.focus();
}

const turmas = G.sections.turmas;
const originalSetup = turmas.setup;
const originalShow = turmas.show;
turmas.setup = function setup() {
    originalSetup?.call(this);
    onSource(['horarios', 'turmas'], renderSchedules);
};
turmas.show = function show(sub) {
    originalShow?.call(this, sub);
    G.ensureSource('horarios');
};
}());
