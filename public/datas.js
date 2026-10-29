// Formatação de datas compartilhada pelos portais, sempre no horário de Brasília.
// - Datas "AAAA-MM-DD" e "AAAA-MM-DDTHH:MM" (data do evento, prazo) são horário local da escola.
// - criado_em vem do SQLite em UTC sem indicação de fuso ("AAAA-MM-DD HH:MM:SS").
const SCHOOL_TIME_ZONE = 'America/Sao_Paulo';
const SCHOOL_UTC_OFFSET_HOURS = -3;

function parseSchoolDate(value, { utc = false } = {}) {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (!match) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const [, y, m, d, hh = '00', mm = '00', ss = '00'] = match;
    const offsetHours = utc ? 0 : SCHOOL_UTC_OFFSET_HOURS;
    return new Date(Date.UTC(+y, +m - 1, +d, +hh - offsetHours, +mm, +ss));
}

function hasTimePart(value) {
    return /[T ]\d{2}:\d{2}/.test(value || '');
}

function formatSchoolDate(value, { utc = false } = {}) {
    const date = parseSchoolDate(value, { utc });
    if (!date) return value || '';
    return date.toLocaleString('pt-BR', {
        timeZone: SCHOOL_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(hasTimePart(value) ? { hour: '2-digit', minute: '2-digit' } : {})
    });
}

// Texto curto para o card: "Evento em 08/11/2026, 19:00" ou "Publicado em 28/10/2026, 22:15".
function noticeDateLabel(notice) {
    if (notice.data_evento) return `Data: ${formatSchoolDate(notice.data_evento)}`;
    if (notice.criado_em) return `Publicado em ${formatSchoolDate(notice.criado_em, { utc: true })}`;
    return '';
}

// Número do dia no calendário de Brasília, para comparar datas sem efeito de fuso.
function schoolDayNumber(date) {
    return Math.floor((date.getTime() + SCHOOL_UTC_OFFSET_HOURS * 3600000) / 86400000);
}

// Dias entre hoje e a data (0 = hoje, 1 = amanhã, negativo = passou).
function daysUntil(value) {
    const date = parseSchoolDate(value);
    return date ? schoolDayNumber(date) - schoolDayNumber(new Date()) : null;
}

function relativeDayLabel(days) {
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Amanhã';
    return `Em ${days} dias`;
}

// Valor ISO para o atributo datetime de <time>.
function isoDateTime(notice) {
    const value = notice.data_evento || notice.criado_em;
    const date = parseSchoolDate(value, { utc: !notice.data_evento });
    return date ? date.toISOString() : '';
}
