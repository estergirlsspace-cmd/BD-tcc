const { ApiError } = require('../errors');

// Horário de Brasília (America/Sao_Paulo). Sem horário de verão desde 2019, o deslocamento é fixo.
const SCHOOL_UTC_OFFSET_HOURS = -3;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/;

function isRealDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

// Aceita "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" (segundos e fuso opcionais), conforme a ISO 8601.
// Datas inexistentes, como 31/02, e textos livres são recusados.
function parseSchoolDate(value, field, { allowTime = true } = {}) {
    const example = allowTime ? '"2026-11-08" ou "2026-11-08T19:00"' : '"2026-11-08"';
    const invalid = () => new ApiError(400, `Informe em "${field}" uma data válida, por exemplo ${example}.`);
    if (typeof value !== 'string') throw invalid();
    const trimmed = value.trim();
    const dateOnly = DATE_ONLY.exec(trimmed);
    const dateTime = allowTime ? DATE_TIME.exec(trimmed) : null;
    const match = dateOnly || dateTime;
    if (!match) throw invalid();
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
    if (!isRealDate(Number(year), Number(month), Number(day))
        || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
        throw invalid();
    }
    return trimmed;
}

// Momento (em ms) em que um prazo termina. Data sem horário vale até 23:59:59 daquele dia,
// e horário sem fuso é interpretado como horário de Brasília.
function deadlineTimestamp(value) {
    const dateOnly = DATE_ONLY.exec(value);
    const offsetMs = -SCHOOL_UTC_OFFSET_HOURS * 60 * 60 * 1000;
    if (dateOnly) {
        const [, year, month, day] = dateOnly.map(Number);
        return Date.UTC(year, month - 1, day, 23, 59, 59, 999) + offsetMs;
    }
    const dateTime = DATE_TIME.exec(value);
    if (!dateTime) return Number.NaN;
    if (dateTime[7]) return Date.parse(value);
    const [, year, month, day, hour, minute, second = '0'] = dateTime;
    return Date.UTC(Number(year), Number(month) - 1, Number(day),
        Number(hour), Number(minute), Number(second)) + offsetMs;
}

module.exports = { parseSchoolDate, deadlineTimestamp, SCHOOL_UTC_OFFSET_HOURS };
