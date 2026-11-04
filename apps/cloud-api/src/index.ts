import { buildCloudApiServer } from './server.js';

const PORT = Number(process.env.CLOUD_PORT ?? 4100);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main() {
  const { app } = await buildCloudApiServer();
  await app.listen({ port: PORT, host: HOST });
  console.log('================================================================');
  console.log(` DECK 26 — CLOUD API (HOSTINGER VPS) ATIVA EM http://127.0.0.1:${PORT}`);
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Erro fatal ao iniciar Cloud API:', err);
  process.exit(1);
});
