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

module.exports = { toCsv, csvCell, decimal, sendCsv };
