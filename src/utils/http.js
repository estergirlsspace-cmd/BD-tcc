const { ApiError } = require('../errors');

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

    try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
        }
        return body;
    } catch {
        if (arguments[0] instanceof ApiError) throw arguments[0];
        throw new ApiError(400, 'O corpo da requisição deve conter JSON válido.');
    }
}

function sendJson(response, statusCode, data) {
    response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(data));
}

module.exports = { readBody, sendJson };
