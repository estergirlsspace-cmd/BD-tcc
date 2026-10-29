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
  educacao.sqlite
```

## Contas iniciais

As contas de professor e Gestão usam os logins `professor` e `gestao`. Atualize as senhas:

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

Para gerar dados de exemplo (turmas, disciplinas, horários, 36 alunos, atividades, avisos e frequência), rode `node scripts/seed-exemplo.js`. A lista de matrículas e senhas iniciais de teste sai em `data/alunos-exemplo.csv`, fora do git.

## Autenticação

`POST /api/auth/login` recebe `login` (matrícula do aluno ou usuário de professor/Gestão) e `senha`:

```json
{ "login": "20260001", "senha": "SUA_SENHA" }
```

O login retorna um token válido por 8 horas e o campo `deve_trocar_senha`. Use o token nas rotas protegidas.

- `POST /api/auth/password` (`senha_atual`, `nova_senha`) troca a própria senha e encerra as outras sessões. A nova senha deve ter de 8 a 128 caracteres, ser diferente da atual e não seguir o padrão `ceep@` + 4 dígitos.
- `POST /api/auth/logout` revoga o token atual.
- `GET /api/me` consulta o perfil.

Após autenticar, alunos e professores são direcionados aos respectivos portais (`/aluno` e `/professor`). O portal do professor carrega turmas e disciplinas vinculadas, horários e comunicados pela API; a publicação só permite escolher uma disciplina associada ao perfil autenticado. Comunicados salvos em pastas ficam no armazenamento local do navegador.

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

Matricule um aluno (a senha inicial será `ceep@` + `cpf_inicio`):

```json
POST /api/matriculas
{"matricula":"20260001","nome":"Nome do aluno","id_turma":1,"cpf_inicio":"1234"}
```

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

Tipos aceitos: `atividade`, `avaliacao`, `evento` e `comunicado`. Para avisos, use `POST /api/avisos` com `titulo`, `conteudo` e `id_turma`; Gestão também pode definir curso/série para avisos gerais.

## Regras de segurança e dados

- A Gestão é o único perfil que administra usuários, turmas, matrículas e disciplinas e que altera notas.
- Contas individuais e dados administrativos existentes são preservados; não são o método de login apresentado na tela do aluno.
- O professor só atua em turmas e disciplinas vinculadas ao próprio perfil. O autor de um aviso é determinado pelo token, não pelo corpo enviado pelo cliente.
- Senhas são armazenadas com `scrypt`; tokens aleatórios são armazenados no banco como hash e expiram em 8 horas.
- Respostas para dados não autorizados não incluem cadastros de terceiros.
- A série e o curso da turma são validados na matrícula; as seleções da tela de login não substituem o vínculo cadastrado pela Gestão.
- HTTP 401 significa não autenticado; 403, perfil sem permissão; 404, registro ausente ou fora do escopo; 409, conflito de chave única/relacionamento.
