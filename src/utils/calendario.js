const { ApiError } = require('../errors');
const { SCHOOL_UTC_OFFSET_HOURS, parseSchoolDate } = require('./dates');

const HOUR_MS = 60 * 60 * 1000;

// "Agora" no horário de Brasília: data (AAAA-MM-DD), dia da semana ISO (1 = segunda … 7 = domingo,
// a mesma convenção de horarios.dia_semana) e hora (HH:MM).
function schoolNow(now = Date.now()) {
    const local = new Date(now + SCHOOL_UTC_OFFSET_HOURS * HOUR_MS);
    const iso = local.toISOString();
    return { data: iso.slice(0, 10), dia_semana: local.getUTCDay() || 7, hora: iso.slice(11, 16) };
}

// Data "AAAA-MM-DD" somada de `days` dias úteis (segunda a sexta; feriados não são considerados).
function addBusinessDays(date, days) {
    const [year, month, day] = date.split('-').map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, day));
    let remaining = days;
    while (remaining > 0) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        const weekday = cursor.getUTCDay();
        if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return cursor.toISOString().slice(0, 10);
}

// Início do ano letivo: 1º de fevereiro do ano corrente (no horário de Brasília).
const SCHOOL_YEAR_START = '02-01';

function isWeekend(date) {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return weekday === 0 || weekday === 6;
}

// Data de aula para lançar presença: dia útil, do início do ano letivo até hoje. Sem isso uma
// falta retroativa (ou de um dia sem aula) nasceria já fora do prazo de justificativa.
function parseClassDate(value, field, now = Date.now()) {
    const date = parseSchoolDate(value, field, { allowTime: false });
    const today = schoolNow(now).data;
    const yearStart = `${today.slice(0, 4)}-${SCHOOL_YEAR_START}`;
    if (date > today) throw new ApiError(400, 'Não é possível lançar chamada em data futura.');
    if (date < yearStart) {
        throw new ApiError(400, `A data da aula deve ser a partir do início do ano letivo (${yearStart}).`);
    }
    if (isWeekend(date)) throw new ApiError(400, 'Não há aula no fim de semana: escolha um dia útil.');
    return date;
}

// "AAAA-MM-DD HH:MM:SS" em UTC (CURRENT_TIMESTAMP do SQLite) → data de Brasília "AAAA-MM-DD".
function schoolDateOfTimestamp(sqliteTimestamp) {
    return schoolNow(Date.parse(`${sqliteTimestamp.replace(' ', 'T')}Z`)).data;
}

module.exports = { schoolNow, addBusinessDays, isWeekend, parseClassDate, schoolDateOfTimestamp };
