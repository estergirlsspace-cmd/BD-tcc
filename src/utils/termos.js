// Versão vigente dos termos de uso e da política de privacidade = data de publicação.
// Se o texto mudar, atualize as duas constantes: aceites anteriores à publicação deixam de valer
// e a pessoa precisa aceitar de novo (authenticate expõe isso como termos_pendentes).
const TERMOS_VERSAO = '2026-10-29';
// Mesmo formato de CURRENT_TIMESTAMP do SQLite (UTC), para comparar como texto.
const TERMOS_PUBLICADOS_EM = '2026-10-29 00:00:00';

function termosPendentes(acceptedAt) {
    return !acceptedAt || acceptedAt < TERMOS_PUBLICADOS_EM;
}

module.exports = { TERMOS_VERSAO, TERMOS_PUBLICADOS_EM, termosPendentes };
