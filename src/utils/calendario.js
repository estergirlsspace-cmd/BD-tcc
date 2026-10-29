const { SCHOOL_UTC_OFFSET_HOURS } = require('./dates');

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

module.exports = { schoolNow, addBusinessDays };
