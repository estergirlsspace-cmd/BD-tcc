const form = document.querySelector('#login-form');
const passwordInput = document.querySelector('#password');
const togglePasswordButton = document.querySelector('#toggle-password');
const togglePasswordIcon = document.querySelector('#toggle-password-icon');
const message = document.querySelector('#form-message');
const submitButton = document.querySelector('#submit-button');
const loginInput = document.querySelector('#login-id');
const loginLabel = document.querySelector('#login-label');
const roleInputs = document.querySelectorAll('input[name="perfil"]');
const firstAccessHint = document.querySelector('#first-access-hint');
const staffAccessHint = document.querySelector('#staff-access-hint');
const welcomePanel = document.querySelector('#welcome-panel');
const welcomeTitle = document.querySelector('#welcome-title');
const welcomeDetails = document.querySelector('#welcome-details');
const sharedAccountNotice = document.querySelector('#shared-account-notice');
const logoutMessage = document.querySelector('#logout-message');
const logoutButton = document.querySelector('#logout-button');
const changePasswordToggle = document.querySelector('#change-password-toggle');
const passwordChangeForm = document.querySelector('#password-change-form');
const passwordChangeMessage = document.querySelector('#password-change-message');
const passwordChangeSuccess = document.querySelector('#password-change-success');
const firstAccessForm = document.querySelector('#first-access-form');
const firstAccessMessage = document.querySelector('#first-access-message');
const firstAccessButton = document.querySelector('#first-access-button');

const state = {
    role: 'aluno',
    token: null,
    pendingLogin: null
};

const roleNames = {
    aluno: 'aluno',
    professor: 'professor',
    gestao: 'gestor'
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

function submitLabel() {
    return `Entrar como ${roleNames[state.role]}`;
}

function clearMessage() {
    message.textContent = '';
}

function showView(view) {
    form.hidden = view !== form;
    firstAccessForm.hidden = view !== firstAccessForm;
    welcomePanel.hidden = view !== welcomePanel;
}

function selectRole(role) {
    state.role = role;
    const isStudent = role === 'aluno';
    loginLabel.textContent = isStudent ? 'Matrícula' : 'Usuário';
    loginInput.placeholder = isStudent
        ? 'Digite o número da sua matrícula'
        : 'Digite seu usuário';
    loginInput.inputMode = isStudent ? 'numeric' : 'text';
    firstAccessHint.hidden = !isStudent;
    staffAccessHint.hidden = isStudent;
    submitButton.textContent = submitLabel();
    clearMessage();
}

roleInputs.forEach((input) => {
    input.addEventListener('change', () => {
        if (input.checked) selectRole(input.value);
    });
});

// Mantém o perfil coerente se o navegador restaurar o formulário (voltar/avançar).
const checkedRole = document.querySelector('input[name="perfil"]:checked');
selectRole(checkedRole ? checkedRole.value : 'aluno');

togglePasswordButton.addEventListener('click', () => {
    const showing = passwordInput.type === 'password';
    passwordInput.type = showing ? 'text' : 'password';
    togglePasswordButton.setAttribute('aria-pressed', String(showing));
    togglePasswordIcon.classList.toggle('ph-eye', !showing);
    togglePasswordIcon.classList.toggle('ph-eye-slash', showing);
});

function resetPasswordVisibility() {
    passwordInput.type = 'password';
    togglePasswordButton.setAttribute('aria-pressed', 'false');
    togglePasswordIcon.classList.add('ph-eye');
    togglePasswordIcon.classList.remove('ph-eye-slash');
}

function showWelcome(user) {
    const isStudent = user.tipo_usuario === 'aluno';
    const profileDescription = user.tipo_usuario === 'gestao'
        ? 'Gestão escolar'
        : isStudent
            ? user.nome_turma || (user.serie
                ? `${seriesNames[user.serie]} — ${courseNames[user.curso]}`
                : 'Conta aguardando matrícula')
            : user.area || 'Professor';

    welcomeTitle.textContent = 'Bem-vindo(a)';
    welcomeDetails.textContent = user.conta_compartilhada
        ? `Acesso compartilhado · ${profileDescription}`
        : `${user.login} · ${profileDescription}`;
    sharedAccountNotice.hidden = !user.conta_compartilhada;
    logoutMessage.textContent = '';
    passwordChangeMessage.textContent = '';
    passwordChangeSuccess.textContent = '';
    passwordChangeForm.hidden = true;
    changePasswordToggle.setAttribute('aria-expanded', 'false');
    showView(welcomePanel);
}

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    submitButton.disabled = true;
    submitButton.textContent = 'Entrando...';

    const typedPassword = passwordInput.value;
    const payload = { login: loginInput.value.trim(), senha: typedPassword };

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
        resetPasswordVisibility();
        if (result.usuario.deve_trocar_senha) {
            state.pendingLogin = { usuario: result.usuario, senha: typedPassword };
            showFirstAccess();
            return;
        }
        enterPortal(result.usuario);
    } catch (error) {
        message.textContent = error instanceof TypeError
            ? 'Não foi possível conectar ao servidor. Confira se a API está em execução.'
            : error.message;
        passwordInput.focus();
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel();
    }
});

const portalPaths = {
    aluno: '/aluno',
    professor: '/professor',
    gestao: '/gestao'
};

function enterPortal(usuario) {
    const portalPath = portalPaths[usuario.tipo_usuario];
    if (portalPath) {
        sessionStorage.setItem('cwarning-token', state.token);
        window.location.assign(portalPath);
        return;
    }
    showWelcome(usuario);
}

function showFirstAccess() {
    showView(firstAccessForm);
    firstAccessMessage.textContent = '';
    document.querySelector('#first-new-password').focus();
}

firstAccessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    firstAccessMessage.textContent = '';
    const newPassword = document.querySelector('#first-new-password');
    const confirmPassword = document.querySelector('#first-confirm-password');
    if (newPassword.value !== confirmPassword.value) {
        firstAccessMessage.textContent = 'As duas senhas não são iguais. Digite novamente.';
        confirmPassword.focus();
        return;
    }

    firstAccessButton.disabled = true;
    firstAccessButton.textContent = 'Salvando...';
    try {
        const response = await fetch('/api/auth/password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${state.token}`
            },
            body: JSON.stringify({
                senha_atual: state.pendingLogin.senha,
                nova_senha: newPassword.value
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar a senha.');
        const { usuario } = state.pendingLogin;
        state.pendingLogin = null;
        newPassword.value = '';
        confirmPassword.value = '';
        firstAccessForm.hidden = true;
        enterPortal({ ...usuario, deve_trocar_senha: false });
    } catch (error) {
        firstAccessMessage.textContent = error instanceof TypeError
            ? 'Não foi possível conectar ao servidor.'
            : error.message;
    } finally {
        firstAccessButton.disabled = false;
        firstAccessButton.textContent = 'Salvar e entrar';
    }
});

changePasswordToggle.addEventListener('click', () => {
    const opening = passwordChangeForm.hidden;
    passwordChangeForm.hidden = !opening;
    changePasswordToggle.setAttribute('aria-expanded', String(opening));
    if (opening) {
        document.querySelector('#current-password').focus();
    }
});

passwordChangeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    passwordChangeMessage.textContent = '';
    passwordChangeSuccess.textContent = '';
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
        passwordChangeSuccess.textContent = 'Senha alterada com sucesso.';
        currentPassword.value = '';
        newPassword.value = '';
    } catch (error) {
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
    passwordChangeSuccess.textContent = '';
    showView(form);
    clearMessage();
    passwordInput.focus();
});
