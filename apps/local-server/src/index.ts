import { buildLocalServer, getLanIpv4Addresses } from './server.js';

const PORT = Number(process.env.PORT ?? 4000);
// Por segurança (Seção 9), durante o desenvolvimento no PC pessoal o servidor escuta por padrão apenas em 127.0.0.1 (Loopback).
// Para habilitar acesso de celulares na rede Wi-Fi do restaurante, basta definir DECK26_ENABLE_LAN=true no arquivo .env.
const HOST = process.env.DECK26_ENABLE_LAN === 'true' ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');

async function main() {
  const { app } = await buildLocalServer();
  await app.listen({ port: PORT, host: HOST });
  const ips = getLanIpv4Addresses();
  console.log('================================================================');
  console.log(' DECK 26 — SERVIDOR OPERACIONAL LOCAL (OFFLINE-FIRST) ATIVO');
  console.log(` Modo de Escuta (Bind)      : ${HOST}:${PORT}`);
  console.log(` Endereço Local PDV Windows : http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(` Endereço Wi-Fi Garçons/KDS : http://${ips[0]}:${PORT}`);
  } else {
    console.log(' [Segurança] Rede Wi-Fi LAN isolada (Somente este computador).');
  }
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar Servidor Operacional Local Deck 26:', err);
  process.exit(1);
});
