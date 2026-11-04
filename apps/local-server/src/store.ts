/**
 * DECK 26 — Repositório Transacional SQLite (node:sqlite nativo — Etapa 3 Completa)
 *
 * Implementa toda a persistência local offline-first com ACID real:
 * - Executa as migrações versionadas `0001_initial_schema.sql` e `0002_stage3_catalog_stock_recipes_qr.sql`
 * - Semeia o catálogo real do Deck 26 (identificando explicitamente `OFFICIAL_MENU` vs `TEST_ONLY`)
 * - Gerencia Categorias, Produtos completos (preços por canal, custo, margem, estoque mínimo, fiscal),
 *   Fichas Técnicas versionadas (`product_recipes`), Adicionais com baixa de insumo e QR Codes seguros por mesa.
 * - Mantém Comanda (Tab), Pedido (Order), Pagamento (Payment), Impressão (PrintJob)
 *   e Movimentação de Estoque (StockMovement) em tabelas distintas.
 * - Regra Explícita de Baixa Automática: o estoque é comprometido e baixado no evento de confirmação
 *   do pedido (`RECEIVED`), nunca duplicando em mudanças subsequentes de status (`IN_PREPARATION`, `READY`, `DELIVERED`),
 *   e revertendo de forma auditável (`REVERSAL_ENTRY`) em caso de cancelamento (`CANCELLED`).
 */

import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: typeof DatabaseSyncType };

