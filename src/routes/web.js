const { readFile, realpath, stat } = require('node:fs/promises');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', '..', 'public');

const pageRoutes = new Map([
    ['/', 'index.html'],
    ['/aluno', 'aluno.html'],
    ['/professor', 'professor.html'],
    ['/gestao', 'gestao.html']
]);

const contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.woff2', 'font/woff2'],
    ['.png', 'image/png'],
    ['.ico', 'image/x-icon']
]);

const immutablePrefixes = ['vendor/', 'assets/'];

const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': [
        "default-src 'self'",
        "connect-src 'self'",
        "style-src 'self'",
        "script-src 'self'",
        "font-src 'self'",
        "img-src 'self' data:",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; ')
};

let publicRootPromise;

function getPublicRoot() {
    publicRootPromise ??= realpath(publicDirectory);
    return publicRootPromise;
}

// Converte o caminho da URL num caminho relativo seguro dentro de public/, ou null.
function toRelativeFile(pathname) {
    const page = pageRoutes.get(pathname);
    if (page) {
        return page;
    }

    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return null;
    }

    if (decoded.includes('\0') || decoded.includes('\\') || !decoded.startsWith('/')) {
        return null;
    }

    const segments = decoded.slice(1).split('/');
    const isUnsafe = segments.some((segment) => segment === '' || segment.startsWith('.'));
    if (isUnsafe || !contentTypes.has(path.extname(decoded).toLowerCase())) {
        return null;
    }

    return segments.join('/');
}

async function resolveFile(relativeFile) {
    const root = await getPublicRoot();
    const candidate = path.resolve(root, relativeFile);
    if (!candidate.startsWith(root + path.sep)) {
        return null;
    }

    try {
        const realFile = await realpath(candidate);
        if (!realFile.startsWith(root + path.sep) || !(await stat(realFile)).isFile()) {
            return null;
        }
        return realFile;
    } catch {
        return null;
    }
}

function cacheControlFor(relativeFile) {
    return immutablePrefixes.some((prefix) => relativeFile.startsWith(prefix))
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
}

async function handleWebRequest(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
    }

    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
        return false;
    }

    const relativeFile = toRelativeFile(pathname);
    const file = relativeFile && await resolveFile(relativeFile);
    if (!file) {
        return false;
    }

    const content = await readFile(file);
    response.writeHead(200, {
        ...securityHeaders,
        'Content-Type': contentTypes.get(path.extname(file).toLowerCase()),
        'Content-Length': content.length,
        'Cache-Control': cacheControlFor(relativeFile)
    });
    response.end(request.method === 'HEAD' ? undefined : content);
    return true;
}

module.exports = { handleWebRequest };
