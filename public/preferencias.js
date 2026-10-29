// Aparência por aparelho (tema e tamanho do texto), guardada só neste navegador.
// Carregado no <head> SEM defer, antes do CSS pintar, para não piscar o tema errado.
(function () {
    const KEY = 'cw-aparencia';
    const TEMAS = ['claro', 'escuro', 'auto'];
    const TEXTOS = ['pequeno', 'medio', 'grande'];

    function read() {
        try {
            const value = JSON.parse(localStorage.getItem(KEY) || '{}');
            return {
                tema: TEMAS.includes(value.tema) ? value.tema : 'claro',
                texto: TEXTOS.includes(value.texto) ? value.texto : 'medio'
            };
        } catch {
            return { tema: 'claro', texto: 'medio' };
        }
    }

    function apply(prefs) {
        document.documentElement.dataset.tema = prefs.tema;
        document.documentElement.dataset.texto = prefs.texto;
    }

    function save(changes) {
        const prefs = { ...read(), ...changes };
        try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* modo privado */ }
        apply(prefs);
        return prefs;
    }

    apply(read());
    window.cwAparencia = { read, save, TEMAS, TEXTOS };
}());
