// Componente compartilhado de Mensagens (C·Warning) — usado pelos portais do aluno, do
// professor e da gestão. Sem dependências: só DOM, textContent e os ícones Phosphor da página.
//
// USO
//   <link rel="stylesheet" href="/componentes/mensagens.css">
//   <script src="/componentes/mensagens.js" defer></script>
//
//   const painel = CwMensagens.montar(container, {
//       api,                 // obrigatório: async (path, options) => JSON já convertido; lança Error
//                            //   com .message legível em caso de falha (a função de API da página,
//                            //   que já envia o token). options = { method, body: JSON string }.
//       usuario,             // obrigatório: { id_usuario, nome, tipo_usuario } (o GET /api/me).
//       aoMudarNaoLidas      // opcional: (total) => void — chamado quando o total de não lidas
//                            //   das conversas muda (para o portal atualizar o badge).
//   });
//
//   painel.atualizar()            // recarrega a lista de conversas (e a conversa aberta).
//   painel.novaConversa()         // abre a busca de contatos ("Nova conversa").
//   painel.abrirCom(id_usuario)   // abre a conversa com essa pessoa (cria ao enviar a 1ª mensagem).
//   painel.desmontar()            // para o polling e limpa o container. Chame ao sair da seção
//                                 // (sem isso o polling continua). Montar de novo no mesmo container
//                                 // enquanto a instância está viva devolve a mesma instância.
//
// LAYOUT: o container precisa de altura definida (ex.: height: calc(100dvh - 180px)); o componente
// ocupa 100% dela (mínimo 460px). Usa container query: abaixo de 720px de largura do próprio
// container, lista e conversa viram telas separadas (com botão "Voltar").
//
// API consumida (docs/sprint-2-contrato.md §3): GET /api/mensagens, GET /api/mensagens/contatos,
// GET /api/mensagens/:id_conversa?depois=<id_mensagem>, POST /api/mensagens { para, texto }.
// Polling de 15 s (conversa aberta + lista) só com a aba visível.

'use strict';

