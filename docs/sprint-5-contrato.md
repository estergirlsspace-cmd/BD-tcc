# Sprint 5 — páginas por turma com senha da turma

Regras gerais iguais às sprints anteriores. **Sem mudar a estrutura do banco** (nenhuma tabela ou
coluna nova): tudo usa `turmas`, `usuarios` e `alunos` como já existem. Ninguém faz commit/push/deploy.

## Turmas

12 turmas: para cada série (1, 2, 3) e curso (informatica, redes), letras A e B. Nome
`"1ª Série — Informática A"` (mesmo padrão dos nomes atuais + espaço + letra), com `curso` e `serie`
preenchidos. Migração de dados idempotente em `src/database.js`: turma existente com o nome sem letra
(`"1ª Série — Informática"`) é renomeada para a versão "A" (mantém o id e tudo que aponta para ela);
as "B" são criadas se não existirem. Turmas com outros nomes não são tocadas.

## Conta da turma

- Cada turma pode ter UMA conta compartilhada: `usuarios` com `tipo_usuario='aluno'`, `login =
  'turma-<id_turma>'`, `curso`/`serie` da turma, e uma linha em `alunos` (nome = nome da turma,
  `id_turma`). Criada/atualizada só pela gestão.
- `PUT /api/turmas/:id/senha` (gestão) `{ senha }` (mínimo 8 caracteres) → cria a conta se não
  existir ou troca a senha; revoga as sessões da conta; auditoria `turma.senha`. `GET
  /api/turmas` (gestão) passa a indicar `tem_senha: boolean` por turma (calculado, sem coluna).
  `DELETE /api/turmas/:id/senha` desativa a conta (`ativo = 0`).
- `GET /api/turmas/publicas` (sem login, com o limitador de IP do login): `[{ id_turma, serie,
  curso, letra }]` só das turmas com conta ativa — nada além disso.
- Login continua `POST /api/auth/login { login, senha }`; o front manda `login = 'turma-<id>'`.
  Conta de turma não passa por "primeiro acesso" nem por confirmação de e-mail; aceite de termos
  continua valendo. O bloqueio progressivo por conta continua valendo.
- `GET /api/me` traz `conta_turma: true` para essas contas. Para elas a API recusa (403) o que é
  pessoal: justificativas, entregas, frequência individual, mensagens, troca de e-mail,
  "meus dados", troca da própria senha. Mural, avisos, salvos/pastas (compartilhados pela turma),
  atividades (só leitura), horário em PDF e calendário funcionam.
- Matrícula individual (login pela matrícula) continua funcionando como hoje.

## Front

- Login (`public/index.html`, `app.js`, `styles.css`): na aba Aluno, no lugar do campo usuário,
  botões de Série (1ª/2ª/3ª), Curso (Informática/Redes) e Turma (A/B) no estilo do design
  `atualizado` + caixa "Turma: 1ª Série — Informática A" + senha da turma. Opções vêm de
  `/api/turmas/publicas`; combinação sem conta fica desabilitada. Link discreto "Entrar com
  matrícula" volta ao campo de usuário. Professor/Gestão continuam com usuário + senha.
- Aluno (`public/aluno.*`): com `conta_turma`, esconder Frequência, justificativas, entregas,
  troca de senha/e-mail, "Baixar meus dados"; o Perfil mostra a turma; atalhos só com dado real.
- Gestão (`public/gestao*`): na tela de Turmas, as 12 turmas agrupadas por série, com "Definir
  senha"/"Trocar senha"/"Desativar acesso" por turma e indicação de quem tem senha. Avisos,
  horários e demais seletores de turma continuam funcionando com as 12.
- Professor (`public/professor.*`): publicar aviso direcionado a uma ou mais das turmas em que
  leciona (uma publicação por turma escolhida, mesma API de avisos), além de "todas as minhas
  turmas".
