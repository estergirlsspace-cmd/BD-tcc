// Portal da Gestão — Salvos e pastas: o botão "Salvar" dos comunicados (PUT/DELETE /api/salvos/:id)
// e a seção que organiza os salvos em pastas pessoais (GET/POST /api/pastas, PATCH/DELETE
// /api/pastas/:id). Excluir uma pasta não tira os comunicados dos salvos: eles ficam sem pasta.

(function () {
'use strict';

const G = window.CwGestao;
const { $, el, icon, button, badge, sourceData, onSource, renderStatusInto, emptyState } = G;

G.SOURCE_PATHS.salvos = '/api/salvos';
G.SOURCE_PATHS.pastas = '/api/pastas';

// Filtro da lista: 'todos', 'sem-pasta' ou o id da pasta.
let filter = 'todos';

function savedItem(postId) {
    return sourceData('salvos').find((item) => item.id_post === postId) || null;
}

function reloadSaved() {
    return Promise.all([G.loadSource('salvos', { silent: true }), G.loadSource('pastas', { silent: true })]);
}

// Botão "Salvar"/"Salvo" dos cartões de comunicado (aria-pressed indica o estado).
G.saveButton = function saveButton(notice) {
    if (G.source('salvos').status !== 'ok') return null;
    const saved = Boolean(savedItem(notice.id_post));
    const trigger = button([icon('bookmark-simple', saved), saved ? 'Salvo' : 'Salvar'],
        'botao botao-secundario botao-pequeno', () => G.runAction(trigger, async () => {
            if (saved) {
                await G.api(`/api/salvos/${notice.id_post}`, { method: 'DELETE' });
                G.showSuccess('Comunicado removido dos salvos.');
            } else {
                await G.sendJson(`/api/salvos/${notice.id_post}`, 'PUT', { id_pasta: null });
                G.showSuccess('Comunicado salvo. Organize-o em pastas em “Salvos e pastas”.');
            }
            await reloadSaved();
        }), { 'aria-pressed': String(saved), title: saved ? 'Remover dos salvos' : 'Salvar comunicado' });
    return trigger;
};

// ---------------------------------------------------------------- pastas

function folders() {
    return sourceData('pastas');
}

function folderById(folderId) {
    return folders().find((folder) => folder.id_pasta === folderId) || null;
}

function filterLabel() {
    if (filter === 'todos') return 'Todos os salvos';
    if (filter === 'sem-pasta') return 'Sem pasta';
    return folderById(filter)?.nome || 'Pasta';
}

function selectFilter(value) {
    filter = value;
    renderFolders();
    renderSaved();
    $('#titulo-salvos').focus();
}

function folderCard(value, name, total, iconName) {
    return el('li', {}, button([
        el('span', { class: 'pasta-icone', 'aria-hidden': 'true' }, icon(iconName)),
        el('span', { class: 'pasta-nome', text: name }),
        el('span', { class: 'pasta-total texto-suave', text: total === 1 ? '1 comunicado' : `${total} comunicados` })
    ], 'pasta', () => selectFilter(value), { 'aria-pressed': String(filter === value) }));
}

function renderFolders() {
    const container = $('#lista-pastas');
    if (!renderStatusInto(container, ['pastas', 'salvos'], 'Carregando pastas…')) return;
    // Pasta excluída em outra aba: volta para "todos".
    if (typeof filter === 'number' && !folderById(filter)) filter = 'todos';
    const saved = sourceData('salvos');
    container.replaceChildren(el('ul', { class: 'grade-pastas' },
        folderCard('todos', 'Todos os salvos', saved.length, 'bookmarks-simple'),
        folderCard('sem-pasta', 'Sem pasta', saved.filter((item) => !item.id_pasta).length, 'tray'),
        folders().map((folder) => folderCard(folder.id_pasta, folder.nome, folder.total, 'folder-simple'))));
}

async function createFolder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = $('#pasta-nome');
    await G.runFormAction(form, form.querySelector('[type="submit"]'), async () => {
        const created = await G.sendJson('/api/pastas', 'POST', { nome: input.value.trim() });
        input.value = '';
        await G.loadSource('pastas', { silent: true });
        G.showSuccess(`Pasta "${created.nome}" criada.`);
    }, { fieldFor: () => input });
}

// Renomear (formulário inline) e excluir (confirmação inline) a pasta aberta.
function renderFolderActions() {
    const box = $('#acoes-pasta');
    const folder = typeof filter === 'number' ? folderById(filter) : null;
    if (!folder) {
        box.replaceChildren();
        return;
    }
    const rename = button([icon('pencil-simple'), 'Renomear'], 'botao botao-secundario botao-pequeno', () => {
        const inputId = `renomear-pasta-${folder.id_pasta}`;
        const input = el('input', { id: inputId, class: 'campo-mini', type: 'text', maxlength: 40, value: folder.nome, required: true });
        const form = el('form', { class: 'confirmacao confirmacao-neutra' },
            el('label', { class: 'visually-hidden', for: inputId, text: 'Novo nome da pasta' }),
            input,
            el('button', { type: 'submit', class: 'botao botao-primario botao-pequeno', text: 'Salvar' }),
            button('Cancelar', 'botao botao-secundario botao-pequeno', () => {
                renderFolderActions();
                box.querySelector('button')?.focus();
            }));
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            await G.runFormAction(form, form.querySelector('[type="submit"]'), async () => {
                await G.sendJson(`/api/pastas/${folder.id_pasta}`, 'PATCH', { nome: input.value.trim() });
                await G.loadSource('pastas', { silent: true });
                G.showSuccess('Pasta renomeada.');
            }, { fieldFor: () => input });
        });
        box.replaceChildren(form);
        input.select();
    });
    const remove = button([icon('trash'), 'Excluir pasta'], 'botao botao-perigo botao-pequeno', () =>
        G.confirmInline(box, {
            question: 'Excluir a pasta? Os comunicados continuam salvos, sem pasta.',
            confirmLabel: 'Sim, excluir',
            onConfirm: async () => {
                await G.api(`/api/pastas/${folder.id_pasta}`, { method: 'DELETE' });
                filter = 'todos';
                await reloadSaved();
                G.showSuccess(`Pasta "${folder.nome}" excluída.`);
                $('#titulo-salvos').focus();
            }
        }));
    box.replaceChildren(rename, remove);
}

