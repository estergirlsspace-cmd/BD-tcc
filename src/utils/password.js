const { randomBytes, scrypt, scryptSync, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');

// scrypt assíncrono: o cálculo (~60 ms) roda fora da linha principal do Node,
// então o servidor continua atendendo outras requisições durante um login.
const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(password, salt, 64);
    return `scrypt:${salt}:${hash.toString('hex')}`;
}

// Versão síncrona, só para scripts de linha de comando.
function hashPasswordSync(password) {
    const salt = randomBytes(16).toString('hex');
    return `scrypt:${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
    const [algorithm, salt, hash] = String(storedHash || '').split(':');
    if (algorithm !== 'scrypt' || !salt || !/^[a-f\d]{128}$/i.test(hash || '')) {
        return false;
    }

    const expected = Buffer.from(hash, 'hex');
    const actual = await scryptAsync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword };
