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
const forgotLink = document.querySelector('#forgot-link');
const recoverForm = document.querySelector('#recover-form');
const recoverInput = document.querySelector('#recover-login');
const recoverMessage = document.querySelector('#recover-message');
const recoverButton = document.querySelector('#recover-button');
const recoverFields = document.querySelector('#recover-fields');
const recoverDone = document.querySelector('#recover-done');
const recoverDoneText = document.querySelector('#recover-done-text');
const termsForm = document.querySelector('#terms-form');
const termsCheck = document.querySelector('#terms-check');
const termsButton = document.querySelector('#terms-button');
const termsMessage = document.querySelector('#terms-message');
const sessionNotice = document.querySelector('#session-notice');

const OFFLINE_MESSAGE = 'Sem conexão com o C·Warning. Tente de novo em instantes.';
const RETURN_KEY = 'cw-voltar';
const REASON_KEY = 'cw-motivo';

function readSession(key) {
    try { return sessionStorage.getItem(key); } catch { return null; }
}

function dropSession(key) {
    try { sessionStorage.removeItem(key); } catch { /* armazenamento bloqueado */ }
}

const state = {
    role: 'aluno',
    token: null,
    pendingLogin: null,
    termsUser: null
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

// As abas só trocam o rótulo do campo (matrícula ou usuário): quem decide o portal é a conta.
function submitLabel() {
    return 'Entrar';
}

const credentialInputs = [loginInput, passwordInput];

function markCredentials(invalid) {
    credentialInputs.forEach((input) => {
        if (invalid) {
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-describedby', 'form-message');
        } else {
            input.removeAttribute('aria-invalid');
            input.removeAttribute('aria-describedby');
        }
    });
}

credentialInputs.forEach((input) => input.addEventListener('input', () => markCredentials(false)));

function clearMessage() {
    message.textContent = '';
    markCredentials(false);
}

function showView(view) {
    form.hidden = view !== form;
    firstAccessForm.hidden = view !== firstAccessForm;
    welcomePanel.hidden = view !== welcomePanel;
    recoverForm.hidden = view !== recoverForm;
    termsForm.hidden = view !== termsForm;
}

// "Esqueci minha senha": formulário no mesmo painel; a resposta é sempre genérica
// (não revela se a matrícula/usuário existe ou tem e-mail).
forgotLink.addEventListener('click', () => {
    recoverInput.value = loginInput.value.trim();
    recoverMessage.textContent = '';
    recoverFields.hidden = false;
    recoverDone.hidden = true;
    showView(recoverForm);
    recoverInput.focus();
});

document.querySelector('#recover-back').addEventListener('click', () => {
    showView(form);
    forgotLink.focus();
});

recoverForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    recoverMessage.textContent = '';
    const login = recoverInput.value.trim();
    if (!login) {
        recoverMessage.textContent = 'Digite sua matrícula ou seu usuário.';
        recoverInput.focus();
        return;
    }
    recoverButton.disabled = true;
    recoverButton.textContent = 'Enviando...';
    try {
        const response = await fetch('/api/auth/recuperar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login })
        });
        if (response.status === 429) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
        if (response.status === 501) throw new Error('A recuperação de senha ainda está em construção. Procure a secretaria da escola.');
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.erro || 'Não foi possível enviar agora. Tente novamente.');
        }
        recoverDoneText.textContent = `Pronto! Se a conta ${login} tiver um e-mail cadastrado, enviamos um link para criar uma nova senha.`;
        recoverFields.hidden = true;
        recoverDone.hidden = false;
        document.querySelector('#recover-title').focus();
    } catch (error) {
        recoverMessage.textContent = error instanceof TypeError ? OFFLINE_MESSAGE : error.message;
    } finally {
        recoverButton.disabled = false;
        recoverButton.textContent = 'Enviar link';
    }
});

