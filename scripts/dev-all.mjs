/**
 * DECK 26 — Orquestrador de Desenvolvimento Local (npm run dev:all)
 *
 * Inicia simultaneamente no computador pessoal Windows 11:
 * 1. Servidor Operacional Local (Porta 4000 — SQLite Persistente data/deck26-local.sqlite)
 * 2. Simulador Persistente da VPS (Porta 4100 — SQLite Persistente data/deck26-cloud-vps.sqlite)
 * 3. Interface Operacional Windows / PDV / Caixa / Cozinha (Porta 5173)
 * 4. Site Público / Cardápio Digital QR Code / Delivery (Porta 5174)
 */

import { spawn, ChildProcess } from 'node:child_process';

const services: Array<{ name: string; color: string; script: string }> = [
  { name: 'LOCAL-SERVER:4000', color: '\x1b[35m', script: 'dev:local-server' },
  { name: 'CLOUD-VPS:4100',    color: '\x1b[36m', script: 'dev:cloud-api' },
  { name: 'DESKTOP-UI:5173',   color: '\x1b[32m', script: 'dev:desktop' },
  { name: 'PUBLIC-WEB:5174',   color: '\x1b[33m', script: 'dev:web' }
];

const children: ChildProcess[] = [];

console.log('========================================================================');
console.log(' DECK 26 — INICIANDO TODOS OS 4 SERVIÇOS LOCAIS DE DESENVOLVIMENTO');
console.log('------------------------------------------------------------------------');
console.log(' -> Programa Principal (Caixa/PDV/Mesas) : http://localhost:5173');
console.log(' -> Terminal Cozinha KDS                 : http://localhost:5173/?terminal=cozinha');
console.log(' -> Terminal Garçom                      : http://localhost:5173/?terminal=garcom');
console.log(' -> Site Público / Cardápio QR / Delivery: http://localhost:5174');
console.log(' -> API Servidor Local (SQLite)          : http://127.0.0.1:4000/api/health');
console.log(' -> API VPS Simulada (SQLite)            : http://127.0.0.1:4100/api/health');
console.log('========================================================================\n');

for (const svc of services) {
  const child = spawn('npm', ['run', svc.script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      console.log(`${svc.color}[${svc.name}]\x1b[0m ${line}`);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      console.error(`${svc.color}[${svc.name}]\x1b[0m ${line}`);
    }
  });

  children.push(child);
}

function shutdown() {
  console.log('\nEncerrando serviços locais do DECK 26 com segurança...');
  for (const c of children) {
    c.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
