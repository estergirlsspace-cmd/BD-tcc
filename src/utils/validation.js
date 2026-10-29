
const { ApiError } = require('../errors');
const { hashPassword } = require('./password');
const { parseSchoolDate } = require('./dates');

// Tamanho máximo dos campos de texto (o formulário também limita, mas a API não pode confiar nele).
const MAX_TEXT_LENGTH = {
    login: 100,
    nome: 150,
    nome_turma: 100,
    nome_disciplina: 100,
    titulo: 200,
    conteudo: 10000,
    senha: 128
};

async function parseBody(body, resource, isCreate) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiError(400, 'O corpo da requisição deve ser um objeto JSON.');
    }

    const fields = Object.keys(body);
    const unknownFields = fields.filter((field) => !resource.fields.includes(field));
    if (unknownFields.length > 0) {
        throw new ApiError(400, `Campo(s) não permitido(s): ${unknownFields.join(', ')}.`);
    }

    if (isCreate) {
        const missingFields = resource.required.filter((field) => body[field] === undefined);
        if (missingFields.length > 0) {
            throw new ApiError(400, `Campo(s) obrigatório(s): ${missingFields.join(', ')}.`);
        }
    }

    if (Object.hasOwn(body, 'tipo_usuario')
        && !['aluno', 'professor', 'gestao'].includes(body.tipo_usuario)) {
        throw new ApiError(400, 'Tipo de usuário inválido.');
    }

    if (Object.hasOwn(body, 'curso')
        && body.curso !== null
        && !['informatica', 'redes'].includes(body.curso)) {
        throw new ApiError(400, 'O curso deve ser "informatica" ou "redes".');
    }

    if (resource.table === 'turmas' && isCreate
        && (!['informatica', 'redes'].includes(body.curso)
            || !Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)) {
        throw new ApiError(400, 'Informe curso e série válidos para a turma.');
    }

    if (body.tipo_usuario === 'aluno'
        && ((isCreate && !['informatica', 'redes'].includes(body.curso))
            || (Object.hasOwn(body, 'curso') && !['informatica', 'redes'].includes(body.curso))
            || (Object.hasOwn(body, 'serie')
                && (!Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)))) {
        throw new ApiError(400, 'Informe curso e série válidos para o aluno.');
    }

    if (body.tipo_usuario === 'professor' && body.curso != null) {
        throw new ApiError(400, 'O perfil de professor não deve informar curso.');
    }

    if (body.tipo_usuario === 'gestao' && (body.curso != null || body.serie != null)) {
        throw new ApiError(400, 'O perfil de gestão não deve informar curso ou série.');
    }

    if (Object.hasOwn(body, 'serie')
        && body.serie !== null
        && (!Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)) {
        throw new ApiError(400, 'A série deve ser um número entre 1 e 3.');
    }

    if (body.tipo_usuario === 'aluno' && isCreate
        && (!['informatica', 'redes'].includes(body.curso)
            || !Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)) {
        throw new ApiError(400, 'Informe curso e série válidos para o aluno.');
    }

    if (resource.table === 'turmas'
        && ((Object.hasOwn(body, 'curso') && !['informatica', 'redes'].includes(body.curso))
            || (Object.hasOwn(body, 'serie')
                && (!Number.isInteger(body.serie) || body.serie < 1 || body.serie > 3)))) {
        throw new ApiError(400, 'Informe curso e série válidos para a turma.');
    }

    if (Object.hasOwn(body, 'tipo')
        && !['aviso', 'evento', 'avaliacao', 'atividade', 'comunicado'].includes(body.tipo)) {
        throw new ApiError(400, 'Tipo de publicação inválido.');
    }

    for (const [field, value] of Object.entries(body)) {
        if (value === null) {
            if (resource.required.includes(field)) {
                throw new ApiError(400, `O campo "${field}" não pode ser nulo.`);
            }
            continue;
        }

        if (resource.secret === field) {
            if (typeof value !== 'string' || value.length < 8 || value.length > MAX_TEXT_LENGTH.senha) {
                throw new ApiError(400, 'A senha deve ser um texto com 8 a 128 caracteres.');
            }
            continue;
        }

        const isTextField = ['login', 'tipo_usuario', 'nome', 'nome_turma', 'titulo', 'conteudo',
            'nome_disciplina', 'tipo', 'curso']
            .includes(field);
        if (isTextField && (typeof value !== 'string' || value.trim().length === 0)) {
            throw new ApiError(400, `O campo "${field}" deve ser um texto não vazio.`);
        }
        if (isTextField && MAX_TEXT_LENGTH[field] && value.length > MAX_TEXT_LENGTH[field]) {
            throw new ApiError(400,
                `O campo "${field}" pode ter no máximo ${MAX_TEXT_LENGTH[field]} caracteres.`);
        }

        if (field === 'area' && !['natureza', 'humanas', 'linguagens', 'matematica',
            'informatica', 'redes'].includes(value)) {
            throw new ApiError(400, 'Área inválida. Use natureza, humanas, linguagens, matematica, informatica ou redes.');
        }

        if (field === 'data_evento') {
            body[field] = parseSchoolDate(value, 'data_evento');
            continue;
        }

        const isIdField = field.startsWith('id_');
        if (isIdField && (!Number.isInteger(value) || value < 1)) {
            throw new ApiError(400, `O campo "${field}" deve ser um número inteiro positivo.`);
        }
    }

    const values = {};
    for (const field of fields) {
        values[field] = field === resource.secret ? await hashPassword(body[field]) : body[field];
    }
    return values;
}

module.exports = { parseBody };
