// Registra o service worker do C-Warning (PWA). Falha em silêncio: o site funciona igual sem ele.
(function () {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
        return;
    }

    // Deploy novo: quando o service worker novo assume uma página que já era controlada pelo antigo,
    // recarrega uma vez para não misturar HTML novo com CSS/JS guardados da versão anterior.
    if (navigator.serviceWorker.controller) {
        var recarregou = false;
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (recarregou) return;
            recarregou = true;
            window.location.reload();
        });
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
