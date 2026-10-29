# E-mails do C-Warning

Cópia versionada dos templates cadastrados na **Resend** (API `/templates`). Cada template tem a
versão HTML (`<nome>.html`) e a versão em texto puro (`<nome>.txt`). Os arquivos aqui são a fonte;
se mudar algum, atualize também na Resend (`PATCH /templates/{id}` + `POST /templates/{id}/publish`).

Domínio de envio verificado: `ceeplourdinhaguerra.com.br`. A chave fica fora do projeto
(`~/.claude/secrets/resend_api_key_bdtcc`; em produção, variável de ambiente).

| Nome (alias) | Quando é enviado | Variáveis | Assunto | Remetente | ID na Resend |
|---|---|---|---|---|---|
| `cw-aviso-urgente` | Aviso marcado como urgente é publicado; um e-mail por destinatário | `NOME`, `TITULO`, `RESUMO`, `AUTOR`, `LINK` | Aviso urgente: {{{TITULO}}} | C-Warning &lt;avisos@ceeplourdinhaguerra.com.br&gt; | `38001f35-89a6-4f77-b73b-8e83e45b2678` |
| `cw-resumo-avisos` | Resumo periódico para quem tem avisos não lidos (não enviar se 0) | `NOME`, `QUANTIDADE` (número), `LISTA_HTML`, `LISTA_TEXTO`, `LINK` | Você tem {{{QUANTIDADE}}} aviso(s) não lido(s) no C-Warning | avisos@ | `eb8fda17-6b23-4fb4-a8f8-a06792c97e57` |
| `cw-lembrete-prazo` | 1 dia antes do prazo de uma atividade, para quem ainda não entregou | `NOME`, `ATIVIDADE`, `DISCIPLINA`, `PRAZO`, `LINK` | Lembrete: {{{ATIVIDADE}}} vence amanhã | avisos@ | `a214ac15-c224-42aa-a0e5-997d197cee04` |
| `cw-redefinir-senha` | Pedido de "Esqueci minha senha" (link de uso único) | `NOME`, `LINK`, `VALIDADE_MINUTOS` (número) | Redefinição de senha do C-Warning | C-Warning &lt;seguranca@ceeplourdinhaguerra.com.br&gt; | `61aa8ac6-06cf-49b0-a251-29b6ceb88188` |
| `cw-senha-alterada` | Logo após qualquer troca de senha (alerta de segurança) | `NOME`, `DATA_HORA` | Sua senha do C-Warning foi alterada | seguranca@ | `6786cbe8-c342-415d-b80a-829726f8b56b` |
| `cw-conta-criada` | Gestão cadastra professor ou membro da gestão (sem senha: a provisória é entregue pessoalmente) | `NOME`, `LOGIN`, `LINK` | Sua conta no C-Warning está pronta | avisos@ | `f610bf0e-5d11-4fb4-b470-52e8096abd66` |
| `cw-confirmar-email` | Pessoa informa um e-mail na conta (link de uso único para o endereço novo) | `NOME`, `LINK`, `VALIDADE_HORAS` (número) | Confirme seu e-mail no C-Warning | seguranca@ | `e8fea22f-6b58-4651-85f2-6a8392e1a03c` |
| `cw-nova-mensagem` | Nova mensagem recebida; no máximo 1 por conversa a cada 30 min (silenciável em "mensagens") | `NOME`, `REMETENTE`, `TRECHO`, `LINK` | Nova mensagem de {{{REMETENTE}}} no C-Warning | avisos@ | `9efd0cbb-7dc6-4904-b645-71691359b189` |

Remetente e assunto ficam gravados no template; se a aplicação mandar `from`/`subject` no envio,
eles têm prioridade sobre os do template.

## Como enviar (aplicação)

```js
await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to: ['pessoa@exemplo.com'],
    template: {
      id: 'cw-aviso-urgente', // alias ou ID
      variables: { NOME: '...', TITULO: '...', RESUMO: '...', AUTOR: '...', LINK: 'https://...' },
    },
  }),
});
```

Com `template` não se pode mandar `html`/`text` no mesmo envio.

## Regras para as variáveis

- **Escapar HTML antes de enviar.** A Resend usa `{{{VAR}}}` (sem escape automático). Todo texto
  vindo de usuário (`NOME`, `TITULO`, `RESUMO`, `AUTOR`, `ATIVIDADE`...) deve passar por escape de
  `& < > " '` na aplicação.
- `LISTA_HTML` é o único campo com HTML: itens `<li>…</li>` montados pela aplicação, com o texto de
  cada item já escapado. `LISTA_TEXTO` é a mesma lista para a versão em texto puro (`- item` por linha).
- Cada valor de texto aceita no máximo 2.000 caracteres: limite o resumo a ~10 itens e termine com
  "e mais N avisos".
- `LINK` deve ser URL absoluta `https://`. `PRAZO` e `DATA_HORA` já vêm formatados em pt-BR
  (ex.: `30/10/2026, às 23h59`), no fuso de Natal (America/Fortaleza).
- Toda variável tem valor de exemplo cadastrado na Resend (usado como valor padrão se faltar).

## Compatibilidade e identidade

HTML em tabelas, estilos inline, largura máx. 560px, botão "bulletproof" (VML no Outlook), sem
imagens, texto de pré-visualização oculto, `lang="pt-BR"`. Marca "C·Warning" em texto (ponto
vermelho `#E40913`), títulos e botão em índigo `#312782`, links em azul `#4A5BD6`, fundo `#f5f6fb`,
cartão branco. Contraste AA (texto secundário `#5f6178`, nunca `#8b8da6`). A fonte Sora só aparece
se estiver instalada no aparelho; nos demais casos cai para Segoe UI/Arial. O Outlook para Windows
ignora cantos arredondados (o layout continua correto).

Teste de renderização: envio de `cw-aviso-urgente` para `delivered@resend.dev` em 29/10/2026
(id `01a185a1-227a-723c-98aa-21629e90cb03`, status `delivered`, assunto e variáveis substituídos).

Teste dos templates `cw-confirmar-email` e `cw-nova-mensagem` para `delivered@resend.dev` em
29/10/2026 (ids `01a185c0-b709-7d48-98ac-fa1b18fd7888` e `01a185c0-b808-7f0d-9a86-33347751bfd9`, status
`delivered`). Na aplicação, o envio fica em `src/services/email.js`.
