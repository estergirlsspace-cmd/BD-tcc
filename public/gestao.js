const token = sessionStorage.getItem('cwarning-token');
const seriesNames = { 1: '1ª Série', 2: '2ª Série', 3: '3ª Série' };
const courseNames = { redes: 'Redes de Computadores', informatica: 'Informática' };
const typeNames = {
    aviso: 'Aviso',
    comunicado: 'Comunicado',
    evento: 'Evento',
    atividade: 'Atividade',
    avaliacao: 'Avaliação'
};
const areaNames = {
    natureza: 'Natureza',
    humanas: 'Humanas',
    linguagens: 'Linguagens',
    matematica: 'Matemática',
    informatica: 'Base Técnica - Informática',
    redes: 'Base Técnica - Redes'
};
const pageDetails = {
    comunicados: ['Comunicados', 'Publique avisos para a escola toda, um curso, uma série ou uma turma.'],
    alunos: ['Alunos', 'Matricule alunos e redefina a senha de primeiro acesso.'],
    equipe: ['Equipe', 'Cadastre professores e membros da gestão.'],
    turmas: ['Turmas e disciplinas', 'Organize as turmas e vincule professores às disciplinas.'],
    conta: ['Minha conta', 'Altere a sua senha de acesso.']
};

let currentUser;
let classes = [];
let disciplines = [];
let notices = [];
let users = [];
let students = [];
let teachers = [];
let editingNoticeId = null;

if (!token) {
    window.location.replace('/');
} else {
    initializePortal().catch((error) => showError(error.message));
}

async function api(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            Authorization: `Bearer ${token}`,
            ...options.headers
        }
    });
    const text = await response.text();
    let result = null;
    if (text) {
        try {
            result = JSON.parse(text);
        } catch {
            throw new Error('O servidor retornou uma resposta inválida.');
        }
    }
    if (response.status === 401) {
        sessionStorage.removeItem('cwarning-token');
        window.location.replace('/');
        throw new Error('Sua sessão expirou. Entre novamente.');
    }
    if (!response.ok) throw new Error(result?.erro || 'Não foi possível concluir a solicitação.');
    return result;
}

async function initializePortal() {
    currentUser = await api('/api/me');
    if (currentUser.tipo_usuario !== 'gestao' || currentUser.deve_trocar_senha) {
        sessionStorage.removeItem('cwarning-token');
        window.location.replace('/');
        return;
    }
    const displayName = currentUser.nome || currentUser.login;
    document.querySelector('#manager-name').textContent = displayName;
    document.querySelector('#manager-login').textContent = `Gestão · ${currentUser.login}`;
    document.querySelector('#manager-avatar').textContent = displayName.charAt(0).toUpperCase();

    setupNavigation();
    setupNoticeForm();
    setupStudents();
    setupStaff();
    setupClasses();
    setupPasswordForm();
    document.querySelectorAll('#logout-button, [data-logout]')
        .forEach((logoutButton) => logoutButton.addEventListener('click', logout));

    await reloadAll();
}

async function reloadAll() {
    [classes, disciplines, notices, users, students, teachers] = await Promise.all([
        api('/api/turmas'),
        api('/api/disciplinas'),
        api('/api/avisos'),
        api('/api/usuarios'),
        api('/api/alunos'),
        api('/api/professores')
    ]);
    classes.sort((a, b) => (a.curso || '').localeCompare(b.curso || '')
        || (a.serie || 0) - (b.serie || 0)
        || a.nome_turma.localeCompare(b.nome_turma, 'pt-BR'));
    fillClassSelects();
    renderNotices();
    renderStudents();
    renderStaff();
    renderClasses();
}

/* ---------- Mensagens e navegação ---------- */

function showError(text) {
    notify(text, 'erro');
}

function showSuccess(text) {
    notify(text, 'sucesso');
}

function clearStatus() {
    clearErrorNotifications();
}

function setupNavigation() {
    document.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => openPage(button.dataset.page));
    });
}

