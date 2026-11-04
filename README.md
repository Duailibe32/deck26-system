# DECK 26 — Sistema Integrado de Gestão para Bar, Restaurante e Hotel (Hotel Auto Posto Milla)

Sistema comercial **Offline-First** e **Cloud-Synced** projetado para operação real do **Deck 26 / Hotel Auto Posto Milla**, dimensionado para:
- **1 Computador Windows Principal** (Tauri 2 + React + TypeScript + Servidor Operacional Local com SQLite WAL de baixo consumo de RAM).
- **5 Celulares de Garçons** operando via rede Wi-Fi local (mesmo sem internet externa).
- **1 Dispositivo de Cozinha / Chapa (KDS)** operando via rede Wi-Fi local.
- **Clientes via QR Code na Mesa e Delivery** + **Proprietário acessando remotamente** via aplicação hospedada em **Hostinger VPS** (React + TypeScript + Node.js + Fastify + PostgreSQL).

---

## 1. Estrutura do Monorepositório

```text
deck26-monorepo/
├── packages/
│   ├── contracts/              # Contratos Zod/TS, 16 Módulos, RBAC, Cardápio Oficial e Migrações SQL
│   │   ├── migrations/local/   # 0001_initial_schema.sql (SQLite 3 WAL Mode)
│   │   └── migrations/cloud/   # 0001_initial_cloud_schema.sql (PostgreSQL 16+ VPS)
│   └── ui/                     # Design System Oficial Deck 26 (Rosa Vibrante, Preto, Branco e Cinza)
├── apps/
│   ├── local-server/           # Servidor Operacional Local (Fastify + node:sqlite WAL + Outbox Sync)
│   ├── desktop/                # Aplicativo Windows (Tauri 2 + React + 16 Módulos + Terminais LAN)
│   ├── cloud-api/              # API da Hostinger VPS (Fastify + Ledger Idempotente + PostgreSQL Ready)
│   └── web/                    # Portal Web / Site Público (Cardápio QR, Delivery, Hotel Milla e Painel Remoto)
```

---

## 2. Como Executar e Testar

### 2.1 Instalar Dependências (na raiz do monorepositório)
```bash
npm install
```

### 2.2 Executar a Suíte de Testes Automatizados e Checagem de Tipos
```bash
npm test
npm run typecheck
npm run build
```

### 2.3 Executar o Ambiente Operacional Local (Computador Windows + Wi-Fi Garçons/Cozinha)
Em um terminal, inicie o **Servidor Operacional Local** (porta `4000`, escutando em `0.0.0.0` na rede Wi-Fi):
```bash
npm run dev:local-server
```
Em outro terminal, inicie a interface do **Aplicativo Windows / Terminais LAN** (porta `5173`):
```bash
npm run dev:desktop
```
- **Estação Principal Windows (Caixa / PDV / Recepção)**: `http://localhost:5173` (ou empacotado via Tauri 2 com `npm --workspace=@deck26/desktop run tauri:dev` após instalar o Rust toolchain).
- **Celulares dos 5 Garçons (na mesma Wi-Fi)**: `http://<IP-DO-WINDOWS>:5173/?terminal=garcom`
- **Dispositivo da Cozinha KDS (na mesma Wi-Fi)**: `http://<IP-DO-WINDOWS>:5173/?terminal=cozinha`

### 2.4 Executar o Ambiente da Hostinger VPS (Cardápio QR, Delivery e Painel do Proprietário)
Em um terminal, inicie a **Cloud API da VPS** (porta `4100`):
```bash
npm run dev:cloud-api
```
Em outro terminal, inicie o **Site / Aplicação Web** (porta `5174`):
```bash
npm run dev:web
```
- Acesse `http://localhost:5174` para utilizar o Cardápio Digital QR Code, Delivery, página do Hotel Auto Posto Milla e o Painel Remoto do Proprietário.
