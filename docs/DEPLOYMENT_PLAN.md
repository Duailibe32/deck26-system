> Revisão da 7A: implantação online ainda pendente. Cloud continua SQLite; DATABASE_URL é recusada e não ativa PostgreSQL. Não publicar API operacional/Vite. Consulte REVISAO_PRE_7B.md e PREPRODUCTION_CHECKLIST.md antes de seguir este plano.

# Plano de Implantação Futura (Windows Definitivo + Hostinger VPS) — DECK 26

## 1. Visão Geral da Migração

Atualmente todo o desenvolvimento e validação ocorrem localmente sem custos de hospedagem. Quando o sistema for implantado em produção no estabelecimento:

1. **Computador Windows do Estabelecimento (Local)**:
   - Executará o aplicativo **Tauri 2 (`@deck26/desktop`)** e o **Servidor Operacional Local (`@deck26/local-server`)** conectado à rede Wi-Fi interna do restaurante e recepção do hotel.
   - Continuará utilizando o banco SQLite local (`data/deck26-local.sqlite`) em modo `WAL` para garantir funcionamento 100% offline se a internet da operadora oscilar.
2. **Servidor em Nuvem (Hostinger VPS)**:
   - Hospedará a **API de Nuvem (`@deck26/cloud-api`)**, o banco **PostgreSQL 16** (usando as migrações de `packages/contracts/migrations/cloud/`) e o **Portal Web Público (`@deck26/web`)** atrás de proxy reverso com HTTPS (TLS).

---

## 2. Procedimento Planejado para a Hostinger VPS

1. Provisionar VPS Linux (Ubuntu 24.04 LTS) na Hostinger.
2. Configurar firewall (UFW) permitindo apenas portas `22` (SSH com chave), `80` e `443` (HTTPS).
3. Subir o banco PostgreSQL 16 (via `docker-compose.yml` escutando apenas em `127.0.0.1:5432`) e aplicar as migrações de `packages/contracts/migrations/cloud/`.
4. Configurar variáveis de ambiente seguras no arquivo `.env` da VPS (`NODE_ENV=production`, `DATABASE_URL`, `DECK26_AUTH_SECRET`).
5. No computador Windows do estabelecimento, apontar `DECK26_CLOUD_API_URL` no `.env` para o endereço HTTPS da VPS.
