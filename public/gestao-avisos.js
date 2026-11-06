// Portal da Gestão — Comunicados (avisos): publicar, editar e excluir (público escola/curso/
// curso+série/turma), tipo, data do evento, urgente, anexo PDF e contador de leituras.
// Também a seção "Comunicados urgentes" (só os marcados como urgentes).

(function () {
'use strict';

const G = window.CwGestao;
const { $, el, icon, button, badge, sourceData, onSource, renderStatusInto, emptyState, matches } = G;

let editing = null;          // aviso em edição (objeto) ou null
let removeAttachment = false; // na edição: o anexo atual deve ser retirado

function attachmentOf(notice) {
    if (notice.anexo) return notice.anexo;
    return notice.id_arquivo ? { id_arquivo: notice.id_arquivo, nome: 'Anexo' } : null;
}

function audienceLabel(notice) {
    if (notice.id_turma) return `Turma: ${G.className(notice.id_turma)}`;
    if (notice.curso && notice.serie) {
        return `${G.SERIES_NAMES[notice.serie]} — ${G.COURSE_NAMES[notice.curso]}`;
    }
    if (notice.curso) return `Todas as séries de ${G.COURSE_NAMES[notice.curso]}`;
    if (notice.serie) return `${G.SERIES_NAMES[notice.serie]} de todos os cursos`;
    return 'Escola toda';
}

// ---------------------------------------------------------------- formulário

function updateAudienceFields() {
    const audience = $('#aviso-publico').value;
    $('#campo-aviso-curso').hidden = !['curso', 'curso-serie'].includes(audience);
    $('#campo-aviso-serie').hidden = audience !== 'curso-serie';
    $('#campo-aviso-turma').hidden = audience !== 'turma';
}

function audienceFromForm() {
    const audience = $('#aviso-publico').value;
    const target = { id_turma: null, curso: null, serie: null };
    if (audience === 'curso' || audience === 'curso-serie') target.curso = $('#aviso-curso').value;
    if (audience === 'curso-serie') target.serie = Number($('#aviso-serie').value);
    if (audience === 'turma') {
        const classId = Number($('#aviso-turma').value);
        if (!classId) throw G.fieldError($('#aviso-turma'), 'Cadastre uma turma antes de publicar para uma turma.');
        target.id_turma = classId;
    }
    return target;
}

function renderCurrentAttachment() {
    const box = $('#aviso-anexo-atual');
    const anexo = editing && !removeAttachment ? attachmentOf(editing) : null;
    box.hidden = !anexo;
    if (!anexo) {
        box.replaceChildren();
        return;
    }
    box.replaceChildren(
        G.attachmentButton(anexo),
        button([icon('x'), 'Remover anexo'], 'botao botao-texto botao-pequeno', () => {
            removeAttachment = true;
            renderCurrentAttachment();
            $('#aviso-anexo').focus();
        }));
}

// O formulário fica sempre aberto (protótipo): "abrir" é levar o foco até ele.
function focusForm() {
    $('#cartao-aviso').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#aviso-titulo').focus({ preventScroll: true });
}

function setFormLabels() {
    $('#titulo-form-aviso').textContent = editing ? 'Editar comunicado' : 'Novo comunicado';
    $('#aviso-enviar').textContent = editing ? 'Salvar alterações' : 'Publicar comunicado';
    $('#aviso-cancelar').textContent = editing ? 'Cancelar edição' : 'Limpar campos';
}

function resetForm() {
    window.CwFormulario?.limparTudo($('#form-aviso'));
    editing = null;
    removeAttachment = false;
    $('#form-aviso').reset();
    updateAudienceFields();
    renderCurrentAttachment();
    setFormLabels();
}

function startNew() {
    if (editing) resetForm();
    focusForm();
}

function startEdit(notice) {
    editing = notice;
    removeAttachment = false;
    const audience = notice.id_turma ? 'turma'
        : notice.curso && notice.serie ? 'curso-serie'
            : notice.curso ? 'curso' : 'escola';
    $('#form-aviso').reset();
    $('#aviso-publico').value = audience;
    if (notice.curso) $('#aviso-curso').value = notice.curso;
    if (notice.serie) $('#aviso-serie').value = String(notice.serie);
    if (notice.id_turma) $('#aviso-turma').value = String(notice.id_turma);
    updateAudienceFields();
    $('#aviso-titulo').value = notice.titulo;
    $('#aviso-conteudo').value = notice.conteudo;
    $('#aviso-tipo').value = notice.tipo || 'aviso';
    $('#aviso-urgente').checked = Boolean(notice.urgente);
    const date = notice.data_evento || '';
    $('#aviso-data').value = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(date)
        ? date.slice(0, 16).replace(' ', 'T')
        : /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00` : '';
    renderCurrentAttachment();
    setFormLabels();
    focusForm();
}

async function submitNotice(event) {
    event.preventDefault();
    const submit = $('#aviso-enviar');
    const form = $('#form-aviso');
    await G.runFormAction(form, submit, async () => {
        const body = {
            titulo: $('#aviso-titulo').value.trim(),
            conteudo: $('#aviso-conteudo').value.trim(),
            tipo: $('#aviso-tipo').value,
            urgente: $('#aviso-urgente').checked,
            data_evento: $('#aviso-data').value || null,
            ...audienceFromForm()
        };
        const file = $('#aviso-anexo').files[0];
        if (file) {
            if (file.type && file.type !== 'application/pdf') throw G.fieldError($('#aviso-anexo'), 'O anexo deve ser um arquivo PDF.');
            submit.textContent = 'Enviando anexo…';
            const uploaded = await G.uploadFile(file);
            body.id_arquivo = uploaded.id_arquivo;
        } else if (editing && removeAttachment) {
            body.id_arquivo = null;
        }
        if (editing) {
            await G.sendJson(`/api/avisos/${editing.id_post}`, 'PATCH', body);
            G.showSuccess('Comunicado atualizado.');
        } else {
            await G.sendJson('/api/avisos', 'POST', body);
            G.showSuccess(`Comunicado publicado para: ${audienceLabel(body)}.`);
        }
        resetForm();
        await G.loadSource('avisos', { silent: true });
    }, {
        fieldFor: G.fieldByMessage([
            [/anexo|arquivo|PDF/i, $('#aviso-anexo')],
            [/t[ií]tulo/i, $('#aviso-titulo')],
            [/conte[uú]do|texto/i, $('#aviso-conteudo')],
            [/data/i, $('#aviso-data')],
            [/turma/i, $('#aviso-turma')],
            [/curso/i, $('#aviso-curso')],
            [/s[ée]rie/i, $('#aviso-serie')],
            [/tipo/i, $('#aviso-tipo')]
        ])
    });
    setFormLabels();
}

// ---------------------------------------------------------------- lista

function readsBlock(notice) {
    const reads = notice.leituras;
    if (!reads || typeof reads.publico_total !== 'number') return null;
    const total = reads.publico_total;
    const confirmed = Math.min(reads.confirmadas || 0, total || 0);
    const percent = total ? Math.round((confirmed / total) * 100) : 0;
    const bar = el('span', { class: 'barra-progresso', 'aria-hidden': 'true' }, el('span', { class: 'barra-progresso-valor' }));
    bar.firstChild.style.setProperty('--valor', `${percent}%`);
    return el('div', { class: 'leituras' },
        icon('eye'),
        el('span', { text: total
            ? `${confirmed} de ${total} ${total === 1 ? 'leitura confirmada' : 'leituras confirmadas'} (${percent}%)`
            : 'Nenhum aluno no público deste comunicado' }),
        bar);
}

// Cartão no desenho do protótipo (.notice): título, texto, etiquetas e ações pequenas.
function noticeCard(notice) {
    const card = el('article', { class: `aviso${notice.urgente ? ' aviso-urgente' : ''}` });
    card.append(el('h3', { class: 'aviso-titulo', text: notice.titulo }));
    card.append(el('p', { class: 'aviso-texto', text: notice.conteudo }));

    const anexo = attachmentOf(notice);
    if (anexo) card.append(el('div', { class: 'aviso-anexo' }, G.attachmentButton(anexo)));

    card.append(el('div', { class: 'aviso-selos' },
        el('span', { class: 'selo selo-neutro' }, icon('clock'), `Publicado em ${G.formatCreated(notice.criado_em)}`),
        el('span', { class: 'selo selo-neutro' }, icon('users-three'), audienceLabel(notice)),
        notice.data_evento
            ? el('span', { class: 'selo selo-neutro' }, icon('calendar-blank'), `Data: ${formatSchoolDate(notice.data_evento)}`)
            : null,
        badge(G.TYPE_NAMES[notice.tipo] || 'Aviso', 'neutro'),
        notice.urgente ? badge('Urgente', 'alerta') : null));
    const reads = readsBlock(notice);
    if (reads) card.append(reads);

    const actions = el('div', { class: 'acoes' });
    const remove = button([icon('trash'), 'Excluir'], 'botao botao-perigo botao-pequeno', () =>
        G.confirmInline(actions, {
            question: 'Excluir este comunicado de vez?',
            confirmLabel: 'Sim, excluir',
            onConfirm: async () => {
                await G.api(`/api/avisos/${notice.id_post}`, { method: 'DELETE' });
                if (editing?.id_post === notice.id_post) resetForm();
                G.showSuccess(`Comunicado "${notice.titulo}" excluído.`);
                await Promise.all([G.loadSource('avisos', { silent: true }), G.loadSource('salvos', { silent: true })]);
            }
        }));
    actions.append(
        button([icon('pencil-simple'), 'Editar'], 'botao botao-primario botao-pequeno', () => editFromAnySection(notice)),
        G.saveButton?.(notice),
        remove);
    card.append(actions);
    return card;
}

// Editar a partir de "Comunicados urgentes": abre a seção Comunicados com o formulário preenchido.
let pendingEdit = null;
function editFromAnySection(notice) {
    if (G.state.route.section === 'avisos') {
        startEdit(notice);
        return;
    }
    pendingEdit = notice;
    window.location.hash = '#/avisos';
}

function renderNotices() {
    const list = $('#lista-avisos');
    if (!renderStatusInto(list, ['avisos', 'turmas'], 'Carregando comunicados…')) return;
    const notices = sourceData('avisos');
    const query = $('#busca-avisos').value;
    const filtered = notices
        .filter((notice) => matches(query, notice.titulo, notice.conteudo, audienceLabel(notice)))
        .sort((a, b) => b.id_post - a.id_post);
    if (!filtered.length) {
        list.replaceChildren(emptyState(notices.length
            ? 'Nenhum comunicado corresponde à busca.'
            : 'Nenhum comunicado publicado. Os comunicados publicados aparecerão aqui.', 'megaphone-simple'));
        return;
    }
    list.replaceChildren(...filtered.map(noticeCard));
}

function renderUrgent() {
    const list = $('#lista-urgentes');
    if (!renderStatusInto(list, ['avisos', 'turmas'], 'Carregando comunicados…')) return;
    const urgent = sourceData('avisos').filter((notice) => notice.urgente).sort((a, b) => b.id_post - a.id_post);
    list.replaceChildren(...(urgent.length
        ? urgent.map(noticeCard)
        : [emptyState('Nenhum comunicado urgente. Marque “urgente” ao publicar para ele aparecer aqui.', 'warning-circle')]));
}

function fillClassSelect() {
    G.fillSelect($('#aviso-turma'), G.classOptions());
    if (editing?.id_turma) $('#aviso-turma').value = String(editing.id_turma);
}

function setup() {
    $('#aviso-publico').addEventListener('change', updateAudienceFields);
    updateAudienceFields();
    $('#form-aviso').addEventListener('submit', submitNotice);
    $('#aviso-cancelar').addEventListener('click', () => {
        resetForm();
        $('#aviso-titulo').focus();
    });
    $('#busca-avisos').addEventListener('input', renderNotices);
    $('#aviso-anexo').addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file && file.size > G.MAX_ANEXO_BYTES) {
            event.target.value = '';
            window.CwFormulario?.erro(event.target, 'O anexo passa de 5 MB. Escolha um PDF menor.');
        }
    });
    onSource(['avisos', 'turmas', 'salvos'], renderNotices);
    onSource(['avisos', 'turmas', 'salvos'], renderUrgent);
    onSource(['turmas'], fillClassSelect);
}

// show() devolve true quando já levou o foco a um campo (a casca então não foca o título).
G.sections.avisos = {
    title: 'Central de Comunicados',
    description: 'Gerencie as informações e mantenha a comunidade escolar informada.',
    setup,
    show(sub) {
        G.ensureSource('avisos');
        G.ensureSource('salvos');
        if (pendingEdit) {
            const notice = pendingEdit;
            pendingEdit = null;
            startEdit(notice);
            return true;
        }
        if (sub === 'novo') {
            history.replaceState(null, '', '#/avisos');
            startNew();
            return true;
        }
        return false;
    }
};

G.sections.urgentes = {
    title: 'Comunicados urgentes',
    description: 'Os comunicados marcados como urgentes, do mais recente ao mais antigo.',
    show() {
        G.ensureSource('avisos');
        G.ensureSource('salvos');
    }
};
}());
