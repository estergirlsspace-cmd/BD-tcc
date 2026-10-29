// Avisos flutuantes (toasts) compartilhados pelos portais.
// Sucesso: verde com ✓, some sozinho. Erro: vermelho com ✕, fica até ser fechado.
// A região é anunciada por leitores de tela (WCAG 4.1.3).
const NOTIFICATION_SUCCESS_MS = 6000;
let notificationRegion;

// A região é criada já no carregamento: leitores de tela só anunciam mudanças em regiões
// que existiam antes da mensagem aparecer.
function notificationContainer() {
    if (!notificationRegion) {
        notificationRegion = document.createElement('div');
        notificationRegion.className = 'toast-region';
        notificationRegion.setAttribute('aria-live', 'polite');
        document.body.append(notificationRegion);
    }
    return notificationRegion;
}
notificationContainer();

function notify(text, type = 'sucesso') {
    if (!text) return;
    const isError = type === 'erro';
    const container = notificationContainer();
    if (isError) container.querySelectorAll('.toast-erro').forEach((toast) => toast.remove());

    const toast = document.createElement('div');
    toast.className = `toast toast-${isError ? 'erro' : 'sucesso'}`;
    toast.setAttribute('role', isError ? 'alert' : 'status');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isError ? '✕' : '✓';

    const message = document.createElement('p');
    message.className = 'toast-text';
    message.textContent = text;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Fechar aviso');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());

    toast.append(icon, message, close);
    container.append(toast);
    if (!isError) setTimeout(() => toast.remove(), NOTIFICATION_SUCCESS_MS);
}

function clearErrorNotifications() {
    notificationRegion?.querySelectorAll('.toast-erro').forEach((toast) => toast.remove());
}
