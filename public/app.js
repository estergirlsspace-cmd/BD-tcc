const form = document.querySelector('#login-form');
const passwordInput = document.querySelector('#password');
const togglePasswordButton = document.querySelector('#toggle-password');
const message = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');
const studentOptions = document.querySelector('#student-options');
const teacherOptions = document.querySelector('#teacher-options');
const selectionSummary = document.querySelector('#selection-summary');
const selectionValue = document.querySelector('#selection-value');
const welcomePanel = document.querySelector('#welcome-panel');
const welcomeTitle = document.querySelector('#welcome-title');
const welcomeDetails = document.querySelector('#welcome-details');
const sharedAccountNotice = document.querySelector('#shared-account-notice');
const logoutMessage = document.querySelector('#logout-message');
const logoutButton = document.querySelector('#logout-button');
const changePasswordToggle = document.querySelector('#change-password-toggle');
const passwordChangeForm = document.querySelector('#password-change-form');
const passwordChangeMessage = document.querySelector('#password-change-message');

const state = {
    role: 'aluno',
    series: '1',
    course: 'informatica',
    area: 'natureza',
    token: null
};

const seriesNames = {
    1: '1ª Série',
    2: '2ª Série',
    3: '3ª Série'
};

const courseNames = {
    redes: 'Redes de Computadores',
    informatica: 'Informática'
};

const areaNames = {
    natureza: 'Área de Natureza',
    humanas: 'Área de Humanas',
    linguagens: 'Área de Linguagens',
    matematica: 'Área de Matemática',
    informatica: 'Base Técnica - Informática',
    redes: 'Base Técnica - Redes'
};

function updateSelectionSummary() {
    const isStudent = state.role === 'aluno';
    selectionSummary.hidden = state.role === 'gestao';
    selectionSummary.classList.toggle('is-hidden', state.role === 'gestao');

    if (isStudent) {
        selectionSummary.querySelector('span[aria-hidden="true"]').textContent = '🎓';
        selectionValue.textContent = `${seriesNames[state.series]} — ${courseNames[state.course]}`;
    } else if (state.role === 'professor') {
        selectionSummary.querySelector('span[aria-hidden="true"]').textContent = '👩‍🏫';
        selectionValue.textContent = areaNames[state.area];
    }
}

function selectExclusive(button, selector) {
    document.querySelectorAll(selector).forEach((option) => {
        const selected = option === button;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
    });
}

function clearMessage() {
    message.textContent = '';
    message.classList.remove('is-success');
}

document.querySelectorAll('[data-role]').forEach((button) => {
    button.addEventListener('click', () => {
        state.role = button.dataset.role;
        document.querySelectorAll('[data-role]').forEach((tab) => {
            const selected = tab === button;
            tab.classList.toggle('is-selected', selected);
            tab.setAttribute('aria-selected', String(selected));
        });

        const isStudent = state.role === 'aluno';
        const isTeacher = state.role === 'professor';
        studentOptions.hidden = !isStudent;
        studentOptions.classList.toggle('is-hidden', !isStudent);
        teacherOptions.hidden = !isTeacher;
        teacherOptions.classList.toggle('is-hidden', !isTeacher);
        clearMessage();
        updateSelectionSummary();
    });
});

document.querySelectorAll('[data-series]').forEach((button) => {
    button.addEventListener('click', () => {
        state.series = button.dataset.series;
        selectExclusive(button, '[data-series]');
        updateSelectionSummary();
    });
});

document.querySelectorAll('[data-course]').forEach((button) => {
    button.addEventListener('click', () => {
        state.course = button.dataset.course;
        selectExclusive(button, '[data-course]');
        updateSelectionSummary();
    });
});

document.querySelectorAll('[data-area]').forEach((button) => {
    button.addEventListener('click', () => {
        state.area = button.dataset.area;
        selectExclusive(button, '[data-area]');
        updateSelectionSummary();
    });
});

togglePasswordButton.addEventListener('click', () => {
    const showing = passwordInput.type === 'password';
    passwordInput.type = showing ? 'text' : 'password';
    togglePasswordButton.setAttribute('aria-pressed', String(showing));
    togglePasswordButton.setAttribute('aria-label', showing ? 'Ocultar senha' : 'Mostrar senha');
});

