# Sprint "Aluno" — contrato entre as frentes

Fonte do design: Claude Design, projeto `50450997-2000-4e4f-ac4a-215bb62148dd`
(`C-Warning Aluno.dc.html` e `CW Aluno App.dc.html`). Cópia de leitura em
`docs/design/` (não editar).

Regras gerais: sem dependências npm; sem CDN externo (CSP `'self'` + LGPD: nada de Google
Fonts/unpkg em produção); código limpo, nomes em português no domínio e em inglês no código, como já
é o padrão do projeto; arquivos com CRLF continuam CRLF. **Ninguém faz commit, push ou deploy.**

## 1. Identidade visual (tokens) — `public/tema.css`

```css
:root {
  --cw-indigo: #312782;      /* marca, títulos, botão principal (branco sobre ele 11,5:1) */
  --cw-indigo-hover: #3d33a0;
  --cw-indigo-escuro: #261e6b;
  --cw-azul: #4A5BD6;        /* destaque, links, ativo (branco sobre ele 5,3:1) */
  --cw-azul-suave: #E8EAFB;
  --cw-vermelho: #E40913;    /* ponto do C·Warning, urgente, erro */
  --cw-vermelho-suave: #fde7e8;
  --cw-fundo: #f5f6fb;
  --cw-superficie: #FFFFFF;
  --cw-borda: #e4e5f0;
  --cw-borda-campo: #8a8fa8; /* bordas de inputs: ≥3:1 (WCAG 1.4.11) */
  --cw-texto: #1f2033;
  --cw-texto-2: #4b4d66;
  --cw-texto-suave: #5f6178; /* metadados; NUNCA usar #8b8da6 para texto (3,3:1) */
  --cw-chip: #f2f3f7;
  --cw-foco: #f5a300;        /* contorno de foco 3px */
  --cw-fonte: 'Figtree', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --cw-fonte-titulo: 'Sora', 'Figtree', system-ui, sans-serif;
  --cw-raio: 16px; --cw-raio-sm: 10px;
}
```

Marca "C·Warning": `C` + ponto vermelho (círculo `--cw-vermelho`, ~0,15em) + `Warning`, em Sora 700.
Componente CSS `.cw-marca` (e `.cw-marca--clara` sobre fundo índigo, com anel branco no ponto).

## 2. Arquivos estáticos (frente "base")

- Fontes: `public/vendor/fontes/` (woff2 latin + latin-ext de Figtree 400/500/600/700/800 e Sora 600/700)
  e `public/vendor/fontes.css` com os `@font-face` (`font-display: swap`).
- Ícones: `public/vendor/phosphor/` com Phosphor Web 2.1.1 pesos **regular** e **fill** (CSS + woff2),
  classes `ph ph-<nome>` e `ph-fill ph-<nome>`.
- Mapa: `public/assets/mapa-rn-parnamirim.svg` (já salvo).
- `src/routes/web.js` passa a servir arquivos de `public/` por lista de extensões permitidas
  (html, css, js, svg, woff2, png, ico), com as rotas de página `/`, `/aluno`, `/professor`,
  `/gestao`; `Cache-Control: no-cache` em html/css/js e `public, max-age=31536000, immutable` em
  `/vendor/**` e `/assets/**`; impedir `..`/path traversal; CSP com `font-src 'self'`.
- Cada página carrega, nesta ordem: `/vendor/fontes.css`, `/vendor/phosphor/regular.css`,
  `/vendor/phosphor/fill.css`, `/tema.css`, CSS da página.

## 3. Banco de dados (frente "servidor")

- `posts_avisos.urgente INTEGER NOT NULL DEFAULT 0 CHECK (urgente IN (0,1))`.
- Nova tabela de estado do aviso por pessoa (uma linha só quando há interação):
  ```sql
  CREATE TABLE avisos_usuarios (
      id_post INTEGER NOT NULL REFERENCES posts_avisos(id_post) ON DELETE CASCADE,
      id_usuario INTEGER NOT NULL REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
      lido_em TEXT,   -- leitura confirmada (UTC, CURRENT_TIMESTAMP)
      salvo_em TEXT,  -- salvo pelo usuário
      PRIMARY KEY (id_post, id_usuario)
  );
  ```
  Linha com `lido_em` e `salvo_em` nulos é apagada (não guardar estado vazio).
- Categoria do aviso é **derivada**, não armazenada:
  `urgente` se urgente=1; senão `eventos` se tipo='evento'; senão `coordenacao` se o autor é gestão;
  senão `turma`.

## 4. API nova (frente "servidor") — todas exigem login; mural só para aluno

`GET /api/mural` →
```json
{
  "nao_lidos": 2,
  "avisos": [{
    "id_post": 12, "titulo": "…", "conteudo": "…", "tipo": "aviso", "urgente": true,
    "categoria": "urgente", "data_evento": null, "criado_em": "2026-10-28 11:42:00",
    "autor": { "nome": "Ana Paula Rocha", "perfil": "gestao" },
    "publico": "escola" | "curso" | "serie" | "turma",
    "lido_em": null, "salvo": false
  }]
}
```
Ordenado por urgente desc, depois criado_em desc. Mesmo filtro de público que o aluno já tem hoje.

- `PUT /api/mural/:id/leitura` → confirma leitura (idempotente) → `{ "lido_em": "…" }`
- `DELETE /api/mural/:id/leitura` → desfaz → `{ "lido_em": null }`
- `POST /api/mural/leitura` → marca todos os visíveis como lidos → `{ "marcados": 5 }`
- `PUT /api/mural/:id/salvo` com `{ "salvo": true|false }` → `{ "salvo": true }`
- 404 se o aviso não for visível para o aluno.

Ajustes em endpoints existentes (aluno):
- `GET /api/atividades` inclui por atividade `nome_disciplina` e `entrega` (`null` ou
  `{ enviado_em, nota, feedback }`) do próprio aluno.
- `GET /api/frequencias` inclui `nome_disciplina` (já inclui) — conferir.
- `GET /api/horarios` inclui `nome_disciplina` e `professor` (nome) — conferir/adicionar.
- `GET /api/me` inclui `nome_turma`, `curso`, `serie` (já inclui).
- Avisos (`/api/avisos` POST/PATCH) aceitam `urgente` (boolean). Portais da gestão e do professor
  ganham a caixa "Marcar como urgente" no formulário de publicação.

## 5. Portal do aluno (frente "aluno")

Seções (rail à esquerda no web, abas inferiores no celular):
Início · Avisos · Agenda · Atividades · Frequência · Ajustes. **Mensagens fica fora desta etapa**
(sem item no menu). Subseções conforme o design, exceto: Frequência → Resumo e Histórico de faltas
(sem "Justificar" nesta etapa); Ajustes → Perfil, Senha e segurança (só alterar senha) e Ajuda
(FAQ estático). Notificações e Aparência ficam para a etapa 3 (sem item no menu).
Card "Ocorrências" do Início vira "Avisos não lidos".

## 6. E-mails (frente "Resend")

Chave em `~/.claude/secrets/resend_api_key_bdtcc` (nunca em arquivo do projeto). Domínio verificado
`ceeplourdinhaguerra.com.br`. Templates criados na Resend (API `/templates`) com a identidade do §1,
e cópia versionada em `emails/` (HTML + texto) para o TCC.
