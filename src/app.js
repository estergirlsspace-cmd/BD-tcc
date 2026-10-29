const http = require('node:http');
const { ApiError } = require('./errors');
const { handleApiRequest } = require('./routes/api');
const { handleWebRequest } = require('./routes/web');
const { sendJson, GLOBAL_HEADERS } = require('./utils/http');

function createApp() {
    return http.createServer((request, response) => {
        for (const [name, value] of Object.entries(GLOBAL_HEADERS)) response.setHeader(name, value);
        const handler = request.url.startsWith('/api')
            ? handleApiRequest(request, response)
            : handleWebRequest(request, response).then((handled) => {
                if (!handled) {
                    return handleApiRequest(request, response);
                }
            });

        handler.catch((error) => {
            if (response.headersSent) {
                response.destroy(error);
                return;
            }

            if (error instanceof ApiError) {
                sendJson(response, error.statusCode, { erro: error.message });
                return;
            }

            if (error.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(error.message)) {
                sendJson(response, 409, {
                    erro: 'Não foi possível salvar o registro por conflito com dados existentes.'
                });
                return;
            }

            console.error('Erro ao processar requisição:', error);
            sendJson(response, 500, { erro: 'Erro interno do servidor.' });
        });
    });
}

module.exports = { createApp };
