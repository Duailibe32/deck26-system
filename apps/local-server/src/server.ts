/**
 * DECK 26 — Servidor Operacional Local (Fastify + SQLite WAL + LAN Wi-Fi Discovery)
 *
 * Atende simultaneamente na rede local (sem necessidade de internet externa):
 * - Aplicativo Windows Principal (PDV / Caixa / Recepção Hotel Milla)
 * - 5 Celulares de Garçons (via Wi-Fi LAN)
 * - 1 Dispositivo de Cozinha KDS (via Wi-Fi LAN)
 * - Sincronizador Bidirecional com a VPS Hostinger quando internet estiver disponível
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import os from 'node:os';
import path from 'node:path';
import {
  OrderStatusSchema,
  OriginNodeSchema,
  PaymentMethodSchema,
  SalesChannelSchema,
  StockMovementTypeSchema,
  SyncBatchPushResponseSchema,
  TabTypeSchema
} from '@deck26/contracts';
import { z } from 'zod';
import { LocalOperationalStore } from './store.js';

export function getLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

export async function buildLocalServer(options?: {
  dbPath?: string;
  cloudApiUrl?: string;
}): Promise<{ app: FastifyInstance; store: LocalOperationalStore }> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const dbPath =
    options?.dbPath ??
    process.env.DECK26_LOCAL_DB_PATH ??
    path.resolve(process.cwd(), 'data', 'deck26-local.sqlite');

  const cloudApiUrl =
    options?.cloudApiUrl ?? process.env.DECK26_CLOUD_API_URL ?? 'http://127.0.0.1:4100';

  const store = new LocalOperationalStore(dbPath);
  let lastPulledRemoteCursor = 0;
  let lastSyncStatus: {
    online: boolean;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  } = {
    online: false,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null
  };

  // 1. Health & Descoberta de Rede Wi-Fi Local para Garçons e Cozinha
  app.get('/api/health', async () => {
    const lanIps = getLanIpv4Addresses();
    const pendingSync = store.listPendingSyncEvents(200).length;
    return {
      service: 'deck26-local-server',
      establishment: 'DECK 26 — Hotel Auto Posto Milla',
      status: 'OPERATIONAL_OFFLINE_READY',
      lanAddresses: lanIps,
      waiterUrlHint: `http://${lanIps[0]}:5173/?terminal=garcom`,
      kitchenUrlHint: `http://${lanIps[0]}:5173/?terminal=cozinha`,
      pendingSyncEvents: pendingSync,
      cloudSyncState: lastSyncStatus,
      timestamp: new Date().toISOString()
    };
  });

  // 2. Estado Consolidado para Dashboard, PDV, Mesas, Cozinha, Estoque, Hotel e Impressoras
  app.get('/api/state', async () => {
    const catalog = store.getCatalog();
    const tabs = store.listTabs();
    const orders = store.listOrders();
    const payments = store.listPayments();
    const printJobs = store.listPrintJobs();
    const stock = store.listStockBalancesAndMovements();
    const hotelRooms = store.listHotelRooms();
    const syncEvents = store.listAllSyncEvents(50);

    return {
      lanAddresses: getLanIpv4Addresses(),
      cloudSyncState: lastSyncStatus,
      catalog,
      tabs,
      orders,
      payments,
      printJobs,
      stock,
      hotelRooms,
      syncEvents
    };
  });

  // 3. Catálogo Lógico Compartilhado
  app.get('/api/catalog', async () => {
    return store.getCatalog();
  });

  // 4. Abertura / Consulta de Comandas e Mesas (Tab)
  const OpenTabBodySchema = z.object({
    code: z.string().min(1),
    type: TabTypeSchema.default('TABLE'),
    tableNumber: z.number().int().positive().nullable().optional(),
    customerName: z.string().nullable().optional(),
    guestsCount: z.number().int().min(1).default(1),
    openedByUserId: z.string().optional(),
    originNode: OriginNodeSchema.default('WINDOWS_PDV')
  });

  app.post('/api/tabs', async (req, reply) => {
    const parsed = OpenTabBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos para abertura de comanda', issues: parsed.error.issues });
    }
    const tab = store.openOrGetTab(parsed.data);
    return reply.status(201).send({ tab });
  });

  // 5. Criação de Pedido (Order) com Idempotência, Impressão por Praça e Baixa de Estoque
  const CreateOrderBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid().nullable().optional(),
    tableNumber: z.number().int().positive().nullable().optional(),
    channel: SalesChannelSchema.default('DINE_IN'),
    originNode: OriginNodeSchema.default('WINDOWS_PDV'),
    waiterUserId: z.string().nullable().optional(),
    waiterName: z.string().nullable().optional(),
    customerNotes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().positive(),
          notes: z.string().optional(),
          modifiers: z
            .array(
              z.object({
                groupId: z.string(),
                groupName: z.string(),
                optionId: z.string(),
                optionName: z.string(),
                priceDeltaCents: z.number().int().optional()
              })
            )
            .optional()
        })
      )
      .min(1)
  });

  app.post('/api/orders', async (req, reply) => {
    const parsed = CreateOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pedido inválido', issues: parsed.error.issues });
    }
    const result = store.createOrder(parsed.data);
    return reply.status(result.idempotentReplay ? 200 : 201).send(result);
  });

  // 6. Avanço de Status na Cozinha / KDS / Garçom
  const AdvanceOrderBodySchema = z.object({
    status: OrderStatusSchema,
    originNode: OriginNodeSchema.default('KITCHEN_KDS')
  });

  app.patch<{ Params: { id: string } }>('/api/orders/:id/status', async (req, reply) => {
    const parsed = AdvanceOrderBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Status inválido', issues: parsed.error.issues });
    }
    const order = store.advanceOrderStatus({
      orderId: req.params.id,
      newStatus: parsed.data.status,
      originNode: parsed.data.originNode
    });
    return { order };
  });

  // 7. Registro de Pagamento (Payment — Entidade Separada)
  const RecordPaymentBodySchema = z.object({
    idempotencyKey: z.string().min(8),
    tabId: z.string().uuid(),
    method: PaymentMethodSchema,
    amountCents: z.number().int().positive(),
    receivedCashCents: z.number().int().nonnegative().optional(),
    nsuOrTxId: z.string().optional(),
    operatorUserId: z.string().optional()
  });

  app.post('/api/payments', async (req, reply) => {
    const parsed = RecordPaymentBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pagamento inválido', issues: parsed.error.issues });
    }
    const result = store.recordPayment(parsed.data);
    return reply.status(result.idempotentReplay ? 200 : 201).send(result);
  });

  // 8. Confirmação de Impressão Térmica no Spooler Local
  app.post<{ Params: { id: string } }>('/api/print-jobs/:id/mark-printed', async (req) => {
    const job = store.markPrintJobPrinted(req.params.id);
    return { printJob: job };
  });

  // 9. Ajuste Auditado de Estoque
  const AdjustStockBodySchema = z.object({
    productId: z.string().min(1),
    quantityDelta: z.number().refine((v) => v !== 0, 'Quantidade não pode ser zero'),
    movementType: StockMovementTypeSchema,
    reason: z.string().min(3)
  });

  app.post('/api/stock/adjust', async (req, reply) => {
    const parsed = AdjustStockBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Movimentação inválida', issues: parsed.error.issues });
    }
    const movement = store.adjustStock(parsed.data);
    return reply.status(201).send({ movement });
  });

  // 10. Check-in de Hóspede no Hotel Auto Posto Milla com Abertura de Conta (Folio) Integrada
  const HotelCheckInSchema = z.object({
    roomNumber: z.string().min(1),
    guestName: z.string().min(2)
  });

  app.post('/api/hotel/checkin', async (req, reply) => {
    const parsed = HotelCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados de check-in inválidos', issues: parsed.error.issues });
    }
    const result = store.checkInHotelRoom(parsed.data);
    return reply.status(201).send(result);
  });

  // 11. Ciclo de Sincronização Bidirecional Local ↔ VPS Hostinger
  app.post('/api/sync/trigger', async () => {
    const pendingEvents = store.listPendingSyncEvents(50);
    const attemptTime = new Date().toISOString();
    lastSyncStatus.lastAttemptAt = attemptTime;

    try {
      const response = await fetch(`${cloudApiUrl}/api/sync/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceNodeId: 'deck26-windows-main',
          sourceOrigin: 'WINDOWS_PDV',
          lastPulledRemoteCursor,
          events: pendingEvents
        })
      });

      if (!response.ok) {
        throw new Error(`VPS retornou HTTP ${response.status}`);
      }

      const rawJson = await response.json();
      const syncResp = SyncBatchPushResponseSchema.parse(rawJson);

      store.acknowledgeSyncEvents([...syncResp.ackedEventIds, ...syncResp.duplicateEventIds]);

      let appliedFromCloud = 0;
      for (const remoteEvent of syncResp.remoteEventsToPull) {
        const res = store.applyRemoteSyncEvent(remoteEvent);
        if (res.applied) appliedFromCloud += 1;
      }

      lastPulledRemoteCursor = syncResp.newRemoteCursor;
      lastSyncStatus = {
        online: true,
        lastAttemptAt: attemptTime,
        lastSuccessAt: syncResp.processedAt,
        lastError: null
      };

      return {
        synced: true,
        pushedCount: pendingEvents.length,
        ackedCount: syncResp.ackedEventIds.length,
        duplicateIgnoredCount: syncResp.duplicateEventIds.length,
        pulledFromCloudCount: appliedFromCloud,
        conflicts: syncResp.conflicts,
        cloudSyncState: lastSyncStatus
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'VPS inacessível (Modo Offline Ativo)';
      lastSyncStatus = {
        online: false,
        lastAttemptAt: attemptTime,
        lastSuccessAt: lastSyncStatus.lastSuccessAt,
        lastError: message
      };
      return {
        synced: false,
        offlineModeActive: true,
        pendingLocalEvents: pendingEvents.length,
        reason: message,
        cloudSyncState: lastSyncStatus
      };
    }
  });

  return { app, store };
}
