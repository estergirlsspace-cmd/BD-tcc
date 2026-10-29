// Regra única de público dos avisos para o aluno: aviso da escola toda, do curso, da série ou da
// turma dele. Usada pela listagem de /api/avisos e pelo mural, para que as duas nunca divirjam.
// Devolve null quando o aluno não tem turma (não vê nenhum aviso).
function studentNoticeScope(user, alias = 'posts_avisos') {
    if (user.conta_compartilhada) {
        return {
            clause: `(${alias}.id_turma IS NULL OR ${alias}.id_turma IN (
                    SELECT id_turma FROM turmas WHERE curso = ? AND serie = ?
                ))
                AND (${alias}.curso IS NULL OR ${alias}.curso = ?)
                AND (${alias}.serie IS NULL OR ${alias}.serie = ?)`,
            params: [user.curso, user.serie, user.curso, user.serie]
        };
    }
    if (!user.id_turma) return null;
    return {
        clause: `(${alias}.id_turma IS NULL OR ${alias}.id_turma = ?)
                AND (${alias}.curso IS NULL OR ${alias}.curso = ?)
                AND (${alias}.serie IS NULL OR ${alias}.serie = ?)`,
        params: [user.id_turma, user.curso, user.serie]
    };
}

module.exports = { studentNoticeScope };
