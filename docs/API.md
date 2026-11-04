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

### Impressão Térmica e Sincronização
- `POST /api/print-jobs/:id/mark-printed` | `PATCH /api/print-jobs/:id/status` | `POST /api/print-jobs/:id/reprint`
- `POST /api/sync/trigger` — Dispara ciclo imediato de sincronização Push/Pull com a API de nuvem.

### Módulo Hoteleiro PMS (Hotel Auto Posto Milla — Etapa 5)
- `GET /api/hotel/rooms` | `POST /api/hotel/rooms` | `PUT /api/hotel/rooms/:id` | `DELETE /api/hotel/rooms/:id` — CRUD de apartamentos (desativação lógica protegida se houver estadias).
- `GET /api/hotel/guests` | `POST /api/hotel/guests` | `PUT /api/hotel/guests/:id` — Fichas de hóspedes LGPD com busca por documento/nome.
- `GET /api/hotel/reservations` | `POST /api/hotel/reservations` — Reservas com proteção contra sobreposição de intervalo `[in, out)`.
- `POST /api/hotel/reservations/:id/cancel` | `POST /api/hotel/reservations/:id/reschedule` — Cancelamento e reagendamento de reservas.
- `GET /api/hotel/availability` — Consulta de disponibilidade por quarto e período de datas.
- `GET /api/hotel/stays` | `GET /api/hotel/stays/:id` — Consulta de estadias hoteleiras ativas e históricas.
- `POST /api/hotel/checkin` — Check-in guiado (walk-in ou de reserva), abre comanda Folio e lança 1ª diária.
- `POST /api/hotel/checkout` — Check-out estrito (exige saldo zero; opcional override auditado).
- `GET /api/hotel/stays/:id/folio` — Extrato completo auditável de débitos e créditos com totalizadores.
- `POST /api/hotel/transfer-tab-to-folio` — Transferência de comanda de restaurante Deck 26 para quarto (`ROOM_CHARGE`).
- `GET /api/hotel/minibar/items` | `POST /api/hotel/minibar/consume` | `POST /api/hotel/minibar/restock` — Gestão e consumo de frigobar.
- `GET /api/hotel/services` | `POST /api/hotel/services/order` — Serviços de hotelaria (lavanderia, cama extra, café extra).
- `PATCH /api/hotel/housekeeping/status` | `GET /api/hotel/housekeeping/logs` — Atualização de governança e histórico.
- `GET /api/hotel/maintenance` | `POST /api/hotel/maintenance` | `PATCH /api/hotel/maintenance/:id/resolve` — Chamados de manutenção predial.
- `GET /api/hotel/metrics` — Painel de métricas hoteleiras (ADR, RevPAR, Taxa de Ocupação, Receitas e Saldos).

### Delivery Próprio & Despacho (Etapa 6)
- `GET /api/delivery/zones` | `POST /api/delivery/zones` — Zonas e taxas de entrega por bairro.
- `GET /api/delivery/couriers` | `POST /api/delivery/couriers` — Gestão e cadastro de entregadores/motoboys.
- `PATCH /api/delivery/couriers/:id/status` — Atualização de status do motoboy (`DISPONIVEL`, `EM_ENTREGA`, `INDISPONIVEL`).
- `GET /api/delivery/customers` | `POST /api/delivery/customers` — Base de clientes e múltiplos endereços de entrega.
- `GET /api/delivery/orders` | `POST /api/delivery/orders` — Central de pedidos delivery e retirada balcão.
- `PATCH /api/delivery/orders/:id/status` — Ciclo de vida (`CONFIRMADO`, `EM_PREPARO`, `PRONTO`).
- `POST /api/delivery/orders/:id/dispatch` — Despacho do pedido com vinculação a motoboy disponível.
- `POST /api/delivery/orders/:id/deliver` — Confirmação de entrega com liberação do motoboy.
- `POST /api/delivery/orders/:id/cancel` — Cancelamento operacional de entrega.
- `POST /api/delivery/settlements` — Prestação de contas de motoboys com transferência de custódia para a tesouraria.

### Gestão Financeira Integrada, DRE e Relatórios (Etapa 6)
- `GET /api/finance/cost-centers` — Centros de custo (`REST`, `BAR`, `DELIV`, `HOTEL`, `ADMIN`).
- `GET /api/finance/categories` — Categorias do plano de contas gerencial (`REVENUE`, `DEDUCTION`, `COST_DIRECT`, `EXPENSE_OP`, `FINANCIAL_RESULT`).
- `GET /api/finance/accounts` | `POST /api/finance/accounts` — Contas financeiras da tesouraria.
- `GET /api/finance/suppliers` | `POST /api/finance/suppliers` — Fornecedores de insumos e mercadorias.
- `GET /api/finance/receivables` | `POST /api/finance/receivables` — Contas a receber manuais e hoteleiras.
- `POST /api/finance/receivables/:id/pay` — Baixa de título a receber com crédito em conta da tesouraria.
- `GET /api/finance/payables` | `POST /api/finance/payables` — Contas a pagar operacionais.
- `POST /api/finance/payables/:id/pay` — Liquidação de conta a pagar com débito em conta da tesouraria.
- `GET /api/finance/transactions` — Extrato unificado de movimentações financeiras.
- `POST /api/finance/transfers` — Transferências internas entre contas (sangrias, suprimentos, depósitos).
- `POST /api/finance/purchases` — Registro de notas fiscais de compra com entrada de estoque no Kardex e geração de conta a pagar.
- `POST /api/finance/reconcile` — Conciliação manual de contas de tesouraria.
- `GET /api/finance/dre` — Demonstrativo de Resultado do Exercício (DRE) gerencial por competência com invariantes contábeis.
- `GET /api/finance/cash-flow/realized` — Fluxo de caixa realizado (regime de caixa por meio de pagamento).
- `GET /api/finance/cash-flow/projected` — Projeção diária de fluxo de caixa futuro por vencimento.
- `GET /api/finance/dashboard` — Métricas executivas consolidadas.
- `GET /api/finance/export/csv` — Exportação segura de relatórios em CSV sanitizados contra Formula Injection.

---

## 2. API de Nuvem / Simulador VPS (`apps/cloud-api` — Porta `4100`)

- `GET /api/health` — Saúde da API de nuvem.
- `GET /api/public/menu` — Cardápio público sincronizado.
- `POST /api/public/orders` — Recebimento de pedidos externos (Delivery / QR Code via nuvem).
- `GET /api/owner/overview` — Resumo executivo remoto para o proprietário.
- `POST /api/sync/push` — Recebimento idempotente de lotes de eventos enviados pelo servidor local.
