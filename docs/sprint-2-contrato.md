# Sprint 2 — contrato entre as frentes

Leia também `docs/sprint-aluno-contrato.md` (tokens, regras gerais). Design: Claude Design, projeto
`50450997-2000-4e4f-ac4a-215bb62148dd` — arquivos `C-Warning Professor.dc.html`,
`C-Warning Gestor.dc.html`, `CW Sidebar.dc.html`, `CW Aluno App.dc.html` (cópia local em
`docs/design/`). Leitura do design pela ferramenta DesignSync (`get_file`), só leitura.

Regras: Node puro, sem npm; sem CDN; CSP `'self'` sem inline (nada de `style=""`/script inline;
larguras dinâmicas via `element.style.setProperty`); CRLF preservado nos arquivos que já são CRLF;
WCAG 2.1 AA; código limpo; **ninguém faz commit, push ou deploy**; nada de chamar o site de produção;
testes sempre em cópia do banco num diretório temporário (`DATA_DIR=$(mktemp -d)`), nunca em
`data/educacao.sqlite`. Contas de teste: gestão `lucas`, professor `lucas.professor` (senha em
`.senha-lucas.txt`, não imprimir); alunos em `data/alunos-exemplo.csv` (senha inicial → trocar no
primeiro login).

## 1. Já pronto (não reescrever)

- Esquema em `src/database.js` (bloco "Sprint 2"): `arquivos`, `justificativas`, `ocorrencias`,
  `conversas` (par ordenado a<b), `mensagens`, `tokens`, `notificacoes_silenciadas`,
  `envios_email`; colunas `usuarios.email` (só e-mail confirmado ou cadastrado pela gestão),
  `sessoes.dispositivo`, `sessoes.ultimo_acesso`, `posts_avisos.id_arquivo`.
  Se precisar mudar o esquema, avise no relatório; não crie colunas redundantes.
- Roteamento em `src/routes/api.js`: `MODULE_ROUTES` despacha `/api/<prefixo>/…` para
  `handler(request, response, user, parts, searchParams)` (depois do login e da trava de troca de
  senha). Rotas públicas (sem login) passam antes por `handlePublicAccountRequest` em
  `contaController.js`. Os controladores são esqueletos que respondem 501.
- Ganchos de e-mail em `src/services/notificacoes.js` (`onNoticePublished`, `onPasswordChanged`,
  `onStaffCreated`) já chamados nos pontos certos; os chamadores não aguardam.
- Aparência: `public/preferencias.js` (carregar no `<head>` SEM defer, antes dos CSS) aplica
  `data-tema` (claro|escuro|auto) e `data-texto` (pequeno|medio|grande) no `<html>`;
  `window.cwAparencia.read()/save({tema,texto})`. `tema.css` tem o modo escuro. Para que o modo
  escuro funcione, todo CSS deve usar só tokens: texto em `--cw-texto`, `--cw-texto-2`,
  `--cw-texto-suave`, `--cw-texto-marca` (títulos índigo), `--cw-link`, `--cw-vermelho-texto`;
  fundos em `--cw-superficie`, `--cw-fundo`, `--cw-chip`, `--cw-indigo`, `--cw-azul-suave`,
  `--cw-vermelho-suave`. Nenhuma cor fixa em CSS de página (exceto branco sobre índigo/azul).

## 2. API — frente "servidor-escola"

Arquivos (`arquivosController.js`): upload em corpo binário cru, não JSON.
- `POST /api/arquivos` — headers `Content-Type` (application/pdf|image/jpeg|image/png) e
  `X-Nome-Arquivo` (nome original, URI-encoded); máx. 5 MB; valida assinatura (magic bytes) e
  descarta o tipo declarado se não bater; grava em `DATA_DIR/arquivos/<id>` (permissão 600) e
  devolve `{ id_arquivo, nome, tipo_mime, tamanho }`. Qualquer usuário logado.
- `GET /api/arquivos/:id` — download com `Content-Disposition: attachment`,
  `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`.
  Acesso: quem enviou; gestão; anexo de aviso → quem pode ver o aviso; atestado de justificativa →
  o aluno dono, a gestão e o professor da disciplina.
- Arquivo enviado e não vinculado em 24 h pode ser apagado por uma limpeza ao iniciar o servidor.

Avisos: `POST/PATCH /api/avisos` aceitam `id_arquivo` (do próprio autor). `GET /api/mural` passa a
incluir `anexo: { id_arquivo, nome, tipo_mime, tamanho } | null`. Para o autor (professor/gestão),
`GET /api/avisos` inclui `leituras: { confirmadas, publico_total }`.

Justificativas (`justificativasController.js`):
- `POST /api/justificativas` (aluno) `{ id_disciplina, data_falta, motivo, id_arquivo? }` — só para
  falta registrada (frequencias presente=0) do próprio aluno; até 5 dias úteis depois da falta.
- `GET /api/justificativas` — aluno: as próprias; professor: das suas disciplinas; gestão: todas;
  filtro `?situacao=pendente`. Item: `{ id_justificativa, aluno:{id_aluno,nome,turma}, disciplina,
  data_falta, motivo, anexo, situacao, resposta, analisado_em, criado_em }`.
- `PATCH /api/justificativas/:id` (gestão) `{ situacao: 'aceita'|'recusada', resposta? }`.
- Falta "justificada" é derivada (justificativa aceita para aluno+disciplina+data). `GET
  /api/frequencias` passa a trazer `justificativa: { situacao } | null` em cada falta.

Ocorrências (`ocorrenciasController.js`):
- `POST /api/ocorrencias` (professor das turmas do aluno; gestão) `{ id_aluno, descricao }`.
- `GET /api/ocorrencias` — aluno: as próprias (sem nome do autor? mostrar perfil); professor: as
  que registrou; gestão: todas, `?situacao=aberta`. `PATCH /api/ocorrencias/:id` (gestão)
  `{ situacao: 'resolvida' }`.

Chamada (`chamadasController.js`):
- `GET /api/chamadas?id_disciplina=&data=AAAA-MM-DD` — alunos da turma com a presença já lançada
  (se houver) e a frequência acumulada de cada um.
- `PUT /api/chamadas` `{ id_disciplina, data_aula, presencas: [{ id_aluno, presente }] }` — grava em
  lote (upsert) em transação; professor da disciplina ou gestão.

Painéis e relatórios (`painelController.js`):
- `GET /api/painel` — professor: aulas de hoje (com a aula em andamento), turmas com nº de alunos e
  frequência, entregas recebidas por atividade (enviadas/total), justificativas e mensagens não
  lidas; gestão: KPIs (alunos, frequência média, alunos < 75%, ocorrências abertas,
  justificativas pendentes), frequência por turma, alunos que precisam de atenção.
- `GET /api/relatorios/frequencia.csv` e `/api/relatorios/alunos-em-risco.csv` (gestão) — CSV UTF-8
  com BOM, separador `;`, e proteção contra injeção de fórmula (prefixar `'` em células que começam
  com = + - @).
- Correção de entregas (`PATCH /api/entregas/:id`) passa a valer também para o professor da
  disciplina; `GET /api/atividades/:id/entregas` idem.

## 3. API — frente "servidor-comunicacao"

E-mail (`src/services/email.js`): envio pela API da Resend com os templates publicados (aliases e
variáveis em `emails/README.md`), chave em `process.env.RESEND_API_KEY`, `APP_URL` para links
(padrão `https://ceeplourdinhaguerra.com.br`). Sem chave → só registra no log (dev). Escapar HTML de
toda variável. Nunca bloquear a requisição; erros só no log, sem dados pessoais.
`src/services/notificacoes.js` implementa os ganchos e `src/services/agendador.js` roda no
processo (setInterval, horário de Brasília) os envios: lembrete de prazo (18h do dia anterior),
resumo semanal de não lidos (segunda 7h). Idempotência por `envios_email.chave`. Respeitar
`notificacoes_silenciadas` e só enviar para `usuarios.email` não nulo e conta ativa.

Conta (`contaController.js`):
- `GET /api/conta` → `{ email, notificacoes: { urgente, turma, prazos, eventos, mensagens } (bool) }`.
- `PUT /api/conta/notificacoes` `{ tipo: bool, … }`.
- `POST /api/conta/email` `{ email }` → envia link de confirmação (template novo
  `cw-confirmar-email`, criar na Resend e em `emails/`); `DELETE /api/conta/email` remove.
- Público: `POST /api/conta/email/confirmar` `{ token }`.
- Público: `POST /api/auth/recuperar` `{ login }` → sempre 200 com mensagem genérica; se a conta
  tiver e-mail, envia `cw-redefinir-senha` com link `APP_URL/redefinir#token=…` (validade 30 min).
  Limitar por IP (reaproveitar o limitador do login).
- Público: `POST /api/auth/redefinir` `{ token, nova_senha }` → troca a senha (mesmas regras da
  troca normal), zera `deve_trocar_senha`, apaga sessões e o token, dispara `onPasswordChanged`.
- `GET /api/conta/sessoes` → `[{ id, dispositivo, ultimo_acesso, atual }]` (id = prefixo curto
  derivado do hash, nunca o token); `DELETE /api/conta/sessoes/:id`; `DELETE /api/conta/sessoes`
  (todas menos a atual). O login grava `dispositivo` (resumo do User-Agent: "Chrome · Windows") e o
  middleware atualiza `ultimo_acesso` no máximo 1x por minuto.
