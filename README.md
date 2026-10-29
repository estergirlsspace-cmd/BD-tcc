# C-Warning — API escolar

API REST e tela de acesso escolar feitas com Node.js e SQLite. Requer Node.js 24 ou superior (`node:sqlite`); não usa dependências externas.

## Executar

```powershell
node .\server.js
```

A tela e a API ficam disponíveis em `http://localhost:3000` e, por padrão, em todos os endereços IPv4 desta máquina na rede local. O terminal informa os endereços para acesso; `HOST` e `PORT` podem ser configurados antes da inicialização:

```powershell
$env:HOST = "0.0.0.0"
$env:PORT = "3000"
node .\server.js
```

O banco persistente fica em `data/educacao.sqlite` (ou na pasta definida em `DATA_DIR`). **Ele nunca vai para o git**, porque guarda dados pessoais de alunos (LGPD). Tabelas e migrações são criadas automaticamente na inicialização, sem apagar dados existentes. Faça cópias de segurança periódicas desse arquivo e pare o servidor antes de copiá-lo.

Para começar com um banco vazio, há dois caminhos:

- **Dados de exemplo (desenvolvimento):** `node scripts/seed-exemplo.js` cria contas de teste da gestão e de professor, 6 turmas e 36 alunos fictícios. Os logins e senhas de teste ficam em `contas-exemplo.csv` e `alunos-exemplo.csv`, na mesma pasta do banco e fora do git.
- **Instalação real:** defina `ADMIN_LOGIN`, `ADMIN_SENHA` e, se quiser, `ADMIN_NOME`. Se não houver nenhuma conta da gestão, essa conta é criada com senha provisória, que precisa ser trocada no primeiro acesso. O resto (turmas, professores, alunos) é cadastrado pelo portal da gestão.

Para acessar a partir de outro computador, use o endereço de rede local mostrado ao iniciar o servidor e confirme que o Firewall do Windows permite conexões de entrada na porta configurada. O endereço da máquina pode mudar ao reconectar à rede. Este servidor deve ser usado somente em rede confiável; para acesso pela internet, configure HTTPS e um proxy reverso.

### Proxy reverso e `TRUST_PROXY`

Os limitadores de tentativas (login, recuperação de senha) usam o IP de quem fez a requisição.

