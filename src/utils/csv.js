const { ApiError } = require('../errors');

// CSV para planilhas em português: UTF-8 com BOM (o Excel reconhece os acentos), separador ";"
// e linhas CRLF. Células que começam com = + - @ (ou tabulação/retorno) recebem um apóstrofo na
// frente para que a planilha não as execute como fórmula (injeção de CSV).
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (FORMULA_START.test(text)) text = `'${text}`;
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
    const lines = [header, ...rows].map((row) => row.map(csvCell).join(';'));
    return `\uFEFF${lines.join('\r\n')}\r\n`;
}

// Número decimal com vírgula, como a planilha em pt-BR espera; vazio quando não há valor.
function decimal(value) {
    return value === null || value === undefined ? '' : String(value).replace('.', ',');
}

function sendCsv(response, fileName, header, rows) {
    const body = toCsv(header, rows);
    response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(body);
}

// Leitura de CSV (importação por planilha). Separador ";", "," ou tab, escolhido pelo que mais
// aparece na primeira linha (fora de aspas); aspas duplas com "" como escape; linhas CRLF, LF ou
// CR; quebras de linha dentro de aspas. Devolve { header, rows: [{ linha, cells }] }, em que
// `linha` é o número do registro na planilha (cabeçalho = 1). Linhas totalmente vazias são
// ignoradas. Os valores são sempre texto: nada é avaliado, uma célula "=SOMA(...)" é só texto.
// `maxRows` limita as linhas de dados (400 acima disso); erro de aspas sem fechar também é 400.
const CSV_SEPARATORS = [';', ',', '\t'];

function detectSeparator(text) {
    let inQuotes = false;
    const counts = { ';': 0, ',': 0, '\t': 0 };
    for (const char of text) {
        if (char === '"') inQuotes = !inQuotes;
        else if (!inQuotes && (char === '\n' || char === '\r')) break;
        else if (!inQuotes && char in counts) counts[char] += 1;
    }
    return CSV_SEPARATORS.reduce((best, sep) => (counts[sep] > counts[best] ? sep : best), ';');
}

function parseCsv(text, { maxRows = Infinity } = {}) {
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const separator = detectSeparator(source);
    let header = null;
    const rows = [];
    let lineNumber = 0;
    let record = [];
    let cell = '';
    let inQuotes = false;
    let quotedStartRecord = 0;

    function endRecord() {
        record.push(cell);
        cell = '';
        lineNumber += 1;
        const cells = record;
        record = [];
        if (cells.every((value) => value.trim() === '')) return;
        if (!header) {
            header = cells;
            return;
        }
        if (rows.length >= maxRows) {
            throw new ApiError(400, `A planilha pode ter no máximo ${maxRows} linhas de dados.`);
        }
        rows.push({ linha: lineNumber, cells });
    }

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (inQuotes) {
            if (char === '"') {
                if (source[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cell += char;
            }
        } else if (char === '"' && cell.trim() === '') {
            inQuotes = true;
            cell = '';
            quotedStartRecord = lineNumber + 1;
        } else if (char === separator) {
            record.push(cell);
            cell = '';
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && source[i + 1] === '\n') i += 1;
            endRecord();
        } else {
            cell += char;
        }
    }
    if (inQuotes) {
        throw new ApiError(400, `Aspas sem fechamento a partir da linha ${quotedStartRecord} da planilha.`);
    }
    if (cell !== '' || record.length) endRecord();

    return { separator, header, rows };
}

module.exports = { toCsv, csvCell, decimal, sendCsv, parseCsv };
