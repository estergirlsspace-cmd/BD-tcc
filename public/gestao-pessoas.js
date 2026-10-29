// Portal da Gestão — pessoas e estrutura da escola: Alunos (matrícula com e-mail opcional e
// redefinição da senha de primeiro acesso), Equipe (professor/gestão com senha provisória),
// Turmas e disciplinas (criar e vincular professor) e desativar/reativar contas.

(function () {
'use strict';

const G = window.CwGestao;
const { $, el, icon, button, option, badge, sourceData, onSource, renderStatusInto, emptyState, matches } = G;

function statusBadge(account) {
    if (account.ativo === 0 || account.ativo === false) return badge('Desativado', 'apagado');
    if (account.deve_trocar_senha) return badge('Aguardando 1º acesso', 'pendente');
    return badge('Ativo', 'ok');
}

function dataTable(headers, rows, emptyText, label) {
    if (!rows.length) return emptyState(emptyText, 'users');
    return el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region', 'aria-label': label },
        el('table', { class: 'tabela tabela-cartoes' },
            el('thead', {}, el('tr', {}, headers.map((header) =>
                el('th', { scope: 'col' }, header.hidden ? G.srText(header.label) : header.label)))),
            el('tbody', {}, rows)));
}

function cell(label, ...content) {
    return el('td', { 'data-rotulo': label }, ...content);
}

// ---------------------------------------------------------------- desativar / reativar

// Desativar mantém todo o histórico da pessoa; só impede o acesso ao sistema.
function activeToggle(account, name, container, refreshSource) {
    const save = async (nextActive) => {
        const result = await G.sendJson(`/api/contas/${account.id_usuario}/situacao`, 'POST', { ativo: nextActive });
        await G.loadSource(refreshSource, { silent: true });
        G.showSuccess(`${name}: ${result.mensagem}`);
    };
    if (account.ativo === 0 || account.ativo === false) {
        const reactivate = button([icon('arrow-counter-clockwise'), 'Reativar'], 'botao botao-texto botao-pequeno',
            () => G.runAction(reactivate, () => save(true)));
        return reactivate;
    }
    return button([icon('prohibit'), 'Desativar'], 'botao botao-texto botao-perigo-texto botao-pequeno', () =>
        G.confirmInline(container, {
            question: 'A pessoa não consegue mais entrar. O histórico é mantido.',
            confirmLabel: 'Desativar',
            onConfirm: () => save(false)
        }));
}

// ---------------------------------------------------------------- alunos

function studentRows() {
    const users = sourceData('usuarios');
    return sourceData('alunos').map((student) => {
        const account = users.find((user) => user.id_usuario === student.id_usuario) || {};
        return {
            ...student,
            login: account.login,
            email: account.email,
            ativo: account.ativo,
            deve_trocar_senha: account.deve_trocar_senha
        };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderStudents() {
    const list = $('#lista-alunos');
    const count = $('#contagem-alunos');
    if (!renderStatusInto(list, ['alunos', 'usuarios', 'turmas'], 'Carregando alunos…')) {
        count.textContent = '';
        return;
    }
    const query = $('#busca-alunos').value;
    const classFilter = Number($('#filtro-turma-alunos').value) || null;
    const all = studentRows();
    const rows = all.filter((student) => (!classFilter || student.id_turma === classFilter)
        && matches(query, student.nome, student.login));
    count.textContent = `${rows.length} de ${all.length} ${all.length === 1 ? 'aluno' : 'alunos'}`;
    list.replaceChildren(dataTable(
        [{ label: 'Nome' }, { label: 'Matrícula' }, { label: 'Turma' }, { label: 'Situação' }, { label: 'Ações', hidden: true }],
        rows.map(studentRow),
        all.length ? 'Nenhum aluno corresponde à busca.' : 'Nenhum aluno matriculado ainda.',
        'Tabela de alunos'));
}

function studentRow(student) {
    const actions = el('div', { class: 'acoes' });
    const fillActions = () => {
        actions.replaceChildren();
        if (student.ativo !== 0) {
            actions.append(button([icon('key'), 'Redefinir senha'], 'botao botao-texto botao-pequeno',
                () => showStudentReset(student, actions, fillActions)));
        }
        actions.append(activeToggle(student, student.nome, actions, 'usuarios'));
    };
    fillActions();
    return el('tr', {},
        cell('Nome', el('strong', { text: student.nome }), student.email ? el('small', { class: 'texto-suave bloco', text: student.email }) : null),
        cell('Matrícula', student.login || '—'),
        cell('Turma', G.className(student.id_turma)),
        cell('Situação', statusBadge(student)),
        cell('Ações', actions));
}

function showStudentReset(student, container, restore) {
    const inputId = `reset-cpf-${student.id_aluno}`;
    const input = el('input', {
        id: inputId, type: 'text', inputmode: 'numeric', maxlength: 4, pattern: '[0-9]{4}', required: true,
        placeholder: '4 dígitos do CPF', autocomplete: 'off', class: 'campo-mini'
    });
    const submit = el('button', { type: 'submit', class: 'botao botao-primario botao-pequeno', text: 'Confirmar' });
    const form = el('form', { class: 'confirmacao' },
        el('label', { for: inputId, class: 'visually-hidden', text: `4 primeiros números do CPF de ${student.nome}` }),
        input, submit,
        button('Cancelar', 'botao botao-secundario botao-pequeno', restore));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runFormAction(form, submit, async () => {
            const result = await G.sendJson(`/api/matriculas/${student.id_aluno}/senha`, 'POST',
                { cpf_inicio: input.value.trim() });
            await G.loadSource('usuarios', { silent: true });
            G.showSuccess(`${student.nome}: ${result.mensagem}`);
        }, { fieldFor: () => input });
    });
    container.replaceChildren(form);
    input.focus();
}

async function enrollStudent(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    await G.runFormAction(form, submit, async () => {
        const body = {
            nome: $('#aluno-nome').value.trim(),
            matricula: $('#aluno-matricula').value.trim(),
            id_turma: Number($('#aluno-turma').value),
            cpf_inicio: $('#aluno-cpf').value.trim()
        };
        const email = $('#aluno-email').value.trim();
        if (email) body.email = email;
        const result = await G.sendJson('/api/matriculas', 'POST', body);
        form.reset();
        G.showSuccess(`Matrícula de ${result.nome} feita em ${result.nome_turma}. No primeiro acesso, use a matrícula ${result.matricula} e ceep@ + 4 primeiros números do CPF.${pendingEmailNote(result)}`);
        await G.loadSources('usuarios', 'alunos');
    }, {
        fieldFor: G.fieldByMessage([
            [/e-mail/i, $('#aluno-email')],
            [/matr[ií]cula/i, $('#aluno-matricula')],
            [/cpf/i, $('#aluno-cpf')],
            [/turma/i, $('#aluno-turma')],
            [/nome/i, $('#aluno-nome')]
        ])
    });
}

// O e-mail informado pela gestão só passa a valer depois que a própria pessoa confirmar.
function pendingEmailNote(result) {
    return result.email_pendente
        ? ` Enviamos um link de confirmação para ${result.email_pendente}; o e-mail só passa a valer depois que a pessoa confirmar.`
        : '';
}

// ---------------------------------------------------------------- equipe

function revealPassword(text, password) {
    $('#senha-revelada-texto').textContent = text;
    $('#senha-revelada-valor').textContent = password;
    const box = $('#senha-revelada');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#senha-revelada-fechar').focus();
}

function hidePassword() {
    $('#senha-revelada').hidden = true;
    $('#senha-revelada-valor').textContent = '';
    $('#senha-revelada-texto').textContent = '';
}

async function createStaff(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    await G.runFormAction(form, submit, async () => {
        const type = $('#equipe-perfil').value;
        const body = {
            nome: $('#equipe-nome').value.trim(),
            login: $('#equipe-login').value.trim(),
            tipo_usuario: type
        };
        if (type === 'professor') body.area = $('#equipe-area').value;
        const email = $('#equipe-email').value.trim();
        if (email) body.email = email;
        const result = await G.sendJson('/api/equipe', 'POST', body);
        form.reset();
        $('#campo-equipe-area').hidden = false;
        revealPassword(`${result.nome} pode entrar com o usuário "${result.login}" e esta senha provisória:`,
            result.senha_provisoria);
        if (result.email_pendente) G.showSuccess(pendingEmailNote(result).trim());
        await G.loadSources('usuarios', 'professores');
    }, {
        fieldFor: G.fieldByMessage([
            [/e-mail/i, $('#equipe-email')],
            [/login|usu[aá]rio/i, $('#equipe-login')],
            [/[aá]rea/i, $('#equipe-area')],
            [/nome/i, $('#equipe-nome')]
        ])
    });
}

function staffRows() {
    const teachers = sourceData('professores');
    return sourceData('usuarios')
        .filter((user) => ['professor', 'gestao'].includes(user.tipo_usuario))
        .map((user) => {
            const teacher = teachers.find((item) => item.id_usuario === user.id_usuario);
            return { ...user, nome: teacher?.nome || user.nome || user.login, area: teacher?.area };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderStaff() {
    const list = $('#lista-equipe');
    if (!renderStatusInto(list, ['usuarios', 'professores'], 'Carregando equipe…')) return;
    list.replaceChildren(dataTable(
        [{ label: 'Nome' }, { label: 'Usuário' }, { label: 'Perfil' }, { label: 'Situação' }, { label: 'Ações', hidden: true }],
        staffRows().map(staffRow),
        'Nenhum membro da equipe cadastrado.',
        'Tabela da equipe'));
}

function staffRow(member) {
    const actions = el('div', { class: 'acoes' });
    const fillActions = () => {
        actions.replaceChildren();
        if (member.id_usuario === G.state.user.id_usuario) {
            actions.append(badge('Você', 'neutro'));
            return;
        }
        if (member.ativo !== 0) {
            actions.append(button([icon('key'), 'Gerar nova senha'], 'botao botao-texto botao-pequeno', () =>
                G.confirmInline(actions, {
                    question: 'A senha atual deixa de valer.',
                    confirmLabel: 'Gerar',
                    onCancel: fillActions,
                    onConfirm: async () => {
                        const result = await G.sendJson(`/api/equipe/${member.id_usuario}/senha`, 'POST', {});
                        await G.loadSource('usuarios', { silent: true });
                        revealPassword(`Nova senha provisória de ${member.nome} (usuário "${member.login}"):`,
                            result.senha_provisoria);
                    }
                })));
        }
        actions.append(activeToggle(member, member.nome, actions, 'usuarios'));
    };
    fillActions();
    const profile = member.tipo_usuario === 'gestao'
        ? 'Gestão'
        : `Professor${member.area ? ` · ${G.AREA_NAMES[member.area] || member.area}` : ''}`;
    return el('tr', {},
        cell('Nome', el('strong', { text: member.nome }), member.email ? el('small', { class: 'texto-suave bloco', text: member.email }) : null),
        cell('Usuário', member.login),
        cell('Perfil', profile),
        cell('Situação', statusBadge(member)),
        cell('Ações', actions));
}

// ---------------------------------------------------------------- turmas e disciplinas

function teacherSelect(selectedId) {
    const users = sourceData('usuarios');
    const select = el('select', {}, option('', 'Sem professor'));
    sourceData('professores')
        .map((teacher) => ({
            ...teacher,
            label: teacher.nome || users.find((user) => user.id_usuario === teacher.id_usuario)?.login
                || `Professor ${teacher.id_professor}`
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
        .forEach((teacher) => select.append(option(teacher.id_professor, teacher.label)));
    select.value = selectedId ? String(selectedId) : '';
    return select;
}

function classFrequency(classId) {
    const panel = G.source('painel').data;
    const list = panel?.frequencia_por_turma || panel?.turmas || [];
    const item = Array.isArray(list) ? list.find((entry) => entry.id_turma === classId) : null;
    return item ? (item.frequencia ?? item.frequencia_media ?? null) : null;
}

function renderClasses() {
    const container = $('#lista-turmas');
    if (!renderStatusInto(container, ['turmas', 'disciplinas', 'professores', 'alunos'], 'Carregando turmas…')) return;
    const classes = G.sortedClasses();
    if (!classes.length) {
        container.replaceChildren(emptyState('Nenhuma turma cadastrada ainda.', 'users-three'));
        return;
    }
    container.replaceChildren(...classes.map(classCard));
}

function classCard(schoolClass) {
    const enrolled = sourceData('alunos').filter((student) => student.id_turma === schoolClass.id_turma).length;
    const frequency = classFrequency(schoolClass.id_turma);
    const meta = el('p', { class: 'texto-suave' },
        [G.SERIES_NAMES[schoolClass.serie], G.COURSE_NAMES[schoolClass.curso], `${enrolled} ${enrolled === 1 ? 'aluno' : 'alunos'}`]
            .filter(Boolean).join(' · '));
    const header = el('div', { class: 'turma-cabecalho' },
        el('div', {}, el('h2', { text: schoolClass.nome_turma }), meta),
        frequency !== null
            ? el('span', { class: `turma-frequencia${frequency < G.FREQUENCIA_MINIMA ? ' alerta' : ''}` },
                el('strong', { text: G.formatPercent(frequency) }), el('small', { text: 'frequência' }))
            : null);

    const disciplines = sourceData('disciplinas')
        .filter((item) => item.id_turma === schoolClass.id_turma)
        .sort((a, b) => a.nome_disciplina.localeCompare(b.nome_disciplina, 'pt-BR'));
    const rows = disciplines.map((discipline) => {
        const select = teacherSelect(discipline.id_professor);
        select.setAttribute('aria-label', `Professor de ${discipline.nome_disciplina}`);
        select.addEventListener('change', async () => {
            const next = select.value ? Number(select.value) : null;
            const ok = await G.runAction(select, async () => {
                await G.sendJson(`/api/disciplinas/${discipline.id_disciplina}`, 'PATCH', { id_professor: next });
                return true;
            });
            if (ok) {
                discipline.id_professor = next;
                G.showSuccess(`Professor de ${discipline.nome_disciplina} (${schoolClass.nome_turma}) atualizado.`);
            } else {
                select.value = discipline.id_professor ? String(discipline.id_professor) : '';
            }
        });
        return el('tr', {}, cell('Disciplina', discipline.nome_disciplina), cell('Professor', select));
    });
    const table = disciplines.length
        ? el('div', { class: 'tabela-rolagem', tabindex: '0', role: 'region',
            'aria-label': `Disciplinas de ${schoolClass.nome_turma}` },
            el('table', { class: 'tabela tabela-cartoes' },
                el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: 'Disciplina' }), el('th', { scope: 'col', text: 'Professor' }))),
                el('tbody', {}, rows)))
        : emptyState('Nenhuma disciplina nesta turma.', 'books');
    return el('section', { class: 'cartao turma' }, header, table, disciplineForm(schoolClass));
}

function disciplineForm(schoolClass) {
    const nameId = `nova-disciplina-${schoolClass.id_turma}`;
    const teacherId = `novo-professor-${schoolClass.id_turma}`;
    const nameInput = el('input', { id: nameId, type: 'text', maxlength: 100, required: true, placeholder: 'Ex.: Banco de Dados' });
    const select = teacherSelect(null);
    select.id = teacherId;
    const submit = el('button', { type: 'submit', class: 'botao botao-secundario' }, icon('plus'), 'Adicionar disciplina');
    const form = el('form', { class: 'form-disciplina' },
        el('div', { class: 'campo' }, el('label', { for: nameId, text: 'Nova disciplina' }), nameInput),
        el('div', { class: 'campo' }, el('label', { for: teacherId, text: 'Professor' }), select),
        submit);
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runFormAction(form, submit, async () => {
            await G.sendJson('/api/disciplinas', 'POST', {
                id_turma: schoolClass.id_turma,
                nome_disciplina: nameInput.value.trim(),
                ...(select.value ? { id_professor: Number(select.value) } : {})
            });
            G.showSuccess(`Disciplina adicionada a ${schoolClass.nome_turma}.`);
            await G.loadSource('disciplinas', { silent: true });
        }, { fieldFor: G.fieldByMessage([[/professor/i, select], [/./, nameInput]]) });
    });
    return form;
}

function setupClassForm() {
    const course = $('#turma-curso');
    const series = $('#turma-serie');
    const name = $('#turma-nome');
    const suggest = () => {
        if (!name.dataset.editado) {
            name.value = `${G.SERIES_NAMES[series.value]} — ${course.value === 'redes' ? 'Redes' : 'Informática'}`;
        }
    };
    name.addEventListener('input', () => { name.dataset.editado = 'true'; });
    course.addEventListener('change', suggest);
    series.addEventListener('change', suggest);
    suggest();
    $('#form-turma').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        G.runFormAction(form, submit, async () => {
            try {
                const created = await G.sendJson('/api/turmas', 'POST', {
                    nome_turma: name.value.trim(),
                    curso: course.value,
                    serie: Number(series.value)
                });
                delete name.dataset.editado;
                suggest();
                G.showSuccess(`Turma "${created.nome_turma}" criada.`);
            } catch (error) {
                throw new Error(error.message.includes('UNIQUE') ? 'Já existe uma turma com esse nome.' : error.message);
            }
            await G.loadSource('turmas', { silent: true });
        }, { fieldFor: G.fieldByMessage([[/curso/i, course], [/s[ée]rie/i, series], [/./, name]]) });
    });
}

