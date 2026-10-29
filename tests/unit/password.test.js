const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, hashPasswordSync, verifyPassword, newPasswordProblem } = require('../../src/utils/password');

test('newPasswordProblem: 8 a 128 caracteres', () => {
    assert.equal(newPasswordProblem('1234567'), 'A nova senha deve ter entre 8 e 128 caracteres.');
    assert.equal(newPasswordProblem('x'.repeat(129)), 'A nova senha deve ter entre 8 e 128 caracteres.');
    assert.equal(newPasswordProblem('12345678'), null);
    assert.equal(newPasswordProblem('x'.repeat(128)), null);
});

test('newPasswordProblem: recusa não-texto e o padrão do primeiro acesso', () => {
    for (const valor of [undefined, null, 12345678, ['abcdefgh'], { length: 10 }]) {
        assert.ok(newPasswordProblem(valor), String(valor));
    }
    assert.match(newPasswordProblem('ceep@1234'), /primeiro acesso/);
    assert.match(newPasswordProblem('CEEP@0000'), /primeiro acesso/);
    assert.equal(newPasswordProblem('ceep@12345'), null, 'só o padrão exato é recusado');
});

test('hash scrypt com sal aleatório; verificação certa e errada', async () => {
    const a = await hashPassword('Senha-forte-1');
    const b = hashPasswordSync('Senha-forte-1');
    assert.match(a, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.notEqual(a, b, 'sal diferente a cada hash');
    assert.equal(await verifyPassword('Senha-forte-1', a), true);
    assert.equal(await verifyPassword('Senha-forte-1', b), true);
    assert.equal(await verifyPassword('senha-forte-1', a), false);
});

test('verifyPassword recusa hash malformado sem lançar erro', async () => {
    for (const hash of [null, '', 'texto', 'bcrypt:abc:def', 'scrypt:sal:curto', `scrypt::${'a'.repeat(128)}`]) {
        assert.equal(await verifyPassword('x', hash), false, String(hash));
    }
});
