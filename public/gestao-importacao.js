// Portal da Gestão — importar alunos por planilha (seção Alunos).
// Fluxo: escolher .csv → "Verificar planilha" (POST /api/matriculas/importar?simular=1, nada é
// gravado) → relatório (resumo, erros por linha, prévia) → "Importar N alunos" só sem erros
// (POST sem simular, tudo ou nada). O texto da planilha (que tem o CPF) só fica em memória entre
// verificar e importar; o CPF nunca aparece na tela e o texto é descartado ao terminar.

(function () {
'use strict';

const G = window.CwGestao;
const { $, el, icon, button } = G;

const IMPORT_PATH = '/api/matriculas/importar';
const MAX_CSV_BYTES = 1024 * 1024;
const PREVIEW_LIMIT = 100;
const ERROR_LIMIT = 200;

// Planilha verificada: { file, text } — só enquanto o relatório está na tela.
let checked = null;

function cell(label, ...content) {
    return el('td', { 'data-rotulo': label }, ...content);
}

function plural(count, one, many) {
    return `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`;
}

function unavailableMessage(error) {
    return [404, 501].includes(error.status)
        ? 'A importação por planilha ainda não está disponível neste servidor.'
        : error.message;
}

function sendCsv(text, simulate) {
    return G.api(`${IMPORT_PATH}${simulate ? '?simular=1' : ''}`, {
        method: 'POST',
        body: text,
        headers: { 'Content-Type': 'text/csv; charset=utf-8' }
    });
}

async function readCsv(input) {
    const file = input.files[0];
    if (!file) throw G.fieldError(input, 'Escolha a planilha em .csv.');
    if (!/\.csv$/i.test(file.name)) throw G.fieldError(input, 'A planilha deve estar em .csv. Veja abaixo como salvar.');
    if (file.size > MAX_CSV_BYTES) throw G.fieldError(input, 'A planilha passa de 1 MB. Divida em arquivos menores.');
    if (!file.size) throw G.fieldError(input, 'A planilha está vazia.');
    const text = await file.text();
    // Caractere de substituição = o arquivo não estava em UTF-8 (CSV comum do Excel).
    if (text.includes('\uFFFD')) {
        throw G.fieldError(input, 'A planilha não está em UTF-8. No Excel, salve como "CSV UTF-8 (delimitado por vírgulas)".');
    }
    return { file, text };
}

function clearResult() {
    checked = null;
    $('#importacao-resultado').replaceChildren();
}

async function verify(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const input = $('#importacao-arquivo');
    clearResult();
    await G.runFormAction(form, submit, async () => {
        const csv = await readCsv(input);
        let report;
        try {
            report = await sendCsv(csv.text, true);
        } catch (error) {
            // Relatório devolvido junto do erro (400): mostra mesmo assim.
            if (error.data && Array.isArray(error.data.erros)) report = error.data;
            else throw Object.assign(new Error(unavailableMessage(error)), { status: error.status });
        }
        checked = csv;
        showReport(report);
    }, {
        fieldFor: (error) => (error.status === 413
            || (error.status === 400 && /arquivo|planilha|cabe[çc]alho|colun/i.test(error.message)) ? input : null)
    });
}

function showReport(report) {
    const errors = Array.isArray(report?.erros) ? report.erros : [];
    const students = Array.isArray(report?.alunos) ? report.alunos : [];
    const total = Number(report?.total) || 0;
    const valid = Number(report?.validos) || 0;
    const ready = !errors.length && valid > 0;
    const result = $('#importacao-resultado');

    const heading = el('h3', { class: 'importacao-titulo', tabindex: '-1',
        text: ready ? 'Planilha pronta para importar' : errors.length ? 'Corrija a planilha antes de importar' : 'Nenhum aluno na planilha' });
    const summary = el('ul', { class: 'importacao-resumo', 'aria-label': 'Resumo da verificação' },
        el('li', {}, el('strong', { text: total.toLocaleString('pt-BR') }), el('span', { text: total === 1 ? 'linha' : 'linhas' })),
        el('li', { class: 'ok' }, el('strong', { text: valid.toLocaleString('pt-BR') }), el('span', { text: valid === 1 ? 'válida' : 'válidas' })),
        el('li', { class: errors.length ? 'alerta' : null }, el('strong', { text: errors.length.toLocaleString('pt-BR') }), el('span', { text: errors.length === 1 ? 'erro' : 'erros' })));

    const parts = [heading, summary];
    if (errors.length) {
        parts.push(el('p', { class: 'texto-apoio', text: 'Corrija as linhas abaixo na planilha, salve de novo em CSV e verifique outra vez. Nada foi gravado.' }));
        parts.push(errorsTable(errors));
    }
    if (students.length) parts.push(previewTable(students));

    const importButton = el('button', { type: 'button', class: 'botao botao-primario', disabled: !ready },
        icon('upload-simple'), ready ? `Importar ${plural(valid, 'aluno', 'alunos')}` : 'Importar alunos');
    importButton.addEventListener('click', () => importAll(importButton, valid));
    const actions = el('div', { class: 'linha-botoes' }, importButton,
        button('Escolher outra planilha', 'botao botao-secundario', () => {
            clearResult();
            $('#form-importacao').reset();
            $('#importacao-arquivo').focus();
        }));
    if (!ready) importButton.setAttribute('aria-describedby', 'importacao-bloqueio');
    parts.push(actions);
    if (!ready) {
        parts.push(el('p', { id: 'importacao-bloqueio', class: 'texto-suave nota',
            text: errors.length ? 'A importação só é liberada quando a planilha não tem erros.' : 'Inclua pelo menos um aluno na planilha.' }));
    }
    result.replaceChildren(...parts);
    heading.focus();
}

function errorsTable(errors) {
    const shown = errors.slice(0, ERROR_LIMIT);
    return el('div', {},
        el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region', 'aria-label': 'Erros encontrados na planilha' },
            el('table', { class: 'tabela tabela-cartoes' },
                el('caption', { class: 'visually-hidden', text: `Erros encontrados na planilha (${errors.length})` }),
                el('thead', {}, el('tr', {},
                    el('th', { scope: 'col', text: 'Linha' }),
                    el('th', { scope: 'col', text: 'Campo' }),
                    el('th', { scope: 'col', text: 'Problema' }))),
                el('tbody', {}, shown.map((item) => el('tr', {},
                    cell('Linha', el('strong', { text: item.linha ? `Linha ${item.linha}` : 'Planilha' })),
                    cell('Campo', item.campo || '—'),
                    cell('Problema', item.mensagem || 'Valor inválido.')))))),
        errors.length > shown.length
            ? el('p', { class: 'texto-suave nota', text: `Mostrando os ${shown.length} primeiros de ${errors.length} erros.` })
            : null);
}

function previewTable(students) {
    const shown = students.slice(0, PREVIEW_LIMIT);
    return el('div', {},
        el('h4', { class: 'importacao-subtitulo', text: 'Prévia dos alunos' }),
        el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region', 'aria-label': 'Prévia dos alunos da planilha' },
            el('table', { class: 'tabela tabela-cartoes' },
                el('caption', { class: 'visually-hidden', text: `Prévia dos alunos da planilha (${students.length})` }),
                el('thead', {}, el('tr', {},
                    el('th', { scope: 'col', text: 'Nome' }),
                    el('th', { scope: 'col', text: 'Matrícula' }),
                    el('th', { scope: 'col', text: 'Turma' }),
                    el('th', { scope: 'col', text: 'Linha' }))),
                el('tbody', {}, shown.map((student) => el('tr', {},
                    cell('Nome', el('strong', { text: student.nome || '—' })),
                    cell('Matrícula', student.matricula || '—'),
                    cell('Turma', student.turma || '—'),
                    cell('Linha', student.linha ? String(student.linha) : '—')))))),
        students.length > shown.length
            ? el('p', { class: 'texto-suave nota', text: `Mostrando ${shown.length} de ${students.length} alunos.` })
            : null);
}

