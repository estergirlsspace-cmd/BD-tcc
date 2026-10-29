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

// Avisos visíveis para o professor: os que publicou, os das turmas em que leciona e os gerais
// (escola, curso ou série) que alcançam alguma dessas turmas.
function teacherNoticeScope(user, alias = 'posts_avisos') {
    const teacherId = user.id_professor || -1;
    return {
        clause: `(${alias}.id_usuario_autor = ?
                OR ${alias}.id_turma IN (SELECT id_turma FROM disciplinas WHERE id_professor = ?)
                OR (${alias}.id_turma IS NULL AND EXISTS (
                    SELECT 1 FROM disciplinas d
                    JOIN turmas t ON t.id_turma = d.id_turma
                    WHERE d.id_professor = ?
                      AND (${alias}.curso IS NULL OR ${alias}.curso = t.curso)
                      AND (${alias}.serie IS NULL OR ${alias}.serie = t.serie)
                )))`,
        params: [user.id_usuario, teacherId, teacherId]
    };
}

// A mesma regra vista pelo lado do aviso: fragmento "FROM … WHERE …" com os alunos (contas
// ativas) que fazem parte do público do aviso `alias`. Serve para contar público e leituras.
function noticeAudienceFrom(alias) {
    return `FROM alunos aud_a
        JOIN usuarios aud_u ON aud_u.id_usuario = aud_a.id_usuario
        JOIN turmas aud_t ON aud_t.id_turma = aud_a.id_turma
        WHERE aud_u.ativo = 1 AND aud_u.tipo_usuario = 'aluno'
          AND aud_u.login NOT GLOB 'turma-[0-9]*'
          AND (${alias}.id_turma IS NULL OR aud_a.id_turma = ${alias}.id_turma)
          AND (${alias}.curso IS NULL OR aud_u.curso = ${alias}.curso)
          AND (${alias}.serie IS NULL OR COALESCE(aud_t.serie, aud_u.serie) = ${alias}.serie)`;
}

module.exports = { studentNoticeScope, teacherNoticeScope, noticeAudienceFrom };
