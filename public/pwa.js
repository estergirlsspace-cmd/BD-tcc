// Registra o service worker do C-Warning (PWA). Falha em silêncio: o site funciona igual sem ele.
(function () {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        return;
    }

    function register() {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function () {
            /* sem service worker: segue online normalmente */
        });
    }

    if (document.readyState === 'complete') {
        register();
    } else {
        window.addEventListener('load', register, { once: true });
    }
})();
