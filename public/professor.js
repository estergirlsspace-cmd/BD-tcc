const token = sessionStorage.getItem('cwarning-token');
const seriesNames = { 1: '1ª Série', 2: '2ª Série', 3: '3ª Série' };
const courseNames = { redes: 'Redes de Computadores', informatica: 'Informática' };
const teacherAreas = {
    natureza: ['Área de Natureza', 'theme-natureza'],
    humanas: ['Área de Humanas', 'theme-humanas'],
    linguagens: ['Área de Linguagens', 'theme-linguagens'],
    matematica: ['Área de Matemática', 'theme-matematica'],
    informatica: ['Base Técnica - Informática', 'theme-informatica'],
    redes: ['Base Técnica - Redes', 'theme-redes']
};
const pageDetails = {
    comunicados: ['Comunicados', 'Publique informações para as turmas vinculadas ao seu perfil.'],
    salvos: ['Comunicados salvos', 'Organize referências em pastas neste navegador.'],
    horario: ['Horário dos professores', 'Horários cadastrados para suas turmas e disciplinas.'],
    turmas: ['Minhas turmas', 'Consulte as turmas e disciplinas vinculadas ao seu perfil.'],
    recebidos: ['Comunicados recebidos', 'Informações da escola destinadas às suas turmas.']
};
const statusMessage = document.querySelector('#status-message');
const disciplineSelect = document.querySelector('#notice-discipline');
const noticeList = document.querySelector('#notice-list');
const searchInput = document.querySelector('#notice-search');
let currentUser;
let disciplines = [];
let classes = [];
let notices = [];
let schedules = [];
let activeFilter = 'todos';
let savedFolderKey;
let folders = [];
let currentFolder;

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
    if (currentUser.tipo_usuario !== 'professor' || currentUser.deve_trocar_senha) {
        sessionStorage.removeItem('cwarning-token');
        window.location.replace('/');
        return;
    }

    document.querySelector('#teacher-login').textContent = currentUser.nome || currentUser.login;
    const [areaName, theme] = teacherAreas[currentUser.area]
        || ['Área docente', 'theme-natureza'];
    document.querySelector('#teacher-area').textContent = areaName;
    document.body.classList.add(theme);
    savedFolderKey = `cwarning-teacher-folders-v1-${currentUser.id_usuario}`;
    folders = loadFolders();
    currentFolder = folders[0]?.id;
    setupNavigation();
    setupFilters();
    setupSearch();
    setupSavedFolders();
    document.querySelector('#notice-form').addEventListener('submit', publishNotice);
    document.querySelectorAll('#logout-button, [data-logout]')
        .forEach((button) => button.addEventListener('click', logout));

    const [classResult, disciplineResult, noticeResult, scheduleResult] = await Promise.all([
        loadResource('/api/turmas', 'Não foi possível carregar as turmas.'),
        loadResource('/api/disciplinas', 'Não foi possível carregar as disciplinas.'),
        loadResource('/api/avisos', 'Não foi possível carregar os comunicados.'),
        loadResource('/api/horarios', 'Não foi possível carregar os horários.')
    ]);
    classes = classResult || [];
    disciplines = disciplineResult || [];
    notices = noticeResult || [];
    schedules = scheduleResult || [];
    if (classResult && disciplineResult) renderAssignments();
    if (noticeResult) {
        renderNotices();
        renderReceivedNotices();
    }
    if (scheduleResult) renderSchedule();
    renderSavedNotices();
}

async function loadResource(path, errorLabel) {
    try {
        const result = await api(path);
        if (!Array.isArray(result)) throw new Error('O formato dos dados recebidos é inválido.');
        return result;
    } catch (error) {
        showError(`${errorLabel} ${error.message}`);
        return null;
    }
}

function showError(text) {
    statusMessage.classList.remove('is-success');
    statusMessage.textContent = text;
}

function showSuccess(text) {
    statusMessage.classList.add('is-success');
    statusMessage.textContent = text;
}

function clearStatus() {
    statusMessage.textContent = '';
}

function setupNavigation() {
    document.querySelectorAll('[data-page]').forEach((button) => {
        button.addEventListener('click', () => openPage(button.dataset.page));
    });
}

