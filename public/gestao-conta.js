// Portal da Gestão — Configurações: perfil e e-mail, senha, notificações por e-mail,
// aparência (window.cwAparencia) e dispositivos conectados.

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$, el, icon, button, badge, onSource, renderStatusInto, emptyState } = G;

const CONFIG_TABS = ['perfil', 'senha', 'notificacoes', 'aparencia', 'dispositivos'];
const NOTIFICATION_TYPES = [
    ['urgente', 'Avisos urgentes', 'Quando um aviso marcado como urgente é publicado.'],
    ['turma', 'Avisos de turma', 'Avisos publicados para turmas.'],
    ['prazos', 'Prazos', 'Lembrete na véspera de prazos de entrega.'],
    ['eventos', 'Eventos', 'Avisos de eventos da escola.'],
    ['mensagens', 'Mensagens', 'Quando você recebe uma mensagem nova.']
];
let configTab = 'perfil';
let editingEmail = false;

// ---------------------------------------------------------------- perfil e e-mail

function renderProfile() {
    const user = G.state.user;
    if (!user) return;
    $('#perfil-detalhe').textContent = ['Gestão escolar', user.login ? `usuário ${user.login}` : ''].filter(Boolean).join(' · ');
}

function renderEmail() {
    const box = $('#perfil-email');
    if (!renderStatusInto(box, ['conta'], 'Carregando…')) return;
    const email = G.source('conta').data?.email || null;
    if (email && !editingEmail) {
        const actions = el('div', { class: 'acoes' });
        actions.append(
            button([icon('pencil-simple'), 'Trocar'], 'botao botao-texto botao-pequeno', () => {
                editingEmail = true;
                renderEmail();
                $('#campo-email-novo')?.focus();
            }),
            button([icon('trash'), 'Remover'], 'botao botao-texto botao-perigo-texto botao-pequeno', () =>
                G.confirmInline(actions, {
                    question: 'Remover o e-mail? Você deixa de receber notificações e não consegue recuperar a senha sozinho.',
                    confirmLabel: 'Remover',
                    onConfirm: async () => {
                        await G.api('/api/conta/email', { method: 'DELETE' });
                        G.showSuccess('E-mail removido.');
                        await G.loadSource('conta', { silent: true });
                    }
                })));
        box.replaceChildren(el('div', { class: 'linha-email' },
            icon('envelope-simple'), el('strong', { text: email }), badge('Confirmado', 'ok'), actions));
        return;
    }
    const inputId = 'campo-email-novo';
    const input = el('input', { id: inputId, type: 'email', maxlength: 254, required: true, autocomplete: 'email', spellcheck: 'false' });
    const submit = el('button', { type: 'submit', class: 'botao botao-primario' }, 'Enviar link de confirmação');
    const form = el('form', { class: 'formulario formulario-estreito' },
        el('div', { class: 'campo' }, el('label', { for: inputId, text: email ? 'Novo e-mail' : 'Seu e-mail' }), input),
        el('div', { class: 'linha-botoes' }, submit,
            email ? button('Cancelar', 'botao botao-secundario', () => { editingEmail = false; renderEmail(); }) : null));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runAction(submit, async () => {
            const address = input.value.trim();
            const result = await G.sendJson('/api/conta/email', 'POST', { email: address });
            editingEmail = false;
            box.replaceChildren(el('div', { class: 'aviso-info', role: 'status' }, icon('envelope-simple-open'),
                el('p', { text: result?.mensagem || `Enviamos um link para ${address}. Abra o e-mail e confirme para concluir.` })));
            G.showSuccess('Link de confirmação enviado.');
        });
    });
    box.replaceChildren(form);
}

// ---------------------------------------------------------------- notificações

function renderNotifications() {
    const box = $('#config-notificacoes');
    if (!renderStatusInto(box, ['conta'], 'Carregando…')) return;
    const account = G.source('conta').data || {};
    const prefs = account.notificacoes || {};
    const noEmail = !account.email
        ? el('div', { class: 'aviso-info' }, icon('info'),
            el('p', {}, 'Você ainda não tem e-mail cadastrado. ',
                el('a', { href: '#/configuracoes/perfil', class: 'link', text: 'Adicionar e-mail' }), ' para receber as notificações.'))
        : null;
    box.replaceChildren(noEmail, el('ul', { class: 'lista-chaves' }, NOTIFICATION_TYPES.map(([key, label, hint]) => {
        const id = `notif-${key}`;
        const input = el('input', { id, type: 'checkbox', role: 'switch', class: 'chave', 'aria-describedby': `${id}-dica` });
        input.checked = prefs[key] !== false;
        input.addEventListener('change', async () => {
            const next = input.checked;
            const ok = await G.runAction(input, async () => {
                await G.sendJson('/api/conta/notificacoes', 'PUT', { [key]: next });
                return true;
            });
            if (ok) {
                prefs[key] = next;
                G.showSuccess(`${label}: ${next ? 'ligado' : 'desligado'}.`);
            } else {
                input.checked = !next;
            }
        });
        return el('li', { class: 'linha-chave' },
            el('span', {}, el('label', { for: id, text: label }), el('small', { id: `${id}-dica`, class: 'texto-suave bloco', text: hint })),
            input);
    })));
}

