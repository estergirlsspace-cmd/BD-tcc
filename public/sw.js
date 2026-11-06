// Service worker do C-Warning (PWA).
// - Estáticos (CSS, JS, fontes, ícones): cache primeiro, atualizado em segundo plano.
// - Páginas (navegações): rede primeiro; sem rede, mostra /offline.html.
// - /api/*, requisições não-GET, outras origens e qualquer coisa com Authorization: nunca passam por aqui.
// - Respostas com Cache-Control no-store/private nunca são guardadas.
// Ao mudar a casca (ou esta lista), suba a versão de CACHE para descartar o cache antigo.

const CACHE = 'cw-v9';
const OFFLINE_URL = '/offline.html';

// Obrigatórios: sem eles a página offline não funciona, então a instalação falha.
const ESSENCIAIS = [
    OFFLINE_URL,
    '/offline.css',
    '/tema.css',
    '/preferencias.js',
    '/vendor/phosphor/regular.css',
    '/vendor/phosphor/Phosphor.woff2',
    '/manifest.webmanifest',
    '/assets/icones/favicon.svg',
    '/assets/icones/favicon-32.png',
    '/assets/icones/icone-192.png',
    '/assets/icones/icone-512.png',
    '/assets/icones/icone-512-maskable.png',
    '/assets/icones/apple-touch-icon.png'
];

// Melhor esforço: se algum sumir num deploy futuro, a instalação segue sem ele.
const CASCA = [
    '/vendor/phosphor/fill.css',
    '/vendor/phosphor/Phosphor-Fill.woff2',
    '/styles.css',
    '/inicio.css',
    '/aluno.css',
    '/professor.css',
    '/gestao.css',
    '/notificacoes.css',
    '/componentes/mensagens.css',
    '/componentes/formulario.css',
    '/privacidade.css',
    '/app.js',
    '/aluno.js',
    '/professor.js',
    '/gestao.js',
    '/gestao-base.js',
    '/gestao-acompanhamento.js',
    '/gestao-avisos.js',
    '/gestao-conta.js',
    '/gestao-pessoas.js',
    '/gestao-horarios.js',
    '/gestao-importacao.js',
    '/gestao-salvos.js',
    '/redefinir.js',
    '/datas.js',
    '/notificacoes.js',
    '/componentes/mensagens.js',
    '/componentes/formulario.js',
    '/pwa.js'
];

const EXTENSOES_ESTATICAS = /\.(?:css|js|woff2|png|svg|ico|webmanifest)$/i;

function podeGuardar(response) {
    if (!response || !response.ok || response.type !== 'basic' || response.redirected) {
        return false;
    }
    const cacheControl = (response.headers.get('Cache-Control') || '').toLowerCase();
    return !/no-store|private/.test(cacheControl);
}

async function buscarEGuardar(cache, request) {
    const response = await fetch(request);
    if (podeGuardar(response)) {
        await cache.put(request, response.clone());
    }
    return response;
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        // cache: 'reload' ignora o cache HTTP do navegador e busca a versão atual do servidor.
        await Promise.all(ESSENCIAIS.map((url) => buscarEGuardar(cache, new Request(url, { cache: 'reload' }))
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Falha ao guardar ${url}: ${response.status}`);
                }
            })));
        await Promise.allSettled(CASCA.map((url) => buscarEGuardar(cache, new Request(url, { cache: 'reload' }))));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const nomes = await caches.keys();
        await Promise.all(nomes
            .filter((nome) => nome.startsWith('cw-') && nome !== CACHE)
            .map((nome) => caches.delete(nome)));
        await self.clients.claim();
    })());
});

async function paginaRedePrimeiro(request) {
    try {
        return await fetch(request);
    } catch {
        const offline = await caches.match(OFFLINE_URL);
        return offline || new Response('Sem conexão.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

async function estaticoCachePrimeiro(event) {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(event.request);
    const atualizacao = buscarEGuardar(cache, event.request);

    if (guardado) {
        // Devolve o que já tem e atualiza em segundo plano para a próxima visita.
        event.waitUntil(atualizacao.catch(() => undefined));
        return guardado;
    }
    return atualizacao;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || request.headers.has('Authorization')) {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(paginaRedePrimeiro(request));
        return;
    }

    if (EXTENSOES_ESTATICAS.test(url.pathname)) {
        event.respondWith(estaticoCachePrimeiro(event));
    }
});
