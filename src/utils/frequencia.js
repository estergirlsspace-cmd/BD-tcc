// Frequência mínima exigida (LDB): abaixo disso o aluno precisa de atenção.
const MIN_ATTENDANCE = 75;

// Percentual de presença com uma casa decimal; null quando ainda não houve aula registrada.
function attendancePercent(presences, classes) {
    return classes ? Math.round((presences / classes) * 1000) / 10 : null;
}

module.exports = { MIN_ATTENDANCE, attendancePercent };