function fillClassSelects() {
    G.fillSelect($('#aluno-turma'), G.classOptions('Selecione a turma'));
    G.fillSelect($('#filtro-turma-alunos'), G.classOptions('Todas as turmas'));
}

// ---------------------------------------------------------------- registro das seções

G.sections.alunos = {
    title: 'Alunos',
    description: 'Matricule alunos, redefina a senha de primeiro acesso e desative contas.',
    setup() {
        $('#form-aluno').addEventListener('submit', enrollStudent);
        $('#busca-alunos').addEventListener('input', renderStudents);
        $('#filtro-turma-alunos').addEventListener('change', renderStudents);
        onSource(['alunos', 'usuarios', 'turmas'], renderStudents);
        onSource(['turmas'], fillClassSelects);
    },
    show(sub) {
        if (sub === 'novo') {
            history.replaceState(null, '', '#/alunos');
            $('#cartao-matricula').open = true;
            $('#aluno-nome').focus();
        }
    }
};

G.sections.equipe = {
    title: 'Equipe',
    description: 'Cadastre professores e membros da gestão, gere novas senhas e desative contas.',
    setup() {
        const type = $('#equipe-perfil');
        type.addEventListener('change', () => { $('#campo-equipe-area').hidden = type.value !== 'professor'; });
        $('#form-equipe').addEventListener('submit', createStaff);
        $('#senha-revelada-fechar').addEventListener('click', hidePassword);
        onSource(['usuarios', 'professores'], renderStaff);
    },
    hide: hidePassword
};

G.sections.turmas = {
    title: 'Turmas',
    description: 'Organize as turmas e vincule professores às disciplinas.',
    setup() {
        setupClassForm();
        onSource(['turmas', 'disciplinas', 'professores', 'alunos', 'usuarios', 'painel'], renderClasses);
    }
};
}());
