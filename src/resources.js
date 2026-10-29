const resources = {
    usuarios: {
        table: 'usuarios',
        id: 'id_usuario',
        fields: ['login', 'senha', 'tipo_usuario', 'curso', 'serie'],
        required: ['login', 'senha', 'tipo_usuario'],
        secret: 'senha'
    },
    alunos: {
        table: 'alunos',
        id: 'id_aluno',
        fields: ['id_usuario', 'nome', 'id_turma'],
        required: ['id_usuario', 'nome', 'id_turma']
    },
    professores: {
        table: 'professores',
        id: 'id_professor',
        fields: ['id_usuario', 'id_disciplina'],
        required: ['id_usuario']
    },
    turmas: {
        table: 'turmas',
        id: 'id_turma',
        fields: ['nome_turma', 'curso', 'serie'],
        required: ['nome_turma', 'curso', 'serie']
    },
    disciplinas: {
        table: 'disciplinas',
        id: 'id_disciplina',
        fields: ['id_grade', 'id_turma', 'id_professor', 'nome_disciplina'],
        required: ['id_turma', 'nome_disciplina']
    },
    'posts-avisos': {
        table: 'posts_avisos',
        id: 'id_post',
        fields: ['titulo', 'conteudo', 'id_usuario_autor', 'id_turma', 'curso', 'serie',
            'tipo', 'data_evento'],
        required: ['titulo', 'conteudo']
    }
};

module.exports = resources;
