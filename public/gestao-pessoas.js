// Portal da Gestão — pessoas e estrutura da escola: Alunos (matrícula com e-mail opcional,
// redefinição da senha de primeiro acesso e remoção definitiva), Equipe (professor/gestão com senha provisória),
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
        if (student.login) {
            actions.append(button([icon('trash'), 'Remover'], 'botao botao-texto botao-perigo-texto botao-pequeno',
                () => showStudentRemoval(student, actions, fillActions)));
        }
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

// Remoção DEFINITIVA (DELETE /api/alunos/:id): apaga a conta e todo o histórico. Para confirmar,
// a gestão digita a matrícula do aluno; "Desativar" continua sendo o caminho para só bloquear.
function showStudentRemoval(student, container, restore) {
    const inputId = `remover-matricula-${student.id_aluno}`;
    const input = el('input', {
        id: inputId, type: 'text', inputmode: 'numeric', maxlength: 20, required: true,
        placeholder: 'Digite a matrícula', autocomplete: 'off', spellcheck: 'false', class: 'campo-mini'
    });
    const submit = el('button', {
        type: 'submit', class: 'botao botao-perigo botao-pequeno', disabled: true
    }, [icon('trash'), 'Remover definitivamente']);
    const cancel = () => {
        restore(); // redesenha as ações: o foco volta para o novo botão "Remover"
        container.querySelector('button:last-of-type')?.focus();
    };
    const textId = `remover-texto-${student.id_aluno}`;
    const form = el('form', { class: 'confirmacao confirmacao-remover', 'aria-describedby': textId },
        el('p', { id: textId, class: 'confirmacao-texto' },
            el('strong', { text: `Remover ${student.nome} de vez? ` }),
            'A conta e todo o histórico (frequência, entregas, justificativas, ocorrências e mensagens) serão apagados e não dá para desfazer. Para só bloquear o acesso, use “Desativar”. ',
            `Para confirmar, digite a matrícula ${student.login}.`),
        el('label', { for: inputId, class: 'visually-hidden', text: `Matrícula de ${student.nome} para confirmar a remoção` }),
        input, submit,
        button('Cancelar', 'botao botao-secundario botao-pequeno', cancel));
    input.addEventListener('input', () => { submit.disabled = input.value.trim() !== student.login; });
    form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (input.value.trim() !== student.login) return;
        G.runFormAction(form, submit, async () => {
            await G.api(`/api/alunos/${student.id_aluno}`, { method: 'DELETE' });
            G.showSuccess(`${student.nome} (matrícula ${student.login}) foi removido. A matrícula está livre para um novo cadastro.`);
            await G.loadSources('usuarios', 'alunos', 'painel');
        }, { fieldFor: () => input });
    });
    container.replaceChildren(form);
    input.focus();
}

