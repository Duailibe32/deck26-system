# Arquitetura do Sistema — DECK 26

## 1. Visão Geral

O **DECK 26** utiliza uma arquitetura híbrida **Offline-First Local + Cloud Sync** projetada especificamente para a realidade operacional de bares, restaurantes e hotéis:

- **Operação Crítica Local (`apps/local-server` + `apps/desktop`)**:
  - Todas as operações de abertura de mesa, lançamento de pedidos pelos garçons, fila de produção da cozinha (KDS), impressão térmica por estação, controle de estoque e fechamento de caixa ocorrem na rede local (LAN/Wi-Fi) com banco SQLite transacional (`WAL`).
  - Se a internet externa cair, o restaurante e a recepção do hotel continuam operando sem qualquer interrupção.
- **Camada de Nuvem (`apps/cloud-api` + `apps/web`)**:
  - Recebe os eventos operacionais sincronizados pelo servidor local via Outbox/Inbox idempotente e disponibiliza o Cardápio Digital Público, pedidos externos e o painel de acompanhamento remoto do proprietário.

```mermaid
flowchart TD
  subgraph LAN["Rede Local do Estabelecimento (Funciona 100% Sem Internet)"]
    WIN["Computador Windows Principal\n(Tauri 2 / React — Porta 5173)\nCaixa PDV, Mesas, Estoque, Recepção"]
    WAITERS["Até 5 Celulares de Garçons\n(?terminal=garcom via Wi-Fi)"]
    KDS["Dispositivo Cozinha / Chapa / Bar\n(?terminal=cozinha via Wi-Fi)"]
    LOCAL_API["Servidor Operacional Local\n(Fastify + node:sqlite WAL — Porta 4000)"]
    LOCAL_DB[("data/deck26-local.sqlite\n+ Outbox de Sincronização")]

    WIN <-->|"HTTP + SSE"| LOCAL_API
    WAITERS <-->|"HTTP + SSE"| LOCAL_API
    KDS <-->|"HTTP + SSE"| LOCAL_API
    LOCAL_API <--> LOCAL_DB
  end

  subgraph CLOUD["Hostinger VPS (Simulada Localmente na Porta 4100)"]
    CLOUD_API["API de Nuvem\n(Fastify — Porta 4100)"]
    CLOUD_DB[("PostgreSQL Planejado /\ndata/deck26-cloud-vps.sqlite")]
    WEB["Aplicação Web Pública\n(Cardápio QR, Delivery, Painel do Dono — Porta 5174)"]

    CLOUD_API <--> CLOUD_DB
    WEB <-->|"HTTPS / HTTP"| CLOUD_API
  end

  LOCAL_API <-->|"Push/Pull Bidirecional Idempotente\n(HLC + SHA-256 + Cursor)"| CLOUD_API
```

---

## 2. Separação Estrita de Entidades de Domínio

No DECK 26, cada conceito operacional e financeiro possui sua própria tabela e ciclo de vida independente:

1. **Mesa Física (`DiningTableQr` / `dining_tables_qr`)**: representa o espaço físico no salão (`LIVRE`, `AGUARDANDO_PEDIDO`, `EM_ATENDIMENTO`, `AGUARDANDO_PAGAMENTO`, `LIMPEZA`, `INDISPONIVEL`) e seu token criptográfico de QR Code.
2. **Comanda / Conta Financeira (`Tab` / `tabs`)**: agrupa todos os pedidos, descontos, taxa de serviço, divisão de conta e pagamentos de uma mesa, balcão ou apartamento de hotel (`OPEN`, `BILL_REQUESTED`, `PARTIALLY_PAID`, `CLOSED`, `CANCELLED`).
3. **Pedido Incremental (`Order` & `OrderItem` / `orders` & `order_items`)**: representa cada disparo individual de produção para a cozinha/bar (`PENDING_APPROVAL`, `RECEIVED`, `IN_PREPARATION`, `READY`, `DELIVERED`, `CANCELLED`), congelando o preço histórico no momento da venda.
4. **Pagamento (`Payment` / `payments`)**: registro financeiro vinculado à comanda e ao turno de caixa aberto, suportando pagamentos parciais, mistos, cálculo de troco em espécie e estorno auditado (`CONFIRMED`, `REFUNDED`).
5. **Trabalho de Impressão (`PrintJob` / `print_jobs`)**: fila persistente de tickets ESC/POS roteados por impressora de destino (`PRINTER_KITCHEN_HOT`, `PRINTER_KITCHEN_COLD`, `PRINTER_GRIDDLE`, `PRINTER_BAR`, `PRINTER_CASHIER`).
6. **Movimentação de Estoque (`StockMovement` / `stock_movements`)**: livro-razão (Kardex) imutável de todas as deduções por venda, entradas de compra, perdas e reversões.

