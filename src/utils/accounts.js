function sharedStudentLogin(course, series) {
    return `__aluno_compartilhado_${course}_${series}`;
}

function isSharedStudentLogin(login) {
    return login.startsWith('__aluno_compartilhado_');
}

// Conta da turma (Sprint 5): um aluno "coletivo" por turma, login 'turma-<id_turma>', senha
// definida pela gestão. Não é o modelo antigo acima (por curso/série, já desativado).
const CLASS_ACCOUNT_PATTERN = /^turma-[1-9]\d*$/;

function classAccountLogin(classId) {
    return `turma-${classId}`;
}

// Usuário da sala legível: "<série><info|redes>-<letra>", ex.: "1info-a", "2redes-b".
const COURSE_SHORT = { informatica: 'info', redes: 'redes' };
const READABLE_PATTERN = /^([1-3])(info|informatica|redes)-?([ab])$/;

function readableClassLogin(schoolClass) {
    const letra = / ([AB])$/.exec(String(schoolClass?.nome_turma || ''))?.[1];
    const short = COURSE_SHORT[schoolClass?.curso];
    if (!letra || !short || !schoolClass.serie) return null;
    return `${schoolClass.serie}${short}-${letra.toLowerCase()}`;
}

// "1INFOA", "1informática-a", "1 info - a" → { serie: 1, curso: 'informatica', letra: 'A' }.
function parseReadableClassLogin(login) {
    const folded = String(login).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/\s+/g, '');
    const match = READABLE_PATTERN.exec(folded);
    if (!match) return null;
    return {
        serie: Number(match[1]),
        curso: match[2] === 'redes' ? 'redes' : 'informatica',
        letra: match[3].toUpperCase()
    };
}

function isClassAccount(user) {
    return user?.tipo_usuario === 'aluno' && CLASS_ACCOUNT_PATTERN.test(String(user.login || ''));
}

module.exports = {
    sharedStudentLogin, isSharedStudentLogin, classAccountLogin, isClassAccount,
    readableClassLogin, parseReadableClassLogin
};
