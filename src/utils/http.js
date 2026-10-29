const { ApiError } = require('../errors');

// Cabeçalhos aplicados a toda resposta (páginas, arquivos estáticos e API), em app.js.
// HSTS só tem efeito em HTTPS (produção); localmente, em HTTP, o navegador o ignora.
const GLOBAL_HEADERS = {
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000'
};

async function readBody(request) {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;
        if (size > 1024 * 1024) {
            throw new ApiError(413, 'O corpo da requisição excede 1 MB.');
        }
        chunks.push(chunk);
    }

    let body;
    try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new ApiError(400, 'O corpo da requisição deve conter JSON válido.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
    }
    return body;
}

// Corpo de texto (ex.: CSV) com limite em bytes: 413 acima do limite, 400 se não for UTF-8
// válido. O BOM inicial (Excel) é removido.
async function readTextBody(request, maxBytes, label = 'O arquivo') {
    const declaredLength = Number(request.headers['content-length']);
    const limitLabel = maxBytes >= 1024 * 1024 ? `${maxBytes / (1024 * 1024)} MB` : `${maxBytes} bytes`;
    if (declaredLength > maxBytes) {
        throw new ApiError(413, `${label} excede o limite de ${limitLabel}.`);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBytes) throw new ApiError(413, `${label} excede o limite de ${limitLabel}.`);
        chunks.push(chunk);
    }
    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
    } catch {
        throw new ApiError(400, `${label} deve estar em UTF-8 (no Excel: "CSV UTF-8").`);
    }
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        // Respostas da API carregam dados pessoais e tokens: nunca guardar em cache.
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(data));
}

module.exports = { readBody, readTextBody, sendJson, GLOBAL_HEADERS };