function openPage(pageName) {
    const details = pageDetails[pageName];
    if (!details) return;
    document.querySelectorAll('[data-page]').forEach((button) => {
        button.classList.toggle('active', button.dataset.page === pageName);
    });
    document.querySelectorAll('.tab-content').forEach((section) => {
        const active = section.id === `page-${pageName}`;
        section.classList.toggle('active', active);
        section.hidden = !active;
    });
    document.querySelector('#topbar-title').textContent = details[0];
    document.querySelector('#topbar-description').textContent = details[1];
    if (pageName === 'salvos') renderSavedNotices();
}

function renderAssignments() {
    const validDisciplines = disciplines.filter((item) => classes
        .some((schoolClass) => schoolClass.id_turma === item.id_turma));
    disciplineSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = validDisciplines.length
        ? 'Selecione uma disciplina e turma'
        : 'Nenhuma disciplina vinculada';
    disciplineSelect.append(placeholder);
    validDisciplines.forEach((discipline) => {
        const schoolClass = classes.find((item) => item.id_turma === discipline.id_turma);
        const option = document.createElement('option');
        option.value = String(discipline.id_disciplina);
        option.textContent = `${discipline.nome_disciplina} · ${schoolClass.nome_turma}`;
        disciplineSelect.append(option);
    });
    document.querySelector('#publish-button').disabled = validDisciplines.length === 0;
    document.querySelector('#assignment-notice').hidden = validDisciplines.length > 0;
    disciplineSelect.addEventListener('change', clearStatus);
    renderClasses();
}

async function publishNotice(event) {
    event.preventDefault();
    clearStatus();
    const discipline = disciplines.find((item) =>
        String(item.id_disciplina) === disciplineSelect.value);
    if (!discipline) {
        showError('Selecione uma disciplina vinculada ao seu perfil.');
        return;
    }
    const button = document.querySelector('#publish-button');
    button.disabled = true;
    try {
        const payload = {
            titulo: document.querySelector('#notice-title').value.trim(),
            conteudo: document.querySelector('#notice-content').value.trim(),
            id_turma: discipline.id_turma,
            tipo: document.querySelector('#notice-type').value
        };
        const date = document.querySelector('#notice-date').value;
        if (date) payload.data_evento = date;
        const created = await api('/api/avisos', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        notices.push(created);
        document.querySelector('#notice-form').reset();
        renderNotices();
        renderReceivedNotices();
        showSuccess('Comunicado publicado para a turma vinculada.');
    } catch (error) {
        showError(error.message);
    } finally {
        button.disabled = disciplines.length === 0;
    }
}

function setupFilters() {
    document.querySelectorAll('[data-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            activeFilter = button.dataset.filter;
            document.querySelectorAll('[data-filter]').forEach((filter) => {
                filter.classList.toggle('active', filter === button);
            });
            renderNotices();
        });
    });
}

function setupSearch() {
    searchInput.addEventListener('input', renderNotices);
}

function typeLabel(type) {
    return ['aviso', 'evento', 'atividade', 'avaliacao', 'comunicado'].includes(type)
        ? type
        : 'aviso';
}

function noticeMatches(notice, query, type) {
    const matchesType = type === 'todos' || typeLabel(notice.tipo) === type;
    const text = `${notice.titulo} ${notice.conteudo}`.toLocaleLowerCase('pt-BR');
    return matchesType && text.includes(query);
}

function targetLabel(notice) {
    const schoolClass = classes.find((item) => item.id_turma === notice.id_turma);
    if (schoolClass) {
        const series = seriesNames[schoolClass.serie]
            || (schoolClass.serie ? `${schoolClass.serie}ª Série` : 'Série não informada');
        const course = courseNames[schoolClass.curso] || schoolClass.curso || 'Curso não informado';
        return `${schoolClass.nome_turma} · ${series} — ${course}`;
    }
    if (notice.curso || notice.serie) {
        return `${notice.serie ? seriesNames[notice.serie] || `${notice.serie}ª Série` : 'Todas as séries'} · ${notice.curso ? courseNames[notice.curso] || notice.curso : 'Todos os cursos'}`;
    }
    return 'Comunicado geral';
}

