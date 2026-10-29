const token = sessionStorage.getItem('cwarning-token');
const courseNames = { redes: 'Redes de Computadores', informatica: 'Informática' };
const seriesNames = { 1: '1ª Série', 2: '2ª Série', 3: '3ª Série' };
const pageDetails = {
    comunicados: ['Comunicados', 'Avisos destinados ao seu curso e à sua série.'],
    lourdinha: ['Lourdinha', 'Assistente virtual do CEEP'],
    perfil: ['Meu perfil', 'Consulte os dados da turma e seus horários.'],
    salvos: ['Comunicados salvos', 'Avisos guardados neste navegador.']
};
const statusMessage = document.querySelector('#status-message');
const noticeList = document.querySelector('#notice-list');
const searchInput = document.querySelector('#notice-search');
let savedFolderKey;
let currentUser;
let notices = [];
let activeFilter = 'todos';
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
    let result;
    try {
        result = text ? JSON.parse(text) : null;
    } catch {
        throw new Error('O servidor retornou uma resposta inválida.');
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
    if (currentUser.tipo_usuario !== 'aluno' || currentUser.deve_trocar_senha) {
        sessionStorage.removeItem('cwarning-token');
        window.location.replace('/');
        return;
    }
    const courseName = courseNames[currentUser.curso] || currentUser.curso;
    const seriesName = seriesNames[currentUser.serie] || `${currentUser.serie}ª Série`;
    const cohortName = currentUser.nome_turma || `${seriesName} — ${courseName}`;
    const studentName = currentUser.nome || 'Aluno(a)';
    document.body.classList.toggle('theme-red', currentUser.curso === 'redes');
    savedFolderKey = `cwarning-student-folders-v2-${currentUser.id_usuario}`;
    folders = loadFolders();
    currentFolder = folders[0]?.id;
    document.querySelector('#sidebar-course').textContent = courseName;
    document.querySelector('#cohort-badge').textContent = cohortName;
    document.querySelector('#welcome-heading').textContent = `Olá, ${studentName.split(' ')[0]}!`;
    document.querySelector('#sidebar-name').textContent = studentName;
    document.querySelector('#student-avatar').textContent = studentName.charAt(0).toUpperCase();
    document.querySelector('#profile-name').textContent = studentName;
    document.querySelector('#profile-matricula').textContent = currentUser.login;
    document.querySelector('#profile-course').textContent = courseName;
    document.querySelector('#profile-series').textContent = seriesName;
    setupNavigation();
    setupFilters();
    setupSearch();
    setupFolders();
    setupChat();
    setupPasswordChange();
    document.querySelector('#logout-button').addEventListener('click', logout);
    await Promise.all([
        loadNotices().catch((error) => showError(error.message)),
        loadSchedule()
    ]);
}

function showError(text) {
    statusMessage.textContent = text;
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

async function loadNotices() {
    notices = await api('/api/avisos');
    renderUpcoming();
    renderNotices();
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

function buildNoticeCard(notice, { saved = false } = {}) {
    const card = document.createElement('article');
    const type = typeLabel(notice.tipo);
    card.className = 'notice-card';
    card.dataset.type = type;
    if (!saved) card.id = `aviso-${notice.id_post}`;

    const top = document.createElement('div');
    top.className = 'notice-topline';
    const badge = document.createElement('span');
    badge.className = 'notice-type';
    badge.textContent = type;
    const date = document.createElement('time');
    date.className = 'notice-date';
    date.dateTime = isoDateTime(notice);
    date.textContent = noticeDateLabel(notice);
    top.append(badge, date);

    const title = document.createElement('h3');
    title.textContent = notice.titulo;
    const content = document.createElement('p');
    content.textContent = notice.conteudo;
    const footer = document.createElement('div');
    footer.className = 'notice-footer';
    const target = document.createElement('span');
    target.className = 'notice-target';
    target.textContent = `${seriesNames[currentUser.serie]} · ${courseNames[currentUser.curso]}`;
    const saveButton = document.createElement('button');
    saveButton.className = 'save-notice';
    saveButton.type = 'button';
    saveButton.textContent = saved ? 'Remover dos salvos' : 'Salvar aviso';
    saveButton.addEventListener('click', () => toggleSaved(notice.id_post));
    footer.append(target, saveButton);
    card.append(top, title, content, footer);
    return card;
}

const UPCOMING_WINDOW_DAYS = 14;
const UPCOMING_LIMIT = 3;

function renderUpcoming() {
    const section = document.querySelector('#upcoming-section');
    const list = document.querySelector('#upcoming-list');
    const upcoming = notices
        .map((notice) => ({ notice, days: daysUntil(notice.data_evento) }))
        .filter(({ days }) => days !== null && days >= 0 && days <= UPCOMING_WINDOW_DAYS)
        .sort((a, b) => parseSchoolDate(a.notice.data_evento) - parseSchoolDate(b.notice.data_evento))
        .slice(0, UPCOMING_LIMIT);
    section.hidden = !upcoming.length;
    list.replaceChildren(...upcoming.map(({ notice, days }) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.className = 'upcoming-item';
        link.href = `#aviso-${notice.id_post}`;
        const when = document.createElement('span');
        when.className = 'upcoming-when';
        when.textContent = relativeDayLabel(days);
        const title = document.createElement('strong');
        title.textContent = notice.titulo;
        const date = document.createElement('time');
        date.dateTime = isoDateTime(notice);
        date.textContent = formatSchoolDate(notice.data_evento);
        link.append(when, title, date);
        item.append(link);
        return item;
    }));
}

function renderNotices() {
    noticeList.replaceChildren();
    const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
    const filtered = notices.filter((notice) => noticeMatches(notice, query, activeFilter));
    if (!filtered.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = notices.length
            ? 'Nenhum comunicado corresponde a esse filtro.'
            : 'Ainda não há comunicados destinados a esta turma.';
        noticeList.append(empty);
        return;
    }
    filtered.forEach((notice) => noticeList.append(buildNoticeCard(notice)));
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

async function loadSchedule() {
    const scheduleList = document.querySelector('#schedule-list');
    try {
        const schedule = await api('/api/horarios');
        scheduleList.replaceChildren();
        if (!schedule.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-state';
            empty.textContent = 'Nenhum horário foi cadastrado para esta turma.';
            scheduleList.append(empty);
            return;
        }
        schedule.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'schedule-row';
            const description = document.createElement('div');
            const discipline = document.createElement('strong');
            discipline.textContent = item.nome_disciplina;
            const className = document.createElement('span');
            className.textContent = item.nome_turma;
            description.append(discipline, className);
            const time = document.createElement('span');
            time.textContent = `${weekdayName(item.dia_semana)} · ${item.hora_inicio}–${item.hora_fim}`;
            row.append(description, time);
            scheduleList.append(row);
        });
    } catch (error) {
        scheduleList.textContent = error.message;
    }
}

