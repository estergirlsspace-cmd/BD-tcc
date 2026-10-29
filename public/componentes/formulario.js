// Erros de formulário junto do campo (C·Warning) — compartilhado pelos portais.
// Sem dependências: só DOM e textContent (nunca innerHTML).
//
// USO
//   <link rel="stylesheet" href="/componentes/formulario.css">
//   <script src="/componentes/formulario.js" defer></script>   (antes do script da página)
//
//   CwFormulario.erro(campo, 'Mensagem')   escreve <p id="<id do campo>-erro"> logo abaixo do campo
//                                          (ou do <label> que o envolve), liga por aria-describedby,
//                                          aplica aria-invalid="true" e limpa sozinho quando a
//                                          pessoa corrige (input/change).
//   CwFormulario.limpar(campo)             remove o erro de um campo.
//   CwFormulario.limparTudo(form)          remove todos os erros do formulário (inclusive o geral).
//   CwFormulario.erroGeral(form, 'Msg')    erro sem campo específico: <p role="alert"> no fim do form.
//   CwFormulario.mostrar(form, error, campo?)
//                                          atalho para o catch: põe error.message no campo indicado
//                                          (ou no 1º campo do form com name === error.campo); sem
//                                          campo, vira erro geral. Foca o campo com erro.
//   opções de erro(): { focar: true }      move o foco para o campo.
'use strict';

(function iniciarFormulario() {
    let contador = 0;
    // Listener "ao corrigir" de cada campo, para limpar() poder removê-lo (senão um erro antigo
    // apagaria um erro novo posto no mesmo campo dentro de um handler de input/change).
    const ouvintes = new WeakMap();

    function idDoCampo(campo) {
        if (!campo.id) {
            contador += 1;
            campo.id = `cw-campo-${contador}`;
        }
        return campo.id;
    }

    function ids(valor) {
        return (valor || '').split(/\s+/).filter(Boolean);
    }

    // O <p> vai depois do <label> que envolve o campo (um <p> dentro de <label> não é válido) ou
    // depois de um invólucro conhecido (campo com botão de mostrar senha etc.).
    function ancora(campo) {
        return campo.closest('[data-campo-erro-apos]')
            || campo.closest('label')
            || campo.closest('.campo-senha, .senha-campo, .campo-com-botao')
            || campo;
    }

    function limpar(campo) {
        if (!campo) return;
        const ouvinte = ouvintes.get(campo);
        if (ouvinte) {
            campo.removeEventListener('input', ouvinte);
            campo.removeEventListener('change', ouvinte);
            ouvintes.delete(campo);
        }
        const erroId = `${idDoCampo(campo)}-erro`;
        document.getElementById(erroId)?.remove();
        const restantes = ids(campo.getAttribute('aria-describedby')).filter((id) => id !== erroId);
        if (restantes.length) campo.setAttribute('aria-describedby', restantes.join(' '));
        else campo.removeAttribute('aria-describedby');
        campo.removeAttribute('aria-invalid');
    }

    function erro(campo, mensagem, { focar = false } = {}) {
        if (!campo) return null;
        limpar(campo);
        const erroId = `${idDoCampo(campo)}-erro`;
        const p = document.createElement('p');
        p.className = 'cw-campo-erro';
        p.id = erroId;
        const icone = document.createElement('i');
        icone.className = 'ph ph-warning-circle';
        icone.setAttribute('aria-hidden', 'true');
        const texto = document.createElement('span');
        texto.textContent = mensagem;
        p.append(icone, texto);
        ancora(campo).insertAdjacentElement('afterend', p);

        campo.setAttribute('aria-invalid', 'true');
        campo.setAttribute('aria-describedby', [...ids(campo.getAttribute('aria-describedby')), erroId].join(' '));
        const aoCorrigir = () => limpar(campo);
        ouvintes.set(campo, aoCorrigir);
        campo.addEventListener('input', aoCorrigir);
        campo.addEventListener('change', aoCorrigir);
        if (focar) campo.focus();
        return p;
    }

    function limparGeral(form) {
        form?.querySelector(':scope > .cw-form-erro')?.remove();
    }

    function erroGeral(form, mensagem) {
        if (!form) return null;
        limparGeral(form);
        const p = document.createElement('p');
        p.className = 'cw-campo-erro cw-form-erro';
        p.setAttribute('role', 'alert');
        const icone = document.createElement('i');
        icone.className = 'ph ph-warning-circle';
        icone.setAttribute('aria-hidden', 'true');
        const texto = document.createElement('span');
        texto.textContent = mensagem;
        p.append(icone, texto);
        form.append(p);
        const limparAoMudar = () => {
            limparGeral(form);
            form.removeEventListener('input', limparAoMudar);
        };
        form.addEventListener('input', limparAoMudar);
        return p;
    }

    function limparTudo(form) {
        if (!form) return;
        form.querySelectorAll('[aria-invalid="true"]').forEach(limpar);
        form.querySelectorAll('.cw-campo-erro').forEach((p) => p.remove());
    }

    function mostrar(form, error, campo) {
        const mensagem = error?.message || String(error || 'Não foi possível concluir.');
        let alvo = campo || null;
        if (!alvo && form && error?.campo) alvo = form.querySelector(`[name="${CSS.escape(error.campo)}"]`);
        if (alvo) return erro(alvo, mensagem, { focar: true });
        return erroGeral(form, mensagem);
    }

    window.CwFormulario = Object.freeze({ erro, limpar, limparTudo, erroGeral, mostrar });
})();
