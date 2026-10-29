const database = require('../database');
const { ApiError } = require('../errors');
const { readTextBody, sendJson } = require('../utils/http');
const { parseCsv } = require('../utils/csv');
const { normalizeEmail } = require('../services/email');
const notificacoes = require('../services/notificacoes');
const { registrar } = require('../services/auditoria');
const {
    requireRole, parseMatricula, initialPasswordHash, insertStudent, STUDENT_NAME_MAX
} = require('./schoolController');

// Importação de alunos por planilha CSV (só gestão): POST /api/matriculas/importar[?simular=1].
// Mesmas regras da matrícula individual (POST /api/matriculas). Tudo ou nada: com qualquer erro
// nada é gravado. O CPF só serve para a senha inicial "ceep@" + 4 primeiros dígitos: nunca é
// gravado, devolvido, registrado em log nem citado em mensagens.

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const HASH_CONCURRENCY = 4;
const COLUMNS = ['matricula', 'nome', 'turma', 'cpf', 'email'];
const REQUIRED_COLUMNS = ['matricula', 'nome', 'turma', 'cpf'];
const ACCEPTED_TYPES = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'];

// Uma importação de cada vez: os hashes ocupam a fila de criptografia do Node.
let importInProgress = false;

// Comparação sem acento, maiúscula ou espaços extras; "ª"/"º" valem "a"/"o" e qualquer traço
// (—, –, -) vale "-" (ex.: "1a serie - informatica" = "1ª Série — Informática").
function fold(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\u00aa/g, 'a').replace(/\u00ba/g, 'o')
        .replace(/[\u2010-\u2015\u2212-]/g, '-')
        .toLowerCase().replace(/\s+/g, ' ').replace(/ ?- ?/g, '-').trim();
}

function columnKey(value) {
    return fold(value).replace(/[^a-z0-9]/g, '');
}

function shorten(value, max = 40) {
    const chars = Array.from(value);
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : value;
}

// 4 primeiros dígitos do CPF (aceita só os 4 ou o CPF inteiro, com ou sem pontuação).
function cpfStart(value) {
    const raw = String(value).trim();
    if (!/^[\d.\-\s/]+$/.test(raw)) return null;
    const digits = raw.replace(/\D/g, '');
    return digits.length === 4 || digits.length === 11 ? digits.slice(0, 4) : null;
}

function emptyReport(erros = []) {
    return { total: 0, validos: 0, erros, alunos: [] };
}

// Valida a planilha inteira. Devolve { report, students } — students só das linhas válidas,
// com `cpf4` (mantido só em memória até calcular o hash).
function validateSheet(text) {
    const { header, rows } = parseCsv(text, { maxRows: MAX_ROWS });
    if (!header) {
        return { report: emptyReport([{ linha: 1, campo: 'cabecalho', mensagem: 'A planilha está vazia.' }]), students: [] };
    }
    const positions = {};
    const headerErrors = [];
    header.forEach((title, index) => {
        const key = columnKey(title);
        if (!COLUMNS.includes(key)) return;
        if (key in positions) {
            headerErrors.push({ linha: 1, campo: 'cabecalho', mensagem: `A coluna "${key}" aparece mais de uma vez.` });
        }
        positions[key] = index;
    });
    for (const column of REQUIRED_COLUMNS) {
        if (!(column in positions)) {
            headerErrors.push({ linha: 1, campo: 'cabecalho', mensagem: `Falta a coluna "${column}" no cabeçalho.` });
        }
    }
    if (headerErrors.length) {
        return { report: { ...emptyReport(headerErrors), total: rows.length }, students: [] };
    }

    const classes = database.prepare('SELECT id_turma, nome_turma, curso, serie FROM turmas ORDER BY nome_turma').all();
    const classByName = new Map(classes.map((row) => [fold(row.nome_turma), row]));
    const validClassNames = classes.map((row) => row.nome_turma).join(', ') || 'nenhuma cadastrada';
    const loginExists = database.prepare('SELECT 1 FROM usuarios WHERE login = ?');
    const emailExists = database.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?');
    const seenMatriculas = new Map();
    const seenEmails = new Map();
    const erros = [];
    const students = [];

    for (const { linha, cells } of rows) {
        const cell = (column) => (column in positions ? (cells[positions[column]] ?? '') : '').trim();
        const rowErrors = [];
        const fail = (campo, mensagem) => rowErrors.push({ linha, campo, mensagem });

        const matricula = parseMatricula(cell('matricula'));
        if (!matricula) {
            fail('matricula', 'Matrícula inválida: use só números (3 a 20 dígitos).');
        } else if (seenMatriculas.has(matricula)) {
            fail('matricula', `Matrícula repetida na planilha (já aparece na linha ${seenMatriculas.get(matricula)}).`);
        } else {
            seenMatriculas.set(matricula, linha);
            if (loginExists.get(matricula)) fail('matricula', 'Já existe um usuário com essa matrícula.');
        }

        const nome = cell('nome').replace(/\s+/g, ' ');
        if (!nome) fail('nome', 'Informe o nome do aluno.');
        else if (nome.length > STUDENT_NAME_MAX) fail('nome', `O nome pode ter no máximo ${STUDENT_NAME_MAX} caracteres.`);

        const turmaText = cell('turma');
        const schoolClass = turmaText ? classByName.get(fold(turmaText)) : null;
        if (!turmaText) fail('turma', `Informe a turma. Turmas válidas: ${validClassNames}.`);
        else if (!schoolClass) {
            fail('turma', `Turma "${shorten(turmaText)}" não encontrada. Turmas válidas: ${validClassNames}.`);
        }

        const cpf4 = cpfStart(cell('cpf'));
        if (!cpf4) fail('cpf', `CPF inválido na linha ${linha}.`);

        const emailText = cell('email');
        let email = null;
        if (emailText) {
            email = normalizeEmail(emailText);
            if (!email) {
                fail('email', 'E-mail inválido (ou deixe a célula vazia).');
            } else if (seenEmails.has(email)) {
                fail('email', `E-mail repetido na planilha (já aparece na linha ${seenEmails.get(email)}).`);
            } else {
                seenEmails.set(email, linha);
                if (emailExists.get(email)) fail('email', 'Este e-mail já está em uso em outra conta.');
            }
        }

        if (rowErrors.length) erros.push(...rowErrors);
        else students.push({ linha, matricula, nome, schoolClass, email, cpf4 });
    }

    return {
        report: {
            total: rows.length,
            validos: students.length,
            erros,
            alunos: students.map((student) => ({
                linha: student.linha,
                matricula: student.matricula,
                nome: student.nome,
                turma: student.schoolClass.nome_turma
            }))
        },
        students
    };
}