// ---------------------------------------------------------------- comunicados salvos

function moveSelect(item) {
    const selectId = `pasta-do-salvo-${item.id_post}`;
    const select = el('select', { id: selectId, class: 'campo-mini' },
        G.option('', 'Sem pasta'),
        folders().map((folder) => G.option(folder.id_pasta, folder.nome)));
    select.value = item.id_pasta ? String(item.id_pasta) : '';
    select.addEventListener('change', () => G.runAction(select, async () => {
        const folderId = Number(select.value) || null;
        await G.sendJson(`/api/salvos/${item.id_post}`, 'PUT', { id_pasta: folderId });
        await reloadSaved();
        G.showSuccess(folderId ? `Movido para "${folderById(folderId)?.nome}".` : 'Comunicado tirado da pasta.');
    }));
    return el('span', { class: 'mover-pasta' },
        el('label', { for: selectId, text: 'Pasta' }),
        select);
}

function savedCard(item) {
    const notice = sourceData('avisos').find((post) => post.id_post === item.id_post);
    const card = el('article', { class: `aviso${item.urgente ? ' aviso-urgente' : ''}` },
        el('h3', { class: 'aviso-titulo', text: item.titulo }),
        notice ? el('p', { class: 'aviso-texto aviso-resumo', text: notice.conteudo }) : null,
        el('div', { class: 'aviso-selos' },
            el('span', { class: 'selo selo-neutro' }, icon('clock'), `Publicado em ${G.formatCreated(item.criado_em)}`),
            el('span', { class: 'selo selo-neutro' }, icon('user'), item.autor?.nome || 'Escola'),
            badge(G.TYPE_NAMES[item.tipo] || 'Aviso', 'neutro'),
            item.urgente ? badge('Urgente', 'alerta') : null));
    const actions = el('div', { class: 'acoes' },
        moveSelect(item),
        button([icon('bookmark-simple', true), 'Remover dos salvos'], 'botao botao-secundario botao-pequeno', async (event) => {
            await G.runAction(event.currentTarget, async () => {
                await G.api(`/api/salvos/${item.id_post}`, { method: 'DELETE' });
                await reloadSaved();
                G.showSuccess('Comunicado removido dos salvos.');
            });
        }));
    card.append(actions);
    return card;
}

function renderSaved() {
    $('#titulo-salvos').textContent = filterLabel();
    renderFolderActions();
    const list = $('#lista-salvos');
    if (!renderStatusInto(list, ['salvos', 'pastas'], 'Carregando salvos…')) return;
    const items = sourceData('salvos').filter((item) => filter === 'todos'
        || (filter === 'sem-pasta' ? !item.id_pasta : item.id_pasta === filter));
    if (!items.length) {
        list.replaceChildren(emptyState(filter === 'todos'
            ? 'Nenhum comunicado salvo. Use “Salvar” nos comunicados para guardá-los aqui.'
            : 'Nenhum comunicado nesta pasta.', 'bookmark-simple'));
        return;
    }
    list.replaceChildren(...items.map(savedCard));
}

G.sections.salvos = {
    title: 'Salvos e pastas',
    description: 'Organize os comunicados importantes em pastas.',
    setup() {
        $('#form-pasta').addEventListener('submit', createFolder);
        onSource(['pastas', 'salvos'], renderFolders);
        onSource(['pastas', 'salvos', 'avisos'], renderSaved);
    },
    show() {
        G.ensureSource('salvos');
        G.ensureSource('pastas');
        G.ensureSource('avisos');
    }
};
}());
