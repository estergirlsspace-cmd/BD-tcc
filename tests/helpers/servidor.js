// Ambiente de teste: um DATA_DIR temporário com o banco de exemplo (scripts/seed-exemplo.js) e o
// servidor real (server.js) como processo filho numa porta livre. Nunca toca em data/educacao.sqlite
// nem em rede externa (sem RESEND_API_KEY os e-mails só são "simulados" no log).
const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { before, after } = require('node:test');

const ROOT = path.join(__dirname, '..', '..');
const PASSWORD_HASH = require(path.join(ROOT, 'src', 'utils', 'password.js'));

function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.unref();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

function readCsv(file) {
    const [header, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const columns = header.split(';');
    return lines.map((line) => Object.fromEntries(line.split(';').map((value, i) => [columns[i], value])));
}

// IP falso por requisição: o limitador do login (20/min por IP) não interfere entre testes.
// Os testes de limite passam um `ip` fixo.
let ipCounter = 0;
function nextIp() {
    ipCounter += 1;
    return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}

// Data "AAAA-MM-DD" no horário de Brasília, deslocada em dias a partir de hoje.
function dataEscola(offsetDays = 0) {
    return new Date(Date.now() - 3 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10);
}

const CLOUDFLARE_EDGE_IP = '173.245.48.10';

async function iniciarServidor({ aceitarTermos = true } = {}) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cw-teste-'));
    const env = {
        ...process.env,
        DATA_DIR: dir,
        HOST: '127.0.0.1',
        CW_AGENDADOR: '0',
        CW_BACKUP: '0',
        // Simula produção (Cloudflare → Traefik → Node): o par imediato informa X-Real-Ip.
        TRUST_PROXY: '1',
        APP_URL: 'http://127.0.0.1'
    };
    delete env.RESEND_API_KEY;
    delete env.ADMIN_LOGIN;
    delete env.ADMIN_SENHA;
    delete env.NODE_TEST_CONTEXT; // o filho não é um teste
    for (const key of Object.keys(env)) if (key.startsWith('NODE_TEST')) delete env[key];

    let child;
    let db;
    let stopped = false;
    async function parar() {
        if (stopped) return;
        stopped = true;
        try { db?.close(); } catch { /* já fechado */ }
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise((resolve) => child.once('exit', resolve));
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
            await exited;
            clearTimeout(timer);
        }
        rmSync(dir, { recursive: true, force: true });
    }
    process.once('exit', () => {
        if (child && child.exitCode === null) child.kill('SIGKILL');
        rmSync(dir, { recursive: true, force: true });
    });

    try {
        execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-exemplo.js')],
            { cwd: ROOT, env, stdio: 'pipe' });
        const contas = Object.fromEntries(readCsv(path.join(dir, 'contas-exemplo.csv'))
            .map((row) => [row.perfil, { login: row.login, senha: row.senha }]));
        const alunos = readCsv(path.join(dir, 'alunos-exemplo.csv'));

        db = new DatabaseSync(path.join(dir, 'educacao.sqlite'), { timeout: 5000 });
        db.exec('PRAGMA foreign_keys = ON');
        if (aceitarTermos) {
            db.prepare('UPDATE usuarios SET termos_aceitos_em = CURRENT_TIMESTAMP').run();
        }

        const port = await freePort();
        env.PORT = String(port);
        child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = '';
        child.stdout.on('data', (chunk) => { log += chunk; });
        child.stderr.on('data', (chunk) => { log += chunk; });
        const url = `http://127.0.0.1:${port}`;

        const deadline = Date.now() + 15000;
        for (;;) {
            if (child.exitCode !== null) throw new Error(`O servidor encerrou ao iniciar:\n${log}`);
            try {
                const response = await fetch(`${url}/api/saude`);
                if (response.ok) break;
            } catch { /* ainda subindo */ }
            if (Date.now() > deadline) throw new Error(`O servidor não respondeu em 15 s:\n${log}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Requisição à API. `body` objeto vira JSON; Buffer/string vai cru. Devolve
        // { status, headers, body (JSON quando houver), text, buffer }.
        async function api(rota, { method = 'GET', token, body, headers = {}, ip } = {}) {
            // X-Real-Ip dentro de uma faixa da Cloudflare: só assim o CF-Connecting-IP é aceito,
            // como em produção. Cada requisição usa um IP de visitante diferente, salvo `ip`.
            const finalHeaders = {
                'x-real-ip': CLOUDFLARE_EDGE_IP,
                'cf-connecting-ip': ip || nextIp(),
                ...headers
            };
            if (token) finalHeaders.authorization = `Bearer ${token}`;
            let payload = body;
            if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') {
                payload = JSON.stringify(body);
                finalHeaders['content-type'] ??= 'application/json';
            }
            const response = await fetch(url + rota, { method, headers: finalHeaders, body: payload });
            const buffer = Buffer.from(await response.arrayBuffer());
            const text = buffer.toString('utf8');
            let json;
            if ((response.headers.get('content-type') || '').includes('application/json') && text) {
                json = JSON.parse(text);
            }
            return { status: response.status, headers: response.headers, body: json, text, buffer };
        }

        async function login(usuario, senha, opcoes = {}) {
            const result = await api('/api/auth/login', {
                method: 'POST', body: { login: usuario, senha }, ...opcoes
            });
            if (result.status !== 200) {
                throw new Error(`Login de ${usuario} falhou: ${result.status} ${result.text}`);
            }
            return result.body.token;
        }

        const tokensEquipe = {};
        async function gestao() {
            tokensEquipe.gestao ??= await login(contas.gestao.login, contas.gestao.senha);
            return tokensEquipe.gestao;
        }
        async function professor() {
            tokensEquipe.professor ??= await login(contas.professor.login, contas.professor.senha);
            return tokensEquipe.professor;
        }

        // Aluno pronto para usar a API: entra com a senha inicial e cria a senha pessoal
        // (os termos já foram aceitos no banco). Devolve { token, senha, ...ids }.
        async function alunoPronto(indice = 0) {
            const aluno = alunos[indice];
            const info = alunoInfo(aluno.matricula);
            let token = await login(aluno.matricula, aluno.senha_inicial).catch(() => null);
            const senha = `Senha-de-teste-${aluno.matricula}`;
            if (token) {
                const troca = await api('/api/auth/password', {
                    method: 'POST', token, body: { senha_atual: aluno.senha_inicial, nova_senha: senha }
                });
                if (troca.status !== 200) throw new Error(`Troca de senha falhou: ${troca.text}`);
            } else {
                token = await login(aluno.matricula, senha);
            }
            return { ...aluno, ...info, token, senha };
        }

        function alunoInfo(matricula) {
            return db.prepare(`
                SELECT u.id_usuario, a.id_aluno, a.id_turma, t.curso, t.serie
                FROM usuarios u JOIN alunos a ON a.id_usuario = u.id_usuario
                JOIN turmas t ON t.id_turma = a.id_turma
                WHERE u.login = ?
            `).get(matricula);
        }

        // Professor extra (não leciona em nenhuma turma até receber disciplinas).
        function criarProfessor(loginProfessor, senha, disciplinas = []) {
            const userId = Number(db.prepare(`
                INSERT INTO usuarios (login, nome, senha, tipo_usuario, ativo, deve_trocar_senha, termos_aceitos_em)
                VALUES (?, ?, ?, 'professor', 1, 0, CURRENT_TIMESTAMP)
            `).run(loginProfessor, `Prof. ${loginProfessor}`, PASSWORD_HASH.hashPasswordSync(senha)).lastInsertRowid);
            const teacherId = Number(db.prepare(
                "INSERT INTO professores (id_usuario, nome, area) VALUES (?, ?, 'humanas')"
            ).run(userId, `Prof. ${loginProfessor}`).lastInsertRowid);
            for (const id of disciplinas) {
                db.prepare('UPDATE disciplinas SET id_professor = ? WHERE id_disciplina = ?').run(teacherId, id);
            }
            return { id_usuario: userId, id_professor: teacherId };
        }

        // Token de uso único conhecido (só o hash vai para o banco), sem depender de e-mail.
        function criarToken(idUsuario, finalidade, { dado = null, validadeSegundos = 1800 } = {}) {
            const token = randomBytes(32).toString('base64url');
            db.prepare(`
                INSERT INTO tokens (token_hash, id_usuario, finalidade, dado, expira_em)
                VALUES (?, ?, ?, ?, ?)
            `).run(sha256(token), idUsuario, finalidade, dado,
                Math.floor(Date.now() / 1000) + validadeSegundos);
            return token;
        }

        return {
            url, dir, db, contas, alunos, api, login, gestao, professor, alunoPronto, alunoInfo,
            criarProfessor, criarToken, parar, log: () => log
        };
    } catch (error) {
        await parar();
        throw error;
    }
}

// Conteúdos mínimos com a assinatura certa de cada tipo aceito.
const ARQUIVOS = {
    pdf: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1'),
    png: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]),
    jpg: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)])
};

// Uso no topo de um arquivo de teste: `const s = usarServidor();` — sobe antes de todos os
// testes do arquivo e derruba (processo + diretório temporário) no fim.
// `preparar(ambiente)` roda logo depois que o servidor sobe (hooks `before` do próprio arquivo
// não têm ordem garantida em relação a este).
function usarServidor(opcoes = {}, preparar = null) {
    const ambiente = {};
    before(async () => {
        Object.assign(ambiente, await iniciarServidor(opcoes));
        if (preparar) await preparar(ambiente);
    });
    after(async () => { await ambiente.parar?.(); });
    return ambiente;
}

module.exports = { usarServidor, iniciarServidor, dataEscola, sha256, ARQUIVOS, ROOT };
