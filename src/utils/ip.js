const { BlockList, isIP } = require('node:net');

// IP de quem fez a requisição, usado pelos limitadores de tentativas.
//
// Em produção o caminho é Cloudflare → Traefik → Node. O Traefik é o par imediato e grava em
// X-Real-Ip o endereço que ele viu: o de um servidor da Cloudflare (tráfego normal) ou o do próprio
// visitante (quem acessa a VPS direto, sem passar pela Cloudflare). Por isso:
//   - sem TRUST_PROXY, os cabeçalhos são ignorados e vale o endereço do socket;
//   - com TRUST_PROXY, vale o X-Real-Ip; o CF-Connecting-IP só é aceito quando esse X-Real-Ip
//     pertence às faixas oficiais da Cloudflare (senão qualquer um poderia forjá-lo).

// Faixas publicadas em https://www.cloudflare.com/ips-v4 e https://www.cloudflare.com/ips-v6
// (conferidas em 2026-10-29). Se a Cloudflare publicar faixas novas, atualize esta lista.
const CLOUDFLARE_RANGES = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
    const [network, prefix] = range.split('/');
    cloudflare.addSubnet(network, Number(prefix), isIP(network) === 6 ? 'ipv6' : 'ipv4');
}

const TRUST_PROXY = !['', '0', 'false', 'nao', 'não'].includes(
    String(process.env.TRUST_PROXY ?? '').trim().toLowerCase());

// Endereço IP válido (IPv4 mapeado em IPv6 vira IPv4) ou null.
function normalizeAddress(value) {
    if (typeof value !== 'string') return null;
    let address = value.trim();
    if (address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4) {
        address = address.slice(7);
    }
    return isIP(address) ? address : null;
}

function isCloudflareAddress(value) {
    const address = normalizeAddress(value);
    if (!address) return false;
    return cloudflare.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

function clientAddress(request) {
    const socketAddress = normalizeAddress(request.socket.remoteAddress) || 'desconhecido';
    if (!TRUST_PROXY) return socketAddress;
    const proxied = normalizeAddress(request.headers['x-real-ip']);
    if (!proxied) return socketAddress;
    if (isCloudflareAddress(proxied)) {
        return normalizeAddress(request.headers['cf-connecting-ip']) || proxied;
    }
    return proxied;
}

module.exports = { clientAddress, isCloudflareAddress, CLOUDFLARE_RANGES };
