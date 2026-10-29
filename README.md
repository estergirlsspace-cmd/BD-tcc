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

Áreas de professor: `natureza`, `humanas`, `linguagens`, `matematica`, `informatica`, `redes`. A área define o tema do portal do professor. Para gerar uma nova senha provisória, use `POST /api/equipe/ID_DO_USUARIO/senha`.

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
| Entregas | `POST /api/atividades/:id/entregas`, `GET /api/atividades/:id/entregas` | Aluno envia sua resposta; professor/gestão consultam entregas das turmas permitidas |
| Notas e feedback | `PATCH /api/entregas/:id` | Apenas Gestão altera nota/feedback; aluno consulta apenas as próprias notas |
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

Contas não são excluídas quando têm histórico (avisos, atividades, frequências, entregas): a API recusa a exclusão e a Gestão **desativa** a conta. A pessoa deixa de entrar e o histórico continua. Turmas e disciplinas com registros vinculados também não podem ser excluídas.

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

## Interface e identidade visual

O visual segue o design do projeto no Claude Design (telas do aluno e folha da marca). O contrato da implementação está em `docs/sprint-aluno-contrato.md`.

- **Marca:** "C·Warning", com o ponto vermelho `#E40913` usado só no sinal e em urgências. As cores ficam em `public/tema.css` (variáveis `--cw-*`): índigo `#312782` para estrutura e botões, azul `#4A5BD6` para interação e neutros para superfícies.
- **Tipografia e ícones:** Sora (títulos), Figtree (textos) e ícones Phosphor, **hospedados no próprio servidor** (`public/vendor/`). Nenhum recurso vem de CDN externo, o que mantém a CSP restrita a `'self'` e não expõe o IP dos alunos a terceiros (LGPD).
- **Acessibilidade:** todas as combinações de cor passam no contraste WCAG 2.1 AA, há foco visível global, alvos de toque de pelo menos 44 px e navegação por teclado.
- **Celular:** no portal do aluno, abas inferiores fixas. Os portais de professor e gestão usam a barra de `public/navegacao.css`.

### Portal do aluno

Seções: Início (resumo do dia), Avisos (não lidos, salvos, categorias, confirmar leitura), Agenda (aulas, provas, entregas e eventos dos próximos 7 dias), Atividades (pendentes, entregues, corrigidas; envio de resposta), Frequência (resumo por disciplina e histórico de faltas) e Ajustes (perfil, senha, ajuda). A navegação usa o hash da URL (`#/avisos/naolidos`, `#/avisos/12`…), o que permite voltar e compartilhar o link.

Avaliações (`tipo = avaliacao`) são provas presenciais: aparecem na Agenda, mas não recebem envio pelo portal (a API recusa com 400).

## E-mails

Os modelos de e-mail ficam na Resend (domínio `ceeplourdinhaguerra.com.br`), com cópia versionada em `emails/` (HTML e texto). São eles: aviso urgente, resumo de avisos, lembrete de prazo, redefinição de senha, senha alterada e conta criada. Veja `emails/README.md`. A chave da Resend nunca fica no repositório: em produção, entra como variável de ambiente. O conteúdo digitado pelos usuários precisa ter o HTML escapado antes do envio, porque a Resend não escapa.

## Regras de segurança e dados

- A Gestão é o único perfil que administra usuários, turmas, matrículas e disciplinas e que altera notas.
- Contas individuais e dados administrativos existentes são preservados; não são o método de login apresentado na tela do aluno.
- O professor só atua em turmas e disciplinas vinculadas ao próprio perfil. O autor de um aviso é determinado pelo token, não pelo corpo enviado pelo cliente.
- Senhas são armazenadas com `scrypt`; tokens aleatórios são armazenados no banco como hash e expiram em 8 horas.
- Respostas para dados não autorizados não incluem cadastros de terceiros.
- A série e o curso da turma são validados na matrícula; as seleções da tela de login não substituem o vínculo cadastrado pela Gestão.
- HTTP 401 significa não autenticado; 403, perfil sem permissão; 404, registro ausente ou fora do escopo; 409, conflito de chave única/relacionamento.
