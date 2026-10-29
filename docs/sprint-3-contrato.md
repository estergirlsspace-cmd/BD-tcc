# Sprint 3 — prontidão para dados reais

Leia antes `docs/sprint-2-contrato.md` (regras gerais continuam: Node puro, sem npm, sem CDN, CSP
`'self'` sem inline, tokens `--cw-*`, CRLF preservado, WCAG AA, testes só em cópia do banco num
diretório temporário, nada de produção, **ninguém faz commit/push/deploy**). Contas de teste:
gestão `lucas`, professor `lucas.professor` (senha em `.senha-lucas.txt`, não imprimir); alunos em
`data/alunos-exemplo.csv`.

## Já pronto (base)

- `GET /api/saude` → `{ status: 'ok' }` (sem login).
- Todas as respostas JSON da API com `Cache-Control: no-store`.
- `usuarios.termos_aceitos_em` (TEXT) e tabela `auditoria (id_auditoria, id_usuario, acao, alvo,
  criado_em)`. `authenticate` expõe `user.termos_pendentes` e `GET /api/me` traz
  `termos_pendentes`. Enquanto pendente, a API só libera `/api/me`, `/api/auth/password` e
  `/api/privacidade/*` (403 com mensagem nas demais).
- Esqueletos: `privacidadeController.js` (prefixo `/api/privacidade`), `auditoriaController.js`
  (`/api/auditoria`), `src/services/auditoria.js` (`registrar(user, acao, alvo)`).

## Frente "lgpd"

- `POST /api/privacidade/aceite` → grava `termos_aceitos_em` (versão dos termos em constante no
  código; se a versão mudar no futuro, comparar com a data de publicação).
- `GET /api/privacidade/meus-dados` → JSON com todos os dados do próprio usuário (perfil, matrícula,
  frequências, entregas, justificativas, ocorrências sobre ele, mensagens enviadas e recebidas,
  avisos lidos/salvos, sessões) — art. 18 LGPD. Registrar na auditoria.
- `GET /api/auditoria` (gestão) com filtros `?acao=&id_usuario=&de=&ate=` e paginação.
- `registrar()` grava ação e alvo (nunca conteúdo pessoal). Chamar nos pontos relevantes:
  login (sucesso), troca/redefinição de senha, matrícula, criação/desativação de contas,
  redefinição de senha pela gestão, análise de justificativa, registro/resolução de ocorrência,
  download de atestado, exportação de relatório, exportação de "meus dados".
- Retenção: no agendador existente (`src/services/agendador.js`), apagar auditoria com mais de
  2 anos e sessões expiradas; documentar a política (o que se guarda, por quanto tempo, quem acessa).
- `public/privacidade.html` (+ css/js se precisar; rota de página `/privacidade` — o integrador
  adiciona em `web.js`): política de privacidade e termos de uso em linguagem simples para
  adolescentes e responsáveis, com: quais dados, finalidade (comunicação escolar), base legal
  (art. 7º, III e art. 14 — interesse do estudante / execução de políticas educacionais), quem
  acessa, retenção, direitos do titular (acesso, correção, exportação), contato da escola.
- Login (`public/index.html`, `app.js`, `styles.css`): depois do login (e do primeiro acesso), se
  `termos_pendentes`, mostrar no mesmo painel a etapa "Termos e privacidade" (resumo + link para a
  página completa + caixa "Li e aceito" + botão), chamar `POST /api/privacidade/aceite` e seguir.
- Portais (`aluno.js`, `professor.js`, `gestao-conta.js`/`gestao.js`): em Ajustes/Configurações,
  bloco "Privacidade" com link para a política e botão "Baixar meus dados" (fetch autenticado →
  arquivo .json). Gestão ganha uma tela/aba "Auditoria" (lista filtrável) — pode ficar dentro de
  Configurações ou Relatórios. Mudanças pequenas e localizadas nesses arquivos.

## Frente "backup"

- `src/services/backup.js`: backup diário (03h de Brasília) do SQLite em
  `DATA_DIR/backups/educacao-AAAA-MM-DD.sqlite` usando a API de backup do `node:sqlite`
  (consistente com o banco em uso), permissão 600, retenção 7 diários + 4 semanais (domingos);
  verificação de integridade (`PRAGMA integrity_check` no arquivo gerado); log sem dados pessoais.
  Iniciado a partir de `server.js` (você pode editar `server.js`), desligável com `CW_BACKUP=0`.
- `scripts/restaurar-backup.js` (restauração guiada com confirmação) e seção no README
  ("Backup e restauração").
- Desligamento gracioso: em SIGTERM/SIGINT, parar de aceitar conexões, terminar as em andamento
  (timeout 10 s) e fechar o banco (Docker/Dokploy manda SIGTERM no redeploy).

## Frente "pwa"

Só arquivos novos: `public/manifest.webmanifest` (nome "C-Warning", cores da marca, `start_url`
"/", display standalone, ícones), ícones em `public/assets/icones/` (PNG 192, 512, 512 maskable,
apple-touch 180 e favicon — gere a partir da marca "C" + ponto vermelho sobre índigo, em SVG
convertido para PNG com uma ferramenta disponível no Mac, sem dependências no projeto),
`public/sw.js` (service worker: cache da casca estática — CSS, JS, fontes, ícones; rede primeiro
para páginas com fallback `public/offline.html`; NUNCA cachear `/api/*`), `public/offline.html`
e `public/pwa.js` (registra o service worker). O integrador adiciona as tags no `<head>` das
páginas e as rotas/headers no `web.js` — liste no relatório exatamente o que adicionar
(`<link rel="manifest">`, `theme-color`, `apple-touch-icon`, `<script src="/pwa.js" defer>`,
`Service-Worker-Allowed`/`Cache-Control` para `/sw.js`, content-type `.webmanifest`).

## Frente "testes"

`tests/` com `node:test` + `node:assert` (sem dependências) e `package.json` com
`"scripts": { "test": "node --test tests/" }` e `"engines": { "node": ">=24" }`. Um helper que sobe
o servidor numa porta livre com `DATA_DIR` temporário e um banco gerado pelo
`scripts/seed-exemplo.js` (não usar o banco real), com `CW_AGENDADOR=0` e `CW_BACKUP=0`. Cobrir:
autenticação (login, bloqueio por tentativas, primeiro acesso, termos pendentes), permissões entre
perfis e turmas, mural (leitura/salvo/categorias), avisos com público, anexos (tipos, tamanho,
acesso), justificativas, ocorrências, chamada, mensagens (permissões), conta (recuperar/redefinir
com token, sessões), relatórios CSV, validação de entradas e utilitários (datas, calendário, CSV,
senha). Os testes devem rodar em < 60 s e não depender de rede (Resend sem chave = simulado).

## Frentes "auditoria" (somente leitura)

Revisão de segurança/bugs do servidor e de UX/acessibilidade/segurança do front, com achados
verificados, ranqueados, citando arquivo:linha e fundamento (OWASP/CWE/LGPD/WCAG/Nielsen). Não
editam arquivos.
