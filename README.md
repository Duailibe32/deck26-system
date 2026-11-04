# DECK 26 — Sistema de Gestão Integrada (Bar, Restaurante e Hotel Auto Posto Milla)

## 1. Apresentação

O **DECK 26** é um sistema comercial profissional de gestão integrada para bar, restaurante e hotel (**Deck 26 / Hotel Auto Posto Milla**), projetado sob arquitetura **Offline-First** e **Cloud-Synced**.

- **Objetivo do Projeto**: Permitir que a operação completa do estabelecimento (1 computador Windows de caixa/recepção, até 5 celulares de garçons em rede Wi-Fi local, 1 dispositivo KDS na cozinha/chapa/bar, pedidos via QR Code nas mesas, delivery e painel remoto do proprietário) funcione com latência zero na rede local — mesmo durante quedas de internet externa — e sincronize de forma bidirecional, idempotente e auditável com um servidor em nuvem.
- **Estado Atual de Desenvolvimento**: **Etapa 4 Concluída** (Catálogo Único Compartilhado, 6 Canais Comerciais, Estoque Kardex com Reversão, Fichas Técnicas Versionadas, QR Code Seguro por Mesa, Gestão Visual de Mesas, Comandas Transacionais, Terminal Mobile do Garçom, KDS com SLA e SSE em Tempo Real, Divisão de Contas, Pagamentos Parciais/Mistos, Turno de Caixa e Spooler Térmico ESC/POS).
- **Identidade Visual Oficial**: Rosa Vibrante (`#F72585`), Preto Profundo (`#111111`), Roxo (`#7209B7`), Neutro (`#1A1A1A`) e tipografia `Plus Jakarta Sans`.

---

## 2. Tecnologias Utilizadas

| Camada | Tecnologias Reais no Monorepositório |
| :--- | :--- |
| **Aplicação Desktop Windows** | Tauri 2 (Rust + Microsoft Edge WebView2), React 19, TypeScript 5.7, Vite 6 |
| **Servidor Operacional Local** | Node.js 22+, Fastify 5, `@fastify/cors`, SQLite nativo (`node:sqlite` em modo `WAL`), Server-Sent Events (SSE) |
| **API de Nuvem / Simulador VPS** | Node.js 22+, Fastify 5, SQLite persistente local (`node:sqlite`) com migrações SQL preparadas para PostgreSQL 16 |
| **Aplicação Web Pública** | React 19, TypeScript 5.7, Vite 6 (Cardápio Digital QR Code, Delivery e Painel do Proprietário) |
| **Contratos e Validação** | Zod (`@deck26/contracts`), RBAC tipado, Cálculos monetários estritos em centavos inteiros (`integer cents`) |
| **Testes Automatizados** | Vitest 2 (Testes de unidade de domínio e testes de integração ponta a ponta dos servidores) |

---

## 3. Arquitetura do Sistema

O monorepositório NPM Workspaces é dividido em 4 aplicações (`apps/*`) e 2 pacotes compartilhados (`packages/*`):

1. **`apps/desktop` (Porta `5173` em dev / App Nativo Tauri 2)**:
   - Interface principal do computador Windows do estabelecimento (Dashboard, Mapa de Mesas, Comandas, Caixa/PDV, Estoque, Cadastro Inteligente de Produtos, Fichas Técnicas, Hotel Milla, Spooler de Impressoras e Sincronização).
   - Também serve os terminais dedicados na rede local:
     - **Terminal Mobile do Garçom**: `http://<IP-LOCAL>:5173/?terminal=garcom`
     - **KDS da Cozinha, Chapa e Bar**: `http://<IP-LOCAL>:5173/?terminal=cozinha`
2. **`apps/local-server` (Porta `4000`)**:
   - Servidor operacional local que grava em `data/deck26-local.sqlite` (`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;`).
   - Protegido em `127.0.0.1` por padrão (ou exposto na LAN Wi-Fi quando `DECK26_ENABLE_LAN=true`).
   - Possui fila persistente (`sync_outbox_events`) com chave de idempotência, relógio lógico híbrido (HLC) e checksum `SHA-256`.
3. **`apps/cloud-api` (Porta `4100`)**:
   - Servidor da VPS (executado localmente como simulador fiel durante o desenvolvimento com persistência independente em `data/deck26-cloud-vps.sqlite`).
   - Recebe lotes de eventos do servidor local (`/api/sync/push`) com deduplicação idempotente e serve dados consolidados para o cardápio público e painel remoto do proprietário.