// ---------------------------------------------------------------- aparência

function setupAppearance() {
    const prefs = window.cwAparencia?.read() || { tema: 'claro', texto: 'medio' };
    $$('input[name="tema"]').forEach((input) => {
        input.checked = input.value === prefs.tema;
        input.addEventListener('change', () => window.cwAparencia?.save({ tema: input.value }));
    });
    $$('input[name="texto"]').forEach((input) => {
        input.checked = input.value === prefs.texto;
        input.addEventListener('change', () => window.cwAparencia?.save({ texto: input.value }));
    });
}

// ---------------------------------------------------------------- dispositivos

function renderSessions() {
    const box = $('#lista-sessoes');
    if (!renderStatusInto(box, ['sessoes'], 'Carregando dispositivos…')) return;
    const sessions = [...(G.source('sessoes').data || [])]
        .sort((a, b) => Number(b.atual) - Number(a.atual) || String(b.ultimo_acesso || '').localeCompare(String(a.ultimo_acesso || '')));
    if (!sessions.length) {
        box.replaceChildren(emptyState('Nenhum dispositivo conectado.', 'devices'));
        return;
    }
    const list = el('ul', { class: 'lista-registros' }, sessions.map((session) => {
        const actions = el('div', { class: 'acoes' });
        if (session.atual) {
            actions.append(badge('Este aparelho', 'ok'));
        } else {
            actions.append(button([icon('sign-out'), 'Encerrar'], 'botao botao-texto botao-perigo-texto botao-pequeno', () =>
                G.confirmInline(actions, {
                    question: 'Encerrar a sessão neste aparelho?',
                    confirmLabel: 'Encerrar',
                    onConfirm: async () => {
                        await G.api(`/api/conta/sessoes/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
                        G.showSuccess('Sessão encerrada.');
                        await G.loadSource('sessoes', { silent: true });
                    }
                })));
        }
        return el('li', { class: 'registro' },
            el('span', { class: 'registro-icone', 'aria-hidden': 'true' }, icon(/android|iphone|ios/i.test(session.dispositivo || '') ? 'device-mobile' : 'desktop')),
            el('div', { class: 'registro-corpo' },
                el('strong', { text: session.dispositivo || 'Dispositivo desconhecido' }),
                el('p', { class: 'texto-suave', text: session.ultimo_acesso ? `Último acesso em ${G.formatCreated(session.ultimo_acesso)}` : '' })),
            actions);
    }));
    const others = sessions.filter((session) => !session.atual).length;
    const footer = el('div', { class: 'linha-botoes' });
    if (others) {
        footer.append(button([icon('sign-out'), 'Encerrar todas as outras'], 'botao botao-secundario', () =>
            G.confirmInline(footer, {
                question: `Encerrar ${others} sessão(ões) em outros aparelhos?`,
                confirmLabel: 'Encerrar todas',
                onConfirm: async () => {
                    await G.api('/api/conta/sessoes', { method: 'DELETE' });
                    G.showSuccess('As outras sessões foram encerradas.');
                    await G.loadSource('sessoes', { silent: true });
                }
            })));
    }
    box.replaceChildren(list, footer);
}

// ---------------------------------------------------------------- senha

function setupPasswordForm() {
    $('#form-senha').addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('button[type="submit"]');
        G.runAction(submit, async () => {
            const newPassword = $('#senha-nova').value;
            if (newPassword !== $('#senha-confirmacao').value) throw new Error('As duas senhas novas não são iguais.');
            const result = await G.sendJson('/api/auth/password', 'POST', {
                senha_atual: $('#senha-atual').value,
                nova_senha: newPassword
            });
            form.reset();
            G.showSuccess(result.mensagem);
        });
    });
}

// ---------------------------------------------------------------- seção

function showTab(tab) {
    configTab = CONFIG_TABS.includes(tab) ? tab : 'perfil';
    $$('[data-aba-config]').forEach((node) => {
        const active = node.dataset.abaConfig === configTab;
        node.classList.toggle('ativo', active);
        if (active) node.setAttribute('aria-current', 'page');
        else node.removeAttribute('aria-current');
    });
    $$('[data-config]').forEach((panel) => { panel.hidden = panel.dataset.config !== configTab; });
    if (['perfil', 'notificacoes'].includes(configTab)) G.ensureSource('conta');
    if (configTab === 'dispositivos') G.loadSource('sessoes');
}

G.sections.configuracoes = {
    title: 'Configurações',
    description: 'Seu perfil, senha, notificações, aparência e dispositivos.',
    setup() {
        renderProfile();
        setupPasswordForm();
        setupAppearance();
        onSource(['conta'], () => {
            renderEmail();
            renderNotifications();
        });
        onSource(['sessoes'], renderSessions);
    },
    show: showTab
};
}());