- **Sem `TRUST_PROXY`** (padrão, acesso direto ou rede local): vale o endereço da conexão (`socket.remoteAddress`). Cabeçalhos como `X-Forwarded-For`, `X-Real-Ip` e `CF-Connecting-IP` são ignorados — qualquer cliente pode forjá-los.
- **`TRUST_PROXY=1`** (produção: Cloudflare → Traefik/Dokploy → contêiner): vale o `X-Real-Ip` gravado pelo Traefik (o IP que ele viu). O `CF-Connecting-IP` só é usado quando esse `X-Real-Ip` pertence às faixas oficiais da Cloudflare (lista em `src/utils/ip.js`, copiada de https://www.cloudflare.com/ips-v4 e ips-v6; atualize se a Cloudflare publicar faixas novas). Quem acessa a VPS direto, sem passar pela Cloudflare, é limitado pelo próprio IP, mesmo enviando um `CF-Connecting-IP` falso.
- Só defina `TRUST_PROXY` quando o contêiner **não** puder ser acessado sem passar pelo proxy (a porta do Node não deve estar publicada na internet). Valores `0`, `false` ou vazio equivalem a não definir.

Além do limite por IP, cada conta tem bloqueio progressivo independente do IP: a cada 5 senhas erradas seguidas, 5 min de bloqueio; na 10ª, 1 h; da 15ª em diante, 24 h (429). Um acerto zera a contagem (24 h sem erros também). Vale para o login e para as rotas que pedem `senha_atual` (`/api/auth/password` e `/api/conta/email`).

## Estrutura

```text
server.js
src/
  app.js
  database.js
  routes/
    api.js
    web.js
  controllers/
    authController.js
    resourceController.js
    schoolController.js
  middleware/
    authenticate.js
  utils/
    http.js
    password.js
    validation.js
scripts/
  seed-accounts.js
  seed-exemplo.js
public/
  index.html
  styles.css
  app.js
  aluno.html
  aluno.css
  aluno.js
  professor.html
  professor.css
  professor.js
data/
  educacao.sqlite   (gerado localmente; fora do git)
```

## Contas iniciais

Professores e membros da Gestão entram com **usuário próprio** (ex.: matrícula de servidor ou `nome.sobrenome`; não use CPF). A Gestão cria cada conta e o sistema gera uma **senha provisória**, exibida uma única vez, que deve ser trocada no primeiro acesso:

```json
POST /api/equipe
{"login":"maria.souza","tipo_usuario":"professor","nome":"Maria Souza","area":"humanas"}
```

Áreas de professor: `natureza`, `humanas`, `linguagens`, `matematica`, `informatica`, `redes`. A área define o tema do portal do professor. O `email` opcional (aqui e em `POST /api/matriculas`) **não** vira e-mail de recuperação na hora: o endereço recebe um link de confirmação (e, na equipe, o aviso de conta criada) e só é gravado depois de confirmado. A resposta traz `email: null` e `email_pendente: "<endereço>"` (ou `null` sem e-mail). Para gerar uma nova senha provisória, use `POST /api/equipe/ID_DO_USUARIO/senha`.

As contas antigas `professor` e `gestao` continuam existindo. Para definir as senhas delas:

```powershell
$env:PROFESSOR_SENHA = Read-Host "Senha de professor"
$env:GESTAO_SENHA = Read-Host "Senha de gestão"
node .\scripts\seed-accounts.js
Remove-Item Env:PROFESSOR_SENHA, Env:GESTAO_SENHA
```

### Acesso do aluno

Cada aluno tem conta própria:

- **Usuário:** número de matrícula.
- **Senha de primeiro acesso:** `ceep@` + 4 primeiros dígitos do CPF (ex.: `ceep@1234`).
- **Primeiro acesso:** o aluno é obrigado a criar uma senha pessoal antes de usar o sistema. Até lá, a API recusa qualquer rota além de `/api/me` e `/api/auth/password`.
- **CPF:** não é armazenado. A Gestão informa os 4 dígitos só no cadastro ou na redefinição, e o sistema guarda apenas o hash `scrypt` da senha.
- **Proteção contra tentativas:** 5 senhas erradas para o mesmo usuário bloqueiam o login por 5 minutos.

O acesso compartilhado por curso e série foi desativado.

Para gerar dados de exemplo (turmas, disciplinas, horários, 36 alunos, atividades, avisos e frequência), rode `node scripts/seed-exemplo.js` com o banco vazio. As listas de logins e senhas de teste saem em `contas-exemplo.csv` e `alunos-exemplo.csv`, junto do banco e fora do git.

## Autenticação

`POST /api/auth/login` recebe `login` (matrícula do aluno ou usuário de professor/Gestão) e `senha`. Na tela, as abas Aluno, Professor e Gestão só mudam o rótulo do campo (Matrícula ou Usuário):

```json
{ "login": "20260001", "senha": "SUA_SENHA" }
```

O login retorna um token válido por 8 horas e o campo `deve_trocar_senha`. Use o token nas rotas protegidas.

- `POST /api/auth/password` (`senha_atual`, `nova_senha`) troca a própria senha e encerra as outras sessões. A nova senha deve ter de 8 a 128 caracteres, ser diferente da atual e não seguir o padrão `ceep@` + 4 dígitos.
- `POST /api/auth/logout` revoga o token atual.
- `GET /api/me` consulta o perfil.

Após autenticar, cada perfil é direcionado ao seu portal: `/aluno`, `/professor` ou `/gestao`. O portal da gestão tem Comunicados (publicar para a escola toda, um curso, uma série ou uma turma; editar e excluir), Alunos (matricular e redefinir senha), Equipe (cadastrar professores e gestão com senha provisória), Turmas e disciplinas (criar turmas e disciplinas e vincular professores) e Minha conta. O portal do professor carrega turmas e disciplinas vinculadas, horários e comunicados pela API; a publicação só permite escolher uma disciplina associada ao perfil autenticado. Comunicados salvos em pastas ficam no armazenamento local do navegador.

## Recursos e operações

Todos os corpos e respostas usam JSON. IDs são inteiros positivos. Erros usam `{"erro":"mensagem"}`.

| Recurso | Rotas principais | Acesso |
| --- | --- | --- |
| Usuários | `GET/POST /api/usuarios`, `GET/PATCH/DELETE /api/usuarios/:id` | Gestão |
| Turmas | CRUD `/api/turmas` | Consulta de acordo com o perfil; alterações pela Gestão |
| Alunos/matrículas | CRUD `/api/alunos` | Gestão; matrícula exige usuário aluno e turma do mesmo curso |
| Matrícula de aluno | `POST /api/matriculas`, `POST /api/matriculas/:id_aluno/senha` | Gestão cadastra o aluno e redefine a senha para a de primeiro acesso |
| Professores | CRUD `/api/professores` | Gestão |
| Disciplinas | CRUD `/api/disciplinas` | Consulta de acordo com o perfil; alterações pela Gestão |
| Avisos/comunicados | CRUD `/api/avisos` ou `/api/posts-avisos` | Aluno consulta os destinados à turma; professor publica para turma vinculada; Gestão administra |
| Mural do aluno | `GET /api/mural`, `PUT/DELETE /api/mural/:id/leitura`, `POST /api/mural/leitura`, `PUT /api/mural/:id/salvo` | Somente aluno (professor e Gestão recebem 403) |
| Horários | `GET/POST /api/horarios`, `GET/PATCH/DELETE /api/horarios/:id` (cada horário traz `nome_disciplina` e `professor`) | Aluno consulta o curso/série da conta; professor consulta/publica nas turmas vinculadas; Gestão consulta e publica |
| Atividades e avaliações | `GET/POST /api/atividades`, `GET/PATCH/DELETE /api/atividades/:id` | Aluno consulta atividades do curso/série, cada uma com `entrega` (`null` ou `{ enviado_em, nota, feedback }` da própria entrega); professor e Gestão publicam |
| Entregas | `POST /api/atividades/:id/entregas`, `GET /api/atividades/:id/entregas` | Aluno envia (ou reenvia, enquanto não houver nota) sua resposta — entrega já corrigida → 409; professor/gestão consultam entregas das turmas permitidas |
| Notas e feedback | `PATCH /api/entregas/:id` | Professor da disciplina e Gestão corrigem (nota/feedback); aluno consulta apenas as próprias notas |
| Frequência | `GET/POST /api/frequencias` | Aluno consulta a própria frequência; professor registra nas turmas vinculadas; Gestão consulta e registra |
| Desempenho | `GET /api/desempenho` | Aluno consulta o próprio desempenho; Gestão consulta usando `?id_aluno=ID` |
| Carga horária | `GET /api/carga-horaria` | Retorna carga semanal agrupada por turma e disciplina, limitada às turmas do perfil |

### Exemplos de cadastro pela Gestão

Crie uma turma:

```json
POST /api/turmas
{"nome_turma":"1A Informática","curso":"informatica","serie":1}
```

Matricule um aluno (a senha inicial será `ceep@` + `cpf_inicio`):

```json
POST /api/matriculas
{"matricula":"20260001","nome":"Nome do aluno","id_turma":1,"cpf_inicio":"1234"}
```

Contas não são excluídas quando têm histórico (avisos, atividades, frequências, entregas, ocorrências, justificativas, conversas, arquivos): a API recusa a exclusão (409) e a Gestão **desativa** a conta. Também não é possível excluir a própria conta (400) nem a última conta ativa da gestão (409). Quando a Gestão define a senha de outra pessoa por `PATCH /api/usuarios/:id`, a senha é provisória (troca obrigatória no próximo acesso) e as sessões abertas dessa pessoa são encerradas. A pessoa deixa de entrar e o histórico continua. Turmas e disciplinas com registros vinculados também não podem ser excluídas.

```json
POST /api/contas/ID_DO_USUARIO/situacao
{"ativo": false}
```

A Gestão não pode desativar a própria conta nem a última conta ativa da gestão.

Se o aluno esquecer a senha, a Gestão a redefine para a de primeiro acesso:

```json
POST /api/matriculas/ID_DO_ALUNO/senha
{"cpf_inicio":"1234"}
```

Crie o usuário professor, seu perfil em `/api/professores` e depois as disciplinas da turma com `id_professor`. A associação professor-disciplina é a autorização usada para limitar a publicação de atividades, horários, avisos e frequência.

### Exemplo de publicação

Com token de professor:

```json
POST /api/atividades
{"titulo":"Atividade 1","descricao":"Enviar a resolução","id_turma":1,"id_disciplina":1,"prazo":"2026-11-01T23:59:00-03:00","tipo":"atividade"}
```

Tipos aceitos: `atividade`, `avaliacao`, `evento` e `comunicado`. Para avisos, use `POST /api/avisos` com `titulo`, `conteudo` e `id_turma`; Gestão também pode definir curso/série para avisos gerais. O campo opcional `urgente` (`true`/`false`, padrão `false`) destaca o aviso no mural; nos portais é a caixa "Marcar como urgente".

### Mural do aluno

`GET /api/mural` lista os avisos visíveis para o aluno (mesma regra de público de `GET /api/avisos`), primeiro os urgentes e depois do mais recente para o mais antigo, com o estado pessoal de cada um:

```json
{
  "nao_lidos": 1,
  "avisos": [{
    "id_post": 25, "titulo": "Sem aula amanhã", "conteudo": "…", "tipo": "aviso",
    "urgente": true, "categoria": "urgente", "data_evento": null,
    "criado_em": "2026-10-29 03:10:26",
    "autor": { "nome": "Lucas Reis", "perfil": "gestao" },
    "publico": "turma", "lido_em": null, "salvo": false
  }]
}
```

- `categoria` é calculada, não gravada: `urgente` se o aviso é urgente; senão `eventos` se `tipo` é `evento`; senão `coordenacao` se o autor é da Gestão; senão `turma`.
- `publico` vem do alvo do aviso: `turma` (tem `id_turma`), `serie` (tem série), `curso` (só curso) ou `escola`.
- O autor aparece só por nome e perfil; o identificador do usuário autor não é exposto ao aluno.
- `PUT /api/mural/:id/leitura` confirma a leitura (idempotente, mantém o primeiro horário) e devolve `{ "lido_em": "…" }`; `DELETE` desfaz e devolve `{ "lido_em": null }`.
- `POST /api/mural/leitura` (sem corpo) marca como lidos todos os avisos visíveis e devolve `{ "marcados": 5 }` (quantos mudaram).
- `PUT /api/mural/:id/salvo` com `{ "salvo": true }` ou `{ "salvo": false }` devolve `{ "salvo": true|false }`.
- Aviso fora do público do aluno responde 404 (não revela que existe); corpo inválido responde 400.

O estado fica na tabela `avisos_usuarios` (`id_post`, `id_usuario`, `lido_em`, `salvo_em`; chave primária `(id_post, id_usuario)`, ambos com `ON DELETE CASCADE`). Só há linha quando o aluno interagiu: se leitura e salvo forem desfeitos, a linha é apagada (um `CHECK` impede guardar estado vazio). Os horários são UTC (`CURRENT_TIMESTAMP`).

## Sprint 2 — escola

| Rota | Acesso | Resumo |
| --- | --- | --- |
| `POST /api/arquivos` | Qualquer usuário logado | Corpo binário cru (não JSON) com `Content-Type` `application/pdf`, `image/jpeg` ou `image/png` e `X-Nome-Arquivo` (nome original, URI-encoded). Até 5 MB (413 acima). O tipo gravado é o detectado pela assinatura do conteúdo (`%PDF-`, `FF D8 FF`, `89 50 4E 47 0D 0A 1A 0A`); conteúdo de outro tipo é recusado com 415. O nome é saneado e recebe a extensão do tipo real. Até 10 arquivos não vinculados por pessoa em 24 h e 2 envios simultâneos por pessoa (429). Devolve `{ id_arquivo, nome, tipo_mime, tamanho }`. |
| `GET /api/arquivos/:id` | Quem enviou; Gestão; quem pode ver o aviso do qual é anexo; atestado: só o aluno dono (e a Gestão) | Download com `Content-Disposition: attachment`, `nosniff`, `Content-Security-Policy: sandbox` e `Cache-Control: private, no-store`. Sem permissão responde 404. |
| `POST/PATCH /api/avisos` | Professor/Gestão | Aceitam `id_arquivo` (arquivo enviado por quem publica; `null` remove o anexo). |
| `GET /api/avisos`, `GET /api/mural` | Conforme o perfil | Cada aviso traz `anexo: { id_arquivo, nome, tipo_mime, tamanho } \| null`. Em `/api/avisos`, o autor (e a Gestão, em todos) recebe `leituras: { confirmadas, publico_total }`. |
| `POST /api/justificativas` | Aluno | `{ id_disciplina, data_falta, motivo, id_arquivo? }`, só para falta registrada do próprio aluno, até 5 dias úteis (segunda a sexta) contados da data da falta ou do dia em que ela foi lançada, o que for mais tarde (409 fora do prazo ou repetida). |
| `GET /api/justificativas?situacao=` | Aluno: as próprias; professor: das suas disciplinas; Gestão: todas | Item `{ id_justificativa, aluno: { id_aluno, nome, turma }, id_disciplina, disciplina, data_falta, motivo, anexo, situacao, resposta, analisado_em, criado_em }`. Para o professor (minimização, LGPD) o item é só `{ id_justificativa, aluno, id_disciplina, disciplina, data_falta, situacao }`. |
| `PATCH /api/justificativas/:id` | Gestão | `{ situacao: "aceita" \| "recusada", resposta? }`; só justificativa `pendente` (já analisada → 409). `GET /api/frequencias` traz `justificativa: { situacao } \| null` em cada registro (sempre `null` em presença). |
| `POST /api/ocorrencias` | Professor das turmas do aluno; Gestão | `{ id_aluno, descricao }`. |
| `GET /api/ocorrencias?situacao=` | Aluno: as próprias (autor só com `perfil`); professor: as que registrou; Gestão: todas | Item `{ id_ocorrencia, aluno: { id_aluno, nome, turma }, descricao, situacao, criado_em, resolvida_em, autor: { nome, perfil } }`. |
| `PATCH /api/ocorrencias/:id` | Gestão | `{ situacao: "resolvida" }`. |
| `GET /api/chamadas?id_disciplina=&data=` | Professor da disciplina; Gestão | Lista `[{ id_aluno, nome, presente: true \| false \| null, frequencia: { aulas, presencas, faltas, percentual } }]` (frequência acumulada na disciplina; `percentual` é `null` sem aulas). |
| `PUT /api/chamadas` | Professor da disciplina; Gestão | `{ id_disciplina, data_aula, presencas: [{ id_aluno, presente }] }` (1 a 200 alunos ativos da turma; `data_aula` em dia útil, do início do ano letivo — 1º de fevereiro do ano corrente — até hoje, senão 400; as mesmas regras valem para `POST /api/frequencias`), gravado em uma transação; devolve a mesma lista do `GET`. |
| `GET /api/painel` | Professor; Gestão | Professor: `hoje`, `aulas_hoje` (com `em_andamento` e `chamada_feita`), `aula_em_andamento`, `turmas` (`alunos`, `frequencia`), `entregas` (`enviadas`/`total` das 10 atividades mais recentes), `justificativas_pendentes`, `mensagens_nao_lidas`. Gestão: `kpis` (`alunos`, `frequencia_media`, `alunos_abaixo_75`, `ocorrencias_abertas`, `justificativas_pendentes`), `frequencia_por_turma`, `alunos_atencao` (frequência abaixo de 75% ou ocorrência aberta), `mensagens_nao_lidas`. |
| `GET /api/relatorios/frequencia.csv`, `GET /api/relatorios/alunos-em-risco.csv` | Gestão | CSV UTF-8 com BOM, separador `;`, decimal com vírgula; células que começam com `=`, `+`, `-` ou `@` recebem `'` na frente (proteção contra injeção de fórmula). |
| `PATCH /api/entregas/:id`, `GET /api/atividades/:id/entregas` | Professor da disciplina; Gestão | O professor da disciplina também corrige (nota e feedback) e vê as notas; fora do escopo responde 404. |

Os arquivos ficam em `DATA_DIR/arquivos/<id_arquivo>` (permissão 600); o caminho vem só do id. Ao iniciar o servidor (e uma vez por dia), arquivos enviados há mais de 24 h que não são anexo de aviso nem atestado são apagados, assim como conteúdos sem registro no banco. Percentuais de frequência têm uma casa decimal; a falta justificada é derivada da justificativa aceita e não altera o percentual.

## Interface e identidade visual

O visual segue o design do projeto no Claude Design (telas do aluno e folha da marca). O contrato da implementação está em `docs/sprint-aluno-contrato.md`.

- **Marca:** "C·Warning", com o ponto vermelho `#E40913` usado só no sinal e em urgências. As cores ficam em `public/tema.css` (variáveis `--cw-*`): índigo `#312782` para estrutura e botões, azul `#4A5BD6` para interação e neutros para superfícies.
- **Tipografia e ícones:** Sora (títulos), Figtree (textos) e ícones Phosphor, **hospedados no próprio servidor** (`public/vendor/`). Nenhum recurso vem de CDN externo, o que mantém a CSP restrita a `'self'` e não expõe o IP dos alunos a terceiros (LGPD).
- **Acessibilidade:** todas as combinações de cor passam no contraste WCAG 2.1 AA, há foco visível global, alvos de toque de pelo menos 44 px e navegação por teclado.
- **Celular:** os três portais têm abas inferiores fixas (com a opção "Mais" quando há muitas seções) e respeitam a área segura do iPhone.
- **Aparência:** tema claro, escuro ou automático e tamanho do texto, escolhidos em Ajustes e guardados no aparelho (`public/preferencias.js`, tokens escuros em `tema.css`).

### Portal do aluno

Seções: Início (resumo do dia), Avisos (não lidos, salvos, categorias, confirmar leitura), Agenda (aulas, provas, entregas e eventos dos próximos 7 dias), Atividades (pendentes, entregues, corrigidas; envio de resposta), Frequência (resumo por disciplina e histórico de faltas) e Ajustes (perfil, senha, ajuda). A navegação usa o hash da URL (`#/avisos/naolidos`, `#/avisos/12`…), o que permite voltar e compartilhar o link.

Avaliações (`tipo = avaliacao`) são provas presenciais: aparecem na Agenda, mas não recebem envio pelo portal (a API recusa com 400).

## E-mails

Os modelos de e-mail ficam na Resend (domínio `ceeplourdinhaguerra.com.br`), com cópia versionada em `emails/` (HTML e texto). São eles: aviso urgente, resumo de avisos, lembrete de prazo, redefinição de senha, senha alterada e conta criada. Veja `emails/README.md`. A chave da Resend nunca fica no repositório: em produção, entra como variável de ambiente. O conteúdo digitado pelos usuários precisa ter o HTML escapado antes do envio, porque a Resend não escapa.

## Sprint 2 — comunicação

**Conta** (logado): `GET /api/conta` → `{ email, notificacoes: { urgente, turma, prazos, eventos, mensagens } }`;
`PUT /api/conta/notificacoes` `{ tipo: true|false, … }`; `POST /api/conta/email` `{ email, senha_atual }` envia um
link de confirmação (24 h) para o endereço novo, que só é gravado depois de confirmado (resposta
`{ email_pendente, mensagem }`); `DELETE /api/conta/email` com corpo JSON `{ senha_atual }` remove. Senha atual
ausente ou errada → 400 `{ erro: "A senha atual está incorreta." }` (nunca 401); bloqueio da conta → 429.
Pendência: ainda não há modelo de e-mail para avisar o endereço anterior quando o e-mail é trocado; por ora a troca
fica na auditoria (`email.alterar` e `email.alterar_sem_aviso`).
Dispositivos: `GET /api/conta/sessoes` → `[{ id, dispositivo, ultimo_acesso, atual }]` (o `id` é um prefixo do hash,
nunca o token), `DELETE /api/conta/sessoes/:id` e `DELETE /api/conta/sessoes` (todas menos a atual).

**Sem login**: `POST /api/auth/recuperar` `{ login }` (usuário, matrícula ou e-mail) responde sempre 200 com a mesma
mensagem e é limitado por IP (5 a cada 15 min) e por conta (3 e-mails por hora); o link `APP_URL/redefinir#token=…`
vale 30 min. `POST /api/auth/redefinir` `{ token, nova_senha }` aplica as regras da troca de senha, zera
`deve_trocar_senha` e encerra todas as sessões. `POST /api/conta/email/confirmar` `{ token }` (link
`APP_URL/confirmar-email#token=…`). Tokens têm 256 bits, são de uso único e só o hash SHA-256 fica no banco.

**Mensagens**: `GET /api/mensagens/contatos`, `GET /api/mensagens` (conversas), `POST /api/mensagens` `{ para, texto }`
(até 2.000 caracteres, 30 por minuto), `GET /api/mensagens/:id_conversa[?depois=<id_mensagem>]` →
`{ id_conversa, com, pode_responder, mensagens: [{ id_mensagem, texto, criado_em, lida_em, minha }], mais }` (até 100
por página; marca as recebidas como lidas) e `GET /api/mensagens/nao-lidas` → `{ total }`. Aluno fala com os
professores da sua turma e com a gestão; professor, com os alunos das suas turmas e com a gestão; gestão, com todos.

**E-mails** (`src/services/email.js`, `notificacoes.js`, `agendador.js`): aviso urgente aos alunos do público (avisos
comuns só entram no resumo), senha alterada, conta criada pela gestão, confirmação de e-mail, redefinição de senha,
nova mensagem (no máximo 1 por conversa a cada 30 min), lembrete de prazo às 18h da véspera para quem não entregou e
resumo semanal dos avisos não lidos na segunda às 7h (horário de Brasília). Só recebe quem tem conta ativa com e-mail;
cada tipo respeita o silenciamento da pessoa; os envios automáticos usam `envios_email` para não repetir. Variáveis de
ambiente: `RESEND_API_KEY` (sem ela os envios só aparecem no log como “simulado”), `APP_URL` (padrão
`https://ceeplourdinhaguerra.com.br`) e `CW_AGENDADOR=0` para desligar o agendador (testes e scripts).

## Testes automatizados

`npm test` (ou `node --test --test-concurrency=1 "tests/**/*.test.js"`) roda 147 testes em cerca de 50 s, sem rede e sem dependências: cada domínio sobe o servidor numa porta livre com um banco novo gerado por `scripts/seed-exemplo.js` em diretório temporário (o banco real nunca é tocado). Cobrem autenticação e limites, permissões entre perfis e turmas, mural, avisos, anexos, horários em PDF, pastas e salvos, importação por planilha, justificativas, ocorrências, chamada, mensagens, conta, relatórios, validação de entradas e os utilitários de data, calendário, CSV e senha. O servidor de teste roda com `TRUST_PROXY=1` e cabeçalhos iguais aos da produção (Cloudflare → Traefik).

## Regras de segurança e dados

- A Gestão é o único perfil que administra usuários, turmas, matrículas e disciplinas e que altera notas.
- Contas individuais e dados administrativos existentes são preservados; não são o método de login apresentado na tela do aluno.
- O professor só atua em turmas e disciplinas vinculadas ao próprio perfil. O autor de um aviso é determinado pelo token, não pelo corpo enviado pelo cliente.
- Senhas são armazenadas com `scrypt`; tokens aleatórios são armazenados no banco como hash e expiram em 8 horas.
- Respostas para dados não autorizados não incluem cadastros de terceiros.
- A série e o curso da turma são validados na matrícula; as seleções da tela de login não substituem o vínculo cadastrado pela Gestão.
- HTTP 401 significa não autenticado; 403, perfil sem permissão; 404, registro ausente ou fora do escopo; 409, conflito de chave única/relacionamento.

## Privacidade e LGPD

Os usuários são, na maioria, adolescentes (art. 14 da LGPD). Base legal: art. 7º, III (execução de política pública
de educação pela escola pública), sempre no melhor interesse do estudante. A política completa, em linguagem simples,
fica em `public/privacidade.html` (rota `/privacidade`).

- **Aceite dos termos.** Depois do login (e do primeiro acesso), quem ainda não aceitou vê a etapa "Termos e
  privacidade" no próprio painel de entrada. Enquanto `termos_pendentes` for verdadeiro, a API só libera `/api/me`,
  `/api/auth/password` e `/api/privacidade/*` (403 nas demais). A versão vigente é a data de publicação, na constante
  `TERMOS_VERSAO` de `src/controllers/privacidadeController.js`; ao mudar o texto, atualize essa data e
  `TERMOS_PUBLICADOS_EM` (e faça o middleware comparar `termos_aceitos_em` com ela, para pedir o aceite de novo).
- **Rotas.** `GET /api/privacidade/termos` (versão e situação do aceite), `POST /api/privacidade/aceite` (corpo `{}`
  ou `{ "versao": "2026-10-29" }`), `GET /api/privacidade/meus-dados` (JSON com perfil, matrícula, frequências,
  entregas, justificativas, ocorrências sobre a pessoa, mensagens, avisos lidos/salvos, arquivos, sessões e o próprio
  registro de auditoria; art. 18 — os portais baixam como `cw-meus-dados-AAAA-MM-DD.json` em Ajustes/Configurações ›
  Privacidade) e, só para a gestão, `GET /api/auditoria?acao=&id_usuario=&de=AAAA-MM-DD&ate=AAAA-MM-DD&pagina=&por_pagina=`
  (`acao` exata, como `aluno.matricular`, ou o grupo, como `senha`; até 100 por página; tela em Relatórios).
- **Auditoria** (`src/services/auditoria.js`, art. 37). Guarda só quem, ação, alvo (ex.: `aluno:21`) e data — nunca
  senha, texto de mensagem, motivo ou descrição. Registra: login com sucesso, troca e redefinição de senha (pela
  pessoa, por link ou pela gestão), matrícula, criação/desativação/reativação/exclusão de contas, análise de
  justificativa, registro e resolução de ocorrência, download de atestado, exportação de relatório, aceite dos termos
  e exportação dos próprios dados. Uma falha ao auditar vai para o log e não interrompe a ação.
- **Retenção** (agendador, a cada 5 minutos): auditoria é apagada após **2 anos**; sessões expiradas (8 h) e links de
  senha/e-mail vencidos (30 min / 24 h) são apagados; chaves de e-mails automáticos, após 60 dias; arquivos enviados e
  não vinculados, após 24 h; backups, 7 diários + 4 semanais. Dados escolares (frequência, entregas, justificativas,
  ocorrências) ficam enquanto houver vínculo e pelo prazo das normas de arquivo escolar; desativar uma conta mantém o
  histórico e só bloqueia o acesso.
- **Quem acessa.** Aluno: os próprios dados. Professor: dados das turmas/disciplinas em que leciona e as ocorrências
  que registrou. Gestão: todos os dados e o registro de auditoria.
- **Pendências da escola:** confirmar o e-mail de contato (`contato@ceeplourdinhaguerra.com.br` é provisório), indicar
  o encarregado de proteção de dados (art. 41), confirmar o prazo de guarda do arquivo escolar e o prazo de resposta
  aos pedidos dos titulares.

## Backup e restauração

**Como funciona.** O próprio servidor faz um backup diário do banco às **03h (horário de Brasília)**, em `src/services/backup.js`. A cópia usa a API de backup online do SQLite (`backup()` do módulo `node:sqlite`): o banco é copiado em etapas enquanto o sistema continua atendendo, e o arquivo final é consistente (escritas feitas durante a cópia entram no backup). O arquivo é gravado primeiro como `.tmp`, passa por `PRAGMA integrity_check` (aberto só leitura) e só então é renomeado; se a verificação falhar, a cópia é descartada e o erro aparece no log. Os backups têm permissão `600` (só o dono lê) e a pasta, `700`. O log registra só nome do arquivo, tamanho e duração, sem dados pessoais.

- **Onde ficam:** `DATA_DIR/backups/educacao-AAAA-MM-DD.sqlite` (em produção, `/data/backups/` no volume do Docker; localmente, `data/backups/`). Fora do git, como o banco.
- **Quando:** o servidor confere a cada 10 minutos (e 1 minuto após iniciar). Se já passou das 03h e o arquivo do dia não existe, o backup é feito — assim um redeploy ou reinício durante a madrugada não perde o backup do dia. Instalação sem nenhum backup recebe o primeiro logo ao iniciar. O nome do arquivo do dia garante que não se repete.
- **Retenção:** os 7 backups mais recentes + os 4 domingos mais recentes (cópias semanais); o resto é apagado automaticamente após cada backup bem-sucedido.
- **Desligar:** `CW_BACKUP=0` (testes e scripts).
- **Desligamento gracioso:** em `SIGTERM`/`SIGINT` (o Dokploy manda `SIGTERM` no redeploy), o servidor para de aceitar conexões, espera as requisições em andamento por até 10 s, espera um backup em andamento terminar, fecha o banco e sai com código 0.

**Restaurar** (com o servidor **parado** — no Dokploy, pare a aplicação e rode o script num terminal do container ou com o volume montado):

```bash
node scripts/restaurar-backup.js                                       # lista os backups
node scripts/restaurar-backup.js educacao-2026-10-28.sqlite            # verifica e mostra o plano
node scripts/restaurar-backup.js educacao-2026-10-28.sqlite --confirmar
```

A pasta de dados vem de `DATA_DIR` (ou `--dir <pasta>`). O script confere a integridade do backup escolhido e só substitui o banco com `--confirmar`. Antes, guarda o banco atual como `educacao.antes-restauracao-<data>.sqlite` na mesma pasta (apague essas cópias depois de conferir que está tudo certo — elas também contêm dados pessoais).

**Pendência: cópia externa.** Os backups ficam no mesmo volume da VPS; protegem contra erro humano e corrupção do arquivo, mas **não** contra perda do servidor ou do disco. Recomenda-se copiar `DATA_DIR/backups/` periodicamente para fora da VPS (ex.: armazenamento de objetos com criptografia, ou o backup de volumes do próprio Dokploy), com acesso restrito, por conter dados pessoais (LGPD). Isso ainda não está implementado.

## Sprint 4 — horários em PDF, pastas de salvos e importação por planilha

Contrato completo em `docs/sprint-4-contrato.md`.

**Horários em PDF** (`/api/horarios-pdf`). A gestão envia o PDF por `POST /api/arquivos` e o publica com
`PUT /api/horarios-pdf/turma/:id_turma` ou `PUT /api/horarios-pdf/professores` (`{ "id_arquivo": n }`; só PDF
enviado pela própria pessoa; publicar de novo substitui o anterior). `DELETE` nas mesmas rotas remove.
`GET /api/horarios-pdf` devolve ao aluno `{ turma }`, ao professor `{ professores, turmas }` (só as turmas em que
leciona) e à gestão `{ professores, turmas }` (todas as publicadas); cada item tem `id_horario_pdf`, `publico`,
`id_turma`, `nome_turma`, `arquivo { id_arquivo, nome, tamanho }` e `atualizado_em`. O download continua em
`GET /api/arquivos/:id`: horário da turma → alunos da turma, professores dela e gestão; horário dos professores →
professores e gestão. Arquivo vinculado a horário não é órfão; o PDF substituído sai na limpeza diária (24 h).
Auditoria: `horario.publicar` e `horario.remover`.

**Pastas e salvos** (aluno, professor e gestão). `GET/POST /api/pastas`, `PATCH/DELETE /api/pastas/:id` (nome de
1 a 40 caracteres, único por pessoa sem diferenciar maiúsculas, até 30 pastas; excluir a pasta mantém os avisos
salvos, sem pasta). `GET /api/salvos[?id_pasta=n | ?sem_pasta=1]`, `PUT /api/salvos/:id_post { "id_pasta": n|null }`
(salva ou move, mantendo a data em que foi salvo) e `DELETE /api/salvos/:id_post`. Só avisos visíveis à pessoa (mesma
regra do mural/listagem); fora disso, 404. O mural do aluno traz `id_pasta` em cada aviso; desmarcar o salvo pelo
mural também tira o aviso da pasta.

**Importação de alunos** (`POST /api/matriculas/importar[?simular=1]`, só gestão). Corpo CSV (`Content-Type:
text/csv`), até 1 MB e 2.000 linhas, UTF-8 com ou sem BOM, separador `;`, `,` ou tab. Colunas: `matricula`, `nome`,
`turma` (nome como cadastrado; acentos, maiúsculas, `ª`/`a` e tipo de traço não importam), `cpf` (4 primeiros dígitos
ou CPF inteiro, com ou sem pontuação) e `email` (opcional). Modelo em `/modelos/alunos.csv`. Resposta
`{ total, validos, erros: [{ linha, campo, mensagem }], alunos: [{ linha, matricula, nome, turma }] }`: com
`simular=1` nada é gravado (200); sem ele, qualquer erro → 400 com o relatório, e sem erros todos entram numa única
transação → 201 com `importados`. Regras iguais às da matrícula individual (senha inicial `ceep@` + 4 primeiros
dígitos do CPF, troca obrigatória no primeiro acesso, e-mail como confirmação pendente — enviados em segundo plano,
um a cada 0,55 s). Uma importação por vez (429 se houver outra em andamento). O CPF só é usado para calcular a senha:
nunca é gravado, devolvido, registrado em log nem citado em mensagens ("CPF inválido na linha N"). Células são sempre
texto (uma fórmula como `=SOMA(...)` não é avaliada). Auditoria `aluno.importar` com alvo `lote:<n>`.

Para gerar o CSV: no Excel, *Arquivo → Salvar como → CSV UTF-8 (delimitado por vírgulas)*; no Google Planilhas,
*Arquivo → Fazer download → Valores separados por vírgula (.csv)*. Formate as colunas `matricula` e `cpf` como
**texto** antes de digitar, para a planilha não remover zeros à esquerda nem converter em notação científica.
