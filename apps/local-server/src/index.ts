import { buildLocalServer, getLanIpv4Addresses } from './server.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const { app } = await buildLocalServer();
  await app.listen({ port: PORT, host: HOST });
  const ips = getLanIpv4Addresses();
  console.log('================================================================');
  console.log(' DECK 26 — SERVIDOR OPERACIONAL LOCAL (OFFLINE-FIRST) ATIVO');
  console.log(` Endereço Local PDV Windows : http://127.0.0.1:${PORT}`);
  console.log(` Endereço Wi-Fi Garçons/KDS : http://${ips[0]}:${PORT}`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar Servidor Operacional Local Deck 26:', err);
  process.exit(1);
});
