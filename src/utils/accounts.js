function sharedStudentLogin(course, series) {
    return `__aluno_compartilhado_${course}_${series}`;
}

function isSharedStudentLogin(login) {
    return login.startsWith('__aluno_compartilhado_');
}

module.exports = { sharedStudentLogin, isSharedStudentLogin };