async function importAll(trigger, expected) {
    if (!checked) return;
    const csv = checked;
    await G.runAction(trigger, async () => {
        let result;
        try {
            result = await sendCsv(csv.text, false);
        } catch (error) {
            // A planilha mudou de estado no servidor (ex.: matrícula criada no meio): novo relatório.
            if (error.data && Array.isArray(error.data.erros)) {
                showReport(error.data);
                throw new Error('Algumas linhas deixaram de ser válidas. Confira o relatório e verifique de novo.');
            }
            throw new Error(unavailableMessage(error));
        }
        const count = Number(result?.importados ?? expected) || 0;
        checked = null;
        $('#form-importacao').reset();
        const message = `${plural(count, 'aluno importado', 'alunos importados')}. No primeiro acesso, cada um usa a matrícula e ceep@ + os 4 primeiros números do CPF.`;
        const done = el('div', { class: 'importacao-sucesso', role: 'status' },
            icon('check-circle', true), el('p', { text: message }));
        $('#importacao-resultado').replaceChildren(done);
        G.showSuccess(message);
        await G.loadSources('usuarios', 'alunos');
    });
}

G.sections.alunos.setup = ((originalSetup) => function setup() {
    originalSetup?.call(this);
    $('#form-importacao').addEventListener('submit', verify);
    // Trocar o arquivo invalida o relatório anterior.
    $('#importacao-arquivo').addEventListener('change', clearResult);
})(G.sections.alunos.setup);

G.sections.alunos.show = ((originalShow) => function show(sub) {
    if (sub === 'importar') {
        history.replaceState(null, '', '#/alunos');
        $('#cartao-importacao').open = true;
        $('#importacao-arquivo').focus();
        return;
    }
    originalShow?.call(this, sub);
})(G.sections.alunos.show);

// Sair da seção descarta a planilha da memória.
G.sections.alunos.hide = ((originalHide) => function hide() {
    originalHide?.call(this);
    clearResult();
    $('#form-importacao')?.reset();
})(G.sections.alunos.hide);
}());