// Hash da senha inicial de cada aluno, no máximo HASH_CONCURRENCY ao mesmo tempo. Cada conta tem
// o próprio sal, mesmo com o mesmo início de CPF.
async function hashAll(students) {
    const hashes = new Array(students.length);
    let next = 0;
    async function worker() {
        while (next < students.length) {
            const index = next;
            next += 1;
            hashes[index] = await initialPasswordHash(students[index].cpf4);
        }
    }
    await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, students.length) }, worker));
    return hashes;
}

// E-mails de confirmação espaçados (o provedor limita envios por segundo): um a cada 550 ms,
// em segundo plano, depois do COMMIT.
const EMAIL_SPACING_MS = 550;
function sendConfirmationsSpaced(pending) {
    let index = 0;
    function sendNext() {
        if (index >= pending.length) return;
        const { userId, email, confirmationToken } = pending[index];
        index += 1;
        notificacoes.sendEmailConfirmation(userId, email, confirmationToken);
        if (index < pending.length) setTimeout(sendNext, EMAIL_SPACING_MS).unref();
    }
    sendNext();
}

function assertCsvRequest(request) {
    const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ACCEPTED_TYPES.includes(type)) {
        throw new ApiError(415, 'Envie a planilha como CSV (Content-Type: text/csv).');
    }
}

async function importStudents(request, response, user, searchParams) {
    requireRole(user, ['gestao']);
    const simulate = searchParams.get('simular');
    if (simulate !== null && simulate !== '1' && simulate !== '0') {
        throw new ApiError(400, 'Use "simular=1" para só verificar a planilha.');
    }
    assertCsvRequest(request);
    if (importInProgress) {
        throw new ApiError(429, 'Já há uma importação em andamento. Aguarde terminar e tente de novo.');
    }
    importInProgress = true;
    try {
        const text = await readTextBody(request, MAX_BYTES, 'A planilha');
        const { report, students } = validateSheet(text);
        if (simulate === '1') {
            sendJson(response, 200, report);
            return;
        }
        if (report.erros.length) {
            sendJson(response, 400, report);
            return;
        }
        if (!students.length) {
            sendJson(response, 400, {
                ...report,
                erros: [{ linha: 1, campo: 'planilha', mensagem: 'A planilha não tem nenhum aluno para importar.' }]
            });
            return;
        }

        // Hashes antes da transação; o CPF sai da memória dos registros logo depois.
        const hashes = await hashAll(students);
        for (const student of students) delete student.cpf4;

        const created = [];
        database.exec('BEGIN IMMEDIATE');
        try {
            // Revalida dentro da transação: alguém pode ter cadastrado a mesma matrícula/e-mail
            // enquanto os hashes eram calculados.
            const loginExists = database.prepare('SELECT 1 FROM usuarios WHERE login = ?');
            const emailExists = database.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?');
            const classExists = database.prepare('SELECT 1 FROM turmas WHERE id_turma = ?');
            if (students.some((s) => loginExists.get(s.matricula)
                || (s.email && emailExists.get(s.email)) || !classExists.get(s.schoolClass.id_turma))) {
                throw new ApiError(409, 'Os cadastros mudaram durante a importação. Verifique a planilha de novo.');
            }
            students.forEach((student, index) => {
                const { userId, confirmationToken } = insertStudent({
                    matricula: student.matricula,
                    passwordHash: hashes[index],
                    nome: student.nome,
                    schoolClass: student.schoolClass,
                    email: student.email
                });
                if (student.email) created.push({ userId, email: student.email, confirmationToken });
            });
            database.exec('COMMIT');
        } catch (error) {
            database.exec('ROLLBACK');
            throw error;
        }
        sendConfirmationsSpaced(created);
        registrar(user, 'aluno.importar', `lote:${students.length}`);
        sendJson(response, 201, { ...report, importados: students.length });
    } finally {
        importInProgress = false;
    }
}

async function handleImportacaoRequest(request, response, user, parts, searchParams) {
    if (parts.length !== 3) throw new ApiError(404, 'Rota não encontrada.');
    if (request.method !== 'POST') throw new ApiError(405, 'Método não permitido.');
    await importStudents(request, response, user, searchParams);
}

module.exports = { handleImportacaoRequest, validateSheet, cpfStart };
