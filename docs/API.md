# Documentação de Endpoints das APIs — DECK 26

## 1. Servidor Operacional Local (`apps/local-server` — Porta `4000`)

### Saúde, Estado e Tempo Real (SSE)
- `GET /api/health` — Saúde do servidor local, versão e status de conexão com a nuvem.
- `GET /api/state` — Snapshot operacional completo (catálogo, fichas técnicas, mesas QR, comandas, pedidos, pagamentos, spooler de impressão, estoque, apartamentos do hotel, notificações, SLA do KDS e resumo do caixa).
- `GET /api/events/stream` — Stream Server-Sent Events (SSE) para atualização instantânea de KDS, garçons e caixa.
- `GET /api/notifications?sinceCursor=0` — Recuperação de notificações operacionais por cursor monotônico.
- `POST /api/notifications/:id/ack` — Confirmação de leitura/ciência de notificação pelo garçom ou operador.

### Autenticação por PIN e RBAC
- `POST /api/auth/login` — Autentica o colaborador via PIN e retorna token assinado `HMAC-SHA256`.
- `GET /api/auth/me` — Retorna a sessão autenticada atual.

### Catálogo, Categorias, Fichas Técnicas e Estoque
- `GET /api/catalog` — Lista categorias e produtos (suporta filtro `?channel=`).
- `POST /api/catalog/categories` | `PUT /api/catalog/categories/:id` | `DELETE /api/catalog/categories/:id`
- `POST /api/catalog/products` | `PUT /api/catalog/products/:id` | `DELETE /api/catalog/products/:id`
- `POST /api/catalog/products/batch-status` — Ativação/desativação em lote.
- `GET /api/recipes` | `POST /api/recipes` — Versionamento de fichas técnicas aprovadas.
- `POST /api/stock/adjust` — Entrada por compra, perda/quebra ou ajuste manual de inventário.
- `POST /api/stock/reverse` — Reversão auditável de movimentação de estoque (`REVERSAL_ENTRY`).

### Mesas, QR Code Seguro e Operações de Salão
- `GET /api/qr-tables/:token` — Valida token criptográfico de mesa QR e retorna cardápio público da mesa.
- `PATCH /api/qr-tables/:tableNumber` — Configura política de aprovação (`requiresOperatorApproval`).
- `POST /api/tables/open` — Abertura transacional de mesa com criação de comanda vinculada (`HTTP 409` se já ocupada).
- `PATCH /api/tables/:tableNumber/status` — Atualização de estado físico (`LIVRE`, `LIMPEZA`, `INDISPONIVEL`).
- `POST /api/tables/transfer` — Transferência auditada de comanda entre mesas (`Mesa X -> Mesa Y`).
- `POST /api/tables/join` — União de múltiplas mesas em uma comanda principal.
- `POST /api/tables/unjoin` — Separação posterior de mesa unida.

### Comandas, Pedidos, KDS, Pagamentos e Turno de Caixa
- `POST /api/orders` — Criação idempotente de pedido incremental com baixa automática de estoque e geração de ticket térmico por estação.
- `PATCH /api/orders/:id/status` — Avanço de status no KDS (`RECEIVED`, `IN_PREPARATION`, `READY`, `DELIVERED`) ou cancelamento por estágio (`BEFORE_PREP`, `DURING_PREP`, `AFTER_DELIVERY`).
- `GET /api/kds/sla` | `PUT /api/kds/sla` — Leitura e configuração dos limites de tempo do KDS.
- `POST /api/tabs/:id/request-bill` — Solicita fechamento de conta (`BILL_REQUESTED` / `AGUARDANDO_PAGAMENTO`).
- `POST /api/tabs/:id/discount` — Aplica desconto autorizado (`FIXED_CENTS`, `PERCENTAGE`, `COURTESY`).
- `POST /api/tabs/:id/service-fee` — Ativa/desativa ou ajusta taxa de serviço da comanda.
- `POST /api/tabs/:id/split` — Calcula e registra plano de divisão da conta (`FREE_AMOUNT`, `EQUAL_SHARES`, `BY_ITEMS`, `MIXED`).
- `POST /api/tabs/:id/transfer-item` — Transfere item entre comandas sem nova baixa de estoque nem reimpressão.
- `POST /api/tabs/:id/close` — Encerra comanda quitada (`remainingCents === 0`) e libera a(s) mesa(s).
- `POST /api/payments` — Registra pagamento parcial ou total (com cálculo de troco para `CASH`).
- `POST /api/payments/:id/refund` — Estorno autorizado de pagamento (`REFUNDED`).
- `POST /api/cash-sessions/open` | `POST /api/cash-sessions/movements` | `POST /api/cash-sessions/close` — Ciclo completo de turno de caixa, sangria e suprimento.

### Impressão Térmica, Hotel e Sincronização
- `POST /api/print-jobs/:id/mark-printed` | `PATCH /api/print-jobs/:id/status` | `POST /api/print-jobs/:id/reprint`
- `POST /api/hotel/checkin` — Check-in rápido de apartamento com abertura de comanda `HOTEL_FOLIO`.
- `POST /api/sync/trigger` — Dispara ciclo imediato de sincronização Push/Pull com a API de nuvem.

---

## 2. API de Nuvem / Simulador VPS (`apps/cloud-api` — Porta `4100`)

- `GET /api/health` — Saúde da API de nuvem.
- `GET /api/public/menu` — Cardápio público sincronizado.
- `POST /api/public/orders` — Recebimento de pedidos externos (Delivery / QR Code via nuvem).
- `GET /api/owner/overview` — Resumo executivo remoto para o proprietário.
- `POST /api/sync/push` — Recebimento idempotente de lotes de eventos enviados pelo servidor local.
