const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toCsv, csvCell, decimal } = require('../../src/utils/csv');

test('csvCell: vazio para null/undefined; números viram texto', () => {
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell('Ana'), 'Ana');
});

test('csvCell: prefixa apóstrofo em = + - @ tab e CR (injeção de fórmula)', () => {
    assert.equal(csvCell('=1+1'), "'=1+1");
    assert.equal(csvCell('+55'), "'+55");
    assert.equal(csvCell('-3'), "'-3");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('\t=1'), "'\t=1");
    assert.equal(csvCell('\r=1'), `"'\r=1"`);
    assert.equal(csvCell('a=b'), 'a=b', 'só no início da célula');
});

test('csvCell: aspas, ; e quebras de linha são escapados', () => {
    assert.equal(csvCell('a;b'), '"a;b"');
    assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
    assert.equal(csvCell('linha1\nlinha2'), '"linha1\nlinha2"');
    assert.equal(csvCell('=HYPERLINK("x";"y")'), `"'=HYPERLINK(""x"";""y"")"`);
});

test('toCsv: BOM, separador ; e CRLF (inclusive no fim)', () => {
    const csv = toCsv(['A', 'B'], [[1, 'x;y'], [null, '-2']]);
    assert.equal(csv, '﻿A;B\r\n1;"x;y"\r\n;\'-2\r\n');
    assert.equal(toCsv(['Só'], []), '﻿Só\r\n');
});

test('decimal: vírgula como separador; vazio sem valor', () => {
    assert.equal(decimal(33.3), '33,3');
    assert.equal(decimal(100), '100');
    assert.equal(decimal(0), '0');
    assert.equal(decimal(null), '');
    assert.equal(decimal(undefined), '');
});