4. **`apps/web` (Porta `5174`)**:
   - Portal público para clientes (Cardápio Digital com leitura de token QR Code seguro por mesa e pedidos de Delivery/Retirada) e visão remota do proprietário.
5. **`packages/contracts` (`@deck26/contracts`)**:
   - Esquemas Zod, tipos TypeScript, matriz de permissões RBAC, funções puras de cálculo financeiro em centavos, avaliação de SLA do KDS, geração de tickets térmicos ESC/POS e migrações SQL (`migrations/local/` e `migrations/cloud/`).
6. **`packages/ui` (`@deck26/ui`)**:
   - Design System oficial do Deck 26 (`tokens.css`), logomarca vetorial (`Deck26Logo`) e componentes visuais compartilhados.

---

## 4. Status Honesto das Funcionalidades

### Implementado e Validado por Testes Automatizados
- **Catálogo Único Compartilhado**: CRUD completo de categorias e produtos com SKU único, custo, margem bruta calculada automaticamente, unidade de medida, estação de preparo (`KITCHEN_HOT`, `KITCHEN_COLD`, `GRIDDLE_TAPIOCA`, `BAR_DRINKS`, `CASHIER_COUNTER`) e preços específicos por canal (`DINE_IN`, `COUNTER_PDV`, `QR_TABLE`, `DELIVERY`, `PICKUP`, `HOTEL_ROOM`).
- **Exclusão Segura de Produtos e Categorias**: bloqueia exclusão de categoria com produtos vinculados; produtos sem histórico são removidos fisicamente e produtos com histórico de vendas/estoque são desativados logicamente (`LOGICAL_DEACTIVATED`).
- **Fichas Técnicas Versionadas (`product_recipes`)**: dedução automática dos insumos da receita aprovada a cada pedido confirmado (`RECEIVED`).
- **Controle de Estoque Kardex (`stock_movements`)**: razão imutável de entradas por compra, baixas automáticas por venda, perdas/desperdícios, ajustes manuais e estornos auditados (`REVERSAL_ENTRY`), com bloqueio de venda sem estoque (`BLOCK_SALE`) ou alerta (`WARN_AND_ALLOW`).
- **QR Code Criptográfico por Mesa (`dining_tables_qr`)**: tokens HMAC não-previsíveis por mesa, validação de preço exclusivamente no servidor e política configurável por mesa (envio direto para a cozinha `RECEIVED` ou retenção para aprovação `PENDING_APPROVAL`).
- **Gestão Visual e Transacional de Mesas**: distinção entre estado físico (`LIVRE`, `AGUARDANDO_PEDIDO`, `EM_ATENDIMENTO`, `AGUARDANDO_PAGAMENTO`, `LIMPEZA`, `INDISPONIVEL`) e estado financeiro da comanda (`OPEN`, `BILL_REQUESTED`, `PARTIALLY_PAID`, `CLOSED`, `CANCELLED`), com bloqueio transacional contra abertura duplicada simultânea (`HTTP 409`).
- **Operações de Salão**: transferência de mesa (`Mesa 03 -> Mesa 08`), junção e separação de mesas (`Mesas 04 e 05`) e transferência de itens entre comandas sem duplicar faturamento, sem reimprimir na cozinha e sem baixar estoque novamente.
- **Divisão de Contas, Descontos, Taxa de Serviço e Pagamentos Parciais/Mistos**: divisão por valor livre, partes iguais/pessoas, por itens consumidos e pagamentos mistos; descontos fixos, percentuais ou cortesia com exigência de permissão gerencial (`tabs:discount_or_void`); cálculo de troco em espécie sem tratá-lo como receita; estorno autorizado de pagamento (`REFUNDED`).
- **KDS Profissional e Notificações em Tempo Real (SSE)**: fila por estação, cálculo de SLA configurável (`NORMAL`, `WARNING`, `DELAYED`), aviso instantâneo de pedido pronto (`ORDER_READY`) para o garçom via Server-Sent Events (`GET /api/events/stream`) e cancelamento por estágio (`BEFORE_PREP` com estorno de estoque; `DURING_PREP` e `AFTER_DELIVERY` exigindo autorização de gerência e registrando perda sem devolver insumos consumidos).
- **Spooler Térmico Incremental ESC/POS**: impressão exclusiva dos itens novos por estação, proteção contra reenvio cego em caso de `UNKNOWN_OUTCOME` e reimpressão autorizada com cabeçalho explícito de `2ª VIA`.
- **Turno de Caixa Completo**: abertura com troco inicial, sangria, suprimento, cálculo estrito de espécie esperada na gaveta e fechamento com conferência de diferença.
- **Sincronização Offline-First Local ↔ Nuvem**: outbox persistente com idempotência e reconciliação bidirecional.

### Parcialmente Implementado (Base Pronta para Expansão na Etapa 5+)
- **Módulo Hotel Auto Posto Milla**: mapa de apartamentos e check-in rápido com abertura de comanda de quarto (`HOTEL_FOLIO`) já funcionais; gestão avançada de reservas multi-diárias, check-out detalhado e governança serão expandidos na Etapa 5.

### Planejado / Dependente de Hardware ou Credenciais Externas
- **Emissão Fiscal SEFAZ (NFC-e Modelo 65 / NF-e Modelo 55)**: estrutura de campos fiscais (`NCM`, `CEST`, `CFOP`, `Origem`) implementada; o emissor permanece honestamente em modo `DISABLED_NOT_CONFIGURED` até a configuração do Certificado Digital A1 e CSC reais do estabelecimento. **O sistema não emite documentos fiscais fictícios.**
- **Integração Bancária / TEF / Webhook PIX**: o banco de dados já diferencia `MANUAL_DECLARED` de `ELECTRONIC_PROVIDER_CONFIRMED`, aguardando credenciais de provedor de pagamento homologado.
- **Impressão Física USB/Rede RAW 9100**: os payloads ESC/POS reais são gerados e gerenciados no spooler SQLite; o disparo físico em impressora térmica depende da conexão da impressora física no computador do estabelecimento.

---

## 5. Instalação Local (Windows 11)

### Pré-requisitos
- **Windows 11** (64-bit)
- **Node.js 22.5+** (recomendado Node.js 22 LTS ou 24+, que inclui o módulo nativo `node:sqlite`)
- **npm 10+**
- **Git**

### Passo a Passo
1. Clone o repositório privado:
   ```powershell
   git clone https://github.com/Duailibe32/deck26-system.git
   cd deck26-system
   ```
2. Instale as dependências de todos os workspaces:
   ```powershell
   npm install
   ```
3. (Opcional) Copie o arquivo `.env.example` para `.env` caso deseje personalizar portas ou segredos locais:
   ```powershell
   Copy-Item .env.example .env
   ```

---

## 6. Como Executar Localmente

### Opção A — Inicializador Rápido no Windows (`.bat`)
Dê dois cliques no arquivo [`INICIAR-DECK26-DEV.bat`](./INICIAR-DECK26-DEV.bat) na raiz do projeto ou execute no PowerShell:
```powershell
.\INICIAR-DECK26-DEV.bat
```

### Opção B — Comando Único via NPM
```powershell
npm run dev:all
```

### Portas e Endereços Locais
- **Painel Principal Windows / Caixa PDV / Mapa de Mesas**: http://localhost:5173
- **Terminal Mobile do Garçom**: http://localhost:5173/?terminal=garcom
- **KDS da Cozinha, Chapa e Bar**: http://localhost:5173/?terminal=cozinha
- **Site Público (Cardápio Digital QR Code, Delivery e Visão do Proprietário)**: http://localhost:5174
- **API do Servidor Operacional Local**: http://127.0.0.1:4000/api/health
- **API do Simulador Local da VPS**: http://127.0.0.1:4100/api/health

---

## 7. Como Testar e Validar

Execute os comandos abaixo na raiz do projeto:

```powershell
# 1. Verificação estrita de tipos TypeScript em todos os 6 pacotes/aplicações
npm run typecheck

# 2. Execução das 35 suítes de testes automatizados (Unidade + Integração E2E)
npm test

# 3. Compilação de produção das aplicações Desktop e Web
npm run build
```

---

## 8. Estrutura de Pastas do Monorepositório