import {
  BillSplitPlan,
  CashRegisterMovement,
  CashRegisterSession,
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DECK26_INITIAL_STAFF,
  DiningTableQr,
  DiscountType,
  HotelRoom,
  KdsSlaConfig,
  ModifierGroup,
  OperationalNotification,
  Order,
  OrderCancelStage,
  OrderItem,
  OrderPriority,
  OrderStatus,
  OriginNode,
  OutOfStockPolicy,
  Payment,
  PaymentConfirmationMode,
  PaymentMethod,
  PrintJob,
  PrintJobStatus,
  PrintJobTarget,
  ProductRecipe,
  SalesChannel,
  StockMovement,
  SyncOutboxEvent,
  Tab,
  TabType,
  TablePhysicalStatus,
  UserRole,
  buildEscPosProductionTicket,
  calculateTabTotals,
  hasPermission,
  resolveChannelPriceCents
} from '@deck26/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuditLogEntry {
  id: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class LocalOperationalStore {
  public readonly db: DatabaseSyncType;
  private readonly eventListeners = new Set<(notification: OperationalNotification) => void>();

  constructor(dbFilePath: string = ':memory:') {
    if (dbFilePath !== ':memory:') {
      const dir = path.dirname(dbFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbFilePath);
    try {
      this.runMigrations();
      this.seedBaseCatalogAndInfrastructure();
    } catch (err) {
      try {
        this.db.close();
      } catch {
        // Ignore close error
      }
      throw err;
    }
  }

  private applySqlStatementsIdempotently(sqlContent: string): void {
    const statements = sqlContent
      .split(';')
      .map((s) => {
        const withoutCommentLines = s
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim();
        return withoutCommentLines;
      })
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        this.db.exec(`${stmt};`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (!msg.includes('duplicate column name')) {
          throw err;
        }
      }
    }
  }

  private runMigrations(): void {
    const migration0001Path = path.resolve(
      __dirname,
      '../../../packages/contracts/migrations/local/0001_initial_schema.sql'
    );
    const sql0001 = fs.readFileSync(migration0001Path, 'utf-8');
    this.db.exec(sql0001);

    const existing0001 = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0001_initial_schema') as { version?: string } | undefined;

    if (!existing0001) {
      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0001_initial_schema', new Date().toISOString());
    }

    const existing0002 = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0002_stage3_catalog_stock_recipes_qr') as { version?: string } | undefined;

    if (!existing0002) {
      const migration0002Path = path.resolve(
        __dirname,
        '../../../packages/contracts/migrations/local/0002_stage3_catalog_stock_recipes_qr.sql'
      );
      const sql0002 = fs.readFileSync(migration0002Path, 'utf-8');
      this.applySqlStatementsIdempotently(sql0002);

      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0002_stage3_catalog_stock_recipes_qr', new Date().toISOString());
    }

    const existing0003 = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0003_stage4_tables_tabs_kds_cashier') as { version?: string } | undefined;

    if (!existing0003) {
      const migration0003Path = path.resolve(
        __dirname,
        '../../../packages/contracts/migrations/local/0003_stage4_tables_tabs_kds_cashier.sql'
      );
      const sql0003 = fs.readFileSync(migration0003Path, 'utf-8');
      this.applySqlStatementsIdempotently(sql0003);

      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0003_stage4_tables_tabs_kds_cashier', new Date().toISOString());
    }

    // Garante compatibilidade de bancos criados na Etapa 2 com novos status das Etapas 3 e 4
    this.db.exec('PRAGMA ignore_check_constraints = ON;');
  }

  private defaultPrinterForStation(station: CatalogProduct['prepStation']): PrintJobTarget {
    switch (station) {
      case 'KITCHEN_HOT':
        return 'PRINTER_KITCHEN_HOT';
      case 'KITCHEN_COLD':
        return 'PRINTER_KITCHEN_COLD';
      case 'GRIDDLE_TAPIOCA':
        return 'PRINTER_GRIDDLE';
      case 'BAR_DRINKS':
        return 'PRINTER_BAR';
      case 'CASHIER_COUNTER':
      case 'NONE':
      default:
        return 'PRINTER_CASHIER';
    }
  }

  private seedBaseCatalogAndInfrastructure(): void {
    const now = new Date().toISOString();

    // 1. Semeia Categorias oficiais do Deck 26
    const insertCat = this.db.prepare(`
      INSERT OR IGNORE INTO catalog_categories (
        id, slug, name, description, sort_order, available_channels_json, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cat of DECK26_INITIAL_CATEGORIES) {
      insertCat.run(
        cat.id,
        cat.slug,
        cat.name,
        cat.description ?? '',
        cat.sortOrder,
        JSON.stringify(cat.availableChannels ?? ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM']),
        cat.active ? 1 : 0,
        now
      );
    }

    // 2. Semeia Produtos oficiais do Deck 26 + Saldo de Estoque Inicial
    const insertProd = this.db.prepare(`
      INSERT OR IGNORE INTO catalog_products (
        id, sku, category_id, name, description, price_cents, cost_price_cents,
        channel_prices_json, available_channels_json, prep_station, target_printer,
        prep_time_minutes, track_stock, min_stock_quantity, out_of_stock_policy,
        modifier_groups_json, data_source, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStockBalance = this.db.prepare(`
      INSERT OR IGNORE INTO stock_balances (product_id, current_quantity, updated_at)
      VALUES (?, ?, ?)
    `);

    for (const prod of DECK26_INITIAL_PRODUCTS) {
      const targetPrinter = prod.targetPrinter ?? this.defaultPrinterForStation(prod.prepStation);
      const dataSource = prod.dataSource ?? 'OFFICIAL_MENU';
      insertProd.run(
        prod.id,
        prod.sku,
        prod.categoryId,
        prod.name,
        prod.description,
        prod.priceCents,
        prod.costPriceCents ?? Math.round(prod.priceCents * 0.4),
        JSON.stringify(prod.channelPricesCents ?? {}),
        JSON.stringify(prod.availableChannels),
        prod.prepStation,
        targetPrinter,
        prod.prepTimeMinutes ?? 15,
        prod.trackStock ? 1 : 0,
        prod.minStockQuantity ?? 5,
        prod.outOfStockPolicy ?? 'BLOCK_SALE',
        JSON.stringify(prod.modifierGroups),
        dataSource,
        prod.active ? 1 : 0,
        prod.createdAt ?? prod.updatedAt,
        prod.updatedAt
      );
      insertStockBalance.run(prod.id, 50, now);
      if (dataSource === 'TEST_ONLY') {
        this.db
          .prepare('UPDATE catalog_products SET data_source = ? WHERE id = ?')
          .run('TEST_ONLY', prod.id);
      }
    }

    // 3. Garante sessão de caixa aberta
    const activeSession = this.db
      .prepare("SELECT id FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1")
      .get() as { id?: string } | undefined;

    if (!activeSession) {
      this.db
        .prepare(`
          INSERT INTO cash_register_sessions (id, opened_by_user_id, opened_at, opening_balance_cents, status)
          VALUES (?, ?, ?, ?, 'OPEN')
        `)
        .run('CASH-SESSION-INITIAL', 'usr-owner-01', now, 20000);
    }

    // 4. Garante estrutura física dos apartamentos do Hotel Auto Posto Milla
    const roomCount = (
      this.db.prepare('SELECT COUNT(*) as total FROM hotel_rooms').get() as { total: number }
    ).total;
    if (roomCount === 0) {
      const insertRoom = this.db.prepare(`
        INSERT INTO hotel_rooms (id, number, category, daily_rate_cents, status, current_guest_name, active_tab_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
      `);
      const rooms: Array<[string, string, string, number, string]> = [
        ['room-101', '101', 'STANDARD_SINGLE', 13000, 'AVAILABLE'],
        ['room-102', '102', 'STANDARD_DOUBLE', 17000, 'AVAILABLE'],
        ['room-103', '103', 'LUXO_CASAL', 21000, 'AVAILABLE'],
        ['room-201', '201', 'LUXO_CASAL', 21000, 'AVAILABLE'],
        ['room-202', '202', 'TRIPLO', 25000, 'AVAILABLE'],
        ['room-203', '203', 'STANDARD_DOUBLE', 17000, 'AVAILABLE']
      ];
      for (const [id, num, cat, rate, status] of rooms) {
        insertRoom.run(id, num, cat, rate, status, null, now);
      }
    }

    // 5. Configuração Fiscal Inicial Honesta
    this.db
      .prepare(`
        INSERT OR IGNORE INTO fiscal_config (
          id, cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, ambiente, mode, certificate_configured, updated_at
        ) VALUES (1, '', 'HOTEL AUTO POSTO MILLA LTDA', 'DECK 26 - HOTEL AUTO POSTO MILLA', '', 'MA', 'HOMOLOGATION', 'DISABLED_NOT_CONFIGURED', 0, ?)
      `)
      .run(now);

    // 6. Semeia Colaboradores Iniciais
    const insertUser = this.db.prepare(`
      INSERT OR IGNORE INTO users (id, name, role, pin_hash, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    for (const staff of DECK26_INITIAL_STAFF) {
      const pinHash = crypto.createHash('sha256').update(`deck26-pin:${staff.pin}`).digest('hex');
      insertUser.run(staff.id, staff.name, staff.role, pinHash, now);
    }

    // 7. Semeia Identificadores Não-Previsíveis de QR Code para as Mesas 01 a 20
    const qrSeedKey =
      process.env.DECK26_QR_SEED_SECRET?.trim() ||
      process.env.DECK26_AUTH_SECRET?.trim() ||
      'deck26-qr-table-seed-dev';
    const insertQrTable = this.db.prepare(`
      INSERT OR IGNORE INTO dining_tables_qr (table_number, qr_token, label, requires_operator_approval, active, created_at)
      VALUES (?, ?, ?, 0, 1, ?)
    `);
    for (let t = 1; t <= 20; t++) {
      const deterministicSecret = crypto
        .createHmac('sha256', qrSeedKey)
        .update(`MESA-${t}`)
        .digest('hex')
        .slice(0, 24);
      const token = `d26qr_m${String(t).padStart(2, '0')}_${deterministicSecret}`;
      insertQrTable.run(t, token, `Mesa ${String(t).padStart(2, '0')} — Salão Deck 26`, now);
    }

    // 8. Configuração Inicial de SLA da Cozinha / KDS (Seção 15)
    this.db
      .prepare(`
        INSERT OR IGNORE INTO kds_sla_config (id, warning_threshold_minutes, delayed_threshold_minutes, updated_at)
        VALUES (1, 10, 20, ?)
      `)
      .run(now);
  }

  public close(): void {
    this.db.close();
  }

  public onOperationalEvent(listener: (notification: OperationalNotification) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  public recordAuditLog(params: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }): AuditLogEntry {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const metadata = params.metadata ?? {};
    this.db
      .prepare(`
        INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.actorUserId,
        params.action,
        params.entityType,
        params.entityId,
        JSON.stringify(metadata),
        createdAt
      );

    return {
      id,
      actorUserId: params.actorUserId,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      metadata,
      createdAt
    };
  }

  public listAuditLogs(entityId?: string, limit: number = 100): AuditLogEntry[] {
    const rows = entityId
      ? (this.db
          .prepare('SELECT * FROM audit_logs WHERE entity_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(entityId, limit) as Array<Record<string, unknown>>)
      : (this.db
          .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
          .all(limit) as Array<Record<string, unknown>>);

    return rows.map((r) => ({
      id: String(r.id),
      actorUserId: String(r.actor_user_id),
      action: String(r.action),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      metadata: r.metadata_json ? JSON.parse(String(r.metadata_json)) : {},
      createdAt: String(r.created_at)
    }));
  }

  public createNotification(params: {
    eventType: OperationalNotification['eventType'];
    targetRole?: UserRole | null;
    targetUserId?: string | null;
    tableNumber?: number | null;
    tabId?: string | null;
    orderId?: string | null;
    title: string;
    message: string;
    payload?: unknown;
  }): OperationalNotification {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const payloadJson = JSON.stringify(params.payload ?? {});

    this.db
      .prepare(`
        INSERT INTO operational_notifications (
          id, event_type, target_role, target_user_id, table_number, tab_id, order_id,
          title, message, payload_json, acknowledged_at, acknowledged_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      `)
      .run(
        id,
        params.eventType,
        params.targetRole ?? null,
        params.targetUserId ?? null,
        params.tableNumber ?? null,
        params.tabId ?? null,
        params.orderId ?? null,
        params.title,
        params.message,
        payloadJson,
        createdAt
      );

    const row = this.db
      .prepare('SELECT * FROM operational_notifications WHERE id = ?')
      .get(id) as Record<string, unknown>;
    const notification = this.mapNotificationRow(row);

    for (const listener of this.eventListeners) {
      try {
        listener(notification);
      } catch {
        // Isola falhas de ouvintes SSE
      }
    }

    return notification;
  }

  public listNotifications(options?: {
    sinceCursorId?: number;
    unacknowledgedOnly?: boolean;
    targetUserId?: string;
    limit?: number;
  }): OperationalNotification[] {
    const sinceCursor = options?.sinceCursorId ?? 0;
    const limit = options?.limit ?? 100;
    let sql = 'SELECT * FROM operational_notifications WHERE cursor_id > ?';
    const args: Array<string | number> = [sinceCursor];

    if (options?.unacknowledgedOnly) {
      sql += ' AND acknowledged_at IS NULL';
    }
    if (options?.targetUserId) {
      sql += ' AND (target_user_id IS NULL OR target_user_id = ?)';
      args.push(options.targetUserId);
    }

    sql += ' ORDER BY cursor_id DESC LIMIT ?';
    args.push(limit);

    const rows = this.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapNotificationRow(r));
  }

  public acknowledgeNotification(notificationId: string, actorUserId: string): OperationalNotification {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE operational_notifications
        SET acknowledged_at = COALESCE(acknowledged_at, ?),
            acknowledged_by_user_id = COALESCE(acknowledged_by_user_id, ?)
        WHERE id = ?
      `)
      .run(now, actorUserId, notificationId);

    const row = this.db
      .prepare('SELECT * FROM operational_notifications WHERE id = ?')
      .get(notificationId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Notificação '${notificationId}' não encontrada.`);
    }
    return this.mapNotificationRow(row);
  }

  public getKdsSlaConfig(): KdsSlaConfig {
    const row = this.db
      .prepare('SELECT * FROM kds_sla_config WHERE id = 1')
      .get() as Record<string, unknown> | undefined;

    if (!row) {
      return {
        warningThresholdMinutes: 10,
        delayedThresholdMinutes: 20,
        updatedAt: new Date().toISOString()
      };
    }

    return {
      warningThresholdMinutes: Number(row.warning_threshold_minutes ?? 10),
      delayedThresholdMinutes: Number(row.delayed_threshold_minutes ?? 20),
      updatedAt: String(row.updated_at)
    };
  }

  public updateKdsSlaConfig(input: {
    warningThresholdMinutes: number;
    delayedThresholdMinutes: number;
  }): KdsSlaConfig {
    if (input.delayedThresholdMinutes <= input.warningThresholdMinutes) {
      throw new Error('O limite de atraso deve ser maior que o limite de atenção.');
    }
    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE kds_sla_config
        SET warning_threshold_minutes = ?, delayed_threshold_minutes = ?, updated_at = ?
        WHERE id = 1
      `)
      .run(input.warningThresholdMinutes, input.delayedThresholdMinutes, now);

    return this.getKdsSlaConfig();
  }

  public authenticateByPin(pin: string): { id: string; name: string; role: UserRole } | null {
    const pinHash = crypto.createHash('sha256').update(`deck26-pin:${pin.trim()}`).digest('hex');
    const row = this.db
      .prepare('SELECT id, name, role FROM users WHERE pin_hash = ? AND active = 1 LIMIT 1')
      .get(pinHash) as { id: string; name: string; role: UserRole } | undefined;

    return row ?? null;
  }

  public listStaffProfiles(): Array<{ id: string; name: string; role: UserRole }> {
    return this.db
      .prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name ASC')
      .all() as Array<{ id: string; name: string; role: UserRole }>;
  }

  // ============================================================================
  // GERENCIAMENTO DE CATEGORIAS (SEÇÃO 5)
  // ============================================================================

  public upsertCategory(input: {
    id?: string;
    slug?: string;
    name: string;
    description?: string;
    imageUrl?: string | null;
    sortOrder?: number;
    availableChannels?: SalesChannel[];
    active?: boolean;
  }): CatalogCategory {
    const now = new Date().toISOString();
    const id = input.id ?? `cat-${crypto.randomUUID().slice(0, 8)}`;
    const slug =
      input.slug ??
      input.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    const category: CatalogCategory = {
      id,
      slug,
      name: input.name.trim(),
      description: input.description ?? '',
      imageUrl: input.imageUrl ?? null,
      sortOrder: input.sortOrder ?? 99,
      availableChannels: input.availableChannels ?? [
        'DINE_IN',
        'COUNTER_PDV',
        'QR_TABLE',
        'DELIVERY',
        'PICKUP',
        'HOTEL_ROOM'
      ],
      active: input.active ?? true,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO catalog_categories (
          id, slug, name, description, image_url, sort_order, available_channels_json, active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          image_url = excluded.image_url,
          sort_order = excluded.sort_order,
          available_channels_json = excluded.available_channels_json,
          active = excluded.active,
          updated_at = excluded.updated_at
      `)
      .run(
        category.id,
        category.slug,
        category.name,
        category.description ?? '',
        category.imageUrl ?? null,
        category.sortOrder,
        JSON.stringify(category.availableChannels),
        category.active ? 1 : 0,
        now
      );

    this.appendOutboxEvent({
      idempotencyKey: `cat-upsert-${category.id}-${now}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'CATALOG_CATEGORY',
      entityId: category.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: category
    });

    return category;
  }

  public deleteCategory(categoryId: string): { deleted: boolean } {
    const linkedCount = (
      this.db
        .prepare('SELECT COUNT(*) as total FROM catalog_products WHERE category_id = ?')
        .get(categoryId) as { total: number }
    ).total;

    if (linkedCount > 0) {
      throw new Error(
        `Não é permitido excluir a categoria '${categoryId}' pois existem ${linkedCount} produto(s) vinculado(s) a ela. Reorganize ou desative a categoria.`
      );
    }

    this.db.prepare('DELETE FROM catalog_categories WHERE id = ?').run(categoryId);
    return { deleted: true };
  }

  // ============================================================================
  // GERENCIAMENTO COMPLETO DE PRODUTOS (SEÇÕES 3, 6, 7, 14, 15, 17)
  // ============================================================================

  public createCatalogProduct(input: {
    id?: string;
    sku: string;
    barcode?: string | null;
    categoryId: string;
    subcategory?: string;
    name: string;
    description?: string;
    imageUrl?: string | null;
    unitOfMeasure?: string;
    priceCents: number;
    costPriceCents?: number;
    channelPricesCents?: Partial<Record<SalesChannel, number>>;
    prepStation: CatalogProduct['prepStation'];
    targetPrinter?: string;
    prepTimeMinutes?: number;
    trackStock?: boolean;
    initialStock?: number;
    minStockQuantity?: number;
    outOfStockPolicy?: OutOfStockPolicy;
    modifierGroups?: ModifierGroup[];
    internalNotes?: string;
    ncm?: string;
    cest?: string;
    cfop?: string;
    merchandiseOrigin?: string;
    taxProfile?: string;
    dataSource?: CatalogProduct['dataSource'];
    availableChannels?: SalesChannel[];
    active?: boolean;
  }): CatalogProduct {
    const now = new Date().toISOString();
    const id = input.id ?? `prd-${crypto.randomUUID().slice(0, 8)}`;
    const existingRow = this.db
      .prepare('SELECT * FROM catalog_products WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    const targetPrinter =
      input.targetPrinter ??
      (existingRow?.target_printer ? String(existingRow.target_printer) : this.defaultPrinterForStation(input.prepStation));

    const product: CatalogProduct = {
      id,
      sku: input.sku.trim().toUpperCase(),
      barcode: input.barcode ?? null,
      categoryId: input.categoryId,
      subcategory: input.subcategory ?? '',
      name: input.name.trim(),
      description: input.description ?? '',
      imageUrl: input.imageUrl ?? null,
      unitOfMeasure: input.unitOfMeasure ?? 'UN',
      priceCents: input.priceCents,
      costPriceCents: input.costPriceCents ?? 0,
      channelPricesCents: input.channelPricesCents as Record<SalesChannel, number> | undefined,
      availableChannels: input.availableChannels ?? [
        'DINE_IN',
        'COUNTER_PDV',
        'QR_TABLE',
        'DELIVERY',
        'PICKUP',
        'HOTEL_ROOM'
      ],
      prepStation: input.prepStation,
      targetPrinter,
      prepTimeMinutes: input.prepTimeMinutes ?? 15,
      trackStock: input.trackStock ?? true,
      minStockQuantity: input.minStockQuantity ?? 5,
      outOfStockPolicy: input.outOfStockPolicy ?? 'BLOCK_SALE',
      modifierGroups: input.modifierGroups ?? [],
      internalNotes: input.internalNotes ?? '',
      ncm: input.ncm,
      cest: input.cest,
      cfop: input.cfop,
      merchandiseOrigin: input.merchandiseOrigin ?? '0',
      taxProfile: input.taxProfile ?? 'REVISAO_CONTABIL_PENDENTE',
      dataSource: input.dataSource ?? 'OFFICIAL_MENU',
      active: input.active ?? true,
      createdAt: existingRow?.created_at ? String(existingRow.created_at) : now,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO catalog_products (
          id, sku, barcode, category_id, subcategory, name, description, image_url,
          unit_of_measure, price_cents, cost_price_cents, channel_prices_json,
          available_channels_json, prep_station, target_printer, prep_time_minutes,
          track_stock, min_stock_quantity, out_of_stock_policy, modifier_groups_json,
          internal_notes, ncm, cest, cfop, merchandise_origin, tax_profile,
          data_source, active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          sku = excluded.sku,
          barcode = excluded.barcode,
          category_id = excluded.category_id,
          subcategory = excluded.subcategory,
          name = excluded.name,
          description = excluded.description,
          image_url = excluded.image_url,
          unit_of_measure = excluded.unit_of_measure,
          price_cents = excluded.price_cents,
          cost_price_cents = excluded.cost_price_cents,
          channel_prices_json = excluded.channel_prices_json,
          available_channels_json = excluded.available_channels_json,
          prep_station = excluded.prep_station,
          target_printer = excluded.target_printer,
          prep_time_minutes = excluded.prep_time_minutes,
          track_stock = excluded.track_stock,
          min_stock_quantity = excluded.min_stock_quantity,
          out_of_stock_policy = excluded.out_of_stock_policy,
          modifier_groups_json = excluded.modifier_groups_json,
          internal_notes = excluded.internal_notes,
          ncm = excluded.ncm,
          cest = excluded.cest,
          cfop = excluded.cfop,
          merchandise_origin = excluded.merchandise_origin,
          tax_profile = excluded.tax_profile,
          data_source = excluded.data_source,
          active = excluded.active,
          updated_at = excluded.updated_at
      `)
      .run(
        product.id,
        product.sku,
        product.barcode ?? null,
        product.categoryId,
        product.subcategory ?? '',
        product.name,
        product.description,
        product.imageUrl ?? null,
        product.unitOfMeasure ?? 'UN',
        product.priceCents,
        product.costPriceCents ?? 0,
        JSON.stringify(product.channelPricesCents ?? {}),
        JSON.stringify(product.availableChannels),
        product.prepStation,
        product.targetPrinter ?? 'PRINTER_KITCHEN_HOT',
        product.prepTimeMinutes ?? 15,
        product.trackStock ? 1 : 0,
        product.minStockQuantity ?? 5,
        product.outOfStockPolicy ?? 'BLOCK_SALE',
        JSON.stringify(product.modifierGroups),
        product.internalNotes ?? '',
        product.ncm ?? null,
        product.cest ?? null,
        product.cfop ?? null,
        product.merchandiseOrigin ?? '0',
        product.taxProfile ?? 'REVISAO_CONTABIL_PENDENTE',
        product.dataSource ?? 'OFFICIAL_MENU',
        product.active ? 1 : 0,
        product.createdAt ?? now,
        product.updatedAt
      );

    if (input.initialStock !== undefined || !existingRow) {
      this.db
        .prepare(`
          INSERT INTO stock_balances (product_id, current_quantity, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(product_id) DO UPDATE SET current_quantity = excluded.current_quantity, updated_at = excluded.updated_at
        `)
        .run(product.id, input.initialStock ?? 50, now);
    }

    this.appendOutboxEvent({
      idempotencyKey: `catalog-product-${product.id}-${now}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'CATALOG_PRODUCT',
      entityId: product.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: product
    });

    return this.getProductById(product.id)!;
  }

  public updateCatalogProduct(
    productId: string,
    patch: Partial<Parameters<LocalOperationalStore['createCatalogProduct']>[0]>
  ): CatalogProduct {
    const existing = this.getProductById(productId);
    if (!existing) {
      throw new Error(`Produto '${productId}' não encontrado para atualização.`);
    }

    return this.createCatalogProduct({
      id: existing.id,
      sku: patch.sku ?? existing.sku,
      barcode: patch.barcode !== undefined ? patch.barcode : existing.barcode,
      categoryId: patch.categoryId ?? existing.categoryId,
      subcategory: patch.subcategory ?? existing.subcategory,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : existing.imageUrl,
      unitOfMeasure: patch.unitOfMeasure ?? existing.unitOfMeasure,
      priceCents: patch.priceCents ?? existing.priceCents,
      costPriceCents: patch.costPriceCents ?? existing.costPriceCents,
      channelPricesCents: patch.channelPricesCents ?? existing.channelPricesCents,
      prepStation: patch.prepStation ?? existing.prepStation,
      targetPrinter: patch.targetPrinter ?? existing.targetPrinter,
      prepTimeMinutes: patch.prepTimeMinutes ?? existing.prepTimeMinutes,
      trackStock: patch.trackStock ?? existing.trackStock,
      minStockQuantity: patch.minStockQuantity ?? existing.minStockQuantity,
      outOfStockPolicy: patch.outOfStockPolicy ?? existing.outOfStockPolicy,
      modifierGroups: patch.modifierGroups ?? existing.modifierGroups,
      internalNotes: patch.internalNotes ?? existing.internalNotes,
      ncm: patch.ncm ?? existing.ncm,
      cest: patch.cest ?? existing.cest,
      cfop: patch.cfop ?? existing.cfop,
      merchandiseOrigin: patch.merchandiseOrigin ?? existing.merchandiseOrigin,
      taxProfile: patch.taxProfile ?? existing.taxProfile,
      dataSource: patch.dataSource ?? existing.dataSource,
      availableChannels: patch.availableChannels ?? existing.availableChannels,
      active: patch.active ?? existing.active,
      initialStock: patch.initialStock
    });
  }

  /**
   * Desativação lógica quando o produto já possui movimentações ou vendas históricas,
   * preservando 100% da integridade referencial dos pedidos anteriores (Seção 3).
   */
  public deleteOrDeactivateProduct(productId: string): {
    mode: 'LOGICAL_DEACTIVATED' | 'PHYSICAL_DELETED';
    product: CatalogProduct | null;
  } {
    const existing = this.getProductById(productId, true);
    if (!existing) {
      throw new Error(`Produto '${productId}' não encontrado.`);
    }

    const orderRefs = (
      this.db
        .prepare('SELECT COUNT(*) as total FROM order_items WHERE product_id = ?')
        .get(productId) as { total: number }
    ).total;

    const stockRefs = (
      this.db
        .prepare('SELECT COUNT(*) as total FROM stock_movements WHERE product_id = ?')
        .get(productId) as { total: number }
    ).total;

    if (orderRefs > 0 || stockRefs > 0) {
      const deactivated = this.updateCatalogProduct(productId, { active: false });
      return { mode: 'LOGICAL_DEACTIVATED', product: deactivated };
    }

    this.db.prepare('DELETE FROM stock_balances WHERE product_id = ?').run(productId);
    this.db.prepare('DELETE FROM catalog_products WHERE id = ?').run(productId);
    return { mode: 'PHYSICAL_DELETED', product: null };
  }

  public batchSetProductsStatus(productIds: string[], active: boolean): { updatedCount: number } {
    const now = new Date().toISOString();
    const stmt = this.db.prepare('UPDATE catalog_products SET active = ?, updated_at = ? WHERE id = ?');
    let count = 0;
    for (const id of productIds) {
      stmt.run(active ? 1 : 0, now, id);
      count += 1;
    }
    return { updatedCount: count };
  }

  public getProductById(productId: string, includeInactive: boolean = true): CatalogProduct | null {
    const sql = includeInactive
      ? 'SELECT * FROM catalog_products WHERE id = ?'
      : 'SELECT * FROM catalog_products WHERE id = ? AND active = 1';
    const row = this.db.prepare(sql).get(productId) as Record<string, unknown> | undefined;
    return row ? this.mapProductRow(row) : null;
  }

  public getCatalog(options?: {
    includeInactive?: boolean;
    channel?: SalesChannel;
  }): { categories: CatalogCategory[]; products: CatalogProduct[] } {
    const includeInactive = options?.includeInactive ?? false;
    const catSql = includeInactive
      ? 'SELECT * FROM catalog_categories ORDER BY sort_order ASC, name ASC'
      : 'SELECT * FROM catalog_categories WHERE active = 1 ORDER BY sort_order ASC, name ASC';

    const prodSql = includeInactive
      ? 'SELECT * FROM catalog_products ORDER BY name ASC'
      : 'SELECT * FROM catalog_products WHERE active = 1 ORDER BY name ASC';

    const catRows = this.db.prepare(catSql).all() as Array<Record<string, unknown>>;
    const prodRows = this.db.prepare(prodSql).all() as Array<Record<string, unknown>>;

    let categories = catRows.map((r) => this.mapCategoryRow(r));
    let products = prodRows.map((r) => this.mapProductRow(r));

    if (options?.channel) {
      const ch = options.channel;
      categories = categories.filter((c) => !c.availableChannels || c.availableChannels.includes(ch));
      products = products.filter((p) => p.availableChannels.includes(ch));
    }

    return { categories, products };
  }

  // ============================================================================
  // FICHAS TÉCNICAS E RECEITAS VERSIONADAS (SEÇÕES 9 E 10)
  // ============================================================================

  public saveProductRecipe(input: {
    productId: string;
    status?: 'DRAFT' | 'APPROVED';
    yieldQuantity?: number;
    notes?: string;
    approvedByUserId?: string;
    items: Array<{
      ingredientProductId: string;
      quantityUsed: number;
      unitOfMeasure?: string;
    }>;
  }): ProductRecipe {
    if (input.items.length === 0) {
      throw new Error('A ficha técnica deve conter pelo menos 1 ingrediente real.');
    }

    const now = new Date().toISOString();
    const maxVerRow = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) as max_v FROM product_recipes WHERE product_id = ?')
      .get(input.productId) as { max_v: number };

    const nextVersion = Number(maxVerRow.max_v) + 1;
    const recipeId = `rcp-${input.productId}-v${nextVersion}`;
    const status = input.status ?? 'APPROVED';

    if (status === 'APPROVED') {
      // Arquiva versões anteriores aprovadas para manter histórico
      this.db
        .prepare("UPDATE product_recipes SET status = 'ARCHIVED', updated_at = ? WHERE product_id = ? AND status = 'APPROVED'")
        .run(now, input.productId);
    }

    let estimatedCostCents = 0;
    const enrichedItems = input.items.map((raw) => {
      const ingProd = this.getProductById(raw.ingredientProductId, true);
      if (!ingProd) {
        throw new Error(`Ingrediente '${raw.ingredientProductId}' não encontrado no catálogo.`);
      }
      const unitCostCents = ingProd.costPriceCents ?? 0;
      estimatedCostCents += Math.round(unitCostCents * raw.quantityUsed);
      return {
        id: crypto.randomUUID(),
        recipeId,
        ingredientProductId: ingProd.id,
        ingredientName: ingProd.name,
        quantityUsed: raw.quantityUsed,
        unitOfMeasure: raw.unitOfMeasure ?? ingProd.unitOfMeasure ?? 'UN',
        unitCostCents
      };
    });

    this.db
      .prepare(`
        INSERT INTO product_recipes (
          id, product_id, version, status, yield_quantity, estimated_cost_cents,
          notes, approved_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        recipeId,
        input.productId,
        nextVersion,
        status,
        input.yieldQuantity ?? 1,
        estimatedCostCents,
        input.notes ?? '',
        input.approvedByUserId ?? null,
        now,
        now
      );

    const insertItem = this.db.prepare(`
      INSERT INTO product_recipe_items (
        id, recipe_id, ingredient_product_id, ingredient_name, quantity_used, unit_of_measure, unit_cost_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of enrichedItems) {
      insertItem.run(
        item.id,
        item.recipeId,
        item.ingredientProductId,
        item.ingredientName,
        item.quantityUsed,
        item.unitOfMeasure,
        item.unitCostCents
      );
    }

    return this.getActiveRecipeForProduct(input.productId) ?? {
      id: recipeId,
      productId: input.productId,
      version: nextVersion,
      status,
      yieldQuantity: input.yieldQuantity ?? 1,
      estimatedCostCents,
      notes: input.notes ?? '',
      approvedByUserId: input.approvedByUserId ?? null,
      items: enrichedItems,
      createdAt: now,
      updatedAt: now
    };
  }

  public getActiveRecipeForProduct(productId: string): ProductRecipe | null {
    const row = this.db
      .prepare("SELECT * FROM product_recipes WHERE product_id = ? AND status = 'APPROVED' ORDER BY version DESC LIMIT 1")
      .get(productId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.mapRecipeWithItems(row);
  }

  public listProductRecipes(productId?: string): ProductRecipe[] {
    const rows = productId
      ? (this.db
          .prepare('SELECT * FROM product_recipes WHERE product_id = ? ORDER BY version DESC')
          .all(productId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare('SELECT * FROM product_recipes ORDER BY updated_at DESC')
          .all() as Array<Record<string, unknown>>);

    return rows.map((r) => this.mapRecipeWithItems(r));
  }

  // ============================================================================
  // QR CODES E GESTÃO OPERACIONAL DE MESAS (SEÇÕES 3, 4, 8, 9, 12, 22)
  // ============================================================================

  public listDiningTablesQr(): DiningTableQr[] {
    const rows = this.db
      .prepare('SELECT * FROM dining_tables_qr ORDER BY table_number ASC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapDiningTableRow(r));
  }

  public getDiningTableByNumber(tableNumber: number): DiningTableQr | null {
    const row = this.db
      .prepare('SELECT * FROM dining_tables_qr WHERE table_number = ? LIMIT 1')
      .get(tableNumber) as Record<string, unknown> | undefined;

    return row ? this.mapDiningTableRow(row) : null;
  }

  public getDiningTableByQrToken(qrToken: string): DiningTableQr | null {
    const row = this.db
      .prepare('SELECT * FROM dining_tables_qr WHERE qr_token = ? AND active = 1 LIMIT 1')
      .get(qrToken.trim()) as Record<string, unknown> | undefined;

    if (!row) return null;
    return this.mapDiningTableRow(row);
  }

  public configureDiningTableQrPolicy(tableNumber: number, requiresOperatorApproval: boolean): DiningTableQr {
    this.db
      .prepare('UPDATE dining_tables_qr SET requires_operator_approval = ? WHERE table_number = ?')
      .run(requiresOperatorApproval ? 1 : 0, tableNumber);

    const updated = this.getDiningTableByNumber(tableNumber);
    if (!updated) {
      throw new Error(`Mesa ${tableNumber} não encontrada.`);
    }
    return updated;
  }

  /**
   * Abertura explícita de mesa com proteção transacional de concorrência (Seções 4 e 22).
   * Impede que dois terminais abram simultaneamente duas comandas ativas na mesma mesa.
   */
  public openTable(input: {
    tableNumber: number;
    guestsCount?: number;
    waiterUserId?: string;
    waiterName?: string;
    customerName?: string | null;
    notes?: string;
    originNode?: OriginNode;
  }): { table: DiningTableQr; tab: Tab } {
    const now = new Date().toISOString();
    const guestsCount = Math.max(1, input.guestsCount ?? 1);
    const waiterUserId = input.waiterUserId ?? 'usr-waiter-01';
    const waiterName = input.waiterName ?? 'Garçom Deck 26';

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tableRow = this.db
        .prepare('SELECT * FROM dining_tables_qr WHERE table_number = ?')
        .get(input.tableNumber) as Record<string, unknown> | undefined;

      if (!tableRow) {
        throw new Error(`Mesa ${input.tableNumber} não cadastrada no salão.`);
      }

      const currentStatus = (tableRow.physical_status as TablePhysicalStatus) ?? 'LIVRE';
      if (currentStatus !== 'LIVRE' || tableRow.active_tab_id) {
        throw new Error(
          `Mesa ${input.tableNumber} não está disponível para abertura (Estado atual: ${currentStatus}). Abertura duplicada bloqueada.`
        );
      }

      const existingActiveTab = this.db
        .prepare(
          "SELECT id FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1"
        )
        .get(input.tableNumber) as { id?: string } | undefined;

      if (existingActiveTab) {
        throw new Error(
          `Mesa ${input.tableNumber} já possui uma comanda ativa (${existingActiveTab.id}). Abertura concorrente bloqueada.`
        );
      }

      const tabId = crypto.randomUUID();
      const tabCode = `MESA-${String(input.tableNumber).padStart(2, '0')}`;

      this.db
        .prepare(`
          INSERT INTO tabs (
            id, code, type, status, table_number, hotel_reservation_id, customer_name,
            guests_count, waiter_user_id, waiter_name, notes, joined_tables_json,
            service_fee_enabled, service_fee_bps, subtotal_cents,
            service_fee_cents, discount_type, discount_cents, discount_bps,
            total_cents, paid_cents, opened_by_user_id, opened_at, closed_at, version
          ) VALUES (?, ?, 'TABLE', 'OPEN', ?, NULL, ?, ?, ?, ?, ?, ?, 1, 1000, 0, 0, 'NONE', 0, 0, 0, 0, ?, ?, NULL, 1)
        `)
        .run(
          tabId,
          tabCode,
          input.tableNumber,
          input.customerName ?? null,
          guestsCount,
          waiterUserId,
          waiterName,
          input.notes ?? null,
          JSON.stringify([input.tableNumber]),
          waiterUserId,
          now
        );

      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = 'AGUARDANDO_PEDIDO',
              active_tab_id = ?,
              primary_table_number = NULL,
              joined_group_id = NULL,
              assigned_waiter_user_id = ?,
              assigned_waiter_name = ?,
              guests_count = ?,
              opened_at = ?,
              notes = ?
          WHERE table_number = ?
        `)
        .run(
          tabId,
          waiterUserId,
          waiterName,
          guestsCount,
          now,
          input.notes ?? null,
          input.tableNumber
        );

      const tab = this.getTabById(tabId)!;
      const table = this.getDiningTableByNumber(input.tableNumber)!;

      this.recordAuditLog({
        actorUserId: waiterUserId,
        action: 'TABLE_OPENED',
        entityType: 'DINING_TABLE',
        entityId: String(input.tableNumber),
        metadata: {
          tableNumber: input.tableNumber,
          tabId: tab.id,
          tabCode: tab.code,
          guestsCount,
          waiterName
        }
      });

      this.appendOutboxEvent({
        idempotencyKey: `tab-open-${tab.id}-v1`,
        originNode: input.originNode ?? 'WINDOWS_PDV',
        entityType: 'TAB',
        entityId: tab.id,
        operation: 'UPSERT',
        entityVersion: tab.version,
        payload: tab
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'TABLE_OPENED',
        tableNumber: input.tableNumber,
        tabId: tab.id,
        title: `Mesa ${String(input.tableNumber).padStart(2, '0')} Aberta`,
        message: `${waiterName} abriu a Mesa ${String(input.tableNumber).padStart(2, '0')} (${guestsCount} pessoa(s)).`
      });

      return { table, tab };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public updateTablePhysicalStatus(input: {
    tableNumber: number;
    physicalStatus: TablePhysicalStatus;
    actorUserId: string;
    notes?: string;
  }): DiningTableQr {
    const table = this.getDiningTableByNumber(input.tableNumber);
    if (!table) {
      throw new Error(`Mesa ${input.tableNumber} não encontrada.`);
    }

    if (input.physicalStatus === 'LIVRE' && table.activeTabId) {
      const activeTab = this.getTabById(table.activeTabId);
      if (activeTab && activeTab.status !== 'CLOSED' && activeTab.status !== 'CANCELLED') {
        const remaining = Math.max(0, activeTab.totalCents - activeTab.paidCents);
        if (remaining > 0 || activeTab.totalCents > 0) {
          throw new Error(
            `Não é permitido liberar a Mesa ${input.tableNumber} com comanda ativa (${activeTab.code}) não encerrada.`
          );
        }
      }
    }

    if (input.physicalStatus === 'LIVRE') {
      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = 'LIVRE',
              active_tab_id = NULL,
              primary_table_number = NULL,
              joined_group_id = NULL,
              assigned_waiter_user_id = NULL,
              assigned_waiter_name = NULL,
              guests_count = 0,
              opened_at = NULL,
              notes = NULL
          WHERE table_number = ?
        `)
        .run(input.tableNumber);
    } else {
      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = ?,
              notes = COALESCE(?, notes)
          WHERE table_number = ?
        `)
        .run(input.physicalStatus, input.notes ?? null, input.tableNumber);
    }

    this.recordAuditLog({
      actorUserId: input.actorUserId,
      action: 'TABLE_STATUS_CHANGED',
      entityType: 'DINING_TABLE',
      entityId: String(input.tableNumber),
      metadata: {
        previousStatus: table.physicalStatus,
        newStatus: input.physicalStatus
      }
    });

    return this.getDiningTableByNumber(input.tableNumber)!;
  }

  /**
   * Transferência de Mesa (Ex.: Mesa 03 -> Mesa 08) — Seção 8
   * - Valida se a mesa de destino está LIVRE (bloqueia transferência para mesa ocupada sem junção).
   * - Transfere comanda, pedidos, pagamentos e histórico preservando integridade.
   * - Libera a mesa de origem e registra auditoria.
   */
  public transferTable(input: {
    fromTableNumber: number;
    toTableNumber: number;
    actorUserId: string;
    reason?: string;
    originNode?: OriginNode;
  }): { fromTable: DiningTableQr; toTable: DiningTableQr; tab: Tab } {
    if (input.fromTableNumber === input.toTableNumber) {
      throw new Error('A mesa de destino deve ser diferente da mesa de origem.');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const fromTable = this.getDiningTableByNumber(input.fromTableNumber);
      const toTable = this.getDiningTableByNumber(input.toTableNumber);

      if (!fromTable) throw new Error(`Mesa de origem ${input.fromTableNumber} não encontrada.`);
      if (!toTable) throw new Error(`Mesa de destino ${input.toTableNumber} não encontrada.`);

      const activeTabRow = fromTable.activeTabId
        ? (this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(fromTable.activeTabId) as
            | Record<string, unknown>
            | undefined)
        : (this.db
            .prepare(
              "SELECT * FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1"
            )
            .get(input.fromTableNumber) as Record<string, unknown> | undefined);

      if (!activeTabRow) {
        throw new Error(`A Mesa ${input.fromTableNumber} não possui comanda ativa para transferir.`);
      }

      const toTableActiveTab = this.db
        .prepare(
          "SELECT id FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1"
        )
        .get(input.toTableNumber) as { id?: string } | undefined;

      if (toTable.physicalStatus !== 'LIVRE' || toTable.activeTabId || toTableActiveTab) {
        throw new Error(
          `A Mesa de destino ${input.toTableNumber} está ocupada (${toTable.physicalStatus}). Utilize a operação de Junção de Mesas se desejar unificar o atendimento.`
        );
      }

      const tab = this.mapTabRow(activeTabRow);
      const newCode = `MESA-${String(input.toTableNumber).padStart(2, '0')}`;
      const currentJoined = tab.joinedTables && tab.joinedTables.length > 0 ? tab.joinedTables : [input.fromTableNumber];
      const updatedJoined = Array.from(
        new Set(currentJoined.map((t) => (t === input.fromTableNumber ? input.toTableNumber : t)))
      );

      this.db
        .prepare(`
          UPDATE tabs
          SET table_number = ?,
              code = ?,
              joined_tables_json = ?,
              version = version + 1
          WHERE id = ?
        `)
        .run(input.toTableNumber, newCode, JSON.stringify(updatedJoined), tab.id);

      this.db
        .prepare('UPDATE orders SET table_number = ? WHERE tab_id = ? AND table_number = ?')
        .run(input.toTableNumber, tab.id, input.fromTableNumber);

      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = ?,
              active_tab_id = ?,
              primary_table_number = NULL,
              joined_group_id = ?,
              assigned_waiter_user_id = ?,
              assigned_waiter_name = ?,
              guests_count = ?,
              opened_at = ?,
              notes = ?
          WHERE table_number = ?
        `)
        .run(
          fromTable.physicalStatus === 'LIVRE' || !fromTable.physicalStatus
            ? 'EM_ATENDIMENTO'
            : fromTable.physicalStatus,
          tab.id,
          fromTable.joinedGroupId ?? null,
          fromTable.assignedWaiterUserId ?? tab.waiterUserId ?? null,
          fromTable.assignedWaiterName ?? tab.waiterName ?? null,
          fromTable.guestsCount ?? tab.guestsCount,
          fromTable.openedAt ?? tab.openedAt,
          fromTable.notes ?? tab.notes ?? null,
          input.toTableNumber
        );

      // Atualiza eventuais mesas secundárias que apontavam para a mesa antiga
      this.db
        .prepare('UPDATE dining_tables_qr SET primary_table_number = ? WHERE primary_table_number = ?')
        .run(input.toTableNumber, input.fromTableNumber);

      // Libera a mesa de origem
      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = 'LIVRE',
              active_tab_id = NULL,
              primary_table_number = NULL,
              joined_group_id = NULL,
              assigned_waiter_user_id = NULL,
              assigned_waiter_name = NULL,
              guests_count = 0,
              opened_at = NULL,
              notes = NULL
          WHERE table_number = ?
        `)
        .run(input.fromTableNumber);

      const updatedTab = this.getTabById(tab.id)!;
      const updatedFrom = this.getDiningTableByNumber(input.fromTableNumber)!;
      const updatedTo = this.getDiningTableByNumber(input.toTableNumber)!;

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TABLE_TRANSFERRED',
        entityType: 'TAB',
        entityId: tab.id,
        metadata: {
          fromTableNumber: input.fromTableNumber,
          toTableNumber: input.toTableNumber,
          reason: input.reason ?? 'Transferência operacional de mesa'
        }
      });

      this.appendOutboxEvent({
        idempotencyKey: `tab-transfer-${updatedTab.id}-v${updatedTab.version}`,
        originNode: input.originNode ?? 'WINDOWS_PDV',
        entityType: 'TAB',
        entityId: updatedTab.id,
        operation: 'UPSERT',
        entityVersion: updatedTab.version,
        payload: updatedTab
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'TABLE_TRANSFERRED',
        tableNumber: input.toTableNumber,
        tabId: updatedTab.id,
        title: `Transferência: Mesa ${input.fromTableNumber} → Mesa ${input.toTableNumber}`,
        message: `Comanda ${updatedTab.code} transferida da Mesa ${input.fromTableNumber} para a Mesa ${input.toTableNumber}.`
      });

      return { fromTable: updatedFrom, toTable: updatedTo, tab: updatedTab };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Junção de Mesas (Ex.: Mesas 04 e 05 atendem o mesmo grupo) — Seção 9
   * - Vincula as mesas secundárias à comanda principal sem duplicar cobrança.
   * - Preserva em cada pedido qual mesa originou o lançamento (`order.tableNumber`).
   */
  public joinTables(input: {
    primaryTableNumber: number;
    tableNumbersToJoin: number[];
    actorUserId: string;
    reason?: string;
    originNode?: OriginNode;
  }): { primaryTable: DiningTableQr; joinedTables: DiningTableQr[]; tab: Tab } {
    const cleanJoinList = Array.from(
      new Set(input.tableNumbersToJoin.filter((n) => n !== input.primaryTableNumber))
    );
    if (cleanJoinList.length === 0) {
      throw new Error('Informe pelo menos uma mesa secundária distinta para unir à mesa principal.');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const primaryTable = this.getDiningTableByNumber(input.primaryTableNumber);
      if (!primaryTable) {
        throw new Error(`Mesa principal ${input.primaryTableNumber} não encontrada.`);
      }

      let primaryTab = primaryTable.activeTabId
        ? this.getTabById(primaryTable.activeTabId)
        : null;

      if (!primaryTab) {
        const existingTabRow = this.db
          .prepare(
            "SELECT * FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1"
          )
          .get(input.primaryTableNumber) as Record<string, unknown> | undefined;

        if (existingTabRow) {
          primaryTab = this.mapTabRow(existingTabRow);
        } else {
          primaryTab = this.openOrGetTab({
            code: `MESA-${String(input.primaryTableNumber).padStart(2, '0')}`,
            type: 'TABLE',
            tableNumber: input.primaryTableNumber,
            openedByUserId: input.actorUserId,
            originNode: input.originNode
          });
        }
      }

      const groupId = primaryTable.joinedGroupId ?? `GRP-M${String(input.primaryTableNumber).padStart(2, '0')}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const existingJoined = primaryTab.joinedTables && primaryTab.joinedTables.length > 0
        ? primaryTab.joinedTables
        : [input.primaryTableNumber];
      const allJoinedNumbers = Array.from(
        new Set([input.primaryTableNumber, ...existingJoined, ...cleanJoinList])
      ).sort((a, b) => a - b);

      let extraGuests = 0;

      for (const secNum of cleanJoinList) {
        const secTable = this.getDiningTableByNumber(secNum);
        if (!secTable) {
          throw new Error(`Mesa secundária ${secNum} não encontrada.`);
        }

        // Verifica se a mesa secundária possuía comanda própria para consolidar pedidos/pagamentos sem duplicar
        const secTabRow = secTable.activeTabId
          ? (this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(secTable.activeTabId) as
              | Record<string, unknown>
              | undefined)
          : (this.db
              .prepare(
                "SELECT * FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1"
              )
              .get(secNum) as Record<string, unknown> | undefined);

        if (secTabRow && String(secTabRow.id) !== primaryTab.id) {
          const secTabId = String(secTabRow.id);
          extraGuests += Number(secTabRow.guests_count ?? 0);

          // Move os pedidos mantendo `table_number = secNum` para rastreabilidade de origem
          this.db
            .prepare('UPDATE orders SET tab_id = ? WHERE tab_id = ?')
            .run(primaryTab.id, secTabId);

          // Move eventuais pagamentos já realizados
          this.db
            .prepare('UPDATE payments SET tab_id = ? WHERE tab_id = ?')
            .run(primaryTab.id, secTabId);

          // Cancela/consolida a comanda secundária esvaziada e libera o índice único de table_number
          this.db
            .prepare(`
              UPDATE tabs
              SET status = 'CANCELLED',
                  table_number = NULL,
                  notes = ?,
                  closed_at = ?,
                  version = version + 1
              WHERE id = ?
            `)
            .run(
              `Consolidada por junção na comanda ${primaryTab.code} (Mesa ${input.primaryTableNumber})`,
              new Date().toISOString(),
              secTabId
            );
        } else {
          extraGuests += Math.max(1, secTable.guestsCount || 2);
        }

        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = 'EM_ATENDIMENTO',
                active_tab_id = ?,
                primary_table_number = ?,
                joined_group_id = ?,
                assigned_waiter_user_id = COALESCE(assigned_waiter_user_id, ?),
                assigned_waiter_name = COALESCE(assigned_waiter_name, ?),
                opened_at = COALESCE(opened_at, ?)
            WHERE table_number = ?
          `)
          .run(
            primaryTab.id,
            input.primaryTableNumber,
            groupId,
            primaryTab.waiterUserId ?? input.actorUserId,
            primaryTab.waiterName ?? 'Garçom Deck 26',
            primaryTab.openedAt,
            secNum
          );
      }

      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = CASE WHEN physical_status = 'LIVRE' THEN 'EM_ATENDIMENTO' ELSE physical_status END,
              active_tab_id = ?,
              primary_table_number = NULL,
              joined_group_id = ?,
              guests_count = guests_count + ?
          WHERE table_number = ?
        `)
        .run(primaryTab.id, groupId, extraGuests, input.primaryTableNumber);

      this.db
        .prepare(`
          UPDATE tabs
          SET joined_tables_json = ?,
              guests_count = guests_count + ?
          WHERE id = ?
        `)
        .run(JSON.stringify(allJoinedNumbers), extraGuests, primaryTab.id);

      const recalculatedTab = this.recalculateTabInTx(primaryTab.id, input.originNode ?? 'WINDOWS_PDV');

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TABLES_JOINED',
        entityType: 'TAB',
        entityId: recalculatedTab.id,
        metadata: {
          primaryTableNumber: input.primaryTableNumber,
          joinedTables: allJoinedNumbers,
          groupId,
          reason: input.reason ?? 'Junção operacional de mesas'
        }
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'TABLES_JOINED',
        tableNumber: input.primaryTableNumber,
        tabId: recalculatedTab.id,
        title: `Mesas Unidas (${allJoinedNumbers.join(', ')})`,
        message: `Mesas ${allJoinedNumbers.join(', ')} vinculadas à comanda principal ${recalculatedTab.code}.`
      });

      return {
        primaryTable: this.getDiningTableByNumber(input.primaryTableNumber)!,
        joinedTables: allJoinedNumbers.map((n) => this.getDiningTableByNumber(n)!),
        tab: recalculatedTab
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Separação posterior de mesa unida (Seção 9).
   */
  public unjoinTable(input: {
    tableNumberToSeparate: number;
    actorUserId: string;
    reason?: string;
    originNode?: OriginNode;
  }): { separatedTable: DiningTableQr; primaryTab: Tab; separatedTab: Tab | null } {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const secTable = this.getDiningTableByNumber(input.tableNumberToSeparate);
      if (!secTable || !secTable.primaryTableNumber || !secTable.activeTabId) {
        throw new Error(`A Mesa ${input.tableNumberToSeparate} não está vinculada a uma junção ativa.`);
      }

      const primaryTab = this.getTabById(secTable.activeTabId);
      if (!primaryTab) {
        throw new Error('Comanda principal da junção não encontrada.');
      }

      const remainingJoined = (primaryTab.joinedTables ?? [secTable.primaryTableNumber]).filter(
        (n) => n !== input.tableNumberToSeparate
      );

      this.db
        .prepare('UPDATE tabs SET joined_tables_json = ? WHERE id = ?')
        .run(JSON.stringify(remainingJoined), primaryTab.id);

      if (remainingJoined.length <= 1) {
        this.db
          .prepare('UPDATE dining_tables_qr SET joined_group_id = NULL WHERE table_number = ?')
          .run(secTable.primaryTableNumber);
      }

      // Verifica se há pedidos ativos originados especificamente nesta mesa secundária
      const tableOrders = this.listOrdersByTab(primaryTab.id).filter(
        (o) => o.tableNumber === input.tableNumberToSeparate && o.status !== 'CANCELLED'
      );

      let separatedTab: Tab | null = null;

      if (tableOrders.length > 0 && primaryTab.paidCents === 0) {
        // Abre uma nova comanda dedicada para a mesa separada e move os pedidos originados nela
        const now = new Date().toISOString();
        const newTabId = crypto.randomUUID();
        const newTabCode = `MESA-${String(input.tableNumberToSeparate).padStart(2, '0')}`;

        this.db
          .prepare(`
            INSERT INTO tabs (
              id, code, type, status, table_number, guests_count, waiter_user_id, waiter_name,
              joined_tables_json, service_fee_enabled, service_fee_bps, subtotal_cents,
              service_fee_cents, discount_type, discount_cents, discount_bps, total_cents, paid_cents,
              opened_by_user_id, opened_at, version
            ) VALUES (?, ?, 'TABLE', 'OPEN', ?, ?, ?, ?, ?, 1, 1000, 0, 0, 'NONE', 0, 0, 0, 0, ?, ?, 1)
          `)
          .run(
            newTabId,
            newTabCode,
            input.tableNumberToSeparate,
            Math.max(1, secTable.guestsCount || 1),
            secTable.assignedWaiterUserId ?? primaryTab.waiterUserId ?? input.actorUserId,
            secTable.assignedWaiterName ?? primaryTab.waiterName ?? 'Garçom Deck 26',
            JSON.stringify([input.tableNumberToSeparate]),
            input.actorUserId,
            now
          );

        for (const ord of tableOrders) {
          this.db.prepare('UPDATE orders SET tab_id = ? WHERE id = ?').run(newTabId, ord.id);
        }

        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = 'EM_ATENDIMENTO',
                active_tab_id = ?,
                primary_table_number = NULL,
                joined_group_id = NULL
            WHERE table_number = ?
          `)
          .run(newTabId, input.tableNumberToSeparate);

        separatedTab = this.recalculateTabInTx(newTabId, input.originNode ?? 'WINDOWS_PDV');
      } else {
        // Libera a mesa secundária de volta para LIVRE
        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = 'LIVRE',
                active_tab_id = NULL,
                primary_table_number = NULL,
                joined_group_id = NULL,
                assigned_waiter_user_id = NULL,
                assigned_waiter_name = NULL,
                guests_count = 0,
                opened_at = NULL,
                notes = NULL
            WHERE table_number = ?
          `)
          .run(input.tableNumberToSeparate);
      }

      const updatedPrimaryTab = this.recalculateTabInTx(primaryTab.id, input.originNode ?? 'WINDOWS_PDV');

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TABLE_UNJOINED',
        entityType: 'TAB',
        entityId: updatedPrimaryTab.id,
        metadata: {
          separatedTableNumber: input.tableNumberToSeparate,
          separatedTabId: separatedTab?.id ?? null,
          reason: input.reason ?? 'Separação operacional de mesa'
        }
      });

      this.db.exec('COMMIT');

      return {
        separatedTable: this.getDiningTableByNumber(input.tableNumberToSeparate)!,
        primaryTab: updatedPrimaryTab,
        separatedTab
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ============================================================================
  // COMANDAS, PEDIDOS, PREÇOS POR CANAL, ADICIONAIS, ESTOQUE E IMPRESSÃO
  // ============================================================================

  public openOrGetTab(input: {
    code: string;
    type: TabType;
    tableNumber?: number | null;
    customerName?: string | null;
    guestsCount?: number;
    waiterUserId?: string | null;
    waiterName?: string | null;
    notes?: string | null;
    openedByUserId?: string;
    originNode?: OriginNode;
  }): Tab {
    // Se for mesa e a mesa estiver unida a uma mesa principal, retorna a comanda principal da junção
    if (input.tableNumber) {
      const tableMeta = this.db
        .prepare('SELECT active_tab_id, primary_table_number FROM dining_tables_qr WHERE table_number = ?')
        .get(input.tableNumber) as { active_tab_id?: string | null; primary_table_number?: number | null } | undefined;

      if (tableMeta?.active_tab_id) {
        const linkedTab = this.db
          .prepare("SELECT * FROM tabs WHERE id = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1")
          .get(tableMeta.active_tab_id) as Record<string, unknown> | undefined;
        if (linkedTab) {
          return this.mapTabRow(linkedTab);
        }
      }

      const existingByTable = this.db
        .prepare("SELECT * FROM tabs WHERE table_number = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1")
        .get(input.tableNumber) as Record<string, unknown> | undefined;

      if (existingByTable) {
        return this.mapTabRow(existingByTable);
      }
    }

    const normalizedCode = input.code.trim().toUpperCase();
    const existingRow = this.db
      .prepare("SELECT * FROM tabs WHERE code = ? AND status IN ('OPEN', 'BILL_REQUESTED', 'PARTIALLY_PAID') LIMIT 1")
      .get(normalizedCode) as Record<string, unknown> | undefined;

    if (existingRow) {
      return this.mapTabRow(existingRow);
    }

    const now = new Date().toISOString();
    const tab: Tab = {
      id: crypto.randomUUID(),
      code: normalizedCode,
      type: input.type,
      status: 'OPEN',
      tableNumber: input.tableNumber ?? null,
      hotelReservationId: null,
      customerName: input.customerName ?? null,
      guestsCount: input.guestsCount ?? 1,
      waiterUserId: input.waiterUserId ?? input.openedByUserId ?? 'usr-operator-local',
      waiterName: input.waiterName ?? null,
      notes: input.notes ?? null,
      joinedTables: input.tableNumber ? [input.tableNumber] : [],
      serviceFeeEnabled: input.type === 'TABLE',
      serviceFeeBasisPoints: 1000,
      subtotalCents: 0,
      serviceFeeCents: 0,
      discountType: 'NONE',
      discountCents: 0,
      discountBasisPoints: 0,
      totalCents: 0,
      paidCents: 0,
      openedByUserId: input.openedByUserId ?? 'usr-operator-local',
      openedAt: now,
      closedAt: null,
      version: 1
    };

    this.db
      .prepare(`
        INSERT INTO tabs (
          id, code, type, status, table_number, hotel_reservation_id, customer_name,
          guests_count, waiter_user_id, waiter_name, notes, joined_tables_json,
          service_fee_enabled, service_fee_bps, subtotal_cents,
          service_fee_cents, discount_type, discount_cents, discount_bps,
          total_cents, paid_cents, opened_by_user_id, opened_at, closed_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NONE', 0, 0, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        tab.id,
        tab.code,
        tab.type,
        tab.status,
        tab.tableNumber ?? null,
        null,
        tab.customerName ?? null,
        tab.guestsCount,
        tab.waiterUserId ?? null,
        tab.waiterName ?? null,
        tab.notes ?? null,
        JSON.stringify(tab.joinedTables ?? []),
        tab.serviceFeeEnabled ? 1 : 0,
        tab.serviceFeeBasisPoints,
        0,
        0,
        0,
        0,
        tab.openedByUserId,
        tab.openedAt,
        null,
        tab.version
      );

    if (tab.tableNumber) {
      this.db
        .prepare(`
          UPDATE dining_tables_qr
          SET physical_status = CASE WHEN physical_status = 'LIVRE' THEN 'AGUARDANDO_PEDIDO' ELSE physical_status END,
              active_tab_id = ?,
              assigned_waiter_user_id = COALESCE(assigned_waiter_user_id, ?),
              assigned_waiter_name = COALESCE(assigned_waiter_name, ?),
              guests_count = CASE WHEN guests_count = 0 THEN ? ELSE guests_count END,
              opened_at = COALESCE(opened_at, ?)
          WHERE table_number = ?
        `)
        .run(
          tab.id,
          tab.waiterUserId ?? null,
          tab.waiterName ?? null,
          tab.guestsCount,
          now,
          tab.tableNumber
        );
    }

    this.appendOutboxEvent({
      idempotencyKey: `tab-open-${tab.id}-v1`,
      originNode: input.originNode ?? 'WINDOWS_PDV',
      entityType: 'TAB',
      entityId: tab.id,
      operation: 'UPSERT',
      entityVersion: tab.version,
      payload: tab
    });

    return tab;
  }

  /**
   * Cria um Pedido (Order) aplicando:
   * - Validação de QR Token da mesa (quando canal = QR_TABLE e qrToken informado)
   * - Preço específico por canal (ou preço padrão) congelado no momento da venda
   * - Validação de disponibilidade do produto e política de falta de estoque (`BLOCK_SALE` vs `ALLOW_BACKORDER`)
   * - Baixa automática de estoque no momento da confirmação (`RECEIVED`):
   *   * Se o produto possuir Ficha Técnica APROVADA (`product_recipes`), consome os ingredientes reais.
   *   * Caso contrário, se `trackStock = true`, consome o saldo direto do produto acabado.
   *   * Se algum adicional selecionado possuir `stockProductId`, também realiza a baixa proporcional do insumo.
   */
  public createOrder(input: {
    idempotencyKey: string;
    tabId?: string | null;
    tableNumber?: number | null;
    qrToken?: string;
    channel: SalesChannel;
    originNode: OriginNode;
    priority?: OrderPriority;
    waiterUserId?: string | null;
    waiterName?: string | null;
    customerNotes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      notes?: string;
      modifiers?: Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceDeltaCents?: number;
      }>;
    }>;
  }): {
    order: Order;
    tab: Tab | null;
    printJobs: PrintJob[];
    stockMovements: StockMovement[];
    idempotentReplay: boolean;
  } {
    const existingOrderRow = this.db
      .prepare('SELECT * FROM orders WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as Record<string, unknown> | undefined;

    if (existingOrderRow) {
      const order = this.getOrderById(String(existingOrderRow.id))!;
      const tab = order.tabId ? this.getTabById(order.tabId) : null;
      const printJobs = this.getPrintJobsByReference('ORDER', order.id);
      const stockMovements = this.getStockMovementsByReference('ORDER', order.id);
      return { order, tab, printJobs, stockMovements, idempotentReplay: true };
    }

    // Se for pedido por QR Code, valida o token criptográfico da mesa no servidor (impede manipulação de mesa/preço)
    let resolvedTableNumber = input.tableNumber ?? null;
    let initialStatus: OrderStatus = 'RECEIVED';

    if (input.qrToken) {
      const qrTable = this.getDiningTableByQrToken(input.qrToken);
      if (!qrTable) {
        throw new Error('Identificador QR Code de mesa inválido ou inativo.');
      }
      resolvedTableNumber = qrTable.tableNumber;
      if (qrTable.requiresOperatorApproval) {
        initialStatus = 'PENDING_APPROVAL';
      }
    }

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();

    const orderItems: OrderItem[] = [];
    const productMetaByItemId = new Map<string, CatalogProduct>();

    for (const rawItem of input.items) {
      const product = this.getProductById(rawItem.productId, true);
      if (!product) {
        throw new Error(`Produto não encontrado no catálogo lógico: ${rawItem.productId}`);
      }
      if (!product.active) {
        throw new Error(`O produto '${product.name}' está inativo e indisponível para venda.`);
      }
      if (!product.availableChannels.includes(input.channel)) {
        throw new Error(`O produto '${product.name}' não está disponível para o canal ${input.channel}.`);
      }

      // Verifica disponibilidade de estoque antes de confirmar a venda quando a política é BLOCK_SALE
      const activeRecipe = this.getActiveRecipeForProduct(product.id);
      if (product.trackStock && product.outOfStockPolicy === 'BLOCK_SALE' && !activeRecipe) {
        const currentQty = this.getProductStockQuantity(product.id);
        if (currentQty < rawItem.quantity) {
          throw new Error(
            `Estoque insuficiente para '${product.name}' (Disponível: ${currentQty}, Solicitado: ${rawItem.quantity}).`
          );
        }
      }

      // Congela o preço do canal no momento exato da venda (ignora qualquer preço manipulado pelo cliente)
      const unitPriceCents = resolveChannelPriceCents(product, input.channel);

      // Valida adicionais contra o cadastro oficial do produto quando os grupos existem no produto
      const modifiers = (rawItem.modifiers ?? []).map((m) => {
        const prodGroup = product.modifierGroups.find((g) => g.id === m.groupId);
        const prodOpt = prodGroup?.options.find((o) => o.id === m.optionId);
        const authoritativeDelta = prodOpt ? prodOpt.priceDeltaCents : (m.priceDeltaCents ?? 0);
        return {
          groupId: m.groupId,
          groupName: prodGroup?.name ?? m.groupName,
          optionId: m.optionId,
          optionName: prodOpt?.name ?? m.optionName,
          priceDeltaCents: authoritativeDelta
        };
      });

      const modifiersTotalCents = modifiers.reduce((acc, m) => acc + m.priceDeltaCents, 0);
      const totalItemCents = Math.round((unitPriceCents + modifiersTotalCents) * rawItem.quantity);

      const itemId = crypto.randomUUID();
      productMetaByItemId.set(itemId, product);

      orderItems.push({
        id: itemId,
        orderId,
        productId: product.id,
        productName: product.name,
        prepStation: product.prepStation,
        quantity: rawItem.quantity,
        unitPriceCents,
        modifiersTotalCents,
        totalItemCents,
        notes: rawItem.notes,
        modifiers,
        status: initialStatus,
        paidQuantity: 0
      });
    }

    let resolvedTab: Tab | null = null;
    if (input.tabId) {
      resolvedTab = this.getTabById(input.tabId);
    } else if (resolvedTableNumber) {
      resolvedTab = this.openOrGetTab({
        code: `MESA-${String(resolvedTableNumber).padStart(2, '0')}`,
        type: 'TABLE',
        tableNumber: resolvedTableNumber,
        waiterUserId: input.waiterUserId ?? 'usr-waiter',
        waiterName: input.waiterName ?? null,
        openedByUserId: input.waiterUserId ?? 'usr-waiter',
        originNode: input.originNode
      });
    } else if (input.channel === 'COUNTER_PDV' || input.channel === 'PICKUP') {
      resolvedTab = this.openOrGetTab({
        code: `BALCAO-${orderId.slice(0, 6).toUpperCase()}`,
        type: 'COUNTER',
        waiterUserId: input.waiterUserId ?? 'usr-cashier',
        waiterName: input.waiterName ?? null,
        openedByUserId: input.waiterUserId ?? 'usr-cashier',
        originNode: input.originNode
      });
    }

    if (resolvedTab && (resolvedTab.status === 'CLOSED' || resolvedTab.status === 'CANCELLED')) {
      throw new Error(`Não é permitido lançar pedidos na comanda encerrada ${resolvedTab.code}.`);
    }

    const totalOrderCents = orderItems.reduce((acc, item) => acc + item.totalItemCents, 0);

    const order: Order = {
      id: orderId,
      tabId: resolvedTab ? resolvedTab.id : null,
      channel: input.channel,
      originNode: input.originNode,
      idempotencyKey: input.idempotencyKey,
      status: initialStatus,
      priority: input.priority ?? 'NORMAL',
      waiterUserId: input.waiterUserId ?? null,
      waiterName: input.waiterName ?? null,
      tableNumber: resolvedTableNumber ?? resolvedTab?.tableNumber ?? null,
      customerNotes: input.customerNotes,
      items: orderItems,
      totalOrderCents,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(`
          INSERT INTO orders (
            id, tab_id, channel, origin_node, idempotency_key, status, priority,
            waiter_user_id, waiter_name, table_number, customer_notes,
            total_order_cents, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          order.id,
          order.tabId ?? null,
          order.channel,
          order.originNode,
          order.idempotencyKey,
          order.status,
          order.priority ?? 'NORMAL',
          order.waiterUserId ?? null,
          order.waiterName ?? null,
          order.tableNumber ?? null,
          order.customerNotes ?? null,
          order.totalOrderCents,
          order.createdAt,
          order.updatedAt,
          order.version
        );

      const insertItem = this.db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, prep_station,
          quantity, unit_price_cents, modifiers_total_cents, total_item_cents,
          notes, modifiers_json, status, paid_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `);

      for (const item of order.items) {
        insertItem.run(
          item.id,
          order.id,
          item.productId,
          item.productName,
          item.prepStation,
          item.quantity,
          item.unitPriceCents,
          item.modifiersTotalCents,
          item.totalItemCents,
          item.notes ?? null,
          JSON.stringify(item.modifiers),
          item.status
        );
      }

      // Se o pedido já nasce confirmado (`RECEIVED`), compromete o estoque e dispara a impressão por estação.
      // Se estiver em `PENDING_APPROVAL`, aguarda aprovação operacional para baixar estoque e imprimir.
      let createdMovements: StockMovement[] = [];
      let createdPrintJobs: PrintJob[] = [];

      if (order.status === 'RECEIVED') {
        createdMovements = this.deductOrderStockInTx(order, productMetaByItemId);
        createdPrintJobs = this.enqueueOrderPrintJobsInTx(order, resolvedTab?.code, productMetaByItemId);
      }

      if (resolvedTab) {
        resolvedTab = this.recalculateTabInTx(resolvedTab.id, order.originNode);
        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = CASE
                  WHEN physical_status IN ('LIVRE', 'OCUPADA', 'AGUARDANDO_PEDIDO') THEN 'EM_ATENDIMENTO'
                  ELSE physical_status
                END,
                active_tab_id = ?
            WHERE active_tab_id = ? OR table_number = ?
          `)
          .run(resolvedTab.id, resolvedTab.id, order.tableNumber ?? resolvedTab.tableNumber ?? -1);
      }

      this.appendOutboxEvent({
        idempotencyKey: `order-create-${order.idempotencyKey}`,
        originNode: order.originNode,
        entityType: 'ORDER',
        entityId: order.id,
        operation: 'UPSERT',
        entityVersion: order.version,
        payload: order
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'ORDER_CREATED',
        targetRole: 'KITCHEN',
        tableNumber: order.tableNumber ?? null,
        tabId: resolvedTab?.id ?? null,
        orderId: order.id,
        title: order.tableNumber
          ? `Novo Pedido — Mesa ${String(order.tableNumber).padStart(2, '0')}`
          : `Novo Pedido (${order.channel})`,
        message: `${order.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}`
      });

      return {
        order,
        tab: resolvedTab,
        printJobs: createdPrintJobs,
        stockMovements: createdMovements,
        idempotentReplay: false
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Transferência de Item entre Comandas (Seção 10):
   * - Não realiza nova baixa de estoque.
   * - Não reimprime pedido na cozinha.
   * - Não duplica receita financeira.
   * - Bloqueia transferência de item cancelado ou já pago.
   */
  public transferOrderItemBetweenTabs(input: {
    orderItemId: string;
    quantityToTransfer?: number;
    targetTabId: string;
    actorUserId: string;
    reason: string;
    originNode?: OriginNode;
  }): { sourceTab: Tab; targetTab: Tab; transferredItem: OrderItem } {
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error('Informe o motivo da transferência do item (mínimo 3 caracteres).');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const itemRow = this.db
        .prepare('SELECT * FROM order_items WHERE id = ?')
        .get(input.orderItemId) as Record<string, unknown> | undefined;

      if (!itemRow) {
        throw new Error(`Item de pedido '${input.orderItemId}' não encontrado.`);
      }

      const sourceOrderRow = this.db
        .prepare('SELECT * FROM orders WHERE id = ?')
        .get(String(itemRow.order_id)) as Record<string, unknown> | undefined;

      if (!sourceOrderRow || !sourceOrderRow.tab_id) {
        throw new Error('O pedido de origem não está vinculado a uma comanda.');
      }

      const sourceTabId = String(sourceOrderRow.tab_id);
      if (sourceTabId === input.targetTabId) {
        throw new Error('A comanda de destino deve ser diferente da comanda de origem.');
      }

      const sourceTab = this.getTabById(sourceTabId);
      const targetTab = this.getTabById(input.targetTabId);

      if (!sourceTab || sourceTab.status === 'CLOSED' || sourceTab.status === 'CANCELLED') {
        throw new Error('Comanda de origem não está ativa para transferência.');
      }
      if (!targetTab || targetTab.status === 'CLOSED' || targetTab.status === 'CANCELLED') {
        throw new Error('Comanda de destino não está ativa para receber transferência.');
      }

      const itemStatus = String(itemRow.status) as OrderStatus;
      if (itemStatus === 'CANCELLED' || String(sourceOrderRow.status) === 'CANCELLED') {
        throw new Error('Não é permitido transferir um item cancelado.');
      }

      const totalQty = Number(itemRow.quantity);
      const paidQty = Number(itemRow.paid_quantity ?? 0);
      const availableUnpaidQty = Number((totalQty - paidQty).toFixed(4));

      const qtyToTransfer = input.quantityToTransfer ?? availableUnpaidQty;
      if (qtyToTransfer <= 0 || qtyToTransfer > availableUnpaidQty) {
        throw new Error(
          `Quantidade indisponível para transferência. O item já foi pago parcial ou integralmente (Disponível não pago: ${availableUnpaidQty}).`
        );
      }

      // Garante que a transferência na origem não reduza o total abaixo do que já foi pago na comanda de origem
      const unitWithModsCents = Number(itemRow.unit_price_cents) + Number(itemRow.modifiers_total_cents);
      const transferValueCents = Math.round(unitWithModsCents * qtyToTransfer);
      const sourceRemainingGross = sourceTab.subtotalCents - transferValueCents;
      if (sourceTab.paidCents > 0 && sourceRemainingGross < sourceTab.paidCents) {
        throw new Error(
          'Não é permitido transferir este item pois o valor restante na comanda de origem ficaria menor que os pagamentos já recebidos.'
        );
      }

      const now = new Date().toISOString();
      const targetOrderId = crypto.randomUUID();

      // Cria um registro de pedido receptor na comanda de destino (sem acionar estoque nem impressão)
      this.db
        .prepare(`
          INSERT INTO orders (
            id, tab_id, channel, origin_node, idempotency_key, status, priority,
            waiter_user_id, waiter_name, table_number, customer_notes,
            total_order_cents, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, 'NORMAL', ?, ?, ?, ?, ?, ?, ?, 1)
        `)
        .run(
          targetOrderId,
          targetTab.id,
          String(sourceOrderRow.channel),
          input.originNode ?? 'WINDOWS_PDV',
          `transfer-item-${input.orderItemId}-${now}`,
          itemStatus,
          input.actorUserId,
          null,
          targetTab.tableNumber ?? null,
          `Transferido da comanda ${sourceTab.code}: ${input.reason}`,
          transferValueCents,
          now,
          now
        );

      let transferredItemId = input.orderItemId;

      if (qtyToTransfer === totalQty && paidQty === 0) {
        // Move a linha inteira para o pedido na comanda de destino
        this.db
          .prepare(`
            UPDATE order_items
            SET order_id = ?,
                transferred_from_tab_id = ?,
                transferred_from_order_id = ?,
                transferred_at = ?,
                transferred_by_user_id = ?
            WHERE id = ?
          `)
          .run(
            targetOrderId,
            sourceTab.id,
            String(sourceOrderRow.id),
            now,
            input.actorUserId,
            input.orderItemId
          );
      } else {
        // Transferência parcial: reduz quantidade no item original e cria novo item no destino
        const remainingSourceQty = Number((totalQty - qtyToTransfer).toFixed(4));
        const remainingSourceCents = Math.round(unitWithModsCents * remainingSourceQty);
        this.db
          .prepare('UPDATE order_items SET quantity = ?, total_item_cents = ? WHERE id = ?')
          .run(remainingSourceQty, remainingSourceCents, input.orderItemId);

        transferredItemId = crypto.randomUUID();
        this.db
          .prepare(`
            INSERT INTO order_items (
              id, order_id, product_id, product_name, prep_station,
              quantity, unit_price_cents, modifiers_total_cents, total_item_cents,
              notes, modifiers_json, status, transferred_from_tab_id,
              transferred_from_order_id, transferred_at, transferred_by_user_id, paid_quantity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          `)
          .run(
            transferredItemId,
            targetOrderId,
            String(itemRow.product_id),
            String(itemRow.product_name),
            String(itemRow.prep_station),
            qtyToTransfer,
            Number(itemRow.unit_price_cents),
            Number(itemRow.modifiers_total_cents),
            transferValueCents,
            itemRow.notes ? String(itemRow.notes) : null,
            String(itemRow.modifiers_json),
            itemStatus,
            sourceTab.id,
            String(sourceOrderRow.id),
            now,
            input.actorUserId
          );
      }

      // Recalcula o total_order_cents do pedido de origem
      const remainingSourceItems = this.db
        .prepare("SELECT COALESCE(SUM(total_item_cents), 0) as total FROM order_items WHERE order_id = ? AND status != 'CANCELLED'")
        .get(String(sourceOrderRow.id)) as { total: number };

      this.db
        .prepare('UPDATE orders SET total_order_cents = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(Number(remainingSourceItems.total), now, String(sourceOrderRow.id));

      const updatedSourceTab = this.recalculateTabInTx(sourceTab.id, input.originNode ?? 'WINDOWS_PDV');
      const updatedTargetTab = this.recalculateTabInTx(targetTab.id, input.originNode ?? 'WINDOWS_PDV');

      const targetOrder = this.getOrderById(targetOrderId)!;
      const transferredItem = targetOrder.items.find((i) => i.id === transferredItemId) ?? targetOrder.items[0]!;

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TAB_ITEM_TRANSFERRED',
        entityType: 'ORDER_ITEM',
        entityId: transferredItem.id,
        metadata: {
          sourceTabId: sourceTab.id,
          sourceTabCode: sourceTab.code,
          targetTabId: targetTab.id,
          targetTabCode: targetTab.code,
          productName: transferredItem.productName,
          quantityTransferred: qtyToTransfer,
          transferValueCents,
          reason: input.reason
        }
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'TAB_ITEM_TRANSFERRED',
        tabId: updatedTargetTab.id,
        tableNumber: updatedTargetTab.tableNumber ?? null,
        title: `Item Transferido (${sourceTab.code} → ${targetTab.code})`,
        message: `${qtyToTransfer}x ${transferredItem.productName} transferido para ${targetTab.code}.`
      });

      return {
        sourceTab: updatedSourceTab,
        targetTab: updatedTargetTab,
        transferredItem
      };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Solicitação de Fechamento de Conta pelo Garçom ou Operador (Seções 3, 6 e 19)
   */
  public requestTabBill(input: {
    tabId: string;
    actorUserId: string;
    originNode?: OriginNode;
  }): Tab {
    const tab = this.getTabById(input.tabId);
    if (!tab) {
      throw new Error(`Comanda '${input.tabId}' não encontrada.`);
    }
    if (tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
      throw new Error(`Comanda ${tab.code} já está encerrada (${tab.status}).`);
    }

    const nextStatus = tab.paidCents > 0 ? 'PARTIALLY_PAID' : 'BILL_REQUESTED';
    this.db
      .prepare('UPDATE tabs SET status = ?, version = version + 1 WHERE id = ?')
      .run(nextStatus, tab.id);

    this.db
      .prepare("UPDATE dining_tables_qr SET physical_status = 'AGUARDANDO_PAGAMENTO' WHERE active_tab_id = ?")
      .run(tab.id);

    const updatedTab = this.getTabById(tab.id)!;

    this.recordAuditLog({
      actorUserId: input.actorUserId,
      action: 'BILL_REQUESTED',
      entityType: 'TAB',
      entityId: tab.id,
      metadata: {
        tabCode: tab.code,
        tableNumber: tab.tableNumber,
        totalCents: tab.totalCents,
        remainingCents: Math.max(0, tab.totalCents - tab.paidCents)
      }
    });

    this.createNotification({
      eventType: 'BILL_REQUESTED',
      targetRole: 'CASHIER',
      tableNumber: tab.tableNumber ?? null,
      tabId: tab.id,
      title: `Fechamento Solicitado — ${tab.code}`,
      message: `Cliente solicitou fechamento da conta ${tab.code} (Saldo: R$ ${((tab.totalCents - tab.paidCents) / 100).toFixed(2).replace('.', ',')}).`
    });

    return updatedTab;
  }

  private deductOrderStockInTx(
    order: Order,
    productMetaByItemId?: Map<string, CatalogProduct>
  ): StockMovement[] {
    const now = new Date().toISOString();
    const createdMovements: StockMovement[] = [];

    for (const item of order.items) {
      const product = productMetaByItemId?.get(item.id) ?? this.getProductById(item.productId, true);
      if (!product) continue;

      const activeRecipe = this.getActiveRecipeForProduct(product.id);
      if (activeRecipe) {
        // Quando há Ficha Técnica APROVADA, consome exatamente os ingredientes cadastrados (Seção 9)
        for (const rItem of activeRecipe.items) {
          const totalIngredientQty = (rItem.quantityUsed / (activeRecipe.yieldQuantity || 1)) * item.quantity;
          const movKey = `sale-rcp-${order.id}-${item.id}-${rItem.ingredientProductId}`;
          const mov = this.recordStockDeltaInTx({
            idempotencyKey: movKey,
            productId: rItem.ingredientProductId,
            productName: rItem.ingredientName,
            movementType: 'SALE_DEDUCTION',
            quantityDelta: -totalIngredientQty,
            originChannel: order.channel,
            referenceEntityType: 'ORDER',
            referenceEntityId: order.id,
            reason: `Baixa por Ficha Técnica v${activeRecipe.version} de '${product.name}' (Pedido #${order.id.slice(0, 8)})`,
            createdByUserId: order.waiterUserId ?? 'system-pos',
            now
          });
          if (mov) createdMovements.push(mov);
        }
      } else if (product.trackStock) {
        // Sem ficha técnica: baixa direta do produto pronto
        const movKey = `sale-prd-${order.id}-${item.id}`;
        const mov = this.recordStockDeltaInTx({
          idempotencyKey: movKey,
          productId: product.id,
          productName: product.name,
          movementType: 'SALE_DEDUCTION',
          quantityDelta: -item.quantity,
          originChannel: order.channel,
          referenceEntityType: 'ORDER',
          referenceEntityId: order.id,
          reason: `Baixa automática Pedido #${order.id.slice(0, 8)} (${order.channel})`,
          createdByUserId: order.waiterUserId ?? 'system-pos',
          now
        });
        if (mov) createdMovements.push(mov);
      }

      // Verifica se algum adicional selecionado consome estoque de insumo (Seção 7)
      for (const selectedMod of item.modifiers) {
        const group = product.modifierGroups.find((g) => g.id === selectedMod.groupId);
        const opt = group?.options.find((o) => o.id === selectedMod.optionId);
        if (opt?.stockProductId && opt.stockQuantityUsed) {
          const modProd = this.getProductById(opt.stockProductId, true);
          if (modProd) {
            const movKey = `sale-mod-${order.id}-${item.id}-${opt.id}`;
            const mov = this.recordStockDeltaInTx({
              idempotencyKey: movKey,
              productId: modProd.id,
              productName: modProd.name,
              movementType: 'SALE_DEDUCTION',
              quantityDelta: -(opt.stockQuantityUsed * item.quantity),
              originChannel: order.channel,
              referenceEntityType: 'ORDER',
              referenceEntityId: order.id,
              reason: `Baixa adicional '${opt.name}' em '${product.name}' (Pedido #${order.id.slice(0, 8)})`,
              createdByUserId: order.waiterUserId ?? 'system-pos',
              now
            });
            if (mov) createdMovements.push(mov);
          }
        }
      }
    }

    return createdMovements;
  }

  private recordStockDeltaInTx(params: {
    idempotencyKey: string;
    productId: string;
    productName: string;
    movementType: StockMovement['movementType'];
    quantityDelta: number;
    unitCostCents?: number;
    originChannel: string;
    referenceEntityType?: StockMovement['referenceEntityType'];
    referenceEntityId?: string;
    reason: string;
    createdByUserId: string;
    now: string;
  }): StockMovement | null {
    const existing = this.db
      .prepare('SELECT * FROM stock_movements WHERE idempotency_key = ?')
      .get(params.idempotencyKey) as Record<string, unknown> | undefined;

    if (existing) {
      return null; // Proteção absoluta contra baixa em duplicidade
    }

    const balanceRow = this.db
      .prepare('SELECT current_quantity FROM stock_balances WHERE product_id = ?')
      .get(params.productId) as { current_quantity?: number } | undefined;

    const currentQty = balanceRow?.current_quantity ?? 0;
    const newBalance = Number((currentQty + params.quantityDelta).toFixed(4));

    this.db
      .prepare(`
        INSERT INTO stock_balances (product_id, current_quantity, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET current_quantity = excluded.current_quantity, updated_at = excluded.updated_at
      `)
      .run(params.productId, newBalance, params.now);

    const movement: StockMovement = {
      id: crypto.randomUUID(),
      idempotencyKey: params.idempotencyKey,
      productId: params.productId,
      productName: params.productName,
      movementType: params.movementType,
      quantityDelta: params.quantityDelta,
      balanceAfter: newBalance,
      unitCostCents: params.unitCostCents,
      originChannel: params.originChannel,
      referenceEntityType: params.referenceEntityType,
      referenceEntityId: params.referenceEntityId,
      reason: params.reason,
      createdByUserId: params.createdByUserId,
      createdAt: params.now
    };

    this.db
      .prepare(`
        INSERT INTO stock_movements (
          id, idempotency_key, product_id, product_name, movement_type, quantity_delta,
          balance_after, unit_cost_cents, origin_channel, reference_entity_type, reference_entity_id,
          reason, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        movement.id,
        movement.idempotencyKey ?? null,
        movement.productId,
        movement.productName,
        movement.movementType,
        movement.quantityDelta,
        movement.balanceAfter,
        movement.unitCostCents ?? null,
        movement.originChannel ?? 'WINDOWS_PDV',
        movement.referenceEntityType ?? null,
        movement.referenceEntityId ?? null,
        movement.reason,
        movement.createdByUserId,
        movement.createdAt
      );

    return movement;
  }

  private enqueueOrderPrintJobsInTx(
    order: Order,
    tabCode?: string,
    productMetaByItemId?: Map<string, CatalogProduct>
  ): PrintJob[] {
    const now = new Date().toISOString();
    const createdPrintJobs: PrintJob[] = [];

    // Agrupa os itens deste pedido pela impressora de destino configurada no produto (ou estação correspondente)
    const itemsByPrinter = new Map<PrintJobTarget, OrderItem[]>();

    for (const item of order.items) {
      if (item.prepStation === 'NONE') continue;
      const product = productMetaByItemId?.get(item.id) ?? this.getProductById(item.productId, true);
      const targetPrinter =
        (product?.targetPrinter as PrintJobTarget | undefined) ??
        this.defaultPrinterForStation(item.prepStation);

      const list = itemsByPrinter.get(targetPrinter) ?? [];
      list.push(item);
      itemsByPrinter.set(targetPrinter, list);
    }

    for (const [targetPrinter, stationItems] of itemsByPrinter.entries()) {
      const stationOrderSlice: Order = {
        ...order,
        items: stationItems
      };

      const printJob: PrintJob = {
        id: crypto.randomUUID(),
        targetPrinter,
        jobType: 'PRODUCTION_TICKET',
        status: 'QUEUED',
        referenceEntityType: 'ORDER',
        referenceEntityId: order.id,
        payloadText: buildEscPosProductionTicket(stationOrderSlice, tabCode),
        attempts: 0,
        lastError: null,
        createdAt: now,
        printedAt: null
      };

      this.db
        .prepare(`
          INSERT INTO print_jobs (
            id, target_printer, job_type, status, reference_entity_type,
            reference_entity_id, payload_text, attempts, last_error, created_at, printed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
        `)
        .run(
          printJob.id,
          printJob.targetPrinter,
          printJob.jobType,
          printJob.status,
          printJob.referenceEntityType,
          printJob.referenceEntityId,
          printJob.payloadText,
          0,
          now
        );

      createdPrintJobs.push(printJob);
    }

    return createdPrintJobs;
  }

  /**
   * Avança o status de um pedido (Seções 14, 15, 16 e 17):
   * - Se o pedido estava em `PENDING_APPROVAL` e passa para `RECEIVED`, compromete o estoque e imprime.
   * - `IN_PREPARATION`: grava `prep_started_at` e atualiza mesa para `EM_ATENDIMENTO`.
   * - `READY`: grava `ready_at`, `waiter_notified_at` e emite alerta em tempo real `ORDER_READY` para o garçom.
   * - `DELIVERED`: grava `delivered_at`, `delivered_by_user_id` e confirma a entrega da notificação.
   * - `CANCELLED`: diferencia os 3 estágios operacionais (Seção 17):
   *   1. `BEFORE_PREP` (`RECEIVED` / `PENDING_APPROVAL`): estorna estoque automaticamente (`REVERSAL_ENTRY`).
   *   2. `DURING_PREP` (`IN_PREPARATION`): exige autorização de Gerente/Proprietário (`tabs:discount_or_void`),
   *      registra perda operacional auditada e NÃO devolve automaticamente insumos já em preparo ao estoque.
   *   3. `AFTER_DELIVERY` (`READY` / `DELIVERED`): exige autorização de Gerente/Proprietário,
   *      ajusta o financeiro da comanda, preserva histórico e NÃO devolve insumos consumidos ao estoque.
   */
  public advanceOrderStatus(input: {
    orderId: string;
    newStatus: OrderStatus;
    originNode: OriginNode;
    reverseStockOnCancel?: boolean;
    cancelReason?: string;
    actorUserId?: string;
    actorRole?: UserRole;
    authorizedByUserId?: string;
    priority?: OrderPriority;
  }): Order {
    const existing = this.getOrderById(input.orderId);
    if (!existing) {
      throw new Error(`Pedido ${input.orderId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;
    const actorUserId = input.actorUserId ?? 'usr-operator-local';

    let cancelStage: OrderCancelStage | null = null;
    if (input.newStatus === 'CANCELLED' && existing.status !== 'CANCELLED') {
      if (existing.status === 'PENDING_APPROVAL' || existing.status === 'RECEIVED') {
        cancelStage = 'BEFORE_PREP';
      } else if (existing.status === 'IN_PREPARATION') {
        cancelStage = 'DURING_PREP';
      } else {
        cancelStage = 'AFTER_DELIVERY';
      }

      if (cancelStage === 'DURING_PREP' || cancelStage === 'AFTER_DELIVERY') {
        if (
          input.actorRole &&
          !hasPermission(input.actorRole, 'tabs:discount_or_void') &&
          !input.authorizedByUserId
        ) {
          throw new Error(
            `Cancelamento de pedido no estágio ${cancelStage} (${existing.status}) exige autorização de Gerente ou Proprietário.`
          );
        }
        if (!input.cancelReason || input.cancelReason.trim().length < 3) {
          throw new Error(
            `Informe obrigatoriamente o motivo do cancelamento para pedido no estágio ${cancelStage}.`
          );
        }
      }
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const prepStartedAt =
        input.newStatus === 'IN_PREPARATION'
          ? (existing.prepStartedAt ?? now)
          : (existing.prepStartedAt ?? null);
      const readyAt =
        input.newStatus === 'READY' ? (existing.readyAt ?? now) : (existing.readyAt ?? null);
      const waiterNotifiedAt =
        input.newStatus === 'READY'
          ? (existing.waiterNotifiedAt ?? now)
          : (existing.waiterNotifiedAt ?? null);
      const deliveredAt =
        input.newStatus === 'DELIVERED'
          ? (existing.deliveredAt ?? now)
          : (existing.deliveredAt ?? null);
      const deliveredByUserId =
        input.newStatus === 'DELIVERED'
          ? actorUserId
          : (existing.deliveredByUserId ?? null);

      this.db
        .prepare(`
          UPDATE orders
          SET status = ?,
              priority = COALESCE(?, priority),
              prep_started_at = ?,
              ready_at = ?,
              waiter_notified_at = ?,
              delivered_at = ?,
              delivered_by_user_id = ?,
              cancel_stage = COALESCE(?, cancel_stage),
              cancel_reason = COALESCE(?, cancel_reason),
              cancelled_by_user_id = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_by_user_id END,
              cancelled_at = CASE WHEN ? = 'CANCELLED' THEN ? ELSE cancelled_at END,
              updated_at = ?,
              version = ?
          WHERE id = ?
        `)
        .run(
          input.newStatus,
          input.priority ?? null,
          prepStartedAt,
          readyAt,
          waiterNotifiedAt,
          deliveredAt,
          deliveredByUserId,
          cancelStage,
          input.cancelReason ?? null,
          input.newStatus,
          actorUserId,
          input.newStatus,
          now,
          now,
          nextVersion,
          input.orderId
        );

      this.db
        .prepare('UPDATE order_items SET status = ? WHERE order_id = ?')
        .run(input.newStatus, input.orderId);

      if (input.newStatus === 'IN_PREPARATION' && existing.tabId) {
        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = 'EM_ATENDIMENTO'
            WHERE active_tab_id = ? AND physical_status IN ('LIVRE', 'OCUPADA', 'AGUARDANDO_PEDIDO')
          `)
          .run(existing.tabId);
      }

      if (input.newStatus === 'DELIVERED') {
        this.db
          .prepare(`
            UPDATE operational_notifications
            SET acknowledged_at = COALESCE(acknowledged_at, ?),
                acknowledged_by_user_id = COALESCE(acknowledged_by_user_id, ?)
            WHERE order_id = ? AND event_type = 'ORDER_READY' AND acknowledged_at IS NULL
          `)
          .run(now, actorUserId, existing.id);
      }

      const updated = this.getOrderById(input.orderId)!;

      // Caso um pedido QR estivesse aguardando aprovação e foi confirmado para RECEIVED
      if (existing.status === 'PENDING_APPROVAL' && input.newStatus === 'RECEIVED') {
        const tab = updated.tabId ? this.getTabById(updated.tabId) : null;
        this.deductOrderStockInTx(updated);
        this.enqueueOrderPrintJobsInTx(updated, tab?.code);
      }

      // Caso o pedido seja CANCELLED: executa estorno auditável de estoque apenas quando BEFORE_PREP (ou quando explicitamente forçado)
      if (input.newStatus === 'CANCELLED' && existing.status !== 'CANCELLED') {
        const shouldReverse =
          input.reverseStockOnCancel !== undefined
            ? input.reverseStockOnCancel
            : cancelStage === 'BEFORE_PREP';

        if (shouldReverse) {
          const originalDeductions = this.getStockMovementsByReference('ORDER', existing.id).filter(
            (m) => m.movementType === 'SALE_DEDUCTION'
          );

          for (const ded of originalDeductions) {
            const revMov = this.recordStockDeltaInTx({
              idempotencyKey: `reversal-order-${existing.id}-mov-${ded.id}`,
              productId: ded.productId,
              productName: ded.productName,
              movementType: 'REVERSAL_ENTRY',
              quantityDelta: Math.abs(ded.quantityDelta),
              originChannel: existing.channel,
              referenceEntityType: 'REVERSAL',
              referenceEntityId: existing.id,
              reason:
                input.cancelReason ??
                `Estorno automático por cancelamento do Pedido #${existing.id.slice(0, 8)} (${cancelStage})`,
              createdByUserId: actorUserId,
              now
            });

            if (revMov) {
              this.db
                .prepare('UPDATE stock_movements SET reversed_by_movement_id = ? WHERE id = ?')
                .run(revMov.id, ded.id);
            }
          }
        }

        this.recordAuditLog({
          actorUserId,
          action: `ORDER_CANCELLED_${cancelStage ?? 'BEFORE_PREP'}`,
          entityType: 'ORDER',
          entityId: existing.id,
          metadata: {
            previousStatus: existing.status,
            cancelStage,
            stockReversed: shouldReverse,
            operationalLossRecorded: !shouldReverse,
            cancelReason: input.cancelReason ?? 'Cancelamento operacional',
            authorizedByUserId: input.authorizedByUserId ?? actorUserId
          }
        });

        if (updated.tabId) {
          this.recalculateTabInTx(updated.tabId, input.originNode);
        }
      }

      this.appendOutboxEvent({
        idempotencyKey: `order-status-${updated.id}-v${updated.version}`,
        originNode: input.originNode,
        entityType: 'ORDER',
        entityId: updated.id,
        operation: 'STATE_TRANSITION',
        entityVersion: updated.version,
        payload: updated
      });

      this.db.exec('COMMIT');

      if (input.newStatus === 'READY' && existing.status !== 'READY') {
        this.createNotification({
          eventType: 'ORDER_READY',
          targetRole: 'WAITER',
          targetUserId: updated.waiterUserId ?? null,
          tableNumber: updated.tableNumber ?? null,
          tabId: updated.tabId ?? null,
          orderId: updated.id,
          title: updated.tableNumber
            ? `Pedido Pronto — Mesa ${String(updated.tableNumber).padStart(2, '0')}`
            : `Pedido Pronto (#${updated.id.slice(0, 6)})`,
          message: `Pronto para entrega: ${updated.items.map((i) => `${i.quantity}x ${i.productName}`).join(', ')}`
        });
      } else if (input.newStatus === 'CANCELLED' && existing.status !== 'CANCELLED') {
        this.createNotification({
          eventType: 'ORDER_CANCELLED',
          tableNumber: updated.tableNumber ?? null,
          tabId: updated.tabId ?? null,
          orderId: updated.id,
          title: `Pedido Cancelado (${cancelStage})`,
          message: `Pedido #${updated.id.slice(0, 6)} cancelado: ${input.cancelReason ?? 'Sem motivo adicional'}`
        });
      }

      return updated;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ============================================================================
  // DESCONTOS, TAXA DE SERVIÇO, DIVISÃO DE CONTA, PAGAMENTOS E ESTORNOS (SEÇÕES 11, 12, 13)
  // ============================================================================

  public applyTabDiscount(input: {
    tabId: string;
    discountType: DiscountType;
    discountCents?: number;
    discountBasisPoints?: number;
    reason: string;
    actorUserId: string;
    actorRole?: UserRole;
    authorizedByUserId?: string;
    originNode?: OriginNode;
  }): Tab {
    if (
      input.actorRole &&
      !hasPermission(input.actorRole, 'tabs:discount_or_void') &&
      !input.authorizedByUserId
    ) {
      throw new Error('Aplicação de desconto ou cortesia exige permissão de Gerente ou Proprietário.');
    }
    if (input.discountType !== 'NONE' && (!input.reason || input.reason.trim().length < 3)) {
      throw new Error('Informe obrigatoriamente o motivo do desconto ou cortesia.');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tab = this.getTabById(input.tabId);
      if (!tab) throw new Error(`Comanda '${input.tabId}' não encontrada.`);
      if (tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
        throw new Error(`Não é permitido alterar desconto em comanda encerrada (${tab.status}).`);
      }

      const grossBeforeDiscount = tab.subtotalCents + tab.serviceFeeCents;
      let resolvedDiscountCents = 0;
      let resolvedDiscountBps = 0;

      if (input.discountType === 'COURTESY') {
        resolvedDiscountCents = grossBeforeDiscount;
        resolvedDiscountBps = 10000;
      } else if (input.discountType === 'PERCENTAGE') {
        resolvedDiscountBps = Math.min(10000, Math.max(0, Math.round(input.discountBasisPoints ?? 0)));
        resolvedDiscountCents = Math.round((grossBeforeDiscount * resolvedDiscountBps) / 10000);
      } else if (input.discountType === 'FIXED_CENTS') {
        resolvedDiscountCents = Math.min(grossBeforeDiscount, Math.max(0, Math.round(input.discountCents ?? 0)));
      }

      const newTotalAfterDiscount = Math.max(0, grossBeforeDiscount - resolvedDiscountCents);
      if (tab.paidCents > 0 && newTotalAfterDiscount < tab.paidCents) {
        throw new Error(
          `Desconto inválido: o novo total da comanda (${newTotalAfterDiscount}c) ficaria menor que o valor já pago (${tab.paidCents}c).`
        );
      }

      this.db
        .prepare(`
          UPDATE tabs
          SET discount_type = ?,
              discount_cents = ?,
              discount_bps = ?,
              discount_reason = ?,
              discount_authorized_by_user_id = ?
          WHERE id = ?
        `)
        .run(
          input.discountType,
          resolvedDiscountCents,
          resolvedDiscountBps,
          input.discountType === 'NONE' ? null : input.reason.trim(),
          input.authorizedByUserId ?? input.actorUserId,
          tab.id
        );

      const updatedTab = this.recalculateTabInTx(tab.id, input.originNode ?? 'WINDOWS_PDV');

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TAB_DISCOUNT_APPLIED',
        entityType: 'TAB',
        entityId: tab.id,
        metadata: {
          discountType: input.discountType,
          discountCents: updatedTab.discountCents,
          discountBasisPoints: resolvedDiscountBps,
          reason: input.reason,
          authorizedByUserId: input.authorizedByUserId ?? input.actorUserId
        }
      });

      this.db.exec('COMMIT');
      return updatedTab;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public configureTabServiceFee(input: {
    tabId: string;
    serviceFeeEnabled: boolean;
    serviceFeeBasisPoints?: number;
    actorUserId: string;
    originNode?: OriginNode;
  }): Tab {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tab = this.getTabById(input.tabId);
      if (!tab) throw new Error(`Comanda '${input.tabId}' não encontrada.`);
      if (tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
        throw new Error(`Não é permitido alterar taxa de serviço em comanda encerrada (${tab.status}).`);
      }

      const nextBps = input.serviceFeeBasisPoints ?? tab.serviceFeeBasisPoints;
      const previewOrders = this.listOrdersByTab(tab.id);
      const previewTotals = calculateTabTotals({
        orders: previewOrders,
        serviceFeeEnabled: input.serviceFeeEnabled,
        serviceFeeBasisPoints: nextBps,
        discountCents: tab.discountCents,
        paidCents: tab.paidCents
      });

      if (tab.paidCents > 0 && previewTotals.totalCents < tab.paidCents) {
        throw new Error(
          `Não é permitido remover a taxa de serviço pois o novo total (${previewTotals.totalCents}c) ficaria menor que os pagamentos já confirmados (${tab.paidCents}c).`
        );
      }

      this.db
        .prepare('UPDATE tabs SET service_fee_enabled = ?, service_fee_bps = ? WHERE id = ?')
        .run(input.serviceFeeEnabled ? 1 : 0, nextBps, tab.id);

      const updatedTab = this.recalculateTabInTx(tab.id, input.originNode ?? 'WINDOWS_PDV');

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TAB_SERVICE_FEE_UPDATED',
        entityType: 'TAB',
        entityId: tab.id,
        metadata: {
          serviceFeeEnabled: input.serviceFeeEnabled,
          serviceFeeBasisPoints: nextBps,
          serviceFeeCents: updatedTab.serviceFeeCents
        }
      });

      this.db.exec('COMMIT');
      return updatedTab;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Divisão de Contas (Seção 11):
   * - Valor livre (`FREE_AMOUNT`)
   * - Partes iguais / por número de pessoas (`EQUAL_SHARES`)
   * - Por itens consumidos (`BY_ITEMS`) sem corromper os pedidos originais
   * - Pagamento misto (`MIXED`)
   */
  public configureTabSplitPlan(input: {
    tabId: string;
    mode: BillSplitPlan['mode'];
    sharesCount?: number;
    itemAllocations?: Array<{
      orderItemId: string;
      quantity: number;
      payerLabel: string;
    }>;
    actorUserId?: string;
  }): {
    tab: Tab;
    splitSummary: {
      mode: BillSplitPlan['mode'];
      totalCents: number;
      paidCents: number;
      remainingCents: number;
      sharesCount: number;
      shareAmountCents: number;
      remainderCents: number;
      itemAllocations: Array<{
        orderItemId: string;
        productName: string;
        quantity: number;
        payerLabel: string;
        amountCents: number;
        alreadyPaidQuantity: number;
      }>;
    };
  } {
    const tab = this.getTabById(input.tabId);
    if (!tab) {
      throw new Error(`Comanda '${input.tabId}' não encontrada.`);
    }

    const orders = this.listOrdersByTab(tab.id).filter((o) => o.status !== 'CANCELLED');
    const allItems = orders.flatMap((o) => o.items).filter((i) => i.status !== 'CANCELLED');

    const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);
    const sharesCount = Math.max(1, input.sharesCount ?? tab.guestsCount ?? 1);
    const shareAmountCents = Math.floor(remainingCents / sharesCount);
    const remainderCents = remainingCents - shareAmountCents * sharesCount;

    const feeMultiplier =
      tab.subtotalCents > 0 ? tab.totalCents / tab.subtotalCents : 1;

    const enrichedAllocations = (input.itemAllocations ?? []).map((alloc) => {
      const foundItem = allItems.find((i) => i.id === alloc.orderItemId);
      if (!foundItem) {
        throw new Error(`Item '${alloc.orderItemId}' não pertence à comanda ${tab.code}.`);
      }
      const paidQty = foundItem.paidQuantity ?? 0;
      const availableQty = Number((foundItem.quantity - paidQty).toFixed(4));
      if (alloc.quantity <= 0 || alloc.quantity > availableQty) {
        throw new Error(
          `Quantidade alocada (${alloc.quantity}) para '${foundItem.productName}' excede o saldo não pago do item (${availableQty}).`
        );
      }
      const unitWithMods = foundItem.unitPriceCents + foundItem.modifiersTotalCents;
      const rawItemSliceCents = Math.round(unitWithMods * alloc.quantity);
      const proportionalTotalCents = Math.round(rawItemSliceCents * feeMultiplier);

      return {
        orderItemId: foundItem.id,
        productName: foundItem.productName,
        quantity: alloc.quantity,
        payerLabel: alloc.payerLabel,
        amountCents: proportionalTotalCents,
        alreadyPaidQuantity: paidQty
      };
    });

    const plan: BillSplitPlan = {
      mode: input.mode,
      sharesCount,
      itemAllocations: enrichedAllocations.map((a) => ({
        orderItemId: a.orderItemId,
        quantity: a.quantity,
        payerLabel: a.payerLabel,
        amountCents: a.amountCents
      })),
      updatedAt: new Date().toISOString()
    };

    this.db
      .prepare('UPDATE tabs SET split_plan_json = ? WHERE id = ?')
      .run(JSON.stringify(plan), tab.id);

    const updatedTab = this.getTabById(tab.id)!;

    return {
      tab: updatedTab,
      splitSummary: {
        mode: input.mode,
        totalCents: updatedTab.totalCents,
        paidCents: updatedTab.paidCents,
        remainingCents,
        sharesCount,
        shareAmountCents,
        remainderCents,
        itemAllocations: enrichedAllocations
      }
    };
  }

  public recordPayment(input: {
    idempotencyKey: string;
    tabId: string;
    method: PaymentMethod;
    confirmationMode?: PaymentConfirmationMode;
    amountCents: number;
    receivedCashCents?: number;
    payerLabel?: string;
    allocatedItems?: Array<{
      orderItemId: string;
      quantity: number;
    }>;
    nsuOrTxId?: string;
    operatorUserId?: string;
    originNode?: OriginNode;
  }): { payment: Payment; tab: Tab; printJob: PrintJob; idempotentReplay: boolean } {
    const existingRow = this.db
      .prepare('SELECT * FROM payments WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as Record<string, unknown> | undefined;

    if (existingRow) {
      const payment = this.mapPaymentRow(existingRow);
      const tab = this.getTabById(payment.tabId)!;
      const printJob = this.getPrintJobsByReference('PAYMENT', payment.id)[0]!;
      return { payment, tab, printJob, idempotentReplay: true };
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tab = this.getTabById(input.tabId);
      if (!tab) {
        throw new Error(`Comanda ${input.tabId} não encontrada para pagamento.`);
      }

      if (tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
        throw new Error(`Comanda ${tab.code} já está encerrada (${tab.status}). Não é permitido novo pagamento.`);
      }

      const remainingBefore = Math.max(0, tab.totalCents - tab.paidCents);
      if (tab.totalCents > 0 && remainingBefore <= 0) {
        throw new Error(
          `Comanda ${tab.code} já está com o saldo integralmente quitado. Pagamento duplicado bloqueado.`
        );
      }

      if (remainingBefore > 0 && input.amountCents > remainingBefore) {
        throw new Error(
          `Valor do pagamento (${input.amountCents} centavos) excede o saldo pendente da comanda (${remainingBefore} centavos).`
        );
      }

      if (input.method === 'CASH' && input.receivedCashCents !== undefined && input.receivedCashCents < input.amountCents) {
        throw new Error(
          `Valor recebido em espécie (${input.receivedCashCents}c) é menor que o valor cobrado no pagamento (${input.amountCents}c).`
        );
      }

      // Valida e marca alocação financeira de itens quando informada (impede que 2 clientes paguem o mesmo item)
      const enrichedAllocatedItems: Array<{
        orderItemId: string;
        quantity: number;
        payerLabel: string;
        amountCents: number;
      }> = [];

      if (input.allocatedItems && input.allocatedItems.length > 0) {
        for (const alloc of input.allocatedItems) {
          const itemRow = this.db
            .prepare('SELECT * FROM order_items WHERE id = ?')
            .get(alloc.orderItemId) as Record<string, unknown> | undefined;
          if (!itemRow) {
            throw new Error(`Item '${alloc.orderItemId}' não encontrado para alocação de pagamento.`);
          }
          const totalQty = Number(itemRow.quantity);
          const paidQty = Number(itemRow.paid_quantity ?? 0);
          const remainingQty = Number((totalQty - paidQty).toFixed(4));
          if (alloc.quantity <= 0 || alloc.quantity > remainingQty) {
            throw new Error(
              `O item '${String(itemRow.product_name)}' já foi pago parcial ou integralmente por outro cliente (Disponível: ${remainingQty}).`
            );
          }

          this.db
            .prepare('UPDATE order_items SET paid_quantity = COALESCE(paid_quantity, 0) + ? WHERE id = ?')
            .run(alloc.quantity, alloc.orderItemId);

          const unitWithMods = Number(itemRow.unit_price_cents) + Number(itemRow.modifiers_total_cents);
          enrichedAllocatedItems.push({
            orderItemId: alloc.orderItemId,
            quantity: alloc.quantity,
            payerLabel: input.payerLabel ?? 'Cliente',
            amountCents: Math.round(unitWithMods * alloc.quantity)
          });
        }
      }

      const activeSession = this.db
        .prepare("SELECT id FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1")
        .get() as { id: string } | undefined;

      if (!activeSession) {
        throw new Error('Não há turno de caixa aberto. Abra o caixa antes de registrar recebimentos.');
      }

      const now = new Date().toISOString();
      const changeCents =
        input.method === 'CASH' && input.receivedCashCents && input.receivedCashCents > input.amountCents
          ? input.receivedCashCents - input.amountCents
          : 0;

      const confirmationMode: PaymentConfirmationMode =
        input.confirmationMode ??
        (input.nsuOrTxId ? 'ELECTRONIC_PROVIDER_CONFIRMED' : 'MANUAL_DECLARED');

      const payment: Payment = {
        id: crypto.randomUUID(),
        tabId: tab.id,
        cashRegisterSessionId: activeSession.id,
        method: input.method,
        confirmationMode,
        status: 'CONFIRMED',
        amountCents: input.amountCents,
        receivedCashCents: input.receivedCashCents,
        changeCents,
        payerLabel: input.payerLabel ?? null,
        allocatedItems: enrichedAllocatedItems.length > 0 ? enrichedAllocatedItems : undefined,
        nsuOrTxId: input.nsuOrTxId,
        idempotencyKey: input.idempotencyKey,
        operatorUserId: input.operatorUserId ?? 'usr-cashier-01',
        createdAt: now
      };

      this.db
        .prepare(`
          INSERT INTO payments (
            id, tab_id, cash_register_session_id, method, confirmation_mode, status,
            amount_cents, received_cash_cents, change_cents, payer_label, allocated_items_json,
            nsu_or_tx_id, idempotency_key, operator_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          payment.id,
          payment.tabId,
          payment.cashRegisterSessionId,
          payment.method,
          confirmationMode,
          payment.status,
          payment.amountCents,
          payment.receivedCashCents ?? null,
          payment.changeCents,
          payment.payerLabel ?? null,
          enrichedAllocatedItems.length > 0 ? JSON.stringify(enrichedAllocatedItems) : null,
          payment.nsuOrTxId ?? null,
          payment.idempotencyKey,
          payment.operatorUserId,
          payment.createdAt
        );

      const updatedTab = this.recalculateTabInTx(tab.id, input.originNode ?? 'WINDOWS_PDV');

      const receiptJob: PrintJob = {
        id: crypto.randomUUID(),
        targetPrinter: 'PRINTER_CASHIER',
        jobType: 'PAYMENT_RECEIPT',
        status: 'QUEUED',
        referenceEntityType: 'PAYMENT',
        referenceEntityId: payment.id,
        payloadText: [
          '================================================',
          '     DECK 26 - HOTEL AUTO POSTO MILLA           ',
          '     COMPROVANTE DE PAGAMENTO DE COMANDA        ',
          '================================================',
          `COMANDA: ${updatedTab.code}`,
          `PAGADOR: ${payment.payerLabel ?? 'Consumidor'}`,
          `METODO:  ${payment.method} (${confirmationMode})`,
          `VALOR:   R$ ${(payment.amountCents / 100).toFixed(2).replace('.', ',')}`,
          `TROCO:   R$ ${(payment.changeCents / 100).toFixed(2).replace('.', ',')}`,
          `SALDO PENDENTE: R$ ${(Math.max(0, updatedTab.totalCents - updatedTab.paidCents) / 100).toFixed(2).replace('.', ',')}`,
          `STATUS COMANDA: ${updatedTab.status}`,
          '================================================'
        ].join('\n'),
        isReprint: false,
        copyNumber: 1,
        attempts: 0,
        lastError: null,
        createdAt: now,
        printedAt: null
      };

      this.db
        .prepare(`
          INSERT INTO print_jobs (
            id, target_printer, job_type, status, reference_entity_type,
            reference_entity_id, payload_text, is_reprint, copy_number,
            attempts, last_error, created_at, printed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, NULL, ?, NULL)
        `)
        .run(
          receiptJob.id,
          receiptJob.targetPrinter,
          receiptJob.jobType,
          receiptJob.status,
          receiptJob.referenceEntityType,
          receiptJob.referenceEntityId,
          receiptJob.payloadText,
          0,
          now
        );

      this.appendOutboxEvent({
        idempotencyKey: `payment-${payment.idempotencyKey}`,
        originNode: input.originNode ?? 'WINDOWS_PDV',
        entityType: 'PAYMENT',
        entityId: payment.id,
        operation: 'APPEND_LEDGER',
        entityVersion: 1,
        payload: payment
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'PAYMENT_CONFIRMED',
        tableNumber: updatedTab.tableNumber ?? null,
        tabId: updatedTab.id,
        title: `Pagamento Confirmado — ${updatedTab.code}`,
        message: `${payment.method}: R$ ${(payment.amountCents / 100).toFixed(2).replace('.', ',')} (Saldo restante: R$ ${(Math.max(0, updatedTab.totalCents - updatedTab.paidCents) / 100).toFixed(2).replace('.', ',')})`
      });

      return { payment, tab: updatedTab, printJob: receiptJob, idempotentReplay: false };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Estorno autorizado de pagamento (Seção 12):
   * - Exige permissão de Gerente ou Proprietário (`tabs:discount_or_void`).
   * - Impede estorno duplicado do mesmo pagamento.
   * - Recalcula o saldo pendente da comanda e reverte eventual alocação de itens pagos.
   */
  public refundPayment(input: {
    paymentId: string;
    reason: string;
    actorUserId: string;
    actorRole?: UserRole;
    authorizedByUserId?: string;
    originNode?: OriginNode;
  }): { payment: Payment; tab: Tab } {
    if (
      input.actorRole &&
      !hasPermission(input.actorRole, 'tabs:discount_or_void') &&
      !input.authorizedByUserId
    ) {
      throw new Error('Estorno de pagamento exige autorização de Gerente ou Proprietário.');
    }
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error('Informe obrigatoriamente o motivo do estorno do pagamento.');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const row = this.db
        .prepare('SELECT * FROM payments WHERE id = ?')
        .get(input.paymentId) as Record<string, unknown> | undefined;

      if (!row) {
        throw new Error(`Pagamento '${input.paymentId}' não encontrado.`);
      }

      const existingPayment = this.mapPaymentRow(row);
      if (existingPayment.status === 'REFUNDED') {
        throw new Error('Este pagamento já foi estornado anteriormente. Estorno em duplicidade bloqueado.');
      }

      const now = new Date().toISOString();
      this.db
        .prepare(`
          UPDATE payments
          SET status = 'REFUNDED',
              refund_reason = ?,
              refunded_by_user_id = ?,
              refunded_at = ?
          WHERE id = ?
        `)
        .run(input.reason.trim(), input.actorUserId, now, existingPayment.id);

      if (existingPayment.allocatedItems && existingPayment.allocatedItems.length > 0) {
        for (const alloc of existingPayment.allocatedItems) {
          this.db
            .prepare(`
              UPDATE order_items
              SET paid_quantity = MAX(0, COALESCE(paid_quantity, 0) - ?)
              WHERE id = ?
            `)
            .run(alloc.quantity, alloc.orderItemId);
        }
      }

      const updatedTab = this.recalculateTabInTx(
        existingPayment.tabId,
        input.originNode ?? 'WINDOWS_PDV'
      );
      const updatedPaymentRow = this.db
        .prepare('SELECT * FROM payments WHERE id = ?')
        .get(existingPayment.id) as Record<string, unknown>;
      const updatedPayment = this.mapPaymentRow(updatedPaymentRow);

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'PAYMENT_REFUNDED',
        entityType: 'PAYMENT',
        entityId: existingPayment.id,
        metadata: {
          tabId: existingPayment.tabId,
          amountCents: existingPayment.amountCents,
          method: existingPayment.method,
          reason: input.reason.trim(),
          authorizedByUserId: input.authorizedByUserId ?? input.actorUserId
        }
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'PAYMENT_REFUNDED',
        tableNumber: updatedTab.tableNumber ?? null,
        tabId: updatedTab.id,
        title: `Pagamento Estornado — ${updatedTab.code}`,
        message: `Estorno de R$ ${(existingPayment.amountCents / 100).toFixed(2).replace('.', ',')} (${existingPayment.method}): ${input.reason.trim()}`
      });

      return { payment: updatedPayment, tab: updatedTab };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Fechamento de Comanda e Liberação de Mesa (Seção 21):
   * - Bloqueia se houver saldo pendente (`remainingCents > 0`).
   * - Bloqueia se houver pedidos ativos em preparo (`IN_PREPARATION` / `PENDING_APPROVAL`).
   * - Passa a comanda para `CLOSED`, preenche `closedAt` e libera todas as mesas vinculadas (`LIVRE` ou `LIMPEZA`).
   * - Preserva a comanda encerrada no histórico; nova abertura da mesma mesa criará nova comanda independente.
   */
  public closeTabAndReleaseTable(input: {
    tabId: string;
    actorUserId: string;
    releaseStatus?: 'LIVRE' | 'LIMPEZA';
    originNode?: OriginNode;
  }): { tab: Tab; releasedTables: DiningTableQr[] } {
    const releaseStatus = input.releaseStatus ?? 'LIVRE';

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const tab = this.recalculateTabInTx(input.tabId, input.originNode ?? 'WINDOWS_PDV');
      if (!tab) {
        throw new Error(`Comanda '${input.tabId}' não encontrada.`);
      }

      const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);
      if (remainingCents > 0) {
        throw new Error(
          `Não é permitido encerrar a comanda ${tab.code} e liberar a mesa: ainda há saldo pendente de R$ ${(remainingCents / 100).toFixed(2).replace('.', ',')}.`
        );
      }

      const tabOrders = this.listOrdersByTab(tab.id);
      const incompatibleActiveOrders = tabOrders.filter(
        (o) => o.status === 'PENDING_APPROVAL' || o.status === 'IN_PREPARATION'
      );
      if (incompatibleActiveOrders.length > 0) {
        throw new Error(
          `Não é permitido encerrar a comanda ${tab.code}: existem ${incompatibleActiveOrders.length} pedido(s) ainda em preparo ou aguardando aprovação.`
        );
      }

      const now = new Date().toISOString();
      this.db
        .prepare(`
          UPDATE tabs
          SET status = 'CLOSED',
              closed_at = COALESCE(closed_at, ?),
              closed_by_user_id = ?,
              version = version + 1
          WHERE id = ?
        `)
        .run(now, input.actorUserId, tab.id);

      const linkedTablesRows = this.db
        .prepare('SELECT table_number FROM dining_tables_qr WHERE active_tab_id = ? OR table_number = ?')
        .all(tab.id, tab.tableNumber ?? -1) as Array<{ table_number: number }>;

      const tableNumbersToRelease = Array.from(
        new Set([
          ...linkedTablesRows.map((r) => Number(r.table_number)),
          ...(tab.joinedTables ?? []),
          ...(tab.tableNumber ? [tab.tableNumber] : [])
        ])
      );

      for (const tblNum of tableNumbersToRelease) {
        this.db
          .prepare(`
            UPDATE dining_tables_qr
            SET physical_status = ?,
                active_tab_id = NULL,
                primary_table_number = NULL,
                joined_group_id = NULL,
                assigned_waiter_user_id = NULL,
                assigned_waiter_name = NULL,
                guests_count = 0,
                opened_at = NULL,
                notes = NULL
            WHERE table_number = ?
          `)
          .run(releaseStatus, tblNum);
      }

      const closedTab = this.getTabById(tab.id)!;
      const releasedTables = tableNumbersToRelease
        .map((n) => this.getDiningTableByNumber(n))
        .filter((t): t is DiningTableQr => t !== null);

      this.recordAuditLog({
        actorUserId: input.actorUserId,
        action: 'TAB_CLOSED_AND_TABLE_RELEASED',
        entityType: 'TAB',
        entityId: closedTab.id,
        metadata: {
          tabCode: closedTab.code,
          totalCents: closedTab.totalCents,
          paidCents: closedTab.paidCents,
          releasedTables: tableNumbersToRelease,
          releaseStatus
        }
      });

      this.appendOutboxEvent({
        idempotencyKey: `tab-close-${closedTab.id}-v${closedTab.version}`,
        originNode: input.originNode ?? 'WINDOWS_PDV',
        entityType: 'TAB',
        entityId: closedTab.id,
        operation: 'STATE_TRANSITION',
        entityVersion: closedTab.version,
        payload: closedTab
      });

      this.db.exec('COMMIT');

      this.createNotification({
        eventType: 'TAB_CLOSED',
        tableNumber: closedTab.tableNumber ?? null,
        tabId: closedTab.id,
        title: `Comanda Encerrada — ${closedTab.code}`,
        message: `Comanda ${closedTab.code} fechada e mesa liberada (${releaseStatus}).`
      });

      return { tab: closedTab, releasedTables };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  private recalculateTabInTx(tabId: string, originNode: OriginNode): Tab {
    const tabRow = this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(tabId) as Record<string, unknown>;
    const currentTab = this.mapTabRow(tabRow);
    const tabOrders = this.listOrdersByTab(tabId);

    const paidRow = this.db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) as paid FROM payments WHERE tab_id = ? AND status = 'CONFIRMED'")
      .get(tabId) as { paid: number };

    const paidCents = Number(paidRow.paid);

    // Recalcula desconto proporcional caso o tipo seja PERCENTAGE ou COURTESY
    const activeOrdersSubtotal = tabOrders
      .filter((o) => o.status !== 'CANCELLED')
      .reduce((acc, o) => acc + o.totalOrderCents, 0);
    const previewServiceFee = currentTab.serviceFeeEnabled
      ? Math.round((activeOrdersSubtotal * currentTab.serviceFeeBasisPoints) / 10000)
      : 0;
    const grossBeforeDiscount = activeOrdersSubtotal + previewServiceFee;

    let effectiveDiscountCents = currentTab.discountCents;
    if (currentTab.discountType === 'COURTESY') {
      effectiveDiscountCents = grossBeforeDiscount;
    } else if (currentTab.discountType === 'PERCENTAGE' && currentTab.discountBasisPoints) {
      effectiveDiscountCents = Math.round((grossBeforeDiscount * currentTab.discountBasisPoints) / 10000);
    } else if (currentTab.discountType === 'NONE') {
      effectiveDiscountCents = 0;
    }

    const totals = calculateTabTotals({
      orders: tabOrders,
      serviceFeeEnabled: currentTab.serviceFeeEnabled,
      serviceFeeBasisPoints: currentTab.serviceFeeBasisPoints,
      discountCents: effectiveDiscountCents,
      paidCents
    });

    let nextStatus = currentTab.status;
    let closedAt = currentTab.closedAt ?? null;

    if (currentTab.status !== 'CANCELLED') {
      if (paidCents > 0 && paidCents < totals.totalCents) {
        nextStatus = 'PARTIALLY_PAID';
        closedAt = null;
      } else if (paidCents === 0 && (currentTab.status === 'PARTIALLY_PAID' || currentTab.status === 'CLOSED')) {
        nextStatus = 'OPEN';
        closedAt = null;
      } else if (totals.totalCents > 0 && paidCents >= totals.totalCents && currentTab.type !== 'TABLE') {
        nextStatus = 'CLOSED';
        closedAt = closedAt ?? new Date().toISOString();
      }
    }

    const nextVersion = currentTab.version + 1;
    this.db
      .prepare(`
        UPDATE tabs
        SET subtotal_cents = ?, service_fee_cents = ?, discount_cents = ?, total_cents = ?,
            paid_cents = ?, status = ?, closed_at = ?, version = ?
        WHERE id = ?
      `)
      .run(
        totals.subtotalCents,
        totals.serviceFeeCents,
        effectiveDiscountCents,
        totals.totalCents,
        paidCents,
        nextStatus,
        closedAt,
        nextVersion,
        tabId
      );

    const updatedTab = this.getTabById(tabId)!;
    this.appendOutboxEvent({
      idempotencyKey: `tab-update-${updatedTab.id}-v${updatedTab.version}`,
      originNode,
      entityType: 'TAB',
      entityId: updatedTab.id,
      operation: 'UPSERT',
      entityVersion: updatedTab.version,
      payload: updatedTab
    });

    return updatedTab;
  }

  // ============================================================================
  // ABERTURA, SANGRIA, SUPRIMENTO E FECHAMENTO DE TURNO DE CAIXA (SEÇÕES 19 E 20)
  // ============================================================================

  public openCashRegisterSession(input: {
    openingBalanceCents: number;
    openedByUserId: string;
    notes?: string;
  }): CashRegisterSession {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const existingOpen = this.db
        .prepare("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1")
        .get() as Record<string, unknown> | undefined;

      if (existingOpen) {
        const existingId = String(existingOpen.id);
        const paymentCount = (
          this.db
            .prepare('SELECT COUNT(*) as total FROM payments WHERE cash_register_session_id = ?')
            .get(existingId) as { total: number }
        ).total;
        const movCount = (
          this.db
            .prepare('SELECT COUNT(*) as total FROM cash_register_movements WHERE session_id = ?')
            .get(existingId) as { total: number }
        ).total;

        // Se for apenas a sessão semente inicial sem nenhuma operação, substitui pelo turno aberto pelo operador
        if (existingId === 'CASH-SESSION-INITIAL' && paymentCount === 0 && movCount === 0) {
          this.db
            .prepare("UPDATE cash_register_sessions SET status = 'CLOSED', closed_at = ? WHERE id = ?")
            .run(new Date().toISOString(), existingId);
        } else {
          throw new Error(
            `Já existe um turno de caixa aberto (${existingId}). Feche o turno atual antes de abrir um novo.`
          );
        }
      }

      const id = `CASH-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      const now = new Date().toISOString();

      this.db
        .prepare(`
          INSERT INTO cash_register_sessions (
            id, opened_by_user_id, opened_at, opening_balance_cents,
            expected_balance_cents, status, notes
          ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
        `)
        .run(
          id,
          input.openedByUserId,
          now,
          input.openingBalanceCents,
          input.openingBalanceCents,
          input.notes ?? null
        );

      this.recordAuditLog({
        actorUserId: input.openedByUserId,
        action: 'CASH_SESSION_OPENED',
        entityType: 'CASH_REGISTER_SESSION',
        entityId: id,
        metadata: {
          openingBalanceCents: input.openingBalanceCents,
          notes: input.notes ?? null
        }
      });

      this.db.exec('COMMIT');
      return this.getCashRegisterSessionById(id)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public recordCashRegisterMovement(input: {
    sessionId?: string;
    movementType: CashRegisterMovement['movementType'];
    amountCents: number;
    reason: string;
    createdByUserId: string;
    authorizedByUserId?: string;
  }): { movement: CashRegisterMovement; session: CashRegisterSession } {
    if (input.amountCents <= 0) {
      throw new Error('O valor da movimentação de caixa deve ser maior que zero.');
    }
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error('Informe o motivo da movimentação de caixa (sangria/suprimento).');
    }

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const sessionRow = input.sessionId
        ? (this.db
            .prepare('SELECT * FROM cash_register_sessions WHERE id = ?')
            .get(input.sessionId) as Record<string, unknown> | undefined)
        : (this.db
            .prepare("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1")
            .get() as Record<string, unknown> | undefined);

      if (!sessionRow || String(sessionRow.status) !== 'OPEN') {
        throw new Error('Não há turno de caixa aberto para registrar sangria ou suprimento.');
      }

      const sessionId = String(sessionRow.id);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      this.db
        .prepare(`
          INSERT INTO cash_register_movements (
            id, session_id, movement_type, amount_cents, reason,
            created_by_user_id, authorized_by_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          sessionId,
          input.movementType,
          input.amountCents,
          input.reason.trim(),
          input.createdByUserId,
          input.authorizedByUserId ?? input.createdByUserId,
          now
        );

      this.recordAuditLog({
        actorUserId: input.createdByUserId,
        action: `CASH_MOVEMENT_${input.movementType}`,
        entityType: 'CASH_REGISTER_SESSION',
        entityId: sessionId,
        metadata: {
          movementId: id,
          movementType: input.movementType,
          amountCents: input.amountCents,
          reason: input.reason.trim()
        }
      });

      this.db.exec('COMMIT');

      const session = this.getCashRegisterSessionById(sessionId)!;
      const movement: CashRegisterMovement = {
        id,
        sessionId,
        movementType: input.movementType,
        amountCents: input.amountCents,
        reason: input.reason.trim(),
        createdByUserId: input.createdByUserId,
        authorizedByUserId: input.authorizedByUserId ?? input.createdByUserId,
        createdAt: now
      };

      this.createNotification({
        eventType: 'CASH_MOVEMENT',
        targetRole: 'CASHIER',
        title: `Caixa: ${input.movementType}`,
        message: `${input.movementType} de R$ ${(input.amountCents / 100).toFixed(2).replace('.', ',')} (${input.reason.trim()})`
      });

      return { movement, session };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public closeCashRegisterSession(input: {
    sessionId?: string;
    countedCashCents: number;
    closedByUserId: string;
    notes?: string;
  }): CashRegisterSession {
    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const sessionRow = input.sessionId
        ? (this.db
            .prepare('SELECT * FROM cash_register_sessions WHERE id = ?')
            .get(input.sessionId) as Record<string, unknown> | undefined)
        : (this.db
            .prepare("SELECT * FROM cash_register_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1")
            .get() as Record<string, unknown> | undefined);

      if (!sessionRow || String(sessionRow.status) !== 'OPEN') {
        throw new Error('Turno de caixa não encontrado ou já encerrado.');
      }

      const sessionId = String(sessionRow.id);
      const currentSession = this.getCashRegisterSessionById(sessionId)!;
      const expectedCashCents = currentSession.expectedCashCents;
      const differenceCents = input.countedCashCents - expectedCashCents;
      const now = new Date().toISOString();

      this.db
        .prepare(`
          UPDATE cash_register_sessions
          SET closed_by_user_id = ?,
              closed_at = ?,
              expected_balance_cents = ?,
              counted_balance_cents = ?,
              difference_cents = ?,
              status = 'CLOSED',
              notes = COALESCE(?, notes)
          WHERE id = ?
        `)
        .run(
          input.closedByUserId,
          now,
          expectedCashCents,
          input.countedCashCents,
          differenceCents,
          input.notes ?? null,
          sessionId
        );

      this.recordAuditLog({
        actorUserId: input.closedByUserId,
        action: 'CASH_SESSION_CLOSED',
        entityType: 'CASH_REGISTER_SESSION',
        entityId: sessionId,
        metadata: {
          openingBalanceCents: currentSession.openingBalanceCents,
          expectedCashCents,
          countedCashCents: input.countedCashCents,
          differenceCents,
          notes: input.notes ?? null
        }
      });

      this.db.exec('COMMIT');
      return this.getCashRegisterSessionById(sessionId)!;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getCashRegisterSessionById(sessionId: string): CashRegisterSession | null {
    const row = this.db
      .prepare('SELECT * FROM cash_register_sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapCashSessionRow(row);
  }

  public getCashierOperationalSummary(): {
    activeSession: CashRegisterSession | null;
    recentSessions: CashRegisterSession[];
    movements: CashRegisterMovement[];
    financialSummary: {
      registeredSalesCents: number;
      actualReceivedTotalCents: number;
      receivedByMethod: Record<PaymentMethod, number>;
      receivedByConfirmationMode: Record<PaymentConfirmationMode, number>;
      totalChangeGivenCents: number;
      totalRefundedCents: number;
      totalDiscountsCents: number;
      totalServiceFeesCents: number;
      pendingReceivablesCents: number;
      openTabsCount: number;
      partiallyPaidTabsCount: number;
      closedTabsCount: number;
    };
  } {
    const sessionRows = this.db
      .prepare('SELECT * FROM cash_register_sessions ORDER BY opened_at DESC LIMIT 20')
      .all() as Array<Record<string, unknown>>;

    const recentSessions = sessionRows.map((r) => this.mapCashSessionRow(r));
    const activeSession = recentSessions.find((s) => s.status === 'OPEN') ?? null;

    const targetSessionId = activeSession?.id ?? recentSessions[0]?.id ?? '';
    const movRows = targetSessionId
      ? (this.db
          .prepare('SELECT * FROM cash_register_movements WHERE session_id = ? ORDER BY created_at DESC')
          .all(targetSessionId) as Array<Record<string, unknown>>)
      : [];

    const movements: CashRegisterMovement[] = movRows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      movementType: r.movement_type as CashRegisterMovement['movementType'],
      amountCents: Number(r.amount_cents),
      reason: String(r.reason),
      createdByUserId: String(r.created_by_user_id),
      authorizedByUserId: r.authorized_by_user_id ? String(r.authorized_by_user_id) : null,
      createdAt: String(r.created_at)
    }));

    const allTabs = this.listTabs();
    const allPayments = this.listPayments();

    const nonCancelledTabs = allTabs.filter((t) => t.status !== 'CANCELLED');
    const registeredSalesCents = nonCancelledTabs.reduce((acc, t) => acc + t.totalCents, 0);
    const totalDiscountsCents = nonCancelledTabs.reduce((acc, t) => acc + t.discountCents, 0);
    const totalServiceFeesCents = nonCancelledTabs.reduce((acc, t) => acc + t.serviceFeeCents, 0);
    const pendingReceivablesCents = nonCancelledTabs
      .filter((t) => t.status !== 'CLOSED')
      .reduce((acc, t) => acc + Math.max(0, t.totalCents - t.paidCents), 0);

    const confirmedPayments = allPayments.filter((p) => p.status === 'CONFIRMED');
    const refundedPayments = allPayments.filter((p) => p.status === 'REFUNDED');

    const receivedByMethod: Record<PaymentMethod, number> = {
      CASH: 0,
      PIX: 0,
      CREDIT_CARD: 0,
      DEBIT_CARD: 0,
      ROOM_CHARGE: 0,
      VOUCHER: 0
    };
    const receivedByConfirmationMode: Record<PaymentConfirmationMode, number> = {
      MANUAL_DECLARED: 0,
      ELECTRONIC_PROVIDER_CONFIRMED: 0
    };

    let actualReceivedTotalCents = 0;
    let totalChangeGivenCents = 0;

    for (const p of confirmedPayments) {
      actualReceivedTotalCents += p.amountCents;
      receivedByMethod[p.method] = (receivedByMethod[p.method] ?? 0) + p.amountCents;
      const mode = p.confirmationMode ?? 'MANUAL_DECLARED';
      receivedByConfirmationMode[mode] = (receivedByConfirmationMode[mode] ?? 0) + p.amountCents;
      if (p.method === 'CASH') {
        totalChangeGivenCents += p.changeCents;
      }
    }

    const totalRefundedCents = refundedPayments.reduce((acc, p) => acc + p.amountCents, 0);

    return {
      activeSession,
      recentSessions,
      movements,
      financialSummary: {
        registeredSalesCents,
        actualReceivedTotalCents,
        receivedByMethod,
        receivedByConfirmationMode,
        totalChangeGivenCents,
        totalRefundedCents,
        totalDiscountsCents,
        totalServiceFeesCents,
        pendingReceivablesCents,
        openTabsCount: allTabs.filter((t) => t.status === 'OPEN' || t.status === 'BILL_REQUESTED').length,
        partiallyPaidTabsCount: allTabs.filter((t) => t.status === 'PARTIALLY_PAID').length,
        closedTabsCount: allTabs.filter((t) => t.status === 'CLOSED').length
      }
    };
  }

  public getTabById(tabId: string): Tab | null {
    const row = this.db.prepare('SELECT * FROM tabs WHERE id = ?').get(tabId) as Record<string, unknown> | undefined;
    return row ? this.mapTabRow(row) : null;
  }

  public listTabs(): Tab[] {
    const rows = this.db
      .prepare('SELECT * FROM tabs ORDER BY opened_at DESC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapTabRow(r));
  }

  public getOrderById(orderId: string): Order | null {
    const row = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapOrderWithItems(row);
  }

  public listOrders(): Order[] {
    const rows = this.db
      .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOrderWithItems(r));
  }

  public listOrdersByTab(tabId: string): Order[] {
    const rows = this.db
      .prepare('SELECT * FROM orders WHERE tab_id = ? ORDER BY created_at ASC')
      .all(tabId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOrderWithItems(r));
  }

  public listPayments(): Payment[] {
    const rows = this.db
      .prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPaymentRow(r));
  }

  public listPrintJobs(): PrintJob[] {
    const rows = this.db
      .prepare('SELECT * FROM print_jobs ORDER BY created_at DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPrintJobRow(r));
  }

  /**
   * Atualiza o estado de um trabalho de impressão térmica (Seção 18):
   * Suporta `PENDING`, `QUEUED`, `SENDING`, `PRINTED`, `FAILED`, `UNKNOWN_OUTCOME`, `CANCELLED`.
   * Quando um trabalho entra em `UNKNOWN_OUTCOME` (ex.: queda de energia/rede durante o envio do buffer),
   * bloqueia reenvio cego automático para impedir duplicidade física na cozinha, exigindo decisão do operador
   * (confirmar que saiu na impressora ou acionar `reprintJob` com marcação explícita de 2ª via).
   */
  public updatePrintJobStatus(input: {
    jobId: string;
    status: PrintJobStatus;
    errorMsg?: string;
    actorUserId?: string;
  }): PrintJob {
    const row = this.db
      .prepare('SELECT * FROM print_jobs WHERE id = ?')
      .get(input.jobId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Trabalho de impressão '${input.jobId}' não encontrado.`);
    }

    const currentStatus = String(row.status) as PrintJobStatus;
    if (
      currentStatus === 'UNKNOWN_OUTCOME' &&
      (input.status === 'SENDING' || input.status === 'PENDING' || input.status === 'QUEUED')
    ) {
      throw new Error(
        'Trabalho de impressão com resultado desconhecido (UNKNOWN_OUTCOME) não pode ser reenviado automaticamente sem verificação. Confirme a saída ou solicite Reimpressão Autorizada (2ª via).'
      );
    }

    const now = new Date().toISOString();
    const shouldIncrementAttempts =
      input.status === 'SENDING' ||
      input.status === 'PRINTED' ||
      input.status === 'FAILED' ||
      input.status === 'UNKNOWN_OUTCOME';

    this.db
      .prepare(`
        UPDATE print_jobs
        SET status = ?,
            attempts = CASE WHEN ? = 1 THEN attempts + 1 ELSE attempts END,
            last_error = COALESCE(?, last_error),
            printed_at = CASE WHEN ? = 'PRINTED' THEN ? ELSE printed_at END
        WHERE id = ?
      `)
      .run(
        input.status,
        shouldIncrementAttempts ? 1 : 0,
        input.errorMsg ?? null,
        input.status,
        now,
        input.jobId
      );

    if (input.status === 'FAILED' || input.status === 'UNKNOWN_OUTCOME') {
      this.createNotification({
        eventType: 'PRINT_FAILED',
        title: `Alerta de Impressora (${String(row.target_printer)})`,
        message: `Status ${input.status}: ${input.errorMsg ?? 'Falha ou resultado desconhecido na comunicação com a impressora.'}`
      });
    }

    const updated = this.db
      .prepare('SELECT * FROM print_jobs WHERE id = ?')
      .get(input.jobId) as Record<string, unknown>;
    return this.mapPrintJobRow(updated);
  }

  public markPrintJobPrinted(jobId: string): PrintJob {
    return this.updatePrintJobStatus({ jobId, status: 'PRINTED' });
  }

  public reprintJob(jobId: string, actorUserId: string): PrintJob {
    const row = this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Trabalho de impressão '${jobId}' não encontrado.`);
    }
    const now = new Date().toISOString();
    const nextCopyNumber = Number(row.copy_number ?? 1) + 1;
    const rawPayload = String(row.payload_text);
    const reprintBanner = `*** 2a VIA / REIMPRESSAO AUTORIZADA (COPIA #${nextCopyNumber}) ***`;
    const cleanPayloadWithoutOldBanner = rawPayload
      .split('\n')
      .filter((line) => !line.includes('2a VIA / REIMPRESSAO AUTORIZADA'))
      .join('\n');
    const updatedPayload = `${reprintBanner}\n${cleanPayloadWithoutOldBanner}`;

    this.db
      .prepare(`
        UPDATE print_jobs
        SET status = 'QUEUED',
            is_reprint = 1,
            copy_number = ?,
            reprint_authorized_by_user_id = ?,
            payload_text = ?,
            attempts = attempts + 1,
            last_error = ?
        WHERE id = ?
      `)
      .run(
        nextCopyNumber,
        actorUserId,
        updatedPayload,
        `Reimpressão (Cópia #${nextCopyNumber}) autorizada por ${actorUserId} em ${now}`,
        jobId
      );

    this.recordAuditLog({
      actorUserId,
      action: 'PRINT_JOB_REPRINTED',
      entityType: 'PRINT_JOB',
      entityId: jobId,
      metadata: {
        copyNumber: nextCopyNumber,
        targetPrinter: String(row.target_printer),
        previousStatus: String(row.status)
      }
    });

    const updated = this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
    return this.mapPrintJobRow(updated);
  }

  public getPrintJobsByReference(refType: string, refId: string): PrintJob[] {
    const rows = this.db
      .prepare('SELECT * FROM print_jobs WHERE reference_entity_type = ? AND reference_entity_id = ?')
      .all(refType, refId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPrintJobRow(r));
  }

  public getProductStockQuantity(productId: string): number {
    const row = this.db
      .prepare('SELECT current_quantity FROM stock_balances WHERE product_id = ?')
      .get(productId) as { current_quantity?: number } | undefined;
    return Number(row?.current_quantity ?? 0);
  }

  public listStockBalancesAndMovements(): {
    balances: Array<{
      productId: string;
      productName: string;
      sku: string;
      currentQuantity: number;
      minStockQuantity: number;
      lowStockAlert: boolean;
      updatedAt: string;
    }>;
    recentMovements: StockMovement[];
  } {
    const balancesRows = this.db
      .prepare(`
        SELECT b.product_id, p.name as product_name, p.sku, b.current_quantity,
               p.min_stock_quantity, b.updated_at
        FROM stock_balances b
        JOIN catalog_products p ON p.id = b.product_id
        ORDER BY p.name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const movRows = this.db
      .prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 150')
      .all() as Array<Record<string, unknown>>;

    return {
      balances: balancesRows.map((r) => {
        const currentQuantity = Number(r.current_quantity);
        const minStockQuantity = Number(r.min_stock_quantity ?? 5);
        return {
          productId: String(r.product_id),
          productName: String(r.product_name),
          sku: String(r.sku),
          currentQuantity,
          minStockQuantity,
          lowStockAlert: currentQuantity <= minStockQuantity,
          updatedAt: String(r.updated_at)
        };
      }),
      recentMovements: movRows.map((r) => this.mapStockMovementRow(r))
    };
  }

  public adjustStock(input: {
    idempotencyKey?: string;
    productId: string;
    quantityDelta: number;
    movementType: StockMovement['movementType'];
    unitCostCents?: number;
    originChannel?: string;
    reason: string;
    userId?: string;
  }): { movement: StockMovement; idempotentReplay: boolean } {
    if (input.idempotencyKey) {
      const existing = this.db
        .prepare('SELECT * FROM stock_movements WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as Record<string, unknown> | undefined;

      if (existing) {
        return { movement: this.mapStockMovementRow(existing), idempotentReplay: true };
      }
    }

    const prod = this.db
      .prepare('SELECT id, name FROM catalog_products WHERE id = ?')
      .get(input.productId) as { id: string; name: string } | undefined;

    if (!prod) {
      throw new Error(`Produto ${input.productId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const idemKey = input.idempotencyKey ?? `manual-stock-${crypto.randomUUID()}`;

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const mov = this.recordStockDeltaInTx({
        idempotencyKey: idemKey,
        productId: prod.id,
        productName: prod.name,
        movementType: input.movementType,
        quantityDelta: input.quantityDelta,
        unitCostCents: input.unitCostCents,
        originChannel: input.originChannel ?? 'WINDOWS_PDV',
        referenceEntityType: 'MANUAL_AUDIT',
        reason: input.reason,
        createdByUserId: input.userId ?? 'usr-manager-local',
        now
      })!;

      if (input.unitCostCents !== undefined && input.movementType === 'PURCHASE_ENTRY') {
        this.db
          .prepare('UPDATE catalog_products SET cost_price_cents = ?, updated_at = ? WHERE id = ?')
          .run(input.unitCostCents, now, prod.id);
      }

      this.appendOutboxEvent({
        idempotencyKey: `stock-mov-${mov.id}`,
        originNode: 'WINDOWS_PDV',
        entityType: 'STOCK_MOVEMENT',
        entityId: mov.id,
        operation: 'APPEND_LEDGER',
        entityVersion: 1,
        payload: mov
      });

      this.db.exec('COMMIT');
      return { movement: mov, idempotentReplay: false };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public reverseStockMovement(input: {
    movementId: string;
    reason: string;
    userId: string;
  }): StockMovement {
    const row = this.db
      .prepare('SELECT * FROM stock_movements WHERE id = ?')
      .get(input.movementId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Movimentação de estoque '${input.movementId}' não encontrada.`);
    }
    if (row.reversed_by_movement_id) {
      throw new Error(`A movimentação '${input.movementId}' já foi estornada anteriormente.`);
    }

    const original = this.mapStockMovementRow(row);
    const now = new Date().toISOString();

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      const reversal = this.recordStockDeltaInTx({
        idempotencyKey: `reversal-mov-${original.id}`,
        productId: original.productId,
        productName: original.productName,
        movementType: 'REVERSAL_ENTRY',
        quantityDelta: -original.quantityDelta,
        originChannel: 'WINDOWS_PDV',
        referenceEntityType: 'REVERSAL',
        referenceEntityId: original.id,
        reason: `Estorno da mov. #${original.id.slice(0, 8)}: ${input.reason}`,
        createdByUserId: input.userId,
        now
      })!;

      this.db
        .prepare('UPDATE stock_movements SET reversed_by_movement_id = ? WHERE id = ?')
        .run(reversal.id, original.id);

      this.db.exec('COMMIT');
      return reversal;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  public getStockMovementsByReference(refType: string, refId: string): StockMovement[] {
    const rows = this.db
      .prepare('SELECT * FROM stock_movements WHERE reference_entity_type = ? AND reference_entity_id = ?')
      .all(refType, refId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapStockMovementRow(r));
  }

  public listHotelRooms(): HotelRoom[] {
    const rows = this.db
      .prepare('SELECT * FROM hotel_rooms ORDER BY number ASC')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      number: String(r.number),
      category: r.category as HotelRoom['category'],
      dailyRateCents: Number(r.daily_rate_cents),
      status: r.status as HotelRoom['status'],
      currentGuestName: r.current_guest_name ? String(r.current_guest_name) : null,
      activeTabId: r.active_tab_id ? String(r.active_tab_id) : null,
      updatedAt: String(r.updated_at)
    }));
  }

  public checkInHotelRoom(input: { roomNumber: string; guestName: string }): { room: HotelRoom; folioTab: Tab } {
    const roomRow = this.db
      .prepare('SELECT * FROM hotel_rooms WHERE number = ?')
      .get(input.roomNumber) as Record<string, unknown> | undefined;

    if (!roomRow) {
      throw new Error(`Apartamento ${input.roomNumber} não cadastrado.`);
    }

    const folioTab = this.openOrGetTab({
      code: `APTO-${input.roomNumber}`,
      type: 'HOTEL_FOLIO',
      customerName: input.guestName,
      openedByUserId: 'usr-reception'
    });

    const now = new Date().toISOString();
    this.db
      .prepare(`
        UPDATE hotel_rooms
        SET status = 'OCCUPIED', current_guest_name = ?, active_tab_id = ?, updated_at = ?
        WHERE number = ?
      `)
      .run(input.guestName, folioTab.id, now, input.roomNumber);

    const updatedRooms = this.listHotelRooms();
    const room = updatedRooms.find((r) => r.number === input.roomNumber)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-checkin-${room.number}-${folioTab.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_ROOM',
      entityId: room.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: room
    });

    return { room, folioTab };
  }

  private appendOutboxEvent(params: {
    idempotencyKey: string;
    originNode: OriginNode;
    entityType: SyncOutboxEvent['entityType'];
    entityId: string;
    operation: SyncOutboxEvent['operation'];
    entityVersion: number;
    payload: unknown;
  }): SyncOutboxEvent {
    const now = new Date().toISOString();
    const payloadJson = JSON.stringify(params.payload);
    const checksumSha256 = crypto.createHash('sha256').update(payloadJson).digest('hex');

    const existing = this.db
      .prepare('SELECT * FROM sync_outbox_events WHERE idempotency_key = ?')
      .get(params.idempotencyKey) as Record<string, unknown> | undefined;

    if (existing) {
      return this.mapOutboxRow(existing);
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(`
        INSERT INTO sync_outbox_events (
          id, idempotency_key, origin_node, entity_type, entity_id,
          operation, entity_version, hlc_timestamp, payload_json, checksum_sha256,
          status, retry_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)
      `)
      .run(
        id,
        params.idempotencyKey,
        params.originNode,
        params.entityType,
        params.entityId,
        params.operation,
        params.entityVersion,
        now,
        payloadJson,
        checksumSha256,
        now
      );

    return {
      id,
      idempotencyKey: params.idempotencyKey,
      originNode: params.originNode,
      entityType: params.entityType,
      entityId: params.entityId,
      operation: params.operation,
      entityVersion: params.entityVersion,
      hlcTimestamp: now,
      payloadJson,
      checksumSha256,
      status: 'PENDING',
      retryCount: 0,
      createdAt: now
    };
  }

  public listPendingSyncEvents(limit: number = 50): SyncOutboxEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM sync_outbox_events WHERE status IN ('PENDING', 'FAILED_RETRY') ORDER BY created_at ASC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOutboxRow(r));
  }

  public listAllSyncEvents(limit: number = 100): SyncOutboxEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_outbox_events ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapOutboxRow(r));
  }

  public acknowledgeSyncEvents(eventIds: string[]): void {
    if (eventIds.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE sync_outbox_events SET status = 'ACKED', synced_at = ? WHERE id = ?"
    );
    for (const id of eventIds) {
      stmt.run(now, id);
    }
  }

  public applyRemoteSyncEvent(event: SyncOutboxEvent): { applied: boolean; duplicate: boolean } {
    const alreadyApplied = this.db
      .prepare('SELECT idempotency_key FROM sync_inbox_applied WHERE idempotency_key = ?')
      .get(event.idempotencyKey) as { idempotency_key?: string } | undefined;

    if (alreadyApplied) {
      return { applied: false, duplicate: true };
    }

    const now = new Date().toISOString();
    const payload = JSON.parse(event.payloadJson);

    if (event.entityType === 'ORDER' && payload.items) {
      this.createOrder({
        idempotencyKey: event.idempotencyKey,
        channel: payload.channel ?? 'QR_TABLE',
        originNode: event.originNode,
        tableNumber: payload.tableNumber ?? null,
        customerNotes: payload.customerNotes,
        items: payload.items.map((item: OrderItem) => ({
          productId: item.productId,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: item.modifiers
        }))
      });
    } else if (event.entityType === 'CATALOG_PRODUCT' && payload.id) {
      this.updateCatalogProduct(payload.id, {
        priceCents: payload.priceCents,
        name: payload.name,
        active: payload.active
      });
    }

    this.db
      .prepare(`
        INSERT INTO sync_inbox_applied (idempotency_key, event_id, origin_node, entity_type, entity_id, applied_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(event.idempotencyKey, event.id, event.originNode, event.entityType, event.entityId, now);

    return { applied: true, duplicate: false };
  }

  private mapCategoryRow(r: Record<string, unknown>): CatalogCategory {
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      description: r.description ? String(r.description) : '',
      imageUrl: r.image_url ? String(r.image_url) : null,
      sortOrder: Number(r.sort_order),
      availableChannels: r.available_channels_json
        ? JSON.parse(String(r.available_channels_json))
        : ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM'],
      active: Boolean(r.active),
      updatedAt: r.updated_at ? String(r.updated_at) : undefined
    };
  }

  private mapProductRow(r: Record<string, unknown>): CatalogProduct {
    const channelPricesRaw = r.channel_prices_json ? JSON.parse(String(r.channel_prices_json)) : {};
    return {
      id: String(r.id),
      sku: String(r.sku),
      barcode: r.barcode ? String(r.barcode) : null,
      categoryId: String(r.category_id),
      subcategory: r.subcategory ? String(r.subcategory) : '',
      name: String(r.name),
      description: String(r.description),
      imageUrl: r.image_url ? String(r.image_url) : null,
      unitOfMeasure: r.unit_of_measure ? String(r.unit_of_measure) : 'UN',
      priceCents: Number(r.price_cents),
      costPriceCents: Number(r.cost_price_cents ?? 0),
      channelPricesCents: Object.keys(channelPricesRaw).length > 0 ? channelPricesRaw : undefined,
      availableChannels: JSON.parse(String(r.available_channels_json)),
      prepStation: r.prep_station as CatalogProduct['prepStation'],
      targetPrinter: r.target_printer
        ? String(r.target_printer)
        : this.defaultPrinterForStation(r.prep_station as CatalogProduct['prepStation']),
      prepTimeMinutes: Number(r.prep_time_minutes ?? 15),
      trackStock: Boolean(r.track_stock),
      minStockQuantity: Number(r.min_stock_quantity ?? 5),
      outOfStockPolicy: (r.out_of_stock_policy as OutOfStockPolicy) ?? 'BLOCK_SALE',
      modifierGroups: JSON.parse(String(r.modifier_groups_json)),
      internalNotes: r.internal_notes ? String(r.internal_notes) : '',
      ncm: r.ncm ? String(r.ncm) : undefined,
      cest: r.cest ? String(r.cest) : undefined,
      cfop: r.cfop ? String(r.cfop) : undefined,
      merchandiseOrigin: r.merchandise_origin ? String(r.merchandise_origin) : '0',
      taxProfile: r.tax_profile ? String(r.tax_profile) : 'REVISAO_CONTABIL_PENDENTE',
      dataSource: (r.data_source as CatalogProduct['dataSource']) ?? 'OFFICIAL_MENU',
      active: Boolean(r.active),
      createdAt: r.created_at ? String(r.created_at) : String(r.updated_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapRecipeWithItems(r: Record<string, unknown>): ProductRecipe {
    const recipeId = String(r.id);
    const itemsRows = this.db
      .prepare('SELECT * FROM product_recipe_items WHERE recipe_id = ?')
      .all(recipeId) as Array<Record<string, unknown>>;

    return {
      id: recipeId,
      productId: String(r.product_id),
      version: Number(r.version),
      status: r.status as ProductRecipe['status'],
      yieldQuantity: Number(r.yield_quantity),
      estimatedCostCents: Number(r.estimated_cost_cents),
      notes: r.notes ? String(r.notes) : '',
      approvedByUserId: r.approved_by_user_id ? String(r.approved_by_user_id) : null,
      items: itemsRows.map((ir) => ({
        id: String(ir.id),
        recipeId,
        ingredientProductId: String(ir.ingredient_product_id),
        ingredientName: String(ir.ingredient_name),
        quantityUsed: Number(ir.quantity_used),
        unitOfMeasure: String(ir.unit_of_measure),
        unitCostCents: Number(ir.unit_cost_cents)
      })),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapDiningTableRow(r: Record<string, unknown>): DiningTableQr {
    return {
      tableNumber: Number(r.table_number),
      qrToken: String(r.qr_token),
      label: String(r.label),
      requiresOperatorApproval: Boolean(r.requires_operator_approval),
      active: Boolean(r.active),
      physicalStatus: (r.physical_status as TablePhysicalStatus) ?? 'LIVRE',
      activeTabId: r.active_tab_id ? String(r.active_tab_id) : null,
      primaryTableNumber:
        r.primary_table_number !== null && r.primary_table_number !== undefined
          ? Number(r.primary_table_number)
          : null,
      joinedGroupId: r.joined_group_id ? String(r.joined_group_id) : null,
      assignedWaiterUserId: r.assigned_waiter_user_id ? String(r.assigned_waiter_user_id) : null,
      assignedWaiterName: r.assigned_waiter_name ? String(r.assigned_waiter_name) : null,
      guestsCount: Number(r.guests_count ?? 0),
      openedAt: r.opened_at ? String(r.opened_at) : null,
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at)
    };
  }

  private mapTabRow(r: Record<string, unknown>): Tab {
    const joinedTables = r.joined_tables_json
      ? (JSON.parse(String(r.joined_tables_json)) as number[])
      : [];
    const splitPlan = r.split_plan_json
      ? (JSON.parse(String(r.split_plan_json)) as BillSplitPlan)
      : null;

    return {
      id: String(r.id),
      code: String(r.code),
      type: r.type as Tab['type'],
      status: r.status as Tab['status'],
      tableNumber: r.table_number !== null && r.table_number !== undefined ? Number(r.table_number) : null,
      hotelReservationId: r.hotel_reservation_id ? String(r.hotel_reservation_id) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      guestsCount: Number(r.guests_count),
      waiterUserId: r.waiter_user_id ? String(r.waiter_user_id) : null,
      waiterName: r.waiter_name ? String(r.waiter_name) : null,
      notes: r.notes ? String(r.notes) : null,
      joinedTables,
      serviceFeeEnabled: Boolean(r.service_fee_enabled),
      serviceFeeBasisPoints: Number(r.service_fee_bps),
      subtotalCents: Number(r.subtotal_cents),
      serviceFeeCents: Number(r.service_fee_cents),
      discountType: (r.discount_type as DiscountType) ?? 'NONE',
      discountCents: Number(r.discount_cents),
      discountBasisPoints: Number(r.discount_bps ?? 0),
      discountReason: r.discount_reason ? String(r.discount_reason) : null,
      discountAuthorizedByUserId: r.discount_authorized_by_user_id
        ? String(r.discount_authorized_by_user_id)
        : null,
      totalCents: Number(r.total_cents),
      paidCents: Number(r.paid_cents),
      splitPlan,
      openedByUserId: String(r.opened_by_user_id),
      closedByUserId: r.closed_by_user_id ? String(r.closed_by_user_id) : null,
      openedAt: String(r.opened_at),
      closedAt: r.closed_at ? String(r.closed_at) : null,
      version: Number(r.version)
    };
  }

  private mapOrderWithItems(r: Record<string, unknown>): Order {
    const orderId = String(r.id);
    const itemRows = this.db
      .prepare('SELECT * FROM order_items WHERE order_id = ?')
      .all(orderId) as Array<Record<string, unknown>>;

    return {
      id: orderId,
      tabId: r.tab_id ? String(r.tab_id) : null,
      channel: r.channel as Order['channel'],
      originNode: r.origin_node as Order['originNode'],
      idempotencyKey: String(r.idempotency_key),
      status: r.status as Order['status'],
      priority: (r.priority as OrderPriority) ?? 'NORMAL',
      waiterUserId: r.waiter_user_id ? String(r.waiter_user_id) : null,
      waiterName: r.waiter_name ? String(r.waiter_name) : null,
      tableNumber: r.table_number !== null && r.table_number !== undefined ? Number(r.table_number) : null,
      customerNotes: r.customer_notes ? String(r.customer_notes) : undefined,
      prepStartedAt: r.prep_started_at ? String(r.prep_started_at) : null,
      readyAt: r.ready_at ? String(r.ready_at) : null,
      deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
      deliveredByUserId: r.delivered_by_user_id ? String(r.delivered_by_user_id) : null,
      waiterNotifiedAt: r.waiter_notified_at ? String(r.waiter_notified_at) : null,
      cancelStage: r.cancel_stage ? (r.cancel_stage as OrderCancelStage) : null,
      cancelReason: r.cancel_reason ? String(r.cancel_reason) : null,
      cancelledByUserId: r.cancelled_by_user_id ? String(r.cancelled_by_user_id) : null,
      cancelledAt: r.cancelled_at ? String(r.cancelled_at) : null,
      items: itemRows.map((ir) => ({
        id: String(ir.id),
        orderId,
        productId: String(ir.product_id),
        productName: String(ir.product_name),
        prepStation: ir.prep_station as OrderItem['prepStation'],
        quantity: Number(ir.quantity),
        unitPriceCents: Number(ir.unit_price_cents),
        modifiersTotalCents: Number(ir.modifiers_total_cents),
        totalItemCents: Number(ir.total_item_cents),
        notes: ir.notes ? String(ir.notes) : undefined,
        modifiers: JSON.parse(String(ir.modifiers_json)),
        status: ir.status as OrderItem['status'],
        transferredFromTabId: ir.transferred_from_tab_id ? String(ir.transferred_from_tab_id) : null,
        transferredFromOrderId: ir.transferred_from_order_id ? String(ir.transferred_from_order_id) : null,
        transferredAt: ir.transferred_at ? String(ir.transferred_at) : null,
        transferredByUserId: ir.transferred_by_user_id ? String(ir.transferred_by_user_id) : null,
        paidQuantity: Number(ir.paid_quantity ?? 0)
      })),
      totalOrderCents: Number(r.total_order_cents),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      version: Number(r.version)
    };
  }

  private mapPaymentRow(r: Record<string, unknown>): Payment {
    return {
      id: String(r.id),
      tabId: String(r.tab_id),
      cashRegisterSessionId: String(r.cash_register_session_id),
      method: r.method as Payment['method'],
      confirmationMode: (r.confirmation_mode as PaymentConfirmationMode) ?? 'MANUAL_DECLARED',
      status: r.status as Payment['status'],
      amountCents: Number(r.amount_cents),
      receivedCashCents:
        r.received_cash_cents !== null && r.received_cash_cents !== undefined
          ? Number(r.received_cash_cents)
          : undefined,
      changeCents: Number(r.change_cents),
      payerLabel: r.payer_label ? String(r.payer_label) : null,
      allocatedItems: r.allocated_items_json
        ? JSON.parse(String(r.allocated_items_json))
        : undefined,
      nsuOrTxId: r.nsu_or_tx_id ? String(r.nsu_or_tx_id) : undefined,
      idempotencyKey: String(r.idempotency_key),
      operatorUserId: String(r.operator_user_id),
      refundReason: r.refund_reason ? String(r.refund_reason) : null,
      refundedByUserId: r.refunded_by_user_id ? String(r.refunded_by_user_id) : null,
      refundedAt: r.refunded_at ? String(r.refunded_at) : null,
      createdAt: String(r.created_at)
    };
  }

  private mapPrintJobRow(r: Record<string, unknown>): PrintJob {
    return {
      id: String(r.id),
      targetPrinter: r.target_printer as PrintJob['targetPrinter'],
      jobType: r.job_type as PrintJob['jobType'],
      status: r.status as PrintJob['status'],
      referenceEntityType: r.reference_entity_type as PrintJob['referenceEntityType'],
      referenceEntityId: String(r.reference_entity_id),
      payloadText: String(r.payload_text),
      isReprint: Boolean(r.is_reprint),
      copyNumber: Number(r.copy_number ?? 1),
      reprintAuthorizedByUserId: r.reprint_authorized_by_user_id
        ? String(r.reprint_authorized_by_user_id)
        : null,
      attempts: Number(r.attempts),
      lastError: r.last_error ? String(r.last_error) : null,
      createdAt: String(r.created_at),
      printedAt: r.printed_at ? String(r.printed_at) : null
    };
  }

  private mapCashSessionRow(r: Record<string, unknown>): CashRegisterSession {
    const sessionId = String(r.id);
    const openingBalanceCents = Number(r.opening_balance_cents);

    // Soma vendas em espécie confirmadas neste turno (líquido sem troco)
    const cashSalesRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM payments WHERE cash_register_session_id = ? AND method = 'CASH' AND status = 'CONFIRMED'"
      )
      .get(sessionId) as { total: number };
    const cashSalesNetCents = Number(cashSalesRow.total ?? 0);

    const inflowRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_register_movements WHERE session_id = ? AND movement_type IN ('SUPRIMENTO', 'MANUAL_INFLOW')"
      )
      .get(sessionId) as { total: number };
    const suprimentosCents = Number(inflowRow.total ?? 0);

    const outflowRow = this.db
      .prepare(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_register_movements WHERE session_id = ? AND movement_type IN ('SANGRIA', 'AUTHORIZED_OUTFLOW')"
      )
      .get(sessionId) as { total: number };
    const sangriasCents = Number(outflowRow.total ?? 0);

    const expectedCashCents =
      openingBalanceCents + cashSalesNetCents + suprimentosCents - sangriasCents;

    return {
      id: sessionId,
      openedByUserId: String(r.opened_by_user_id),
      closedByUserId: r.closed_by_user_id ? String(r.closed_by_user_id) : null,
      openedAt: String(r.opened_at),
      closedAt: r.closed_at ? String(r.closed_at) : null,
      openingBalanceCents,
      expectedCashCents,
      countedCashCents:
        r.counted_balance_cents !== null && r.counted_balance_cents !== undefined
          ? Number(r.counted_balance_cents)
          : null,
      differenceCents:
        r.difference_cents !== null && r.difference_cents !== undefined
          ? Number(r.difference_cents)
          : null,
      status: r.status as CashRegisterSession['status'],
      notes: r.notes ? String(r.notes) : null
    };
  }

  private mapNotificationRow(r: Record<string, unknown>): OperationalNotification {
    return {
      id: String(r.id),
      cursorId: r.cursor_id !== undefined ? Number(r.cursor_id) : undefined,
      eventType: r.event_type as OperationalNotification['eventType'],
      targetRole: r.target_role ? (r.target_role as UserRole) : null,
      targetUserId: r.target_user_id ? String(r.target_user_id) : null,
      tableNumber:
        r.table_number !== null && r.table_number !== undefined ? Number(r.table_number) : null,
      tabId: r.tab_id ? String(r.tab_id) : null,
      orderId: r.order_id ? String(r.order_id) : null,
      title: String(r.title),
      message: String(r.message),
      payloadJson: String(r.payload_json ?? '{}'),
      acknowledgedAt: r.acknowledged_at ? String(r.acknowledged_at) : null,
      acknowledgedByUserId: r.acknowledged_by_user_id ? String(r.acknowledged_by_user_id) : null,
      createdAt: String(r.created_at)
    };
  }

  private mapStockMovementRow(r: Record<string, unknown>): StockMovement {
    return {
      id: String(r.id),
      idempotencyKey: r.idempotency_key ? String(r.idempotency_key) : undefined,
      productId: String(r.product_id),
      productName: String(r.product_name),
      movementType: r.movement_type as StockMovement['movementType'],
      quantityDelta: Number(r.quantity_delta),
      balanceAfter: Number(r.balance_after),
      unitCostCents: r.unit_cost_cents !== null && r.unit_cost_cents !== undefined ? Number(r.unit_cost_cents) : undefined,
      originChannel: r.origin_channel ? String(r.origin_channel) : undefined,
      referenceEntityType: r.reference_entity_type ? (r.reference_entity_type as StockMovement['referenceEntityType']) : undefined,
      referenceEntityId: r.reference_entity_id ? String(r.reference_entity_id) : undefined,
      reversedByMovementId: r.reversed_by_movement_id ? String(r.reversed_by_movement_id) : null,
      reason: String(r.reason),
      createdByUserId: String(r.created_by_user_id),
      createdAt: String(r.created_at)
    };
  }

  private mapOutboxRow(r: Record<string, unknown>): SyncOutboxEvent {
    return {
      id: String(r.id),
      idempotencyKey: String(r.idempotency_key),
      originNode: r.origin_node as SyncOutboxEvent['originNode'],
      entityType: r.entity_type as SyncOutboxEvent['entityType'],
      entityId: String(r.entity_id),
      operation: r.operation as SyncOutboxEvent['operation'],
      entityVersion: Number(r.entity_version),
      hlcTimestamp: String(r.hlc_timestamp),
      payloadJson: String(r.payload_json),
      checksumSha256: String(r.checksum_sha256),
      status: r.status as SyncOutboxEvent['status'],
      retryCount: Number(r.retry_count),
      conflictReason: r.conflict_reason ? String(r.conflict_reason) : null,
      createdAt: String(r.created_at),
      syncedAt: r.synced_at ? String(r.synced_at) : null
    };
  }
}
