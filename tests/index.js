// Ponto de entrada para `node --test tests/`: no Node 24+ um diretório passado ao --test é
// carregado como módulo (este index.js) em vez de ser varrido. Cada arquivo *.test.js entra
// numa suíte própria, então os hooks dele (servidor de teste) valem só para aquela suíte e os
// servidores sobem e caem um de cada vez. `npm test` roda os arquivos em processos separados.
const { describe } = require('node:test');
const { readdirSync } = require('node:fs');
const path = require('node:path');

function testFiles(directory) {
    return readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((entry) => {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) return entry.name === 'helpers' ? [] : testFiles(full);
            return entry.name.endsWith('.test.js') ? [full] : [];
        });
}

for (const file of testFiles(__dirname)) {
    describe(path.relative(__dirname, file), () => {
        require(file);
    });
}