function weekdayName(day) {
    return ['', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira',
        'Sexta-feira', 'Sábado', 'Domingo'][day] || 'Dia não informado';
}

function loadFolders() {
    try {
        const stored = JSON.parse(localStorage.getItem(savedFolderKey) || '[]');
        if (Array.isArray(stored) && stored.length) return stored;
    } catch (error) {
        console.warn('Não foi possível carregar os comunicados salvos.', error);
    }
    return [{ id: 'geral', name: 'Geral', noticeIds: [] }];
}

function saveFolders() {
    localStorage.setItem(savedFolderKey, JSON.stringify(folders));
}

function setupFolders() {
    document.querySelector('#create-folder').addEventListener('click', () => {
        const input = document.querySelector('#folder-name');
        const name = input.value.trim();
        if (!name) {
            input.focus();
            return;
        }
        const id = `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        folders.push({ id, name, noticeIds: [] });
        currentFolder = id;
        input.value = '';
        saveFolders();
        renderSavedNotices();
    });
    document.querySelector('#saved-folder-select').addEventListener('change', (event) => {
        currentFolder = event.target.value;
        renderSavedNotices();
    });
    renderSavedNotices();
}

function renderSavedNotices() {
    const select = document.querySelector('#saved-folder-select');
    const savedList = document.querySelector('#saved-list');
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
    savedList.replaceChildren();
    const folder = folders.find((item) => item.id === currentFolder);
    const saved = (folder?.noticeIds || [])
        .map((id) => notices.find((notice) => String(notice.id_post) === String(id)))
        .filter(Boolean);
    if (!saved.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'Esta pasta ainda não tem comunicados salvos.';
        savedList.append(empty);
        return;
    }
    saved.forEach((notice) => savedList.append(buildNoticeCard(notice, { saved: true })));
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
    renderSavedNotices();
}

function setupChat() {
    document.querySelector('#chat-form').addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.querySelector('#chat-input');
        const text = input.value.trim();
        if (!text) return;
        appendChatMessage(text, 'user');
        input.value = '';
        const answer = /hor[aá]rio/i.test(text)
            ? 'Consulte os horários cadastrados na aba Meu perfil. Se não houver horários, peça à gestão para publicá-los.'
            : /aviso|comunicado/i.test(text)
                ? 'Os comunicados direcionados ao seu curso e série estão na aba Comunicados.'
                : 'Posso ajudar com orientações gerais. Para dados da turma, consulte Comunicados e Meu perfil ou procure a equipe da escola.';
        appendChatMessage(answer, 'assistant');
    });
}

function appendChatMessage(text, role) {
    const message = document.createElement('p');
    message.className = `chat-bubble ${role}`;
    message.textContent = text;
    const messages = document.querySelector('#chat-messages');
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
}

function setupPasswordChange() {
    document.querySelector('#password-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button');
        button.disabled = true;
        try {
            const result = await api('/api/auth/password', {
                method: 'POST',
                body: JSON.stringify({
                    senha_atual: document.querySelector('#current-password').value,
                    nova_senha: document.querySelector('#new-password').value
                })
            });
            showError(result.mensagem);
            form.reset();
        } catch (error) {
            showError(error.message);
        } finally {
            button.disabled = false;
        }
    });
}

async function logout() {
    try {
        await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        showError(error.message);
        return;
    }
    sessionStorage.removeItem('cwarning-token');
    window.location.replace('/');
}
