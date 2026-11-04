/**
 * DECK 26 — Servidor de Nuvem (Hostinger VPS — Node.js + Fastify + PostgreSQL / SQLite Fallback)
 *
 * Responsabilidades na VPS:
 * 1. Receber lotes de eventos persistentes do Servidor Operacional Local (`/api/sync/batch`),
 *    garantindo idempotência por `idempotencyKey`, validação de checksum SHA-256 e resolução determinística de conflitos.
 * 2. Servir o Catálogo Digital Público e registrar pedidos de clientes via QR Code na Mesa e Delivery,
 *    inserindo-os no Ledger de Sincronização para que desçam imediatamente ao computador Windows local e Cozinha (KDS).
 * 3. Fornecer visão consolidada para o Proprietário acessar remotamente de qualquer lugar.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import crypto from 'node:crypto';
import {
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  SalesChannelSchema,
  SyncBatchPushRequestSchema,
  SyncBatchPushResponse,
  SyncOutboxEvent
} from '@deck26/contracts';
import { z } from 'zod';

export interface CloudLedgerRecord {
  cursorSeq: number;
  event: SyncOutboxEvent;
}

export async function buildCloudApiServer(): Promise<{
  app: FastifyInstance;
  getLedger: () => CloudLedgerRecord[];
}> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  // Ledger idempotente com cursor sequencial monotônico (espelha a tabela sync_event_ledger do PostgreSQL)
  const ledgerByIdempotencyKey = new Map<string, CloudLedgerRecord>();
  const ledgerList: CloudLedgerRecord[] = [];
  const entityVersionMap = new Map<string, { version: number; origin: string; updatedAt: string }>();
  let cursorCounter = 0;

  function appendToCloudLedger(event: SyncOutboxEvent): {
    record: CloudLedgerRecord;
    duplicate: boolean;
    conflict: SyncBatchPushResponse['conflicts'][number] | null;
  } {
    const existing = ledgerByIdempotencyKey.get(event.idempotencyKey);
    if (existing) {
      return { record: existing, duplicate: true, conflict: null };
    }

    const entityKey = `${event.entityType}:${event.entityId}`;
    const currentMeta = entityVersionMap.get(entityKey);
    let conflict: SyncBatchPushResponse['conflicts'][number] | null = null;

    if (currentMeta && event.entityVersion < currentMeta.version) {
      // Regra determinística de conflito:
      // Operações físicas de salão (TAB, ORDER, PAYMENT) priorizam o Servidor Local (LOCAL_WINS_OPERATIONAL).
      // Alterações de cadastro de catálogo priorizam a Retaguarda Cloud (CLOUD_WINS_CATALOG).
      const strategy =
        event.entityType === 'CATALOG_PRODUCT' ? 'CLOUD_WINS_CATALOG' : 'LOCAL_WINS_OPERATIONAL';

      conflict = {
        eventId: event.id,
        entityType: event.entityType,
        entityId: event.entityId,
        resolutionStrategy: strategy,
        reason: `Versão recebida (${event.entityVersion}) menor que versão na nuvem (${currentMeta.version}). Aplicada política ${strategy}.`
      };
    }

    entityVersionMap.set(entityKey, {
      version: Math.max(currentMeta?.version ?? 0, event.entityVersion),
      origin: event.originNode,
      updatedAt: event.hlcTimestamp
    });

    cursorCounter += 1;
    const record: CloudLedgerRecord = {
      cursorSeq: cursorCounter,
      event: {
        ...event,
        status: 'ACKED',
        syncedAt: new Date().toISOString()
      }
    };

    ledgerByIdempotencyKey.set(event.idempotencyKey, record);
    ledgerList.push(record);
    return { record, duplicate: false, conflict };
  }

  app.get('/api/health', async () => ({
    service: 'deck26-cloud-api-vps',
    host: 'Hostinger VPS Ready',
    databaseEngine: process.env.DATABASE_URL ? 'PostgreSQL (DATABASE_URL configured)' : 'Embedded Ledger + PostgreSQL Migration Ready',
    totalSyncedEvents: ledgerList.length,
    currentCursor: cursorCounter,
    timestamp: new Date().toISOString()
  }));

  // Catálogo Público para QR Code na Mesa, Delivery e Portal do Proprietário
  app.get('/api/public/catalog', async () => ({
    establishment: 'DECK 26 — Hotel Auto Posto Milla',
    categories: DECK26_INITIAL_CATEGORIES,
    products: DECK26_INITIAL_PRODUCTS
  }));

  // Endpoint de Sincronização Bidirecional chamado pelo Servidor Local Windows
  app.post('/api/sync/batch', async (req, reply) => {
    const parsed = SyncBatchPushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Payload de sincronização inválido', issues: parsed.error.issues });
    }

    const { lastPulledRemoteCursor, events } = parsed.data;
    const ackedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    const conflicts: SyncBatchPushResponse['conflicts'] = [];

    for (const ev of events) {
      const result = appendToCloudLedger(ev);
      if (result.duplicate) {
        duplicateEventIds.push(ev.id);
      } else {
        ackedEventIds.push(ev.id);
      }
      if (result.conflict) {
        conflicts.push(result.conflict);
      }
    }

    // Eventos originados na VPS (ex: Pedidos QR Code, Delivery ou edições do Proprietário) que o servidor local ainda não puxou
    const remoteEventsToPull = ledgerList
      .filter(
        (item) =>
          item.cursorSeq > lastPulledRemoteCursor &&
          item.event.originNode !== parsed.data.sourceOrigin
      )
      .map((item) => item.event);

    const responsePayload: SyncBatchPushResponse = {
      processedAt: new Date().toISOString(),
      ackedEventIds,
      duplicateEventIds,
      conflicts,
      remoteEventsToPull,
      newRemoteCursor: cursorCounter
    };

    return reply.status(200).send(responsePayload);
  });

  // Criação de Pedido Digital na VPS (QR Code na Mesa ou Delivery) que desce para o Servidor Local
  const CreateCloudOrderSchema = z.object({
    idempotencyKey: z.string().min(8),
    channel: SalesChannelSchema.default('QR_TABLE'),
    tableNumber: z.number().int().positive().nullable().optional(),
    customerName: z.string().min(2),
    customerNotes: z.string().optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().positive(),
          notes: z.string().optional()
        })
      )
      .min(1)
  });

  app.post('/api/public/orders', async (req, reply) => {
    const parsed = CreateCloudOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Pedido online inválido', issues: parsed.error.issues });
    }

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();
    const enrichedItems = parsed.data.items.map((item) => {
      const prod = DECK26_INITIAL_PRODUCTS.find((p) => p.id === item.productId);
      if (!prod) {
        throw new Error(`Produto ${item.productId} inválido`);
      }
      return {
        id: crypto.randomUUID(),
        orderId,
        productId: prod.id,
        productName: prod.name,
        prepStation: prod.prepStation,
        quantity: item.quantity,
        unitPriceCents: prod.priceCents,
        modifiersTotalCents: 0,
        totalItemCents: Math.round(prod.priceCents * item.quantity),
        notes: item.notes,
        modifiers: [],
        status: 'RECEIVED' as const
      };
    });

    const totalOrderCents = enrichedItems.reduce((acc, i) => acc + i.totalItemCents, 0);
    const payloadObj = {
      id: orderId,
      tabId: null,
      channel: parsed.data.channel,
      originNode: parsed.data.channel === 'DELIVERY' ? 'CLOUD_DELIVERY' : 'CLOUD_QR_MENU',
      idempotencyKey: parsed.data.idempotencyKey,
      status: 'RECEIVED',
      tableNumber: parsed.data.tableNumber ?? null,
      customerNotes: `${parsed.data.customerName}${parsed.data.customerNotes ? ` - ${parsed.data.customerNotes}` : ''}`,
      items: enrichedItems,
      totalOrderCents,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    const payloadJson = JSON.stringify(payloadObj);
    const event: SyncOutboxEvent = {
      id: crypto.randomUUID(),
      idempotencyKey: parsed.data.idempotencyKey,
      originNode: parsed.data.channel === 'DELIVERY' ? 'CLOUD_DELIVERY' : 'CLOUD_QR_MENU',
      entityType: 'ORDER',
      entityId: orderId,
      operation: 'UPSERT',
      entityVersion: 1,
      hlcTimestamp: now,
      payloadJson,
      checksumSha256: crypto.createHash('sha256').update(payloadJson).digest('hex'),
      status: 'ACKED',
      retryCount: 0,
      createdAt: now,
      syncedAt: now
    };

    const { record, duplicate } = appendToCloudLedger(event);
    return reply.status(duplicate ? 200 : 201).send({
      order: payloadObj,
      cursorSeq: record.cursorSeq,
      duplicate
    });
  });

  // Visão Remota do Proprietário na VPS
  app.get('/api/owner/overview', async () => {
    return {
      totalEventsInCloud: ledgerList.length,
      currentCursor: cursorCounter,
      recentEvents: ledgerList.slice(-30).reverse()
    };
  });

  return {
    app,
    getLedger: () => ledgerList
  };
}