---

## 3. Serviços e Portas

| Serviço | Pacote Workspace | Porta Padrão | Finalidade |
| :--- | :--- | :--- | :--- |
| Servidor Operacional Local | `@deck26/local-server` | `4000` | API transacional do salão, garçons, KDS, caixa, estoque e SSE |
| API de Nuvem (Simulador VPS) | `@deck26/cloud-api` | `4100` | Recepção de sincronização (`push`/`pull`) e API pública |
| Aplicativo Desktop / Terminais | `@deck26/desktop` | `5173` | Interface do Caixa Windows, Terminal do Garçom e KDS |
| Site Web / Cardápio QR | `@deck26/web` | `5174` | Cardápio Digital QR Code, Delivery e Painel do Proprietário |

---

## 4. Arquitetura do Módulo Hoteleiro PMS (Hotel Auto Posto Milla)

A Etapa 5 introduziu a gestão completa de PMS hoteleiro com integração nativa às operações de bar e restaurante do Deck 26:

### 4.1 Separação Estrita dos Três Eixos de Status do Quarto
Diferente de sistemas legados que misturam disponibilidade com limpeza, o DECK 26 gerencia 3 máquinas de estado independentes para cada apartamento:
1. **Ocupação (`occupancyStatus`)**: `LIVRE` | `RESERVADO` | `OCUPADO` | `BLOQUEADO`.
2. **Governança (`housekeepingStatus`)**: `LIMPO` | `SUJO` | `EM_LIMPEZA` | `INSPECAO_PENDENTE`.
3. **Manutenção (`maintenanceStatus`)**: `DISPONIVEL` | `EM_MANUTENCAO` | `INTERDITADO`.

Essa separação impede que um quarto marcado como `SUJO` seja erroneamente liberado para venda, ou que um quarto `EM_MANUTENCAO` seja reservado por engano.

### 4.2 Modelo de Conta do Hóspede (Hotel Folio Ledger)
- Toda estadia ativa (`HotelStay`) cria uma comanda correspondente do tipo `HOTEL_FOLIO` (`APTO-XXX`).
- Todos os débitos e créditos são registrados em `hotel_folio_entries` como um razão contábil estrito em centavos inteiros (`amountCents`).
- Débitos (> 0): diárias de hospedagem (`ROOM_RATE`), pedidos transferidos do restaurante (`RESTAURANT_ORDER`), pedidos de bar (`BAR_ORDER`), consumos de frigobar (`MINIBAR`), serviços adicionais (`SERVICE`).
- Créditos (<= 0): pagamentos efetuados (`PAYMENT`), adiantamentos/sinal de reserva (`ADVANCE_PAYMENT`), descontos autorizados (`DISCOUNT`), estornos (`REFUND`).
- **Saldo Devedor Calculado**: `balanceCents = debitsCents - creditsCents`.

### 4.3 Integração Transacional Restaurante -> Hotel (`ROOM_CHARGE`)
- Hóspedes podem consumir no salão do Deck 26 (mesas ou balcão) e solicitar a transferência da despesa para o quarto.
- O endpoint `/api/hotel/transfer-tab-to-folio` valida se o quarto está `OCUPADO` e possui estadia ativa (`ACTIVE`).
- A comanda da mesa é encerrada com pagamento no método `ROOM_CHARGE`.
- A despesa é lançada no Folio do hóspede (`entryType = 'RESTAURANT_ORDER'`).
- **Garantias de Integridade**:
  1. O estoque de insumos **não** sofre dupla baixa (a baixa já ocorreu na confirmação do pedido no restaurante).
  2. Os cupons de produção **não** são reenviados para as impressoras da cozinha/bar.
  3. O caixa diário do restaurante **não** é inflado com numerário inexistente (a receita será recebida no check-out do hotel).

### 4.4 Proteção de Sobreposição de Reservas
- A verificação de disponibilidade considera entrada inclusiva e saída exclusiva: `[inA, outA)` e `[inB, outB)`.
- Duas reservas ou estadias colidem se e somente se: `inA < outB && outA > inB`.
- Permite que um hóspede faça check-in no mesmo dia em que outro hóspede faz check-out (`checkInB == checkOutA`).

### 4.5 Regra de Ouro do Check-Out
- O encerramento da estadia exige saldo devedor quitado (`balanceCents == 0`).
- Se houver pendência financeira, o check-out é bloqueado (`HTTP 400`), exigindo quitação prévia via PIX, Dinheiro ou Cartões, ou autorização expressa documentada no log de auditoria (`allowOverrideWithAudit = true`).
- No encerramento:
  - Estadia é marcada como `CHECKED_OUT`.
  - Quarto passa para ocupação `LIVRE`.
  - Quarto passa para governança `SUJO` (obrigando passagem pela equipe de limpeza).