function selectRole(role) {
    state.role = role;
    const isStudent = role === 'aluno';
    loginLabel.textContent = isStudent ? 'Usuário da sala ou matrícula' : 'Usuário';
    loginInput.placeholder = isStudent
        ? 'Ex.: 1info-a ou sua matrícula'
        : 'Digite seu usuário';
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
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw Object.assign(
                new Error(result.erro || 'Não foi possível entrar. Tente novamente.'),
                { credenciais: response.status === 400 || response.status === 401 }
            );
        }
        if (!result.token || !result.usuario) throw new Error('O servidor respondeu de um jeito inesperado. Tente de novo.');

        state.token = result.token;
        passwordInput.value = '';
        resetPasswordVisibility();
        if (result.usuario.deve_trocar_senha) {
            state.pendingLogin = { usuario: result.usuario, senha: typedPassword };
            showFirstAccess();
            return;
        }
        await enterPortal(result.usuario);
    } catch (error) {
        message.textContent = error instanceof TypeError ? OFFLINE_MESSAGE : error.message;
        markCredentials(Boolean(error.credenciais));
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

// LGPD: sem o aceite dos termos, a API só libera perfil, senha e privacidade. O login não traz
// essa informação, então ela vem de /api/me; se /api/me falhar, o portal volta para cá.
async function termsPending() {
    try {
        const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${state.token}` } });
        if (!response.ok) return false;
        return (await response.json()).termos_pendentes === true;
    } catch {
        return false;
    }
}

function showTerms(usuario) {
    state.termsUser = usuario;
    termsCheck.checked = false;
    termsButton.disabled = true;
    termsMessage.textContent = '';
    showView(termsForm);
    document.querySelector('#terms-title').focus();
}

async function enterPortal(usuario) {
    if (await termsPending()) {
        showTerms(usuario);
        return;
    }
    goToPortal(usuario);
}

// Depois de uma sessão expirada, volta para a tela onde a pessoa estava — só se for um caminho do
// próprio site e do mesmo portal da conta (nada de URL externa nem portal de outro perfil).
function returnPathFor(portalPath) {
    const saved = readSession(RETURN_KEY);
    dropSession(RETURN_KEY);
    if (!saved || !/^\/[a-z]+(?:#[\w\-/=&.%~:]*)?$/.test(saved)) return portalPath;
    const [pathname] = saved.split('#');
    return pathname === portalPath ? saved : portalPath;
}

function goToPortal(usuario) {
    const portalPath = portalPaths[usuario.tipo_usuario];
    if (portalPath) {
        sessionStorage.setItem('cwarning-token', state.token);
        window.location.assign(returnPathFor(portalPath));
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
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.erro || 'Não foi possível salvar a senha.');
        const { usuario } = state.pendingLogin;
        state.pendingLogin = null;
        newPassword.value = '';
        confirmPassword.value = '';
        firstAccessForm.hidden = true;
        await enterPortal({ ...usuario, deve_trocar_senha: false });
    } catch (error) {
        firstAccessMessage.textContent = error instanceof TypeError ? OFFLINE_MESSAGE : error.message;
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
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.erro || 'Não foi possível alterar a senha.');
        passwordChangeSuccess.textContent = 'Senha alterada com sucesso.';
        currentPassword.value = '';
        newPassword.value = '';
    } catch (error) {
        passwordChangeMessage.textContent = error instanceof TypeError ? OFFLINE_MESSAGE : error.message;
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

termsCheck.addEventListener('change', () => {
    termsButton.disabled = !termsCheck.checked;
});

termsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    termsMessage.textContent = '';
    if (!termsCheck.checked) return;
    termsButton.disabled = true;
    termsButton.textContent = 'Salvando...';
    try {
        const response = await fetch('/api/privacidade/aceite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
            body: '{}'
        });
        if (response.status === 401) throw new Error('Sua sessão expirou. Entre novamente.');
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.erro || 'Não foi possível registrar o aceite. Tente novamente.');
        const usuario = state.termsUser;
        state.termsUser = null;
        goToPortal(usuario);
    } catch (error) {
        termsMessage.textContent = error instanceof TypeError ? OFFLINE_MESSAGE : error.message;
        termsButton.disabled = !termsCheck.checked;
    } finally {
        termsButton.textContent = 'Aceitar e continuar';
    }
});

// "Agora não": encerra a sessão e volta para a tela de entrada.
document.querySelector('#terms-cancel').addEventListener('click', () => {
    if (state.token) {
        fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } })
            .catch(() => {});
    }
    state.token = null;
    state.termsUser = null;
    sessionStorage.removeItem('cwarning-token');
    showView(form);
    loginInput.focus();
});

// Um portal que perdeu a sessão (401) avisa por cw-motivo; a rota fica em cw-voltar até entrar.
if (readSession(REASON_KEY) === 'sessao') {
    dropSession(REASON_KEY);
    sessionNotice.hidden = false;
}

// Um portal que recebeu 403 de termos pendentes manda para cá com a sessão ainda válida:
// retoma direto na etapa de aceite, sem pedir a senha de novo.
(async () => {
    const savedToken = sessionStorage.getItem('cwarning-token');
    if (!savedToken) return;
    try {
        const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${savedToken}` } });
        if (!response.ok) return;
        const usuario = await response.json();
        if (usuario.termos_pendentes && !usuario.deve_trocar_senha && form.hidden === false) {
            state.token = savedToken;
            showTerms(usuario);
        }
    } catch {
        // Sem conexão: fica na tela de entrada.
    }
})();