function openPage(pageName) {
    const details = pageDetails[pageName];
    if (!details) return;
    clearStatus();
    document.querySelectorAll('[data-page]').forEach((button) => {
        const active = button.dataset.page === pageName;
        button.classList.toggle('active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('.tab-content').forEach((section) => {
        const active = section.id === `page-${pageName}`;
        section.classList.toggle('active', active);
        section.hidden = !active;
    });
    document.querySelector('#topbar-title').textContent = details[0];
    document.querySelector('#topbar-description').textContent = details[1];
    document.title = `${details[0]} | Portal da Gestão`;
}

/* ---------- Utilitários ---------- */

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(text, className, onClick) {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

function option(value, text) {
    const node = document.createElement('option');
    node.value = String(value);
    node.textContent = text;
    return node;
}

function emptyRow(columns, text) {
    const row = document.createElement('tr');
    const cell = element('td', 'empty-state', text);
    cell.colSpan = columns;
    row.append(cell);
    return row;
}

function className(classId) {
    return classes.find((item) => item.id_turma === classId)?.nome_turma || 'Sem turma';
}

function fillClassSelects() {
    const noticeClass = document.querySelector('#notice-class');
    const studentClass = document.querySelector('#student-class');
    const filter = document.querySelector('#student-class-filter');
    const previousFilter = filter.value;
    noticeClass.replaceChildren(...classes.map((item) => option(item.id_turma, item.nome_turma)));
    studentClass.replaceChildren(option('', 'Selecione a turma'),
        ...classes.map((item) => option(item.id_turma, item.nome_turma)));
    filter.replaceChildren(option('', 'Todas as turmas'),
        ...classes.map((item) => option(item.id_turma, item.nome_turma)));
    filter.value = previousFilter;
}

/* ---------- Comunicados ---------- */

function setupNoticeForm() {
    const audience = document.querySelector('#notice-audience');
    audience.addEventListener('change', updateAudienceFields);
    updateAudienceFields();
    document.querySelector('#notice-form').addEventListener('submit', submitNotice);
    document.querySelector('#notice-cancel-edit').addEventListener('click', resetNoticeForm);
    document.querySelector('#notice-search').addEventListener('input', renderNotices);
}

function updateAudienceFields() {
    const audience = document.querySelector('#notice-audience').value;
    document.querySelector('#audience-course-field').hidden = !['curso', 'curso-serie'].includes(audience);
    document.querySelector('#audience-series-field').hidden = audience !== 'curso-serie';
    document.querySelector('#audience-class-field').hidden = audience !== 'turma';
}

function audienceFromForm() {
    const audience = document.querySelector('#notice-audience').value;
    const target = { id_turma: null, curso: null, serie: null };
    if (audience === 'curso' || audience === 'curso-serie') {
        target.curso = document.querySelector('#notice-course').value;
    }
    if (audience === 'curso-serie') {
        target.serie = Number(document.querySelector('#notice-series').value);
    }
    if (audience === 'turma') {
        const classId = Number(document.querySelector('#notice-class').value);
        if (!classId) throw new Error('Cadastre uma turma antes de publicar para uma turma.');
        target.id_turma = classId;
    }
    return target;
}

function audienceLabel(notice) {
    if (notice.id_turma) return `Turma: ${className(notice.id_turma)}`;
    if (notice.curso && notice.serie) {
        return `${seriesNames[notice.serie]} — ${courseNames[notice.curso]}`;
    }
    if (notice.curso) return `Todas as séries de ${courseNames[notice.curso]}`;
    if (notice.serie) return `${seriesNames[notice.serie]} de todos os cursos`;
    return 'Escola toda';
}

async function submitNotice(event) {
    event.preventDefault();
    clearStatus();
    const submit = document.querySelector('#notice-submit');
    submit.disabled = true;
    try {
        const date = document.querySelector('#notice-date').value;
        const body = {
            titulo: document.querySelector('#notice-title').value.trim(),
            conteudo: document.querySelector('#notice-content').value.trim(),
            tipo: document.querySelector('#notice-type').value,
            data_evento: date || null,
            ...audienceFromForm()
        };
        if (editingNoticeId) {
            await api(`/api/avisos/${editingNoticeId}`, { method: 'PATCH', body: JSON.stringify(body) });
            showSuccess('Comunicado atualizado.');
        } else {
            await api('/api/avisos', { method: 'POST', body: JSON.stringify(body) });
            showSuccess(`Comunicado publicado para: ${audienceLabel(body)}.`);
        }
        resetNoticeForm();
        notices = await api('/api/avisos');
        renderNotices();
    } catch (error) {
        showError(error.message);
    } finally {
        submit.disabled = false;
    }
}

function resetNoticeForm() {
    editingNoticeId = null;
    document.querySelector('#notice-form').reset();
    updateAudienceFields();
    document.querySelector('#notice-form-title').textContent = 'Novo comunicado';
    document.querySelector('#notice-submit').textContent = 'Publicar comunicado';
    document.querySelector('#notice-cancel-edit').hidden = true;
}

function startEditNotice(notice) {
    editingNoticeId = notice.id_post;
    const audience = notice.id_turma ? 'turma'
        : notice.curso && notice.serie ? 'curso-serie'
            : notice.curso ? 'curso' : 'escola';
    document.querySelector('#notice-audience').value = audience;
    if (notice.curso) document.querySelector('#notice-course').value = notice.curso;
    if (notice.serie) document.querySelector('#notice-series').value = String(notice.serie);
    if (notice.id_turma) document.querySelector('#notice-class').value = String(notice.id_turma);
    updateAudienceFields();
    document.querySelector('#notice-title').value = notice.titulo;
    document.querySelector('#notice-content').value = notice.conteudo;
    document.querySelector('#notice-type').value = notice.tipo || 'aviso';
    document.querySelector('#notice-date').value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(notice.data_evento || '')
        ? notice.data_evento.slice(0, 16)
        : /^\d{4}-\d{2}-\d{2}$/.test(notice.data_evento || '') ? `${notice.data_evento}T00:00` : '';
    document.querySelector('#notice-form-title').textContent = 'Editar comunicado';
    document.querySelector('#notice-submit').textContent = 'Salvar alterações';
    document.querySelector('#notice-cancel-edit').hidden = false;
    document.querySelector('#notice-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelector('#notice-title').focus();
}

function renderNotices() {
    const list = document.querySelector('#notice-list');
    const query = document.querySelector('#notice-search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = notices
        .filter((notice) => !query || [notice.titulo, notice.conteudo, audienceLabel(notice)]
            .some((text) => (text || '').toLocaleLowerCase('pt-BR').includes(query)))
        .sort((a, b) => b.id_post - a.id_post);
    if (!filtered.length) {
        list.replaceChildren(element('p', 'empty-state', notices.length
            ? 'Nenhum comunicado corresponde à busca.'
            : 'Nenhum comunicado publicado ainda.'));
        return;
    }
    list.replaceChildren(...filtered.map(buildNoticeCard));
}

function buildNoticeCard(notice) {
    const card = element('article', 'notice-card');
    card.dataset.type = notice.tipo || 'aviso';

    const top = element('div', 'notice-topline');
    top.append(element('span', 'notice-type', typeNames[notice.tipo] || 'Aviso'));
    top.append(element('span', 'notice-date', `Publicado em ${formatSchoolDate(notice.criado_em, { utc: true })}`));
    card.append(top);

    card.append(element('h3', '', notice.titulo));
    card.append(element('p', '', notice.conteudo));

    const footer = element('div', 'notice-footer');
    const info = element('span', 'notice-audience', audienceLabel(notice));
    if (notice.data_evento) info.textContent += ` · Data: ${formatSchoolDate(notice.data_evento)}`;
    footer.append(info);

    const actions = element('div', 'card-actions');
    actions.append(button('Editar', 'small-button', () => startEditNotice(notice)));
    const remove = button('Excluir', 'small-button danger', () => confirmDeleteNotice(notice, actions, remove));
    actions.append(remove);
    footer.append(actions);
    card.append(footer);
    return card;
}

function confirmDeleteNotice(notice, actions, removeButton) {
    removeButton.hidden = true;
    const confirmBox = element('span', 'inline-form');
    confirmBox.append(element('span', 'hint', 'Excluir de vez?'));
    confirmBox.append(button('Sim, excluir', 'small-button danger', async () => {
        try {
            await api(`/api/avisos/${notice.id_post}`, { method: 'DELETE' });
            notices = notices.filter((item) => item.id_post !== notice.id_post);
            if (editingNoticeId === notice.id_post) resetNoticeForm();
            renderNotices();
            showSuccess(`Comunicado "${notice.titulo}" excluído.`);
        } catch (error) {
            showError(error.message);
        }
    }));
    confirmBox.append(button('Cancelar', 'small-button', () => {
        confirmBox.remove();
        removeButton.hidden = false;
    }));
    actions.append(confirmBox);
}

/* ---------- Alunos ---------- */

function setupStudents() {
    document.querySelector('#student-form').addEventListener('submit', enrollStudent);
    document.querySelector('#student-search').addEventListener('input', renderStudents);
    document.querySelector('#student-class-filter').addEventListener('change', renderStudents);
}

async function enrollStudent(event) {
    event.preventDefault();
    clearStatus();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const result = await api('/api/matriculas', {
            method: 'POST',
            body: JSON.stringify({
                nome: document.querySelector('#student-name').value.trim(),
                matricula: document.querySelector('#student-matricula').value.trim(),
                id_turma: Number(document.querySelector('#student-class').value),
                cpf_inicio: document.querySelector('#student-cpf').value.trim()
            })
        });
        form.reset();
        showSuccess(`${result.nome} matriculado(a) em ${result.nome_turma}. No primeiro acesso, use a matrícula ${result.matricula} e ceep@ + 4 primeiros números do CPF.`);
        [users, students] = await Promise.all([api('/api/usuarios'), api('/api/alunos')]);
        renderStudents();
        renderClasses();
    } catch (error) {
        showError(error.message);
    } finally {
        submit.disabled = false;
    }
}

function studentRows() {
    return students.map((student) => {
        const account = users.find((user) => user.id_usuario === student.id_usuario) || {};
        return { ...student, login: account.login, ativo: account.ativo, deve_trocar_senha: account.deve_trocar_senha };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function statusBadge(account) {
    if (account.ativo === 0) return element('span', 'badge badge-off', 'Desativado');
    if (account.deve_trocar_senha) return element('span', 'badge badge-pending', 'Aguardando 1º acesso');
    return element('span', 'badge badge-ok', 'Ativo');
}

function renderStudents() {
    const list = document.querySelector('#student-list');
    const query = document.querySelector('#student-search').value.trim().toLocaleLowerCase('pt-BR');
    const classFilter = Number(document.querySelector('#student-class-filter').value) || null;
    const rows = studentRows().filter((student) => (!classFilter || student.id_turma === classFilter)
        && (!query || student.nome.toLocaleLowerCase('pt-BR').includes(query)
            || (student.login || '').includes(query)));
    document.querySelector('#student-count').textContent = `${rows.length} aluno(s)`;
    if (!rows.length) {
        list.replaceChildren(emptyRow(5, students.length
            ? 'Nenhum aluno corresponde à busca.'
            : 'Nenhum aluno matriculado ainda.'));
        return;
    }
    list.replaceChildren(...rows.map((student) => {
        const row = document.createElement('tr');
        row.append(element('td', '', student.nome));
        row.append(element('td', '', student.login || '—'));
        row.append(element('td', '', className(student.id_turma)));
        const status = document.createElement('td');
        status.append(statusBadge(student));
        row.append(status);
        const actions = document.createElement('td');
        if (student.ativo !== 0) {
            actions.append(button('Redefinir senha', 'small-button', () => showStudentReset(student, actions)));
        }
        actions.append(activeToggle(student, student.nome, actions, async () => {
            users = await api('/api/usuarios');
            renderStudents();
        }));
        row.append(actions);
        return row;
    }));
}

function showStudentReset(student, cell) {
    const form = element('form', 'inline-form');
    const label = element('label', 'visually-hidden', `4 primeiros números do CPF de ${student.nome}`);
    const input = document.createElement('input');
    input.id = `reset-cpf-${student.id_aluno}`;
    label.htmlFor = input.id;
    Object.assign(input, {
        type: 'text', inputMode: 'numeric', maxLength: 4, pattern: '[0-9]{4}', required: true,
        placeholder: '4 dígitos do CPF', autocomplete: 'off'
    });
    const submit = element('button', 'small-button', 'Confirmar');
    submit.type = 'submit';
    form.append(label, input, submit, button('Cancelar', 'small-button', () => renderStudents()));
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            const result = await api(`/api/matriculas/${student.id_aluno}/senha`, {
                method: 'POST',
                body: JSON.stringify({ cpf_inicio: input.value.trim() })
            });
            users = await api('/api/usuarios');
            renderStudents();
            showSuccess(`${student.nome}: ${result.mensagem}`);
        } catch (error) {
            showError(error.message);
        }
    });
    cell.replaceChildren(form);
    input.focus();
}

/* ---------- Desativar / reativar contas ---------- */

// Desativar mantém todo o histórico da pessoa; só impede o acesso ao sistema.
function activeToggle(account, name, cell, refresh) {
    const active = account.ativo !== 0;
    const save = async (nextActive) => {
        try {
            const result = await api(`/api/contas/${account.id_usuario}/situacao`, {
                method: 'POST',
                body: JSON.stringify({ ativo: nextActive })
            });
            await refresh();
            showSuccess(`${name}: ${result.mensagem}`);
        } catch (error) {
            showError(error.message);
        }
    };
    if (!active) return button('Reativar', 'small-button', () => save(true));
    return button('Desativar', 'small-button danger', () => {
        const box = element('span', 'inline-form');
        box.append(element('span', 'hint', 'A pessoa não consegue mais entrar. O histórico é mantido.'));
        box.append(button('Confirmar', 'small-button danger', () => save(false)));
        box.append(button('Cancelar', 'small-button', () => refresh()));
        cell.replaceChildren(box);
    });
}

/* ---------- Equipe ---------- */

function setupStaff() {
    const type = document.querySelector('#staff-type');
    type.addEventListener('change', () => {
        document.querySelector('#staff-area-field').hidden = type.value !== 'professor';
    });
    document.querySelector('#staff-form').addEventListener('submit', createStaff);
    document.querySelector('#password-reveal-close').addEventListener('click', () => {
        document.querySelector('#password-reveal').hidden = true;
        document.querySelector('#password-reveal-value').textContent = '';
    });
}

function revealPassword(text, password) {
    document.querySelector('#password-reveal-text').textContent = text;
    document.querySelector('#password-reveal-value').textContent = password;
    const box = document.querySelector('#password-reveal');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.querySelector('#password-reveal-close').focus();
}

async function createStaff(event) {
    event.preventDefault();
    clearStatus();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
        const type = document.querySelector('#staff-type').value;
        const body = {
            nome: document.querySelector('#staff-name').value.trim(),
            login: document.querySelector('#staff-login').value.trim(),
            tipo_usuario: type
        };
        if (type === 'professor') body.area = document.querySelector('#staff-area').value;
        const result = await api('/api/equipe', { method: 'POST', body: JSON.stringify(body) });
        form.reset();
        document.querySelector('#staff-area-field').hidden = false;
        revealPassword(`${result.nome} pode entrar com o usuário "${result.login}" e esta senha provisória:`,
            result.senha_provisoria);
        [users, teachers] = await Promise.all([api('/api/usuarios'), api('/api/professores')]);
        renderStaff();
        renderClasses();
    } catch (error) {
        showError(error.message);
    } finally {
        submit.disabled = false;
    }
}

function staffRows() {
    return users
        .filter((user) => ['professor', 'gestao'].includes(user.tipo_usuario))
        .map((user) => {
            const teacher = teachers.find((item) => item.id_usuario === user.id_usuario);
            return { ...user, nome: teacher?.nome || user.nome || user.login, area: teacher?.area };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function renderStaff() {
    const list = document.querySelector('#staff-list');
    const rows = staffRows();
    if (!rows.length) {
        list.replaceChildren(emptyRow(5, 'Nenhum membro da equipe cadastrado.'));
        return;
    }
    list.replaceChildren(...rows.map((member) => {
        const row = document.createElement('tr');
        row.append(element('td', '', member.nome));
        row.append(element('td', '', member.login));
        row.append(element('td', '', member.tipo_usuario === 'gestao'
            ? 'Gestão'
            : `Professor${member.area ? ` · ${areaNames[member.area]}` : ''}`));
        const status = document.createElement('td');
        status.append(statusBadge(member));
        row.append(status);
        const actions = document.createElement('td');
        if (member.id_usuario !== currentUser.id_usuario) {
            if (member.ativo !== 0) {
                actions.append(button('Gerar nova senha', 'small-button', () => confirmStaffReset(member, actions)));
            }
            actions.append(activeToggle(member, member.nome, actions, async () => {
                users = await api('/api/usuarios');
                renderStaff();
            }));
        } else {
            actions.append(element('span', 'notice-audience', 'Você'));
        }
        row.append(actions);
        return row;
    }));
}

function confirmStaffReset(member, cell) {
    const box = element('span', 'inline-form');
    box.append(element('span', 'hint', 'A senha atual deixa de valer.'));
    box.append(button('Gerar', 'small-button', async () => {
        try {
            const result = await api(`/api/equipe/${member.id_usuario}/senha`, { method: 'POST' });
            users = await api('/api/usuarios');
            renderStaff();
            revealPassword(`Nova senha provisória de ${member.nome} (usuário "${member.login}"):`,
                result.senha_provisoria);
        } catch (error) {
            showError(error.message);
        }
    }));
    box.append(button('Cancelar', 'small-button', () => renderStaff()));
    cell.replaceChildren(box);
}

/* ---------- Turmas e disciplinas ---------- */

function setupClasses() {
    const course = document.querySelector('#class-course');
    const series = document.querySelector('#class-series');
    const name = document.querySelector('#class-name');
    const suggest = () => {
        if (!name.dataset.edited) {
            name.value = `${seriesNames[series.value]} — ${course.value === 'redes' ? 'Redes' : 'Informática'}`;
        }
    };
    name.addEventListener('input', () => { name.dataset.edited = 'true'; });
    course.addEventListener('change', suggest);
    series.addEventListener('change', suggest);
    suggest();
    document.querySelector('#class-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearStatus();
        try {
            const created = await api('/api/turmas', {
                method: 'POST',
                body: JSON.stringify({
                    nome_turma: name.value.trim(),
                    curso: course.value,
                    serie: Number(series.value)
                })
            });
            delete name.dataset.edited;
            suggest();
            showSuccess(`Turma "${created.nome_turma}" criada.`);
            classes = await api('/api/turmas');
            fillClassSelects();
            renderClasses();
        } catch (error) {
            showError(error.message.includes('UNIQUE')
                ? 'Já existe uma turma com esse nome.'
                : error.message);
        }
    });
}

function teacherOptions(selectedId) {
    const select = document.createElement('select');
    select.append(option('', 'Sem professor'));
    teachers
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

function renderClasses() {
    const container = document.querySelector('#class-list');
    if (!classes.length) {
        container.replaceChildren(element('p', 'empty-state', 'Nenhuma turma cadastrada ainda.'));
        return;
    }
    container.replaceChildren(...classes.map((schoolClass) => {
        const card = element('section', 'content-card class-card');
        const title = element('h2', '', schoolClass.nome_turma);
        const enrolled = students.filter((student) => student.id_turma === schoolClass.id_turma).length;
        title.append(element('span', 'class-meta',
            `${seriesNames[schoolClass.serie] || ''} · ${courseNames[schoolClass.curso] || ''} · ${enrolled} aluno(s)`));
        card.append(title);

        const classDisciplines = disciplines
            .filter((item) => item.id_turma === schoolClass.id_turma)
            .sort((a, b) => a.nome_disciplina.localeCompare(b.nome_disciplina, 'pt-BR'));
        const table = element('table', 'data-table');
        const head = document.createElement('thead');
        head.innerHTML = '<tr><th scope="col">Disciplina</th><th scope="col">Professor</th></tr>';
        const body = document.createElement('tbody');
        if (!classDisciplines.length) body.append(emptyRow(2, 'Nenhuma disciplina nesta turma.'));
        classDisciplines.forEach((discipline) => {
            const row = document.createElement('tr');
            row.append(element('td', '', discipline.nome_disciplina));
            const cell = document.createElement('td');
            const select = teacherOptions(discipline.id_professor);
            select.setAttribute('aria-label', `Professor de ${discipline.nome_disciplina}`);
            select.addEventListener('change', async () => {
                try {
                    await api(`/api/disciplinas/${discipline.id_disciplina}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ id_professor: select.value ? Number(select.value) : null })
                    });
                    discipline.id_professor = select.value ? Number(select.value) : null;
                    showSuccess(`Professor de ${discipline.nome_disciplina} (${schoolClass.nome_turma}) atualizado.`);
                } catch (error) {
                    select.value = discipline.id_professor ? String(discipline.id_professor) : '';
                    showError(error.message);
                }
            });
            cell.append(select);
            row.append(cell);
            body.append(row);
        });
        table.append(head, body);
        const wrap = element('div', 'table-wrap');
        wrap.append(table);
        card.append(wrap);
        card.append(buildDisciplineForm(schoolClass));
        return card;
    }));
}

function buildDisciplineForm(schoolClass) {
    const form = element('form', 'discipline-form');
    const nameLabel = element('label', '', 'Nova disciplina');
    const nameInput = document.createElement('input');
    Object.assign(nameInput, { type: 'text', maxLength: 100, required: true, placeholder: 'Ex.: Banco de Dados' });
    nameLabel.append(nameInput);
    const teacherLabel = element('label', '', 'Professor');
    const select = teacherOptions(null);
    teacherLabel.append(select);
    const submit = element('button', 'secondary-button', 'Adicionar disciplina');
    submit.type = 'submit';
    form.append(nameLabel, teacherLabel, submit);
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await api('/api/disciplinas', {
                method: 'POST',
                body: JSON.stringify({
                    id_turma: schoolClass.id_turma,
                    nome_disciplina: nameInput.value.trim(),
                    ...(select.value ? { id_professor: Number(select.value) } : {})
                })
            });
            disciplines = await api('/api/disciplinas');
            renderClasses();
            showSuccess(`Disciplina adicionada a ${schoolClass.nome_turma}.`);
        } catch (error) {
            showError(error.message);
        }
    });
    return form;
}

/* ---------- Minha conta ---------- */

function setupPasswordForm() {
    document.querySelector('#password-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        clearStatus();
        const form = event.currentTarget;
        const newPassword = document.querySelector('#new-password').value;
        if (newPassword !== document.querySelector('#confirm-password').value) {
            showError('As duas senhas novas não são iguais.');
            return;
        }
        try {
            const result = await api('/api/auth/password', {
                method: 'POST',
                body: JSON.stringify({
                    senha_atual: document.querySelector('#current-password').value,
                    nova_senha: newPassword
                })
            });
            form.reset();
            showSuccess(result.mensagem);
        } catch (error) {
            showError(error.message);
        }
    });
}

async function logout() {
    const logoutButton = document.querySelector('#logout-button');
    logoutButton.disabled = true;
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        showError(error.message);
        logoutButton.disabled = false;
        return;
    }
    sessionStorage.removeItem('cwarning-token');
    window.location.replace('/');
}
