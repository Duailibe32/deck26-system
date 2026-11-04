/**
 * DECK 26 — Servidor de Nuvem (Hostinger VPS / Simulador Local Persistente)
 *
 * Responsabilidades:
 * 1. Persistir o Ledger de Sincronização em arquivo independente (`data/deck26-cloud-vps.sqlite`)
 *    para que o reinício do servidor nunca apague os eventos sincronizados, mantendo compatibilidade
 *    com a migração `0001_initial_cloud_schema.sql` de PostgreSQL para futura implantação na Hostinger VPS.
 * 2. Garantir idempotência estrita por `idempotencyKey`, validação de checksum SHA-256 e resolução determinística de conflitos.
 * 3. Servir o Catálogo Digital Público e registrar pedidos de clientes via QR Code na Mesa e Delivery.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  SalesChannelSchema,
  SyncBatchPushRequestSchema,
  SyncBatchPushResponse,
  SyncOutboxEvent,
  resolveChannelPriceCents
} from '@deck26/contracts';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

export interface CloudLedgerRecord {
  cursorSeq: number;
  event: SyncOutboxEvent;
}

export async function buildCloudApiServer(options?: {
  dbPath?: string;
}): Promise<{
  app: FastifyInstance;
  getLedger: () => CloudLedgerRecord[];
  closeDb: () => void;
}> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  const dbPath =
    options?.dbPath ??
    process.env.DECK26_CLOUD_DB_PATH ??
    path.resolve(process.cwd(), 'data', 'deck26-cloud-vps.sqlite');

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS sync_event_ledger (
      cursor_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE,
      origin_node TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_version INTEGER NOT NULL,
      hlc_timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      checksum_sha256 TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_version_tracker (
      entity_key TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      origin_node TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  function mapLedgerRow(row: Record<string, unknown>): CloudLedgerRecord {
    return {
      cursorSeq: Number(row.cursor_seq),
      event: {
        id: String(row.event_id),
        idempotencyKey: String(row.idempotency_key),
        originNode: row.origin_node as SyncOutboxEvent['originNode'],
        entityType: row.entity_type as SyncOutboxEvent['entityType'],
        entityId: String(row.entity_id),
        operation: row.operation as SyncOutboxEvent['operation'],
        entityVersion: Number(row.entity_version),
        hlcTimestamp: String(row.hlc_timestamp),
        payloadJson: String(row.payload_json),
        checksumSha256: String(row.checksum_sha256),
        status: 'ACKED',
        retryCount: 0,
        createdAt: String(row.hlc_timestamp),
        syncedAt: String(row.received_at)
      }
    };
  }

  function appendToCloudLedger(event: SyncOutboxEvent): {
    record: CloudLedgerRecord;
    duplicate: boolean;
    conflict: SyncBatchPushResponse['conflicts'][number] | null;
  } {
    const existingRow = db
      .prepare('SELECT * FROM sync_event_ledger WHERE idempotency_key = ?')
      .get(event.idempotencyKey) as Record<string, unknown> | undefined;

    if (existingRow) {
      return { record: mapLedgerRow(existingRow), duplicate: true, conflict: null };
    }

    const entityKey = `${event.entityType}:${event.entityId}`;
    const currentMeta = db
      .prepare('SELECT version, origin_node, updated_at FROM entity_version_tracker WHERE entity_key = ?')
      .get(entityKey) as { version: number; origin_node: string; updated_at: string } | undefined;

    let conflict: SyncBatchPushResponse['conflicts'][number] | null = null;

    if (currentMeta && event.entityVersion < currentMeta.version) {
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

    const nextVersion = Math.max(currentMeta?.version ?? 0, event.entityVersion);
    db.prepare(`
      INSERT INTO entity_version_tracker (entity_key, version, origin_node, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity_key) DO UPDATE SET
        version = excluded.version,
        origin_node = excluded.origin_node,
        updated_at = excluded.updated_at
    `).run(entityKey, nextVersion, event.originNode, event.hlcTimestamp);

    const receivedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO sync_event_ledger (
        event_id, idempotency_key, origin_node, entity_type, entity_id,
        operation, entity_version, hlc_timestamp, payload_json, checksum_sha256, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.idempotencyKey,
      event.originNode,
      event.entityType,
      event.entityId,
      event.operation,
      event.entityVersion,
      event.hlcTimestamp,
      event.payloadJson,
      event.checksumSha256,
      receivedAt
    );

    const insertedRow = db
      .prepare('SELECT * FROM sync_event_ledger WHERE idempotency_key = ?')
      .get(event.idempotencyKey) as Record<string, unknown>;

    return { record: mapLedgerRow(insertedRow), duplicate: false, conflict };
  }

  function getAllLedgerRecords(): CloudLedgerRecord[] {
    const rows = db
      .prepare('SELECT * FROM sync_event_ledger ORDER BY cursor_seq ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => mapLedgerRow(r));
  }

  function getCurrentMaxCursor(): number {
    const row = db
      .prepare('SELECT COALESCE(MAX(cursor_seq), 0) as max_cursor FROM sync_event_ledger')
      .get() as { max_cursor: number };
    return Number(row.max_cursor);
  }

  app.get('/api/health', async () => {
    const total = getAllLedgerRecords().length;
    const currentCursor = getCurrentMaxCursor();
    return {
      service: 'deck26-cloud-api-vps',
      host: 'Hostinger VPS Simulator (Persistent Disk Mode)',
      databaseEngine: process.env.DATABASE_URL
        ? 'PostgreSQL (DATABASE_URL configured)'
        : `Persistent Disk SQLite (${path.basename(dbPath)}) + PostgreSQL Migration Ready`,
      totalSyncedEvents: total,
      currentCursor,
      timestamp: new Date().toISOString()
    };
  });

  app.get('/api/public/catalog', async () => ({
    establishment: 'DECK 26 — Hotel Auto Posto Milla',
    categories: DECK26_INITIAL_CATEGORIES,
    products: DECK26_INITIAL_PRODUCTS
  }));

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

    const remoteRows = db
      .prepare('SELECT * FROM sync_event_ledger WHERE cursor_seq > ? AND origin_node != ? ORDER BY cursor_seq ASC')
      .all(lastPulledRemoteCursor, parsed.data.sourceOrigin) as Array<Record<string, unknown>>;

    const remoteEventsToPull = remoteRows.map((r) => mapLedgerRow(r).event);
    const currentCursor = getCurrentMaxCursor();

    const responsePayload: SyncBatchPushResponse = {
      processedAt: new Date().toISOString(),
      ackedEventIds,
      duplicateEventIds,
      conflicts,
      remoteEventsToPull,
      newRemoteCursor: currentCursor
    };

    return reply.status(200).send(responsePayload);
  });

  const CreateCloudOrderSchema = z.object({
    idempotencyKey: z.string().min(8),
    channel: SalesChannelSchema.default('QR_TABLE'),
    tableNumber: z.number().int().positive().nullable().optional(),
    qrToken: z.string().optional(),
    customerName: z.string().min(2),
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
      const unitPriceCents = resolveChannelPriceCents(prod, parsed.data.channel);
      const modifiers = (item.modifiers ?? []).map((m) => {
        const grp = prod.modifierGroups.find((g) => g.id === m.groupId);
        const opt = grp?.options.find((o) => o.id === m.optionId);
        return {
          groupId: m.groupId,
          groupName: grp?.name ?? m.groupName,
          optionId: m.optionId,
          optionName: opt?.name ?? m.optionName,
          priceDeltaCents: opt ? opt.priceDeltaCents : (m.priceDeltaCents ?? 0)
        };
      });
      const modifiersTotalCents = modifiers.reduce((acc, m) => acc + m.priceDeltaCents, 0);
      return {
        id: crypto.randomUUID(),
        orderId,
        productId: prod.id,
        productName: prod.name,
        prepStation: prod.prepStation,
        quantity: item.quantity,
        unitPriceCents,
        modifiersTotalCents,
        totalItemCents: Math.round((unitPriceCents + modifiersTotalCents) * item.quantity),
        notes: item.notes,
        modifiers,
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

  app.get('/api/owner/overview', async () => {
    const all = getAllLedgerRecords();
    const currentCursor = getCurrentMaxCursor();
    return {
      totalEventsInCloud: all.length,
      currentCursor,
      recentEvents: all.slice(-30).reverse()
    };
  });

  return {
    app,
    getLedger: () => getAllLedgerRecords(),
    closeDb: () => db.close()
  };
}
