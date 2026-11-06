# Sprint 6 — interface nos códigos da equipe (pasta "Códigos Interface")

Referência visual: `docs/design/prototipo/*.html` (+ `.png` de cada um), baixados do Drive da Ester
em 2026-11-06. Eles SUBSTITUEM o protótipo anterior (dourado/indigo). Paleta: azul-marinho + vermelho.

## Regras gerais (valem para todos)

- **Só interface.** Sem mudar banco, API ou regras de negócio. Toda funcionalidade que existe hoje
  continua existindo e funcionando (mesmos endpoints, mesmos ids/hash-rotas usados pelo JS). O
  protótipo manda no visual e na organização; o app atual manda no que existe.
- Não inventar recurso que o backend não tem (ex.: "Lourdinha IA", chat do aluno — o chat foi tirado
  da interface do aluno na Sprint 5 e continua fora). Item do protótipo sem backend: omitir.
  Dados do protótipo são de mentira: nunca copiar nomes/números fictícios para o app.
- CSP do servidor é estrita: **nada inline** (sem `<style>`, `style=""`, `<script>` inline, `onclick=`),
  **nada de CDN** (o protótipo do aluno usa Tailwind CDN e o da gestão usa pdf.js CDN: traduzir para
  CSS próprio / não usar). Ícones: os do protótipo são emojis/caracteres; preferir os ícones Phosphor
  já vendorizados (`/vendor/phosphor/*.css`, classes `ph ph-*`), coerentes entre telas.
- Tokens compartilhados em `public/tema.css` (já atualizados: `--cw-marinho`, `--cw-marinho-hover`,
  `--cw-marinho-escuro`, `--cw-azul`, `--cw-azul-suave`, `--cw-vermelho`, `--cw-vermelho-hover`,
  `--cw-vermelho-suave`, `--cw-fundo`, `--cw-superficie`, `--cw-borda`, `--cw-texto*`, `--cw-link`,
  `--cw-vermelho-texto`, `--cw-fonte` = fonte do sistema, `--cw-fonte-marca` = Georgia). **Não editar
  tema.css** — o CSS de cada página define só tokens locais que faltarem, derivados desses.
  Remover tokens locais antigos que ficarem sem uso (ouro, indigo etc.). CSS enxuto: apagar regras mortas.
- Modo escuro (`html[data-tema]`) precisa continuar legível: usar os tokens, não cores fixas, para
  fundo/texto/borda.
- Acessibilidade mantida: foco visível, labels, contraste AA, `aria-*` que já existem.
- Responsivo: celular (360px) até desktop. Aluno é app de celular (barra inferior); no desktop
  centraliza como no protótipo (sem a moldura de "celular" escura em volta — fundo `--cw-fundo`).
- Fontes: a família agora é a do sistema. Não carregar mais `/vendor/fontes.css` nas páginas.
- Logo: quadrado vermelho com "CW"/"C" branco como no protótipo (HTML/CSS, sem imagem nova).
- Login fica em **`/entrar`** (`public/entrar.html`, antigo index.html); **`/`** passa a ser a página
  inicial nova (`public/index.html`). Redirecionamentos de sessão já apontam para `/entrar`.
- Ninguém faz commit/push/deploy. Ninguém mexe em arquivo de outro agente (lista abaixo).
  Rodar `npm test` ao fim (130 testes devem passar) e conferir as telas no navegador
  (`PORT=30xx node server.js`; contas em `.contas-demo.txt`: gestor/gestor, professor/prof, aluno/123,
  senha 12345678 — banco local de exemplo, pode usar à vontade).

## Divisão

1. **Inicial + login** — `public/index.html` (novo), `public/inicio.css` (novo), `public/entrar.html`,
   `public/app.js`, `public/styles.css`, `public/redefinir.html`, `public/redefinir.js`,
   `public/offline.html/.css`, `public/privacidade.html/.css`. Página inicial = protótipo `index.html`
   (botões "Entrar"/"Acessar o portal" → `/entrar`; créditos como no protótipo). Login = protótipo
   `login.html` (cartão com topo marinho + curva vermelha, abas Aluno/Professor/Gestão em segmento,
   título serifado) **mantendo** tudo o que o login atual faz: login por turma (série/curso/turma +
   senha da sala via `/api/turmas/publicas`), "Entrar com matrícula", primeiro acesso, aceite de termos,
   esqueci a senha, mostrar senha, mensagens de erro/bloqueio. O mapa do RN sai.
   Redefinir/privacidade/offline: só alinhar à paleta e ao cabeçalho novos.
2. **Aluno** — `public/aluno.html`, `public/aluno.css`, `public/aluno.js`. Protótipo `aluno.html`:
   cabeçalho marinho com logo, sino de notificações e avatar; cartão de saudação com chip da turma;
   "Prazos a vencer" (dados reais de prazos/atividades), "Áreas de aviso" (categorias reais), lista de
   comunicados com faixa lateral e etiqueta urgente, modal do aviso, salvar em pastas; barra inferior
   com Início / Horários / Perfil (+ o que já existe hoje, sem chat nem IA). Manter conta de turma,
   frequência, justificativas, entregas, horário PDF, calendário, ajustes etc.
3. **Professor** — `public/professor.html`, `public/professor.css`, `public/professor.js`. Protótipo
   `professor.html`: barra lateral marinho (Disciplinas, Horário, Comunicados da gestão, Meu perfil e
   salvos + o que já existe), topo branco com nome, "Minhas disciplinas" em cartões com traço vermelho,
   telas internas da disciplina (avisos, prazos, turmas, perfil do aluno, aviso individual).
4. **Gestão** — `public/gestao.html`, `public/gestao.css`, `public/gestao*.js`. Protótipo `gestao.html`:
   barra lateral marinho escura com item ativo vermelho, faixa de busca marinho no topo com identificação,
   "Central de Comunicados", comunicados urgentes, salvos e pastas, turmas e alunos, agenda, horários,
   perfil — mapeando para as seções que já existem (pessoas, importação, acompanhamento, auditoria...).

Componentes compartilhados (`public/componentes/*`, `notificacoes.*`, `preferencias.js`, `sw.js`,
`tema.css`, `src/`) ficam com o coordenador; se precisar de mudança neles, descrever no relatório.

## Relatório de cada agente

O que mudou (curto), o que do protótipo ficou de fora e por quê, resultado do `npm test`.
