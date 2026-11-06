// Portal da Gestão — Configurações: perfil e e-mail, senha, notificações por e-mail,
// aparência (window.cwAparencia), senha e segurança (com dispositivos conectados) e privacidade (LGPD).

(function () {
'use strict';

const G = window.CwGestao;
const { $, $$, el, icon, button, badge, onSource, renderStatusInto, emptyState } = G;

const CONFIG_TABS = ['perfil', 'senha', 'notificacoes', 'aparencia', 'privacidade'];
// Endereços antigos que agora vivem dentro de outra aba.
const TAB_ALIASES = { dispositivos: 'senha', seguranca: 'senha' };
const NOTIFICATION_TYPES = [
    ['urgente', 'Avisos urgentes', 'Quando um aviso marcado como urgente é publicado.'],
    ['turma', 'Avisos de turma', 'Avisos publicados para turmas.'],
    ['prazos', 'Prazos', 'Lembrete na véspera de prazos de entrega.'],
    ['eventos', 'Eventos', 'Avisos de eventos da escola.']
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
            button([icon('trash'), 'Remover'], 'botao botao-texto botao-perigo-texto botao-pequeno', () => {
                box.replaceChildren(removeEmailForm());
                $('#campo-email-remover-senha')?.focus();
            }));
        box.replaceChildren(el('div', { class: 'linha-email' },
            icon('envelope-simple'), el('strong', { text: email }), badge('Confirmado', 'ok'), actions));
        return;
    }
    const inputId = 'campo-email-novo';
    const input = el('input', { id: inputId, type: 'email', maxlength: 254, required: true, autocomplete: 'email', spellcheck: 'false' });
    const password = currentPasswordField('campo-email-senha');
    const submit = el('button', { type: 'submit', class: 'botao botao-primario' }, 'Enviar link de confirmação');
    const form = el('form', { class: 'formulario formulario-estreito' },
        el('div', { class: 'campo' }, el('label', { for: inputId, text: email ? 'Novo e-mail' : 'Seu e-mail' }), input),
        password.field,
        el('div', { class: 'linha-botoes' }, submit,
            email ? button('Cancelar', 'botao botao-secundario', () => { editingEmail = false; renderEmail(); }) : null));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runFormAction(form, submit, async () => {
            const address = input.value.trim();
            const result = await G.sendJson('/api/conta/email', 'POST', { email: address, senha_atual: password.input.value });
            editingEmail = false;
            box.replaceChildren(el('div', { class: 'aviso-info', role: 'status' }, icon('envelope-simple-open'),
                el('p', { text: result?.mensagem || `Enviamos um link para ${address}. Abra o e-mail e confirme para concluir.` })));
            G.showSuccess('Link de confirmação enviado.');
        }, { fieldFor: G.fieldByMessage([[/senha|tentativas/i, password.input], [/e-mail/i, input]]) });
    });
    box.replaceChildren(form);
}

// Trocar ou remover o e-mail pede a senha atual (a API exige "senha_atual").
function currentPasswordField(id) {
    const input = el('input', { id, type: 'password', maxlength: 128, required: true, autocomplete: 'current-password' });
    const field = el('div', { class: 'campo' },
        el('label', { for: id, text: 'Sua senha atual' }),
        el('small', { id: `${id}-dica`, class: 'texto-suave bloco', text: 'Para sua segurança, confirme que é você.' }),
        input);
    input.setAttribute('aria-describedby', `${id}-dica`);
    return { input, field };
}