function showWelcome(user) {
    const isStudent = user.tipo_usuario === 'aluno';
    const profileDescription = user.tipo_usuario === 'gestao'
        ? 'Gestão escolar'
        : isStudent
            ? user.nome_turma || (user.serie
                ? `${seriesNames[user.serie]} — ${courseNames[user.curso]}`
                : 'Conta aguardando matrícula')
            : areaNames[state.area];

    welcomeTitle.textContent = 'Bem-vindo(a)';
    welcomeDetails.textContent = user.conta_compartilhada
        ? `Acesso compartilhado · ${profileDescription}`
        : `${user.login} · ${profileDescription}`;
    sharedAccountNotice.hidden = !user.conta_compartilhada;
    logoutMessage.textContent = '';
    passwordChangeMessage.textContent = '';
    passwordChangeForm.hidden = true;
    passwordChangeForm.classList.add('is-hidden');
    form.hidden = true;
    form.classList.add('is-hidden');
    welcomePanel.hidden = false;
    welcomePanel.classList.remove('is-hidden');
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    submitButton.disabled = true;
    submitButton.textContent = 'Entrando...';

    const payload = { senha: passwordInput.value };
    if (state.role === 'aluno') {
        payload.curso = state.course;
        payload.serie = Number(state.series);
    } else {
        payload.login = state.role === 'professor' ? 'professor' : 'gestao';
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.erro || 'Não foi possível entrar. Tente novamente.');
        }

        state.token = result.token;
        passwordInput.value = '';
        if (result.usuario.tipo_usuario === 'aluno') {
            sessionStorage.setItem('cwarning-token', result.token);
            window.location.assign('/aluno');
            return;
        }
        if (result.usuario.tipo_usuario === 'professor') {
            sessionStorage.setItem('cwarning-token', result.token);
            sessionStorage.setItem('cwarning-professor-area', state.area);
            window.location.assign('/professor');
            return;
        }
        showWelcome(result.usuario);
    } catch (error) {
        message.textContent = error instanceof TypeError
            ? 'Não foi possível conectar ao servidor. Confira se a API está em execução.'
            : error.message;
        passwordInput.focus();
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Entrar';
    }
});

changePasswordToggle.addEventListener('click', () => {
    const showing = !passwordChangeForm.hidden;
    passwordChangeForm.hidden = showing;
    passwordChangeForm.classList.toggle('is-hidden', showing);
    if (!showing) {
        document.querySelector('#current-password').focus();
    }
});

passwordChangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passwordChangeMessage.textContent = '';
    const currentPassword = document.querySelector('#current-password');
    const newPassword = document.querySelector('#new-password');
    try {
        const response = await fetch('/api/auth/password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${state.token}`
            },
            body: JSON.stringify({
                senha_atual: currentPassword.value,
                nova_senha: newPassword.value
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.erro || 'Não foi possível alterar a senha.');
        passwordChangeMessage.textContent = 'Senha alterada com sucesso.';
        passwordChangeMessage.classList.add('is-success');
        currentPassword.value = '';
        newPassword.value = '';
    } catch (error) {
        passwordChangeMessage.classList.remove('is-success');
        passwordChangeMessage.textContent = error instanceof TypeError
            ? 'Não foi possível conectar ao servidor.'
            : error.message;
    }
});

logoutButton.addEventListener('click', async () => {
    if (state.token) {
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { Authorization: `Bearer ${state.token}` }
            });
            if (!response.ok && response.status !== 401) {
                logoutMessage.textContent = 'Não foi possível encerrar a sessão no servidor. Tente novamente.';
                return;
            }
        } catch {
            logoutMessage.textContent = 'Não foi possível confirmar o encerramento da sessão. Tente novamente.';
            return;
        }
    }

    state.token = null;
    logoutMessage.textContent = '';
    passwordChangeMessage.textContent = '';
    welcomePanel.hidden = true;
    welcomePanel.classList.add('is-hidden');
    form.hidden = false;
    form.classList.remove('is-hidden');
    clearMessage();
    passwordInput.focus();
});

updateSelectionSummary();