function buildNoticeCard(notice, { saved = false, allowDelete = false } = {}) {
    const card = document.createElement('article');
    const type = typeLabel(notice.tipo);
    card.className = 'notice-card';
    card.dataset.type = type;

    const top = document.createElement('div');
    top.className = 'notice-topline';
    const labels = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = 'notice-type';
    badge.textContent = type;
    labels.append(badge);
    const ownNotice = notice.id_usuario_autor === currentUser.id_usuario;
    const origin = document.createElement('span');
    origin.className = 'notice-origin';
    origin.textContent = ownNotice ? 'Publicado por você' : 'Recebido';
    labels.append(origin);
    const date = document.createElement('time');
    date.className = 'notice-date';
    date.dateTime = isoDateTime(notice);
    date.textContent = noticeDateLabel(notice);
    top.append(labels, date);

    const title = document.createElement('h3');
    title.textContent = notice.titulo;
    const content = document.createElement('p');
    content.textContent = notice.conteudo;
    const footer = document.createElement('div');
    footer.className = 'notice-footer';
    const target = document.createElement('span');
    target.className = 'notice-target';
    target.textContent = targetLabel(notice);
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const saveButton = document.createElement('button');
    saveButton.className = 'save-notice';
    saveButton.type = 'button';
    saveButton.textContent = saved || isSaved(notice.id_post) ? 'Remover dos salvos' : 'Salvar';
    saveButton.addEventListener('click', () => toggleSaved(notice.id_post));
    actions.append(saveButton);
    if (allowDelete && ownNotice) {
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-notice';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Excluir';
        deleteButton.addEventListener('click', () => deleteNotice(notice));
        actions.append(deleteButton);
    }
    footer.append(target, actions);
    card.append(top, title, content, footer);
    return card;
}

function renderNotices() {
    noticeList.replaceChildren();
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    const filtered = notices.filter((notice) => noticeMatches(notice, query, activeFilter));
    if (!filtered.length) {
        noticeList.append(emptyState(notices.length
            ? 'Nenhum comunicado corresponde a esse filtro.'
            : 'Ainda não há comunicados disponíveis para suas turmas.'));
        return;
    }
    filtered.forEach((notice) => {
        noticeList.append(buildNoticeCard(notice, { allowDelete: true }));
    });
}

function renderReceivedNotices() {
    const container = document.querySelector('#received-list');
    container.replaceChildren();
    const received = notices.filter((notice) => notice.id_usuario_autor !== currentUser.id_usuario);
    if (!received.length) {
        container.append(emptyState('Não há comunicados recebidos para as turmas vinculadas.'));
        return;
    }
    received.forEach((notice) => {
        container.append(buildNoticeCard(notice));
    });
}

async function deleteNotice(notice) {
    if (!window.confirm('Deseja excluir este comunicado?')) return;
    try {
        await api(`/api/avisos/${notice.id_post}`, { method: 'DELETE' });
        notices = notices.filter((item) => item.id_post !== notice.id_post);
        renderNotices();
        renderReceivedNotices();
        renderSavedNotices();
        clearStatus();
    } catch (error) {
        showError(error.message);
    }
}

function renderClasses() {
    const container = document.querySelector('#class-list');
    container.replaceChildren();
    if (!classes.length) {
        container.append(emptyState('Nenhuma turma está vinculada ao seu perfil.'));
        return;
    }
    classes.forEach((schoolClass) => {
        const card = document.createElement('article');
        card.className = 'class-card';
        const title = document.createElement('h3');
        title.textContent = schoolClass.nome_turma;
        const course = document.createElement('p');
        const series = seriesNames[schoolClass.serie]
            || (schoolClass.serie ? `${schoolClass.serie}ª Série` : 'Série não informada');
        const courseName = courseNames[schoolClass.curso]
            || schoolClass.curso
            || 'Curso não informado';
        course.textContent = `${series} · ${courseName}`;
        const subjects = disciplines
            .filter((discipline) => discipline.id_turma === schoolClass.id_turma)
            .map((discipline) => discipline.nome_disciplina);
        const subjectList = document.createElement('p');
        subjectList.textContent = subjects.length
            ? `Disciplinas: ${subjects.join(', ')}`
            : 'Nenhuma disciplina vinculada.';
        card.append(title, course, subjectList);
        container.append(card);
    });
}

