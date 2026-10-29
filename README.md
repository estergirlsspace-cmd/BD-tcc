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

O banco persistente está em `data\educacao.sqlite`. Ele e as migrações são criados automaticamente sem apagar dados existentes. Faça cópias de segurança periódicas desse arquivo e pare o servidor antes de copiá-lo.

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
  configure-class-passwords.js
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
  educacao.sqlite
```

## Contas iniciais

As contas de professor e Gestão usam os logins `professor` e `gestao`. O acesso de aluno na tela é compartilhado por curso e série: informa-se somente curso, série e senha. Todos os alunos daquela combinação usam a mesma conta. A tela avisa que esse acesso não identifica quem enviou uma atividade e não permite consultar notas ou frequência individuais. A senha alterada nessa conta passa a valer para toda a turma.

Atualize os logins e senhas de professor e Gestão:

```powershell
$env:PROFESSOR_SENHA = Read-Host "Senha de professor"
$env:GESTAO_SENHA = Read-Host "Senha de gestão"
node .\scripts\seed-accounts.js
Remove-Item Env:PROFESSOR_SENHA, Env:GESTAO_SENHA
```

Configure as senhas compartilhadas para o acesso de aluno. Cada uma corresponde a um curso e série:

```powershell
$env:REDES_TURMA_1_SENHA = Read-Host "Senha compartilhada de Redes, turma 1"
$env:REDES_TURMA_2_SENHA = Read-Host "Senha compartilhada de Redes, turma 2"
$env:REDES_TURMA_3_SENHA = Read-Host "Senha compartilhada de Redes, turma 3"
$env:INFORMATICA_TURMA_1_SENHA = Read-Host "Senha compartilhada de Informática, turma 1"
$env:INFORMATICA_TURMA_2_SENHA = Read-Host "Senha compartilhada de Informática, turma 2"
$env:INFORMATICA_TURMA_3_SENHA = Read-Host "Senha compartilhada de Informática, turma 3"
node .\scripts\configure-class-passwords.js
Remove-Item Env:REDES_TURMA_1_SENHA, Env:REDES_TURMA_2_SENHA, Env:REDES_TURMA_3_SENHA, Env:INFORMATICA_TURMA_1_SENHA, Env:INFORMATICA_TURMA_2_SENHA, Env:INFORMATICA_TURMA_3_SENHA
```

As duas rotinas salvam somente hashes `scrypt`, não imprimem senhas e não gravam segredos no código. Todas as senhas devem ter pelo menos 8 caracteres.

## Autenticação

`POST /api/auth/login` aceita JSON. Para aluno, envie curso, série e senha, sem usuário. Professor e Gestão enviam login e senha, sem curso ou série.

```json
{
  "senha": "SUA_SENHA",
  "curso": "redes",
  "serie": 1
}
```

O login retorna um token valido por 8 horas e indica `conta_compartilhada`. Use o token nas rotas protegidas. `POST /api/auth/logout` revoga o token atual, `POST /api/auth/password` altera a senha compartilhada de todo o curso e serie, e `GET /api/me` consulta o perfil. As contas compartilhadas antigas sao desativadas; os dados administrativos e as contas individuais existentes sao preservados.

Após autenticar, alunos e professores são direcionados aos respectivos portais (`/aluno` e `/professor`). O portal do professor carrega turmas e disciplinas vinculadas, horários e comunicados pela API; a publicação só permite escolher uma disciplina associada ao perfil autenticado. Comunicados salvos em pastas ficam no armazenamento local do navegador.

## Recursos e operações

Todos os corpos e respostas usam JSON. IDs são inteiros positivos. Erros usam `{"erro":"mensagem"}`.

| Recurso | Rotas principais | Acesso |
| --- | --- | --- |
| Usuários | `GET/POST /api/usuarios`, `GET/PATCH/DELETE /api/usuarios/:id` | Gestão |
| Turmas | CRUD `/api/turmas` | Consulta de acordo com o perfil; alterações pela Gestão |
| Alunos/matrículas | CRUD `/api/alunos` | Gestão; matrícula exige usuário aluno e turma do mesmo curso |
| Cadastro individual | `POST /api/matriculas` | Gestão mantém registros individuais de matrícula, mesmo com o login compartilhado |
| Professores | CRUD `/api/professores` | Gestão |
| Disciplinas | CRUD `/api/disciplinas` | Consulta de acordo com o perfil; alterações pela Gestão |
| Avisos/comunicados | CRUD `/api/avisos` ou `/api/posts-avisos` | Aluno consulta os destinados à turma; professor publica para turma vinculada; Gestão administra |
| Horários | `GET/POST /api/horarios`, `GET/PATCH/DELETE /api/horarios/:id` | Aluno consulta o curso/série da conta; professor consulta/publica nas turmas vinculadas; Gestão consulta e publica |
| Atividades e avaliações | `GET/POST /api/atividades`, `GET/PATCH/DELETE /api/atividades/:id` | Aluno consulta atividades do curso/série; professor e Gestão publicam |
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

Para cadastrar um aluno individualmente para controle administrativo de matrícula, a Gestão envia login, nome e turma:

```json
POST /api/matriculas
{"login":"aluno.001","nome":"Nome do aluno","id_turma":1}
```

O login da tela não usa esses nomes individuais: todos os alunos do mesmo curso/série compartilham a conta e senha configuradas. Por isso, a conta de turma não pode ser usada para identificar autorias individuais de entregas, notas ou frequência. Crie o usuário professor, seu perfil em `/api/professores` e depois as disciplinas da turma com `id_professor`. A associação professor-disciplina é a autorização usada para limitar a publicação de atividades, horários, avisos e frequência.

### Exemplo de publicação

Com token de professor:

```json
POST /api/atividades
{"titulo":"Atividade 1","descricao":"Enviar a resolução","id_turma":1,"id_disciplina":1,"prazo":"2026-11-01T23:59:00-03:00","tipo":"atividade"}
```

Tipos aceitos: `atividade`, `avaliacao`, `evento` e `comunicado`. Para avisos, use `POST /api/avisos` com `titulo`, `conteudo` e `id_turma`; Gestão também pode definir curso/série para avisos gerais.

## Regras de segurança e dados

- A Gestão é o único perfil que administra usuários, turmas, matrículas e disciplinas e que altera notas.
- A conta compartilhada de aluno acessa conteúdo da combinação curso/série, mas não representa uma pessoa. Ela não pode consultar dados individuais nem enviar uma entrega atribuída a um aluno específico.
- Contas individuais e dados administrativos existentes são preservados; não são o método de login apresentado na tela do aluno.
- O professor só atua em turmas e disciplinas vinculadas ao próprio perfil. O autor de um aviso é determinado pelo token, não pelo corpo enviado pelo cliente.
- Senhas são armazenadas com `scrypt`; tokens aleatórios são armazenados no banco como hash e expiram em 8 horas.
- Respostas para dados não autorizados não incluem cadastros de terceiros.
- A série e o curso da turma são validados na matrícula; as seleções da tela de login não substituem o vínculo cadastrado pela Gestão.
- HTTP 401 significa não autenticado; 403, perfil sem permissão; 404, registro ausente ou fora do escopo; 409, conflito de chave única/relacionamento.
