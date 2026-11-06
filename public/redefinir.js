// Página dos links enviados por e-mail: redefinir senha e confirmar e-mail.
// Rotas /redefinir e /confirmar-email servem esta mesma página; o token vem no fragmento (#token=…).
// Também aceita /redefinir#confirmar-email=… (formato alternativo).

'use strict';

const resetForm = document.querySelector('#reset-form');
const resetMessage = document.querySelector('#reset-message');
const resetButton = document.querySelector('#reset-button');
const newPassword = document.querySelector('#new-password');
const confirmPassword = document.querySelector('#confirm-password');
const resultPanel = document.querySelector('#result-panel');

const OFFLINE_MESSAGE = 'Sem conexão com o C·Warning. Tente de novo em instantes.';
// O token sai da barra de endereço, mas fica guardado nesta aba até dar certo: recarregar a página
// não quebra o link. Apagado depois do sucesso (ou quando o servidor recusa o link).
const LINK_KEY = 'cw-link-token';

function saveLink(link) {
    try { sessionStorage.setItem(LINK_KEY, JSON.stringify(link)); } catch { /* armazenamento bloqueado */ }
}

function forgetLink() {
    try { sessionStorage.removeItem(LINK_KEY); } catch { /* armazenamento bloqueado */ }
}

function savedLink(mode) {
    try {
        const saved = JSON.parse(sessionStorage.getItem(LINK_KEY) || 'null');
        return saved && saved.mode === mode && typeof saved.token === 'string' ? saved : null;
    } catch {
        return null;
    }
}

// Lê o token e tira o fragmento da barra de endereço (não fica no histórico nem em capturas de tela).
function readLink() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const emailToken = params.get('confirmar-email');
    const token = params.get('token');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    const mode = emailToken || /confirmar-email/.test(window.location.pathname) ? 'email' : 'senha';
    const fromHash = emailToken || token;
    if (fromHash) {
        const link = { mode, token: fromHash };
        saveLink(link);
        return link;
    }
    return savedLink(mode) || { mode, token: null };
}

function showResult({ ok, title, text, linkText = 'Entrar no C·Warning', linkHref = '/entrar' }) {
    resetForm.hidden = true;
    resultPanel.hidden = false;
    const icon = document.querySelector('#result-icon');
    icon.className = `ph ${ok ? 'ph-check-circle' : 'ph-warning-circle'} login-confirmacao__icone`;
    document.querySelector('#result-title').textContent = title;
    document.querySelector('#result-text').textContent = text;
    const link = document.querySelector('#result-link');
    link.textContent = linkText;
    link.href = linkHref;
    document.querySelector('#result-title').focus();
}

async function post(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 501) throw new Error('Este recurso ainda está em construção. Tente mais tarde.');
    if (response.status === 429) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente de novo.');
    if (!response.ok) {
        throw Object.assign(new Error(result.erro || 'Não foi possível concluir. Tente novamente.'),
            { recusado: response.status >= 400 && response.status < 500 && response.status !== 429 });
    }
    return result;
}

async function confirmEmail(token) {
    document.title = 'Confirmar e-mail | C-Warning';
    showResult({ ok: true, title: 'Confirmando seu e-mail…', text: 'Aguarde um instante.' });
    try {
        await post('/api/conta/email/confirmar', { token });
        forgetLink();
        showResult({
            ok: true,
            title: 'E-mail confirmado!',
            text: 'A partir de agora você recebe as notificações por e-mail e pode recuperar a senha sozinho(a).'
        });
    } catch (error) {
        if (error.recusado) forgetLink();
        showResult({
            ok: false,
            title: 'Não foi possível confirmar',
            text: error instanceof TypeError
                ? `${OFFLINE_MESSAGE} Recarregue esta página quando a conexão voltar.`
                : `${error.message} O link pode ter expirado ou já ter sido usado: entre no C·Warning e cadastre o e-mail de novo em Configurações.`
        });
    }
}

function setupReset(token) {
    resetForm.hidden = false;
    newPassword.focus();
    resetForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        resetMessage.textContent = '';
        if (newPassword.value.length < 8) {
            resetMessage.textContent = 'A nova senha precisa ter pelo menos 8 caracteres.';
            newPassword.focus();
            return;
        }
        if (newPassword.value !== confirmPassword.value) {
            resetMessage.textContent = 'As duas senhas não são iguais. Digite novamente.';
            confirmPassword.focus();
            return;
        }
        resetButton.disabled = true;
        resetButton.textContent = 'Salvando...';
        try {
            await post('/api/auth/redefinir', { token, nova_senha: newPassword.value });
            forgetLink();
            newPassword.value = '';
            confirmPassword.value = '';
            showResult({
                ok: true,
                title: 'Senha alterada!',
                text: 'Sua nova senha já vale. Por segurança, você saiu de todos os aparelhos: entre de novo com a senha nova.'
            });
        } catch (error) {
            resetMessage.textContent = error instanceof TypeError
                ? OFFLINE_MESSAGE
                : `${error.message} Se o link expirou (vale 30 minutos), peça outro em "Esqueci minha senha".`;
        } finally {
            resetButton.disabled = false;
            resetButton.textContent = 'Salvar nova senha';
        }
    });
}

const link = readLink();
if (!link.token) {
    showResult({
        ok: false,
        title: 'Link incompleto',
        text: link.mode === 'email'
            ? 'Abra o link de confirmação exatamente como chegou no seu e-mail.'
            : 'Abra o link exatamente como chegou no seu e-mail, ou peça um novo em "Esqueci minha senha" na tela de entrada.',
        linkText: 'Ir para a tela de entrada'
    });
} else if (link.mode === 'email') {
    confirmEmail(link.token);
} else {
    setupReset(link.token);
}