(function () {
    const POLL_MS = 15000;
    const MAX_TEXT = 2000;
    const TIME_ZONE = 'America/Sao_Paulo';
    // Em tela de toque, Enter quebra a linha (o envio é pelo botão).
    const COARSE_POINTER = window.matchMedia('(pointer: coarse)');
    const PROFILE_LABELS = { aluno: 'Aluno(a)', professor: 'Professor(a)', gestao: 'Coordenação' };

    // h('div', { class, text, on: { click }, ...atributos }, ...filhos)
    function h(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key === 'on') {
                for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
            } else if (value === true) node.setAttribute(key, '');
            else node.setAttribute(key, String(value));
        }
        for (const child of children.flat()) {
            if (child === null || child === undefined || child === false) continue;
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return node;
    }

    const icon = (name) => h('i', { class: `ph ph-${name}`, 'aria-hidden': 'true' });

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    function normalize(text) {
        return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }

    // criado_em vem do SQLite em UTC sem fuso ("AAAA-MM-DD HH:MM:SS").
    function parseUtc(value) {
        if (!value) return null;
        const text = String(value);
        const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function dayKey(date) {
        return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(date);
    }

    function dayDiff(date) {
        const toNumber = (d) => Date.parse(`${dayKey(d)}T00:00:00Z`) / 86400000;
        return toNumber(new Date()) - toNumber(date);
    }

    function timeLabel(date) {
        return date.toLocaleTimeString('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
    }

    // Lista: "09:42", "ontem", "seg", "12/10".
    function shortWhen(value) {
        const date = parseUtc(value);
        if (!date) return '';
        const diff = dayDiff(date);
        if (diff <= 0) return timeLabel(date);
        if (diff === 1) return 'ontem';
        if (diff < 7) return new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'short' }).format(date).replace('.', '');
        return date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' });
    }

    function dayLabel(date) {
        const diff = dayDiff(date);
        if (diff <= 0) return 'Hoje';
        if (diff === 1) return 'Ontem';
        return date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' });
    }

    function fullWhen(date) {
        return `${date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE })} às ${timeLabel(date)}`;
    }

    function personDetail(person) {
        const label = PROFILE_LABELS[person?.perfil];
        const detail = person?.detalhe && person.detalhe !== label ? person.detalhe : null;
        return [label, detail].filter(Boolean).join(' · ');
    }

    let instanceCount = 0;
    const INSTANCE_KEY = Symbol('cwMensagens');

    function montar(container, options = {}) {
        if (!container || typeof options.api !== 'function') {
            throw new Error('CwMensagens.montar(container, { api, usuario }) precisa do container e da função api.');
        }
        // Idempotente: montar de novo no mesmo container (ex.: o portal redesenhou a seção) devolve
        // a instância viva, sem perder a conversa aberta. Depois de desmontar(), monta do zero.
        const alive = container[INSTANCE_KEY];
        if (alive && !alive.destroyed && container.contains(alive.root)) return alive.publicApi;
        if (alive && !alive.destroyed) alive.publicApi.desmontar();
        const { api, usuario = {}, aoMudarNaoLidas } = options;
        const uid = `cwm${(instanceCount += 1)}`;
        const state = {
            conversations: null,      // null = carregando
            listError: null,
            listSignature: null,
            contacts: null,
            contactsError: null,
            search: '',
            contactSearch: '',
            mode: 'lista',            // 'lista' | 'contatos'
            open: null,               // { id_conversa|null, com:{...}, messages:[], status, error }
            sending: false,
            lastTotal: null,
            timer: null,
            destroyed: false
        };

        // ------------------------------------------------------------ estrutura fixa

        const listPane = h('section', { class: 'cwm-lista', 'aria-labelledby': `${uid}-titulo` });
        const threadPane = h('section', { class: 'cwm-conversa', 'aria-label': 'Conversa' });
        const root = h('div', { class: 'cwm', 'data-tela': 'lista' }, listPane, threadPane);
        container.replaceChildren(root);

        const status = h('p', { class: 'cwm-sr', role: 'status' });
        root.append(status);

        function announce(text) {
            status.textContent = '';
            window.setTimeout(() => { status.textContent = text; }, 50);
        }

        function setScreen(screen) {
            root.dataset.tela = screen;
        }

        // ------------------------------------------------------------ dados

        function messageId(message) {
            return Number(message.id_mensagem ?? message.id ?? 0);
        }

        function isMine(message) {
            if (typeof message.minha === 'boolean') return message.minha;
            if (message.minha === 0 || message.minha === 1) return Boolean(message.minha);
            const sender = message.id_remetente ?? message.de ?? message.id_usuario;
            return sender !== undefined && Number(sender) === Number(usuario.id_usuario);
        }

        function asMessageList(result) {
            if (Array.isArray(result)) return result;
            if (Array.isArray(result?.mensagens)) return result.mensagens;
            return [];
        }

        function totalUnread() {
            return (state.conversations || []).reduce((sum, item) => sum + (Number(item.nao_lidas) || 0), 0);
        }

        function reportUnread() {
            if (!state.conversations) return;
            const total = totalUnread();
            if (total !== state.lastTotal) {
                state.lastTotal = total;
                if (typeof aoMudarNaoLidas === 'function') aoMudarNaoLidas(total);
            }
        }

        async function loadConversations({ quiet = false } = {}) {
            if (!quiet) {
                state.listError = null;
                if (!state.conversations) renderList();
            }
            try {
                const result = await api('/api/mensagens');
                const list = Array.isArray(result) ? result : (result?.conversas || []);
                const signature = JSON.stringify(list);
                if (quiet && signature === state.listSignature && !state.listError) return;
                state.listSignature = signature;
                state.conversations = list;
                state.listError = null;
                if (state.open && !state.open.id_conversa) {
                    const found = state.conversations.find((item) => Number(item.com?.id_usuario) === Number(state.open.com.id_usuario));
                    if (found) state.open.id_conversa = found.id_conversa;
                }
                if (state.open?.id_conversa) {
                    const current = state.conversations.find((item) => item.id_conversa === state.open.id_conversa);
                    if (current) current.nao_lidas = 0;
                }
            } catch (error) {
                if (!quiet || !state.conversations) state.listError = error.message || 'Não foi possível carregar as conversas.';
            }
            if (state.mode === 'lista') renderList();
            reportUnread();
        }

        async function loadContacts() {
            state.contactsError = null;
            try {
                const result = await api('/api/mensagens/contatos');
                state.contacts = Array.isArray(result) ? result : (result?.contatos || []);
            } catch (error) {
                state.contactsError = error.message || 'Não foi possível carregar os contatos.';
            }
            if (state.mode === 'contatos') renderContacts();
        }

        async function loadMessages({ incremental = false } = {}) {
            const open = state.open;
            if (!open || !open.id_conversa) return;
            const last = open.messages.length ? messageId(open.messages[open.messages.length - 1]) : 0;
            const path = `/api/mensagens/${encodeURIComponent(open.id_conversa)}${incremental && last ? `?depois=${last}` : ''}`;
            try {
                let result = await api(path);
                if (state.open !== open) return;
                let list = asMessageList(result);
                // O servidor pagina (100 por vez, "mais": true): busca o resto em sequência.
                for (let page = 0; result?.mais && list.length && page < 20; page += 1) {
                    result = await api(`/api/mensagens/${encodeURIComponent(open.id_conversa)}?depois=${messageId(list[list.length - 1])}`);
                    if (state.open !== open) return;
                    list = list.concat(asMessageList(result));
                }
                if (result && !Array.isArray(result)) {
                    if (result.com && !open.com.nome) open.com = result.com;
                    if (typeof result.pode_responder === 'boolean' && result.pode_responder !== open.canReply) {
                        open.canReply = result.pode_responder;
                        if (incremental) renderThread();
                    }
                }
                if (incremental) {
                    const known = new Set(open.messages.map(messageId));
                    const fresh = list.filter((message) => !known.has(messageId(message)));
                    if (fresh.length) {
                        open.messages.push(...fresh);
                        appendMessages(fresh);
                        const received = fresh.filter((message) => !isMine(message));
                        if (received.length) announce(`${received.length === 1 ? 'Nova mensagem' : `${received.length} novas mensagens`} de ${open.com.nome || 'contato'}.`);
                    }
                } else {
                    open.messages = list;
                    open.status = 'ok';
                    renderThread();
                }
                const current = (state.conversations || []).find((item) => item.id_conversa === open.id_conversa);
                if (current && current.nao_lidas) {
                    current.nao_lidas = 0;
                    if (state.mode === 'lista') renderList();
                    reportUnread();
                }
            } catch (error) {
                if (state.open !== open || incremental) return;
                open.status = 'error';
                open.error = error.message || 'Não foi possível abrir a conversa.';
                renderThread();
            }
        }

        // ------------------------------------------------------------ polling

        function tick() {
            if (state.destroyed || document.hidden) return;
            loadConversations({ quiet: true });
            if (state.open?.id_conversa && state.open.status === 'ok') loadMessages({ incremental: true });
        }

        function onVisibility() {
            if (!document.hidden) tick();
        }

        state.timer = window.setInterval(tick, POLL_MS);
        document.addEventListener('visibilitychange', onVisibility);

        // ------------------------------------------------------------ lista de conversas

        function avatar(name, size = '') {
            return h('span', { class: `cwm-avatar${size ? ` cwm-avatar--${size}` : ''}`, 'aria-hidden': 'true', text: initials(name) });
        }

        function listHeader(title, action) {
            return h('div', { class: 'cwm-lista-topo' },
                h('h2', { class: 'cwm-lista-titulo', id: `${uid}-titulo`, text: title }),
                action);
        }

        function searchField(id, label, value, onInput) {
            const input = h('input', {
                class: 'cwm-busca-campo', id, type: 'search', placeholder: label, autocomplete: 'off', maxlength: '80'
            });
            input.value = value;
            input.addEventListener('input', () => onInput(input.value));
            return h('div', { class: 'cwm-busca' },
                h('label', { class: 'cwm-sr', for: id, text: label }),
                icon('magnifying-glass'), input);
        }

        function stateBox(kind, text, retry) {
            return h('div', { class: `cwm-estado cwm-estado--${kind}`, role: kind === 'erro' ? 'alert' : null },
                icon(kind === 'erro' ? 'warning-circle' : kind === 'vazio' ? 'chat-circle-dots' : 'circle-notch'),
                h('p', { text }),
                retry ? h('button', { class: 'cwm-botao cwm-botao--contorno', type: 'button', on: { click: retry } },
                    icon('arrow-clockwise'), 'Tentar de novo') : null);
        }

        function renderList() {
            if (state.mode !== 'lista') return;
            const searchId = `${uid}-busca`;
            const hadFocus = document.activeElement?.id === searchId;
            const focusedConversation = listPane.contains(document.activeElement)
                ? document.activeElement.dataset?.conversa : null;
            const newButton = h('button', {
                class: 'cwm-botao-icone cwm-botao-icone--primario', type: 'button',
                'aria-label': 'Nova conversa', title: 'Nova conversa', on: { click: novaConversa }
            }, icon('note-pencil'));

            const nodes = [listHeader('Mensagens', newButton)];
            if (state.conversations?.length) {
                nodes.push(searchField(searchId, 'Buscar conversa', state.search, (value) => {
                    state.search = value;
                    renderList();
                }));
            }

            const body = h('div', { class: 'cwm-lista-corpo' });
            if (state.listError && !state.conversations) {
                body.append(stateBox('erro', state.listError, () => loadConversations()));
            } else if (!state.conversations) {
                body.append(stateBox('carregando', 'Carregando conversas…'));
            } else {
                const term = normalize(state.search);
                const list = state.conversations.filter((item) => !term
                    || normalize(`${item.com?.nome} ${item.com?.detalhe || ''}`).includes(term));
                if (!state.conversations.length) {
                    body.append(stateBox('vazio', 'Nenhuma conversa ainda.'),
                        h('button', { class: 'cwm-botao cwm-botao--primario cwm-centro', type: 'button', on: { click: novaConversa } },
                            icon('note-pencil'), 'Começar uma conversa'));
                } else if (!list.length) {
                    body.append(stateBox('vazio', 'Nenhuma conversa encontrada.'));
                } else {
                    body.append(h('ul', { class: 'cwm-itens', 'aria-label': 'Conversas' }, list.map(conversationItem)));
                }
            }
            nodes.push(body);
            listPane.replaceChildren(...nodes);
            if (focusedConversation) {
                listPane.querySelector(`[data-conversa="${CSS.escape(focusedConversation)}"]`)?.focus();
            }
            if (hadFocus) {
                const input = document.getElementById(searchId);
                if (input) {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }
        }

        function conversationItem(item) {
            const unread = Number(item.nao_lidas) || 0;
            const active = state.open?.id_conversa === item.id_conversa;
            const preview = item.ultima ? `${item.ultima.minha ? 'Você: ' : ''}${item.ultima.texto || ''}` : 'Sem mensagens';
            const srParts = [item.com?.nome, unread ? `${unread} ${unread === 1 ? 'não lida' : 'não lidas'}` : null].filter(Boolean);
            return h('li', {},
                h('button', {
                    class: `cwm-item${active ? ' ativo' : ''}${unread ? ' nao-lida' : ''}`, type: 'button',
                    'aria-current': active ? 'true' : null,
                    'data-conversa': item.id_conversa,
                    on: { click: () => openConversation({ id_conversa: item.id_conversa, com: item.com || {} }) }
                },
                avatar(item.com?.nome),
                h('span', { class: 'cwm-item-texto' },
                    h('span', { class: 'cwm-item-linha' },
                        h('span', { class: 'cwm-item-nome', text: item.com?.nome || 'Contato' }),
                        h('span', { class: 'cwm-item-hora', text: shortWhen(item.ultima?.criado_em) })),
                    h('span', { class: 'cwm-item-linha' },
                        h('span', { class: 'cwm-item-previa', text: preview }),
                        unread ? h('span', { class: 'cwm-badge', 'aria-hidden': 'true', text: unread > 99 ? '99+' : String(unread) }) : null)),
                h('span', { class: 'cwm-sr', text: srParts.length > 1 ? `, ${srParts.slice(1).join(', ')}` : '' })));
        }

        // ------------------------------------------------------------ nova conversa (contatos)

        function novaConversa() {
            state.mode = 'contatos';
            state.contactSearch = '';
            setScreen('lista');
            renderContacts();
            const input = document.getElementById(`${uid}-contatos`);
            if (input) input.focus();
            if (!state.contacts) loadContacts();
        }

        function closeContacts() {
            state.mode = 'lista';
            renderList();
            listPane.querySelector('.cwm-botao-icone--primario')?.focus();
        }

        function renderContacts() {
            if (state.mode !== 'contatos') return;
            const searchId = `${uid}-contatos`;
            const hadFocus = document.activeElement?.id === searchId;
            const back = h('button', {
                class: 'cwm-botao-icone', type: 'button', 'aria-label': 'Voltar para as conversas', title: 'Voltar',
                on: { click: closeContacts }
            }, icon('arrow-left'));
            const header = h('div', { class: 'cwm-lista-topo' },
                back, h('h2', { class: 'cwm-lista-titulo', id: `${uid}-titulo`, text: 'Nova conversa' }));
            const field = searchField(searchId, 'Buscar pessoa', state.contactSearch, (value) => {
                state.contactSearch = value;
                renderContacts();
            });
            const body = h('div', { class: 'cwm-lista-corpo' });
            if (state.contactsError) {
                body.append(stateBox('erro', state.contactsError, loadContacts));
            } else if (!state.contacts) {
                body.append(stateBox('carregando', 'Carregando contatos…'));
            } else {
                const term = normalize(state.contactSearch);
                const list = state.contacts.filter((person) => !term
                    || normalize(`${person.nome} ${person.detalhe || ''} ${PROFILE_LABELS[person.perfil] || ''}`).includes(term));
                if (!list.length) {
                    body.append(stateBox('vazio', state.contacts.length ? 'Ninguém encontrado com esse nome.' : 'Nenhum contato disponível.'));
                } else {
                    body.append(h('ul', { class: 'cwm-itens', 'aria-label': 'Contatos' }, list.map((person) => h('li', {},
                        h('button', {
                            class: 'cwm-item', type: 'button',
                            on: { click: () => startWith(person) }
                        },
                        avatar(person.nome),
                        h('span', { class: 'cwm-item-texto' },
                            h('span', { class: 'cwm-item-nome', text: person.nome || 'Contato' }),
                            h('span', { class: 'cwm-item-previa', text: personDetail(person) })))))));
                }
            }
            listPane.replaceChildren(header, field, body);
            if (hadFocus) {
                const input = document.getElementById(searchId);
                if (input) {
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }
            }
        }

        function startWith(person) {
            state.mode = 'lista';
            const existing = (state.conversations || []).find((item) => Number(item.com?.id_usuario) === Number(person.id_usuario));
            renderList();
            openConversation(existing
                ? { id_conversa: existing.id_conversa, com: existing.com || person }
                : { id_conversa: null, com: person });
        }

        async function abrirCom(idUsuario) {
            const id = Number(idUsuario);
            if (!state.conversations) await loadConversations();
            const existing = (state.conversations || []).find((item) => Number(item.com?.id_usuario) === id);
            if (existing) {
                openConversation({ id_conversa: existing.id_conversa, com: existing.com });
                return;
            }
            if (!state.contacts) await loadContacts();
            const person = (state.contacts || []).find((item) => Number(item.id_usuario) === id);
            if (person) openConversation({ id_conversa: null, com: person });
            else novaConversa();
        }

        // ------------------------------------------------------------ conversa aberta

        let logNode = null;
        let lastDayRendered = null;

        function openConversation({ id_conversa, com }) {
            state.open = { id_conversa, com: com || {}, messages: [], status: id_conversa ? 'loading' : 'ok', error: null, canReply: true };
            setScreen('conversa');
            if (state.mode === 'lista') renderList();
            renderThread();
            threadPane.querySelector('.cwm-conversa-nome')?.focus({ preventScroll: true });
            if (id_conversa) loadMessages();
        }

        function backToList() {
            const id = state.open?.id_conversa;
            setScreen('lista');
            const button = id ? listPane.querySelector(`[data-conversa="${CSS.escape(String(id))}"]`) : null;
            (button || listPane.querySelector('button'))?.focus();
        }

        function bubble(message) {
            const mine = isMine(message);
            const date = parseUtc(message.criado_em);
            return h('li', { class: `cwm-msg${mine ? ' cwm-msg--minha' : ''}` },
                h('div', { class: 'cwm-balao' },
                    h('span', { class: 'cwm-sr', text: mine ? 'Você: ' : `${state.open.com.nome || 'Contato'}: ` }),
                    h('p', { class: 'cwm-msg-texto', text: message.texto || '' }),
                    date ? h('time', { class: 'cwm-msg-hora', datetime: date.toISOString(), title: fullWhen(date), text: timeLabel(date) }) : null));
        }

        function appendMessages(list) {
            if (!logNode) return;
            const empty = logNode.querySelector('.cwm-vazio-conversa');
            if (empty) empty.remove();
            const nearBottom = logNode.scrollHeight - logNode.scrollTop - logNode.clientHeight < 80;
            const ul = logNode.querySelector('.cwm-msgs') || logNode.appendChild(h('ul', { class: 'cwm-msgs' }));
            for (const message of list) {
                const date = parseUtc(message.criado_em);
                const key = date ? dayKey(date) : null;
                if (key && key !== lastDayRendered) {
                    lastDayRendered = key;
                    ul.append(h('li', { class: 'cwm-dia', 'aria-hidden': 'true' }, h('span', { text: dayLabel(date) })));
                }
                ul.append(bubble(message));
            }
            if (nearBottom || list.some(isMine)) logNode.scrollTop = logNode.scrollHeight;
        }

        function renderThread() {
            const open = state.open;
            logNode = null;
            lastDayRendered = null;
            if (!open) {
                threadPane.replaceChildren(h('div', { class: 'cwm-placeholder' },
                    icon('chat-circle-dots'),
                    h('p', { class: 'cwm-placeholder-titulo', text: 'Suas mensagens' }),
                    h('p', { text: 'Escolha uma conversa ou comece uma nova.' }),
                    h('button', { class: 'cwm-botao cwm-botao--primario', type: 'button', on: { click: novaConversa } },
                        icon('note-pencil'), 'Nova conversa')));
                return;
            }
            const header = h('div', { class: 'cwm-conversa-topo' },
                h('button', {
                    class: 'cwm-botao-icone cwm-voltar', type: 'button', 'aria-label': 'Voltar para as conversas',
                    on: { click: backToList }
                }, icon('arrow-left')),
                avatar(open.com.nome, 'grande'),
                h('div', { class: 'cwm-conversa-titulos' },
                    h('h3', { class: 'cwm-conversa-nome', tabindex: '-1', text: open.com.nome || 'Contato' }),
                    personDetail(open.com) ? h('p', { class: 'cwm-conversa-detalhe', text: personDetail(open.com) }) : null));

            logNode = h('div', { class: 'cwm-log', role: 'log', 'aria-label': `Mensagens com ${open.com.nome || 'contato'}`, tabindex: '0' });
            if (open.status === 'loading') {
                logNode.append(stateBox('carregando', 'Carregando mensagens…'));
                logNode.setAttribute('aria-busy', 'true');
            } else if (open.status === 'error') {
                logNode.append(stateBox('erro', open.error, () => {
                    open.status = 'loading';
                    renderThread();
                    loadMessages();
                }));
            } else if (!open.messages.length) {
                logNode.append(h('div', { class: 'cwm-vazio-conversa' },
                    icon('hand-waving'),
                    h('p', { text: `Envie a primeira mensagem para ${open.com.nome || 'este contato'}.` })));
            }

            const footer = open.canReply === false
                ? h('p', { class: 'cwm-sem-resposta' }, icon('lock-simple'), 'Você não pode mais responder nesta conversa.')
                : composer(open);
            threadPane.replaceChildren(header, logNode, footer);
            if (open.status === 'ok' && open.messages.length) appendMessages(open.messages);
            logNode.scrollTop = logNode.scrollHeight;
        }

        function composer(open) {
            const fieldId = `${uid}-texto`;
            const counterId = `${uid}-contador`;
            const errorId = `${uid}-erro`;
            const textarea = h('textarea', {
                class: 'cwm-campo', id: fieldId, rows: '1', maxlength: String(MAX_TEXT),
                placeholder: 'Escreva uma mensagem', 'aria-describedby': `${counterId} ${errorId}`,
                disabled: open.status !== 'ok'
            });
            const counter = h('span', { class: 'cwm-contador', id: counterId, 'aria-live': 'polite' });
            const errorLine = h('p', { class: 'cwm-erro', id: errorId, role: 'alert' });
            const send = h('button', {
                class: 'cwm-enviar', type: 'submit', 'aria-label': 'Enviar mensagem', title: 'Enviar',
                disabled: open.status !== 'ok'
            }, icon('paper-plane-right'));

            const grow = () => {
                textarea.style.setProperty('height', 'auto');
                textarea.style.setProperty('height', `${Math.min(textarea.scrollHeight, 140)}px`);
                const left = MAX_TEXT - textarea.value.length;
                counter.textContent = left <= 200 ? `${left} caracteres restantes` : '';
            };
            textarea.addEventListener('input', () => {
                errorLine.textContent = '';
                grow();
            });
            textarea.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !COARSE_POINTER.matches) {
                    event.preventDefault();
                    form.requestSubmit();
                }
            });

            const form = h('form', { class: 'cwm-envio', novalidate: true },
                h('label', { class: 'cwm-sr', for: fieldId, text: `Mensagem para ${open.com.nome || 'contato'}` }),
                textarea, send,
                h('div', { class: 'cwm-envio-rodape' },
                    h('span', { class: 'cwm-dica', text: 'Enter envia · Shift+Enter quebra a linha' }), counter),
                errorLine);
            form.addEventListener('submit', async (event) => {
                event.preventDefault();
                const text = textarea.value.trim();
                if (!text || state.sending) {
                    if (!text) textarea.focus();
                    return;
                }
                state.sending = true;
                send.disabled = true;
                textarea.setAttribute('aria-busy', 'true');
                try {
                    const result = await api('/api/mensagens', {
                        method: 'POST', body: JSON.stringify({ para: Number(open.com.id_usuario), texto: text })
                    });
                    if (state.open !== open) return;
                    textarea.value = '';
                    grow();
                    const newId = result?.id_conversa ?? result?.mensagem?.id_conversa;
                    if (!open.id_conversa && newId) open.id_conversa = newId;
                    const sent = result?.mensagem || (result && result.texto !== undefined ? result : null);
                    if (open.messages.length && open.id_conversa) {
                        // Busca o que chegou depois da última mensagem (inclui a recém-enviada).
                        await loadMessages({ incremental: true });
                    }
                    if (sent && !open.messages.some((message) => messageId(message) === messageId(sent))) {
                        const wasEmpty = !open.messages.length;
                        open.messages.push({ ...sent, minha: true });
                        if (wasEmpty) renderThread();
                        else appendMessages([{ ...sent, minha: true }]);
                    }
                    loadConversations({ quiet: true });
                    announce('Mensagem enviada.');
                } catch (error) {
                    errorLine.textContent = error.message || 'Não foi possível enviar a mensagem.';
                } finally {
                    state.sending = false;
                    send.disabled = false;
                    textarea.removeAttribute('aria-busy');
                    if (state.open === open) threadPane.querySelector('.cwm-campo')?.focus();
                }
            });
            return form;
        }

        // ------------------------------------------------------------ início

        renderList();
        renderThread();
        loadConversations();

        const publicApi = {
            atualizar: () => loadConversations({ quiet: true }).then(() => {
                if (state.open?.id_conversa && state.open.status === 'ok') loadMessages({ incremental: true });
            }),
            novaConversa,
            abrirCom,
            desmontar() {
                state.destroyed = true;
                window.clearInterval(state.timer);
                document.removeEventListener('visibilitychange', onVisibility);
                if (container[INSTANCE_KEY]?.publicApi === publicApi) delete container[INSTANCE_KEY];
                container.replaceChildren();
            }
        };
        container[INSTANCE_KEY] = { root, publicApi, get destroyed() { return state.destroyed; } };
        return publicApi;
    }

    window.CwMensagens = { montar };
}());