function removeEmailForm() {
    const password = currentPasswordField('campo-email-remover-senha');
    const submit = el('button', { type: 'submit', class: 'botao botao-perigo' }, icon('trash'), 'Remover e-mail');
    const cancel = button('Cancelar', 'botao botao-secundario', () => {
        renderEmail();
        $('#perfil-email .linha-email .acoes button')?.focus();
    });
    const form = el('form', { class: 'formulario formulario-estreito' },
        el('p', { text: 'Remover o e-mail? Você deixa de receber notificações e não consegue recuperar a senha sozinho.' }),
        password.field,
        el('div', { class: 'linha-botoes' }, submit, cancel));
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        G.runFormAction(form, submit, async () => {
            await G.api('/api/conta/email', { method: 'DELETE', body: JSON.stringify({ senha_atual: password.input.value }) });
            G.showSuccess('E-mail removido.');
            await G.loadSource('conta', { silent: true });
        }, { fieldFor: G.fieldByMessage([[/senha|tentativas/i, password.input]]) });
    });
    return form;
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
                question: others === 1
                    ? 'Encerrar a sessão no outro aparelho?'
                    : `Encerrar as ${others} sessões em outros aparelhos?`,
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
        G.runFormAction(form, submit, async () => {
            const newPassword = $('#senha-nova').value;
            if (newPassword !== $('#senha-confirmacao').value) {
                throw G.fieldError($('#senha-confirmacao'), 'As duas senhas novas não são iguais.');
            }
            const result = await G.sendJson('/api/auth/password', 'POST', {
                senha_atual: $('#senha-atual').value,
                nova_senha: newPassword
            });
            form.reset();
            G.showSuccess(result.mensagem);
        }, { fieldFor: G.fieldByMessage([[/nova senha/i, $('#senha-nova')], [/atual|tentativas/i, $('#senha-atual')], [/./, $('#senha-nova')]]) });
    });
}

// ---------------------------------------------------------------- privacidade (LGPD)

// Data de hoje em Brasília (AAAA-MM-DD) para o nome do arquivo exportado.
function schoolToday() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

// Aba e painel criados aqui para não mexer no HTML da página.
function setupPrivacy() {
    const tabs = $('[data-pagina="configuracoes"] .segmentos-abas');
    if (!tabs || $('[data-config="privacidade"]')) return;
    tabs.append(el('a', { class: 'segmento', href: '#/configuracoes/privacidade', dataset: { abaConfig: 'privacidade' }, text: 'Privacidade' }));
    const download = button([icon('download-simple'), 'Baixar meus dados'], 'botao botao-primario', () =>
        G.runAction(download, async () => {
            await G.downloadAuthenticated('/api/privacidade/meus-dados', `cw-meus-dados-${schoolToday()}.json`);
            G.showSuccess('Arquivo com os seus dados baixado.');
        }));
    tabs.parentElement.append(el('div', { dataset: { config: 'privacidade' }, hidden: true },
        el('section', { class: 'cartao' },
            el('div', { class: 'cartao-cabecalho' },
                el('h2', { text: 'Privacidade' }),
                el('p', { class: 'texto-suave', text: 'Como o C·Warning usa os dados de estudantes, professores e gestão, com base na LGPD.' })),
            el('p', {},
                el('a', { class: 'link', href: '/privacidade', target: '_blank', rel: 'noopener' },
                    'Ler a política de privacidade e os termos de uso', G.srText(' (abre em nova aba)')))),
        el('section', { class: 'cartao' },
            el('div', { class: 'cartao-cabecalho' },
                el('h2', { text: 'Seus dados' }),
                el('p', { class: 'texto-suave', text: 'Baixe uma cópia de tudo o que o sistema guarda sobre você (arquivo .json). O pedido fica no registro de auditoria.' })),
            el('div', { class: 'linha-botoes' }, download))));
}

// ---------------------------------------------------------------- seção

function showTab(tab) {
    const wanted = TAB_ALIASES[tab] || tab;
    configTab = CONFIG_TABS.includes(wanted) ? wanted : 'perfil';
    $$('[data-aba-config]').forEach((node) => {
        const active = node.dataset.abaConfig === configTab;
        node.classList.toggle('ativo', active);
        if (active) node.setAttribute('aria-current', 'page');
        else node.removeAttribute('aria-current');
    });
    $$('[data-config]').forEach((panel) => { panel.hidden = panel.dataset.config !== configTab; });
    if (['perfil', 'notificacoes'].includes(configTab)) G.ensureSource('conta');
    if (configTab === 'senha') G.loadSource('sessoes');
}

G.sections.configuracoes = {
    title: 'Perfil da Gestão',
    description: 'Seus dados, senha e segurança, notificações e aparência.',
    setup() {
        renderProfile();
        setupPasswordForm();
        setupAppearance();
        setupPrivacy();
        onSource(['conta'], () => {
            renderEmail();
            renderNotifications();
        });
        onSource(['sessoes'], renderSessions);
    },
    show: showTab
};
}());