// "Novo cadastro" no cabeçalho da lista: abre o formulário de matrícula e leva o foco ao 1º campo.
function openEnrollForm() {
    const card = $('#cartao-matricula');
    card.open = true;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    $('#aluno-nome').focus({ preventScroll: true });
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

// Senha provisória em janela modal (protótipo .modal): <dialog> prende o foco e fecha com Esc.
function revealPassword(text, password) {
    $('#senha-revelada-texto').textContent = text;
    $('#senha-revelada-valor').textContent = password;
    const dialog = $('#senha-revelada');
    if (!dialog.open) dialog.showModal();
    $('#senha-revelada-fechar').focus();
}

function hidePassword() {
    const dialog = $('#senha-revelada');
    if (dialog.open) dialog.close();
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
    // Agrupadas por série (1ª, 2ª, 3ª); turmas sem série ficam num grupo final.
    const groups = new Map();
    [...classes].sort((a, b) => (a.serie || 9) - (b.serie || 9)
        || (a.curso || '').localeCompare(b.curso || '')
        || a.nome_turma.localeCompare(b.nome_turma, 'pt-BR'))
        .forEach((item) => {
            const key = G.SERIES_NAMES[item.serie] || 'Outras turmas';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        });
    container.replaceChildren(...[...groups].map(([title, items], index) => {
        const headingId = `turmas-grupo-${index}`;
        const withPassword = items.filter((item) => item.tem_senha === true).length;
        return el('section', { class: 'turmas-serie', 'aria-labelledby': headingId },
            el('div', { class: 'turmas-serie-topo' },
                el('h2', { class: 'titulo-secao', id: headingId, text: title }),
                el('span', { class: 'texto-suave', text: `${withPassword} de ${items.length} com senha da turma` })),
            ...items.map(classCard));
    }));
}

// Usuário da sala (ex.: "1info-a"): vem da API; sem ele, monta pelo mesmo padrão (série+curso-letra).
function classUser(schoolClass) {
    if (schoolClass.usuario) return schoolClass.usuario;
    const letter = /\s([A-Za-z])$/.exec(schoolClass.nome_turma || '')?.[1];
    const course = { informatica: 'info', redes: 'redes' }[schoolClass.curso];
    return letter && course && schoolClass.serie ? `${schoolClass.serie}${course}-${letter.toLowerCase()}` : null;
}

function copyButton(text, label) {
    const copy = button([icon('copy'), 'Copiar'], 'botao botao-texto botao-pequeno', async () => {
        try {
            await navigator.clipboard.writeText(text);
            G.showSuccess(`${label} copiado.`);
        } catch {
            G.showError('Não foi possível copiar. Selecione o texto e copie manualmente.');
        }
    }, { 'aria-label': `Copiar ${label.toLowerCase()} ${text}` });
    return copy;
}

// Senha da turma: a gestão define/troca (mín. 8 caracteres) ou desativa o acesso compartilhado.
// O aluno entra no login com o usuário da sala e a senha da turma.
function classAccess(schoolClass) {
    const hasPassword = schoolClass.tem_senha === true;
    const user = classUser(schoolClass);
    const actions = el('div', { class: 'acoes' });
    const wrapper = el('div', { class: 'turma-acesso' },
        el('div', { class: 'turma-acesso-info' },
            hasPassword ? badge('Com senha', 'ok') : badge('Sem senha', 'neutro'),
            user ? el('span', { class: 'turma-usuario' },
                el('span', { class: 'texto-suave', text: 'Usuário da sala:' }),
                el('code', { text: user }),
                copyButton(user, 'Usuário da sala')) : null,
            el('p', { class: 'texto-suave turma-acesso-ajuda', text: hasPassword
                ? 'O aluno entra no login com o usuário da sala e a senha da turma.'
                : 'Defina a senha da turma para liberar o login com o usuário da sala.' })),
        actions);
    const fillActions = () => {
        actions.replaceChildren(
            button([icon('key'), hasPassword ? 'Trocar senha' : 'Definir senha'], 'botao botao-texto botao-pequeno',
                () => showClassPasswordForm(schoolClass, wrapper, actions, fillActions)));
        if (hasPassword) {
            actions.append(button([icon('prohibit'), 'Desativar acesso'], 'botao botao-texto botao-perigo-texto botao-pequeno', () =>
                G.confirmInline(actions, {
                    question: 'A senha da turma deixa de valer e as sessões abertas são encerradas.',
                    confirmLabel: 'Desativar acesso',
                    onConfirm: async () => {
                        await G.sendJson(`/api/turmas/${schoolClass.id_turma}/senha`, 'DELETE');
                        G.showSuccess(`Acesso da turma ${schoolClass.nome_turma} desativado.`);
                        await G.loadSource('turmas', { silent: true });
                    }
                })));
        }
    };
    fillActions();
    return wrapper;
}

function showClassPasswordForm(schoolClass, wrapper, actions, fillActions) {
    const inputId = `senha-turma-${schoolClass.id_turma}`;
    const helpId = `${inputId}-ajuda`;
    const input = el('input', { id: inputId, type: 'password', minlength: 8, maxlength: 128, required: true,
        autocomplete: 'new-password', 'aria-describedby': helpId });
    const submit = el('button', { type: 'submit', class: 'botao botao-primario botao-pequeno' }, 'Salvar senha');
    const cancel = button('Cancelar', 'botao botao-secundario botao-pequeno', () => {
        form.remove();
        actions.hidden = false;
        fillActions();
        actions.querySelector('button')?.focus();
    });
    const form = el('form', { class: 'form-senha-turma', novalidate: true },
        el('div', { class: 'campo' },
            el('label', { for: inputId, text: schoolClass.tem_senha ? 'Nova senha da turma' : 'Senha da turma' }),
            input,
            el('p', { class: 'texto-suave', id: helpId, text: 'Mínimo de 8 caracteres. Passe a senha só aos alunos da turma.' })),
        el('div', { class: 'linha-botoes' }, submit, cancel));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runFormAction(form, submit, async () => {
            if (input.value.length < 8) throw G.fieldError(input, 'A senha precisa ter pelo menos 8 caracteres.');
            const result = await G.sendJson(`/api/turmas/${schoolClass.id_turma}/senha`, 'PUT', { senha: input.value });
            input.value = '';
            const user = result?.usuario || classUser(schoolClass);
            G.showSuccess(`Senha da turma ${schoolClass.nome_turma} salva${user ? ` (usuário da sala: ${user})` : ''}. As sessões abertas foram encerradas.`);
            await G.loadSource('turmas', { silent: true });
        }, { fieldFor: () => input });
    });
    actions.hidden = true;
    wrapper.append(form);
    input.focus();
}

function classCard(schoolClass) {
    const enrolled = sourceData('alunos').filter((student) => student.id_turma === schoolClass.id_turma).length;
    const frequency = classFrequency(schoolClass.id_turma);
    const meta = el('p', { class: 'texto-suave' },
        [G.SERIES_NAMES[schoolClass.serie], G.COURSE_NAMES[schoolClass.curso], `${enrolled} ${enrolled === 1 ? 'aluno' : 'alunos'}`]
            .filter(Boolean).join(' · '));
    const header = el('div', { class: 'turma-cabecalho' },
        el('div', {}, el('h3', { text: schoolClass.nome_turma }), meta),
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
    return el('section', { class: 'cartao turma', 'aria-label': schoolClass.nome_turma },
        header, classAccess(schoolClass), table, disciplineForm(schoolClass));
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
    description: 'Matricule alunos, redefina a senha de primeiro acesso, desative ou remova contas.',
    setup() {
        $('#form-aluno').addEventListener('submit', enrollStudent);
        $('#botao-novo-aluno').addEventListener('click', openEnrollForm);
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
        $('#senha-revelada').addEventListener('close', hidePassword);
        onSource(['usuarios', 'professores'], renderStaff);
    },
    hide: hidePassword
};

G.sections.turmas = {
    title: 'Turmas',
    description: 'Organize as turmas, defina a senha de cada uma e vincule professores às disciplinas.',
    setup() {
        setupClassForm();
        onSource(['turmas', 'disciplinas', 'professores', 'alunos', 'usuarios', 'painel'], renderClasses);
    }
};
}());