```text
deck26-system/
├── apps/
│   ├── desktop/        # Aplicativo Windows (Tauri 2 + React + Terminais Garçom/KDS)
│   ├── local-server/   # Servidor Operacional Local (Fastify + SQLite WAL + SSE + RBAC)
│   ├── cloud-api/      # API de Nuvem / Simulador da VPS (Fastify + Sync Outbox/Inbox)
│   └── web/            # Cardápio Digital QR Code, Delivery e Portal Remoto do Proprietário
├── packages/
│   ├── contracts/      # Contratos Zod, RBAC, Cálculos em Centavos e Migrações SQL
│   └── ui/             # Design System Rosa/Preto/Roxo (#F72585, #111111, #7209B7) e Componentes
├── docs/               # Documentação técnica detalhada (Arquitetura, Banco, API, Segurança, Deploy)
├── scripts/            # Orquestrador de desenvolvimento local (dev-all.mjs)
├── .github/workflows/  # Pipeline de Integração Contínua (GitHub Actions CI)
├── .env.example        # Modelo seguro de variáveis de ambiente (sem segredos reais)
├── .gitignore          # Proteção contra versionamento de bancos SQLite, .env e builds
├── docker-compose.yml  # Infraestrutura opcional PostgreSQL 16 para simulação de VPS
├── INICIAR-DECK26-DEV.bat # Inicializador com verificação de ambiente para Windows 11
└── package.json        # Configuração de Workspaces e scripts globais
```

---

## 9. Práticas de Segurança

- **Isolamento de Rede Local**: `apps/local-server` escuta exclusivamente em `127.0.0.1` por padrão, só abrindo para a rede Wi-Fi interna quando `DECK26_ENABLE_LAN=true`.
- **Autenticação e RBAC**: sessões assinadas com `HMAC-SHA256` (`DECK26_AUTH_SECRET`) e validação de permissões por rota no backend (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `KITCHEN`, `RECEPTION`, `STOCK_CLERK`).
- **Prevenção de Fraude em QR Code**: identificadores de mesa assinados via HMAC (`d26qr_mXX_...`); o backend ignora qualquer preço enviado pelo cliente e recalcula 100% dos valores a partir do catálogo oficial.
- **Proteção de Dados e Segredos**: bancos `.sqlite`, arquivos `.env`, certificados digitais (`.pfx`, `.p12`, `.pem`, `.key`) e pastas de outros projetos são bloqueados pelo `.gitignore`.

---

## 10. Roadmap de Desenvolvimento

- [x] **Etapa 1**: Arquitetura base do monorepositório, identidade visual oficial e separação de entidades.
- [x] **Etapa 2**: Ambiente local Windows 11, persistência dual SQLite, pagamentos parciais e impressão incremental.
- [x] **Etapa 3**: Cadastro inteligente de produtos, 6 canais comerciais, estoque Kardex com reversão, fichas técnicas versionadas e QR Code seguro por mesa.
- [x] **Etapa 4**: Operação profissional de mesas, comandas, garçons, KDS com SLA/SSE, divisão de contas, turno de caixa e recuperação de impressão.
- [x] **Etapa 4.5**: Auditoria de segurança, documentação técnica completa, CI e publicação em repositório privado no GitHub.
- [ ] **Etapa 5**: Gestão hoteleira completa (Hotel Auto Posto Milla — reservas, check-in/check-out, diárias, frigobar e transferência de consumo para o apartamento).
- [ ] **Etapa 6**: Delivery próprio completo, gestão financeira avançada, DRE operacional e relatórios gerenciais.
- [ ] **Etapa 7**: Implantação em produção na Hostinger VPS (PostgreSQL + Nginx + TLS) e instalador Windows definitivo no estabelecimento.

---

## 11. Limitações Conhecidas no Estágio Atual

1. **Emissão Fiscal (NFC-e / NF-e)**: desabilitada (`DISABLED_NOT_CONFIGURED`) até a inserção do Certificado Digital A1 e credenciais SEFAZ reais do estabelecimento.
2. **Provedores de Pagamento Eletrônico (TEF / PIX Webhook)**: pagamentos eletrônicos operam em modo declarado pelo operador (`MANUAL_DECLARED`) até a integração com adquirente/banco homologado.
3. **Impressão Térmica Física**: os cupons ESC/POS são gerados e persistidos no spooler do banco local, aguardando mapeamento da impressora física USB/Ethernet na máquina definitiva do estabelecimento.

---

## 12. Fluxo Simples para Futuras Atualizações no GitHub

Sempre que concluir novas alterações no Google Antigravity:

```powershell
# 1. Validar tipos, testes e compilação
npm run typecheck
npm test
npm run build

# 2. Verificar os arquivos modificados
git status

# 3. Adicionar, criar commit e enviar ao GitHub privado
git add .
git commit -m "feat: descricao clara da melhoria implementada"
git push
```

---

## 13. Licença e Propriedade Intelectual

**Todos os direitos reservados — Propriedade Privada (Deck 26 / Hotel Auto Posto Milla).**
Este software é proprietário e de uso exclusivo do estabelecimento. Não é permitida a redistribuição, comercialização ou publicação pública sem autorização expressa do proprietário.
