const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [algorithm, salt, hash] = storedHash.split(':');
    if (algorithm !== 'scrypt' || !salt || !/^[a-f\d]{128}$/i.test(hash || '')) {
        return false;
    }

    const expected = Buffer.from(hash, 'hex');
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
