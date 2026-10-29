# Sprint 4 — horários em PDF, pastas, atalhos, sem Agenda e importação por planilha

Regras gerais iguais às sprints anteriores (`docs/sprint-2-contrato.md` e `sprint-3-contrato.md`):
Node puro, sem npm, sem CDN, CSP sem inline, tokens `--cw-*` (modo escuro), CRLF preservado,
WCAG AA, erros de formulário junto do campo (`public/componentes/formulario.js`), testes em cópia do
banco em diretório temporário, nada em produção, **ninguém faz commit/push/deploy**. O layout atual
NÃO muda: as novidades entram com os componentes visuais que cada portal já tem.

## Esquema (pronto em `src/database.js`, bloco "Sprint 4")

- `horarios_pdf (id_horario_pdf, publico 'turma'|'professores', id_turma, id_arquivo, id_usuario,
  atualizado_em)` — um por turma e um para os professores (índice único por alvo).
- `pastas (id_pasta, id_usuario, nome, criado_em, UNIQUE(id_usuario, nome))`.
- `avisos_usuarios.id_pasta` (nula = salvo sem pasta).

## API (frente "servidor")

Horários em PDF (`src/controllers/horariosPdfController.js`, prefixo `/api/horarios-pdf`):
- `GET /api/horarios-pdf` → aluno: `{ turma: item|null }` (da própria turma); professor:
  `{ professores: item|null, turmas: [item das turmas em que dá aula] }`; gestão: `{ professores:
  item|null, turmas: [todas] }`. Item: `{ id_horario_pdf, publico, id_turma, nome_turma,
  arquivo: { id_arquivo, nome, tamanho }, atualizado_em }`.
- `PUT /api/horarios-pdf/professores` e `PUT /api/horarios-pdf/turma/:id_turma` (gestão)
  `{ id_arquivo }` — PDF enviado antes por `POST /api/arquivos` pela própria gestão; substitui o
  anterior. `DELETE` nas mesmas rotas remove.
- Download continua em `GET /api/arquivos/:id`, com a regra de acesso ampliada: horário da turma →
  alunos da turma, professores da turma e gestão; horário dos professores → professores e gestão.
  Arquivo vinculado a horário não é órfão (limpeza).
- Auditoria: `horario.publicar`, `horario.remover`.

Pastas e salvos (`src/controllers/salvosController.js`, prefixos `/api/pastas` e `/api/salvos`),
para aluno e professor (gestão também pode usar):
- `GET /api/pastas` → `[{ id_pasta, nome, total }]`; `POST /api/pastas { nome }` (1–40
  caracteres, único por pessoa, até 30 pastas); `PATCH /api/pastas/:id { nome }`; `DELETE
  /api/pastas/:id` (avisos da pasta continuam salvos, sem pasta).
- `GET /api/salvos[?id_pasta=|sem_pasta=1]` → avisos salvos visíveis à pessoa com
  `{ id_post, titulo, tipo, urgente, criado_em, autor, id_pasta, salvo_em }`.
- `PUT /api/salvos/:id_post { id_pasta: number|null }` → salva (ou move de pasta);
  `DELETE /api/salvos/:id_post` → deixa de salvar. Visibilidade: aluno → `studentNoticeScope`,
  professor → `teacherNoticeScope`, gestão → todos (`src/utils/audience.js`). 404 fora do escopo.
- O mural do aluno (`GET /api/mural`) passa a trazer `id_pasta` em cada aviso; `PUT
  /api/mural/:id/salvo` continua funcionando (salva sem pasta / remove).

Importação de alunos por planilha (`src/controllers/importacaoController.js`, rota
`POST /api/matriculas/importar[?simular=1]`, só gestão):
- Corpo: texto CSV (`Content-Type: text/csv`), até 1 MB e 2.000 linhas de dados. UTF-8 com ou sem
  BOM; separador `;`, `,` ou tab detectado pelo cabeçalho; aspas e quebras de linha CRLF/LF.
- Colunas (cabeçalho obrigatório, sem diferenciar maiúsculas/acentos): `matricula`, `nome`,
  `turma` (nome da turma como cadastrado, comparação sem acento/maiúscula), `cpf` (aceita os 4
  primeiros dígitos ou o CPF inteiro, com ou sem pontuação — só os 4 primeiros dígitos são usados;
  **o CPF nunca é gravado, nem devolvido, nem registrado em log**), `email` (opcional).
- Mesmas regras da matrícula individual. Erros por linha: matrícula inválida/duplicada na planilha/
  já existente, nome vazio/longo, turma inexistente (dizer as turmas válidas), CPF inválido,
  e-mail inválido/duplicado.
- Resposta: `{ total, validos, erros: [{ linha, campo, mensagem }], alunos: [{ linha, matricula,
  nome, turma }] }`. Com `simular=1` nada é gravado (200). Sem `simular`: se houver qualquer erro →
  400 com o mesmo relatório; senão grava TODOS numa única transação (tudo ou nada) → 201 com
  `importados`. Hashes calculados antes da transação (concorrência limitada). E-mails viram
  confirmação pendente (como na matrícula). Auditoria `aluno.importar` com alvo `lote:<n>`.
- Modelo para baixar: `public/modelos/alunos.csv` (cabeçalho + 2 linhas fictícias).

## Front

- **front-aluno** (`public/aluno.*`): remover a seção Agenda (rail, abas do celular, rotas,
  links e subnavegação; o card "Aulas de hoje" do Início continua sem link para a Agenda); no
  celular, a aba que era Agenda passa a ser Atividades. Atalhos no topo do Início (cartões
  clicáveis com ícone e contador: Avisos não lidos, Urgentes, Salvos, Mensagens) no estilo dos
  cartões atuais. Salvos com pastas (criar, renomear, excluir com confirmação, mover aviso;
  filtro por pasta) usando `/api/pastas` e `/api/salvos`. Ajustes ou Início: "Meu horário" com o
  PDF da turma (download autenticado fetch → blob).
- **front-professor** (`public/professor.*`): seção/aba "Salvos" com pastas (salvar avisos que o
  professor vê — os próprios e os recebidos), e "Horário" com os PDFs (professores e turmas dele).
- **front-gestao** (`public/gestao*.{html,js,css}`): em Turmas e disciplinas (ou seção própria
  "Horários"), publicar/substituir/remover o PDF de horário de cada turma e o dos professores, com
  data da última atualização; em Alunos, "Importar planilha": baixar modelo, escolher .csv,
  "Verificar" (simular) mostrando o relatório de erros por linha em tabela acessível e a prévia,
  e "Importar N alunos" só quando não houver erros; explicar como salvar do Excel/Planilhas como
  CSV UTF-8.
- `public/sw.js`: se criar arquivos novos de front, acrescentar na lista `CASCA` e subir `CACHE`.
