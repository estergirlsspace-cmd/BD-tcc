const { test } = require('node:test');
const assert = require('node:assert/strict');
const { schoolNow, addBusinessDays } = require('../../src/utils/calendario');

test('schoolNow converte para o horário de Brasília (UTC-3) com dia ISO 1..7', () => {
    // 2026-11-02 02:30 UTC = domingo 2026-11-01 23:30 em Brasília.
    assert.deepEqual(schoolNow(Date.parse('2026-11-02T02:30:00Z')), { data: '2026-11-01', dia_semana: 7, hora: '23:30' });
    // 2026-11-02 12:05 UTC = segunda 09:05.
    assert.deepEqual(schoolNow(Date.parse('2026-11-02T12:05:00Z')), { data: '2026-11-02', dia_semana: 1, hora: '09:05' });
    assert.equal(schoolNow(Date.parse('2026-11-07T15:00:00Z')).dia_semana, 6);
});

test('addBusinessDays pula sábado e domingo', () => {
    assert.equal(addBusinessDays('2026-10-26', 5), '2026-11-02', 'segunda + 5 = segunda seguinte');
    assert.equal(addBusinessDays('2026-10-30', 1), '2026-11-02', 'sexta + 1 = segunda');
    assert.equal(addBusinessDays('2026-10-30', 5), '2026-11-06', 'sexta + 5 = sexta seguinte');
    assert.equal(addBusinessDays('2026-10-31', 1), '2026-11-02', 'falta no sábado: + 1 = segunda');
    assert.equal(addBusinessDays('2026-11-01', 5), '2026-11-06', 'domingo + 5 = sexta');
    assert.equal(addBusinessDays('2026-10-28', 0), '2026-10-28');
});

test('addBusinessDays atravessa mês e ano', () => {
    assert.equal(addBusinessDays('2026-12-30', 3), '2027-01-04');
    assert.equal(addBusinessDays('2028-02-28', 1), '2028-02-29');
});