function renderSchedule() {
    const container = document.querySelector('#schedule-list');
    container.replaceChildren();
    if (!schedules.length) {
        container.append(emptyState('Nenhum horário foi cadastrado para suas turmas.'));
        return;
    }
    schedules.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'schedule-row';
        const description = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.nome_disciplina;
        const schoolClass = document.createElement('small');
        schoolClass.textContent = item.nome_turma;
        description.append(title, schoolClass);
        const time = document.createElement('time');
        time.textContent = `${weekdayName(item.dia_semana)} · ${item.hora_inicio}–${item.hora_fim}${item.sala ? ` · ${item.sala}` : ''}`;
        row.append(description, time);
        container.append(row);
    });
}

function weekdayName(day) {
    return ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira',
        'Sexta-feira', 'Sábado', 'Domingo'][day] || 'Dia não informado';
}

function emptyState(text) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = text;
    return empty;
}

function loadFolders() {
    try {
        const stored = JSON.parse(localStorage.getItem(savedFolderKey) || '[]');
        if (Array.isArray(stored)) {
            const valid = stored.filter((folder) => folder
                && typeof folder.id === 'string'
                && typeof folder.name === 'string'
                && Array.isArray(folder.noticeIds));
            if (valid.length) return valid;
        }
    } catch (error) {
        console.warn('Não foi possível carregar as pastas salvas.', error);
        showError('As pastas salvas não puderam ser carregadas; uma pasta vazia foi criada.');
    }
    return [{ id: 'geral', name: 'Geral', noticeIds: [] }];
}

function saveFolders() {
    localStorage.setItem(savedFolderKey, JSON.stringify(folders));
}

function setupSavedFolders() {
    document.querySelector('#folder-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.querySelector('#folder-name');
        const name = input.value.trim();
        if (!name) return;
        if (folders.some((folder) => folder.name.toLocaleLowerCase('pt-BR')
            === name.toLocaleLowerCase('pt-BR'))) {
            showError('Já existe uma pasta com esse nome.');
            return;
        }
        folders.push({
            id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name,
            noticeIds: []
        });
        currentFolder = folders[folders.length - 1].id;
        input.value = '';
        saveFolders();
        renderSavedNotices();
        clearStatus();
    });
    document.querySelector('#saved-folder-select').addEventListener('change', (event) => {
        currentFolder = event.target.value;
        renderSavedNotices();
    });
}

function isSaved(noticeId) {
    const folder = folders.find((item) => item.id === currentFolder);
    return Boolean(folder?.noticeIds
        .some((savedId) => String(savedId) === String(noticeId)));
}

function toggleSaved(noticeId) {
    let folder = folders.find((item) => item.id === currentFolder);
    if (!folder) {
        folder = folders[0];
        currentFolder = folder.id;
    }
    const id = String(noticeId);
    const exists = folder.noticeIds.some((savedId) => String(savedId) === id);
    folder.noticeIds = exists
        ? folder.noticeIds.filter((savedId) => String(savedId) !== id)
        : [...folder.noticeIds, id];
    saveFolders();
    renderNotices();
    renderReceivedNotices();
    renderSavedNotices();
}

function renderSavedNotices() {
    const select = document.querySelector('#saved-folder-select');
    const container = document.querySelector('#saved-list');
    if (!select || !container) return;
    select.replaceChildren();
    folders.forEach((folder) => {
        const option = document.createElement('option');
        option.value = folder.id;
        option.textContent = folder.name;
        select.append(option);
    });
    if (!folders.some((folder) => folder.id === currentFolder)) {
        currentFolder = folders[0]?.id;
    }
    if (currentFolder) select.value = currentFolder;
    container.replaceChildren();
    const folder = folders.find((item) => item.id === currentFolder);
    const saved = (folder?.noticeIds || [])
        .map((id) => notices.find((notice) => String(notice.id_post) === String(id)))
        .filter(Boolean);
    if (!saved.length) {
        container.append(emptyState('Esta pasta ainda não tem comunicados salvos.'));
        return;
    }
    saved.forEach((notice) => container.append(buildNoticeCard(notice, { saved: true })));
}

async function logout() {
    const button = document.querySelector('#logout-button');
    button.disabled = true;
    try {
        await api('/api/auth/logout', { method: 'POST' });
        sessionStorage.removeItem('cwarning-token');
        window.location.replace('/');
    } catch (error) {
        showError(error.message);
        button.disabled = false;
    }
}
