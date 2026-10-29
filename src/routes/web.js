const { readFile } = require('node:fs/promises');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', '..', 'public');
const pages = new Map([
    ['/', { file: 'index.html', contentType: 'text/html; charset=utf-8' }],
    ['/aluno', { file: 'aluno.html', contentType: 'text/html; charset=utf-8' }],
    ['/professor', { file: 'professor.html', contentType: 'text/html; charset=utf-8' }],
    ['/gestao', { file: 'gestao.html', contentType: 'text/html; charset=utf-8' }],
    ['/styles.css', { file: 'styles.css', contentType: 'text/css; charset=utf-8' }],
    ['/app.js', { file: 'app.js', contentType: 'text/javascript; charset=utf-8' }],
    ['/aluno.css', { file: 'aluno.css', contentType: 'text/css; charset=utf-8' }],
    ['/aluno.js', { file: 'aluno.js', contentType: 'text/javascript; charset=utf-8' }],
    ['/professor.css', { file: 'professor.css', contentType: 'text/css; charset=utf-8' }],
    ['/professor.js', { file: 'professor.js', contentType: 'text/javascript; charset=utf-8' }],
    ['/datas.js', { file: 'datas.js', contentType: 'text/javascript; charset=utf-8' }],
    ['/gestao.css', { file: 'gestao.css', contentType: 'text/css; charset=utf-8' }],
    ['/gestao.js', { file: 'gestao.js', contentType: 'text/javascript; charset=utf-8' }]
]);

async function handleWebRequest(request, response) {
    const page = pages.get(new URL(request.url, 'http://localhost').pathname);
    if (!page || request.method !== 'GET' && request.method !== 'HEAD') {
        return false;
    }

    const content = await readFile(path.join(publicDirectory, page.file));
    response.writeHead(200, {
        'Content-Type': page.contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'"
    });
    response.end(request.method === 'HEAD' ? undefined : content);
    return true;
}

module.exports = { handleWebRequest };