- Gestão: `email` opcional ao matricular aluno (`POST /api/matriculas`) e ao criar equipe
  (`POST /api/equipe`); `onStaffCreated` envia `cw-conta-criada` se houver e-mail.

Mensagens (`mensagensController.js`):
- `GET /api/mensagens/contatos` — com quem posso falar: aluno → professores das disciplinas da
  turma + "Coordenação" (gestão); professor → alunos das suas turmas + gestão; gestão → todos.
  Item `{ id_usuario, nome, perfil, detalhe }`.
- `GET /api/mensagens` → conversas `[{ id_conversa, com:{id_usuario,nome,perfil,detalhe},
  ultima:{texto,criado_em,minha}, nao_lidas }]` ordenadas pela última mensagem.
- `POST /api/mensagens` `{ para: id_usuario, texto }` (cria a conversa se não existir; valida a
  permissão de contato; texto até 2.000; limite de 30 mensagens/minuto por usuário).
- `GET /api/mensagens/:id_conversa?depois=<id_mensagem>` → mensagens (paginação simples) e marca as
  recebidas como lidas. `GET /api/mensagens/nao-lidas` → `{ total }` (para badges; a UI faz polling
  a cada 30 s só com a aba visível).
- E-mail de nova mensagem (template a criar `cw-nova-mensagem`) no máximo 1 por conversa a cada
  30 min, respeitando silenciamento `mensagens`.

## 4. Front — componente compartilhado de mensagens (dono: frente "front-aluno")

`public/componentes/mensagens.js` + `public/componentes/mensagens.css`:
`CwMensagens.montar(container, { api, usuario, aoMudarNaoLidas })` monta lista de conversas +
conversa aberta + campo de envio + "Nova conversa" (busca em contatos), responsivo (no celular,
lista e conversa em telas separadas), polling de 15 s na conversa aberta, só tokens de cor.
`api(path, options)` é a função de API da página (com token). Os portais do professor e da gestão
apenas incluem os dois arquivos e chamam `montar`; até o componente existir, deixem a seção
Mensagens chamando `CwMensagens.montar` (não reimplementem).

## 5. Frentes de front

- **front-aluno**: `public/aluno.*`, `public/index.html`/`app.js`/`styles.css` (link "Esqueci minha
  senha" → formulário de recuperação na própria tela), `public/redefinir.html`/`redefinir.js`
  (nova página), `public/componentes/**`. Novas seções: Mensagens; Frequência › Justificar falta
  (+ histórico com situação e botão Justificar em faltas sem justificativa); anexo no aviso aberto;
  card "Ocorrências" no Início (volta, agora real) e lista em Ajustes; Ajustes › Notificações
  (e-mail por tipo; pedir e-mail se não houver), Aparência (tema claro/escuro/automático e tamanho
  do texto via `cwAparencia`), Senha e segurança › Dispositivos conectados; Perfil com e-mail
  (adicionar/confirmar/remover). `src/routes/web.js` precisa da rota `/redefinir` → peça no
  relatório (não edite).
- **front-professor**: reescrever `public/professor.*` no design (sidebar índigo 240px do
  `CW Sidebar` com Início, Turmas, Chamada, Atividades, Avisos, Ocorrências, Mensagens +
  Configurações; mobile com abas inferiores). Telas: Início (painel), Turmas (alunos e frequência),
  Chamada (lista com Presente/Falta, marcar todos, salvar), Atividades (criar, ver entregas,
  corrigir com nota e comentário), Avisos (publicar para turma com urgente e anexo PDF; ver
  leituras), Ocorrências (registrar e listar), Mensagens (componente), Configurações (perfil,
  senha, e-mail, notificações, aparência, dispositivos).
- **front-gestor**: reescrever `public/gestao.*` no design (sidebar com Visão geral, Turmas, Alunos,
  Avisos, Ocorrências, Justificativas, Relatórios, Equipe, Mensagens + Configurações). Manter TODAS
  as funções atuais do portal (publicar/editar/excluir avisos com público, matrículas com e-mail
  opcional e redefinição, equipe com senha provisória, turmas/disciplinas/professores,
  desativar/reativar), mais: Visão geral (KPIs e listas do painel), Justificativas (analisar com
  anexo), Ocorrências (listar/resolver), Relatórios (baixar CSV), leituras dos avisos, anexo PDF.
- `public/professor.css` hoje é usado também pela gestão: cada portal passa a ter o próprio CSS
  (`gestao.css` independente). `public/navegacao.css` pode ser deixado de usar.
