// Utilitários puros: não importam src/database.js (nenhum banco é aberto).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSchoolDate, deadlineTimestamp, SCHOOL_UTC_OFFSET_HOURS } = require('../../src/utils/dates');
const { ApiError } = require('../../src/errors');

test('parseSchoolDate aceita data e data-hora ISO (com e sem fuso)', () => {
    assert.equal(parseSchoolDate('2026-11-08', 'prazo'), '2026-11-08');
    assert.equal(parseSchoolDate(' 2026-11-08 ', 'prazo'), '2026-11-08');
    assert.equal(parseSchoolDate('2026-11-08T19:00', 'prazo'), '2026-11-08T19:00');
    assert.equal(parseSchoolDate('2026-11-08T19:00:59.123Z', 'prazo'), '2026-11-08T19:00:59.123Z');
    assert.equal(parseSchoolDate('2026-11-08T19:00-03:00', 'prazo'), '2026-11-08T19:00-03:00');
    assert.equal(parseSchoolDate('2028-02-29', 'd'), '2028-02-29', 'ano bissexto');
});

test('parseSchoolDate recusa datas inexistentes, formatos livres e não-texto (400)', () => {
    for (const valor of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '08/11/2026', 'amanhã',
        '2026-11-08T24:00', '2026-11-08T10:60', '2026-11-08 10:00', '', 20261108, null]) {
        assert.throws(() => parseSchoolDate(valor, 'campo'),
            (erro) => erro instanceof ApiError && erro.statusCode === 400 && /campo/.test(erro.message), String(valor));
    }
});

test('parseSchoolDate com allowTime=false recusa horário', () => {
    assert.equal(parseSchoolDate('2026-11-08', 'd', { allowTime: false }), '2026-11-08');
    assert.throws(() => parseSchoolDate('2026-11-08T10:00', 'd', { allowTime: false }), ApiError);
});

test('deadlineTimestamp: data sem hora vale até 23:59:59.999 de Brasília', () => {
    assert.equal(SCHOOL_UTC_OFFSET_HOURS, -3);
    assert.equal(deadlineTimestamp('2026-11-08'), Date.parse('2026-11-09T02:59:59.999Z'));
});

test('deadlineTimestamp: hora sem fuso é de Brasília; com fuso, respeita o fuso', () => {
    assert.equal(deadlineTimestamp('2026-11-08T19:00'), Date.parse('2026-11-08T22:00:00Z'));
    assert.equal(deadlineTimestamp('2026-11-08T19:00:30'), Date.parse('2026-11-08T22:00:30Z'));
    assert.equal(deadlineTimestamp('2026-11-08T19:00Z'), Date.parse('2026-11-08T19:00:00Z'));
    assert.equal(deadlineTimestamp('2026-11-08T19:00+01:00'), Date.parse('2026-11-08T18:00:00Z'));
    assert.ok(Number.isNaN(deadlineTimestamp('lixo')));
});
