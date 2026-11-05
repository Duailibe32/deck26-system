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
  HotelCompanion,
  HotelDashboardMetrics,
  HotelFolioEntry,
  HotelFolioEntryType,
  HotelGuest,
  HotelGuestAddress,
  HotelGuestDocumentType,
  HotelHousekeepingAction,
  HotelHousekeepingLog,
  HotelMaintenancePriority,
  HotelMaintenanceRecord,
  HotelMaintenanceStatus,
  HotelMinibarConsumption,
  HotelMinibarItem,
  HotelMinibarMovementType,
  HotelReservation,
  HotelReservationSource,
  HotelReservationStatus,
  HotelRoom,
  HotelRoomCategory,
  HotelRoomStatus,
  HotelService,
  HotelServiceCategory,
  HotelServiceOrder,
  HotelStay,
  HotelStayStatus,
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
  RoomHousekeepingStatus,
  RoomMaintenanceStatus,
  RoomOccupancyStatus,
  SalesChannel,
  StockMovement,
  SyncOutboxEvent,
  Tab,
  TabType,
  TablePhysicalStatus,
  UserRole,
  areDateIntervalsOverlapping,
  buildEscPosProductionTicket,
  calculateNightsCount,
  calculateStayFolioTotals,
  calculateTabTotals,
  hasPermission,
  resolveChannelPriceCents,
  // Etapa 6: Delivery e Gestão Financeira
  AccountReconciliation,
  AccountsPayable,
  AccountsPayableOrigin,
  AccountsPayableStatus,
  AccountsReceivable,
  AccountsReceivableOrigin,
  AccountsReceivableStatus,
  CashFlowProjectedSummary,
  CashFlowRealizedSummary,
  CostCenter,
  DECK26_INITIAL_COST_CENTERS,
  DECK26_INITIAL_DELIVERY_ZONES,
  DECK26_INITIAL_FINANCIAL_ACCOUNTS,
  DECK26_INITIAL_FINANCIAL_CATEGORIES,
  DeliveryAddress,
  DeliveryCourier,
  DeliveryCourierStatus,
  DeliveryCustomer,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliveryOrigin,
  DeliverySettlement,
  DeliveryType,
  DeliveryZone,
  DreStatement,
  ExecutiveDashboardMetrics,
  FinancialAccount,
  FinancialAccountType,
  FinancialCategory,
  FinancialCategoryType,
  FinancialTransaction,
  FinancialTransactionType,
  FinancialTransfer,
  PurchaseInvoice,
  PurchaseInvoiceItem,
  Supplier,
  calculateDreStatement,
  sanitizeCsvCell
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

    const existing0004 = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0004_stage5_hotel_pms') as { version?: string } | undefined;

    if (!existing0004) {
      const migration0004Path = path.resolve(
        __dirname,
        '../../../packages/contracts/migrations/local/0004_stage5_hotel_pms.sql'
      );
      const sql0004 = fs.readFileSync(migration0004Path, 'utf-8');
      this.applySqlStatementsIdempotently(sql0004);

      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0004_stage5_hotel_pms', new Date().toISOString());
    }

    const existing0005 = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0005_stage6_delivery_and_finance') as { version?: string } | undefined;

    if (!existing0005) {
      const migration0005Path = path.resolve(
        __dirname,
        '../../../packages/contracts/migrations/local/0005_stage6_delivery_and_finance.sql'
      );
      const sql0005 = fs.readFileSync(migration0005Path, 'utf-8');
      this.applySqlStatementsIdempotently(sql0005);

      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0005_stage6_delivery_and_finance', new Date().toISOString());
    }

    // Garante compatibilidade de bancos criados na Etapa 2 com novos status das Etapas 3, 4, 5 e 6
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

    // 9. Semeia Serviços Hoteleiros Básicos
    const serviceCount = (
      this.db.prepare('SELECT COUNT(*) as total FROM hotel_services').get() as { total: number }
    ).total;
    if (serviceCount === 0) {
      const insertService = this.db.prepare(`
        INSERT INTO hotel_services (id, name, category, default_price_cents, active, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
      `);
      insertService.run('srv-lavanderia', 'Lavanderia por Peça', 'LAVANDERIA', 1500, now);
      insertService.run('srv-cafe-extra', 'Café da Manhã Extra', 'CAFE_MANHA', 2500, now);
      insertService.run('srv-cama-extra', 'Cama Extra Casal/Solteiro', 'CAMA_EXTRA', 5000, now);
      insertService.run('srv-estacionamento-pesado', 'Pátio Veículo Pesado / Caminhão', 'ESTACIONAMENTO', 3000, now);
    }

    // 10. Semeia Regiões de Entrega / Delivery Zones (Etapa 6)
    const insertZone = this.db.prepare(`
      INSERT OR IGNORE INTO delivery_zones (id, name, fee_cents, minimum_order_cents, estimated_minutes, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const zone of DECK26_INITIAL_DELIVERY_ZONES) {
      insertZone.run(zone.id, zone.name, zone.feeCents, zone.minimumOrderCents, zone.estimatedMinutes, zone.active ? 1 : 0, now);
    }

    // 11. Semeia Centros de Custo (Etapa 6)
    const insertCostCenter = this.db.prepare(`
      INSERT OR IGNORE INTO cost_centers (id, code, name, description, active)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const cc of DECK26_INITIAL_COST_CENTERS) {
      insertCostCenter.run(cc.id, cc.code, cc.name, cc.description, cc.active ? 1 : 0);
    }

    // 12. Semeia Plano de Contas Gerencial / Categorias Financeiras (Etapa 6)
    const insertFinCat = this.db.prepare(`
      INSERT OR IGNORE INTO financial_categories (id, code, name, type, parent_id, active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const cat of DECK26_INITIAL_FINANCIAL_CATEGORIES) {
      insertFinCat.run(cat.id, cat.code, cat.name, cat.type, cat.parentId ?? null, cat.active ? 1 : 0);
    }

    // 13. Semeia Contas Financeiras / Tesouraria (Etapa 6)
    const insertFinAcc = this.db.prepare(`
      INSERT OR IGNORE INTO financial_accounts (
        id, name, type, bank_name, account_number, pix_key,
        current_balance_cents, initial_balance_cents, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const acc of DECK26_INITIAL_FINANCIAL_ACCOUNTS) {
      insertFinAcc.run(
        acc.id,
        acc.name,
        acc.type,
        acc.bankName ?? null,
        acc.accountNumber ?? null,
        acc.pixKey ?? null,
        acc.currentBalanceCents,
        acc.initialBalanceCents,
        acc.active ? 1 : 0,
        acc.createdAt,
        acc.updatedAt
      );
    }

    // 14. Semeia Entregador Inicial (Etapa 6)
    const insertCourier = this.db.prepare(`
      INSERT OR IGNORE INTO delivery_couriers (id, name, phone, vehicle_type, vehicle_plate, fee_per_delivery_cents, status, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    insertCourier.run('cr-motoboy-01', 'Carlos Silva (Moto 01)', '98988112233', 'MOTO', 'SLZ-2601', 500, 'DISPONIVEL', now);

    // 15. Semeia Fornecedores Iniciais (Etapa 6)
    const insertSupplier = this.db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, name, trade_name, document, email, phone, contact_person, category, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertSupplier.run(
      'sup-distribuidora-milla',
      'Distribuidora Milla Bebidas Ltda',
      'Milla Bebidas & Gelo',
      '12.345.678/0001-90',
      'pedidos@millabebidas.com.br',
      '9832221100',
      'Roberto Milla',
      'Bebidas e Cervejas',
      now,
      now
    );
    insertSupplier.run(
      'sup-hortifruti-central',
      'Hortifruti & Carnes Santa Inês Ltda',
      'Frigorífico & Hortifruti Central',
      '98.765.432/0001-10',
      'comercial@hortifruticentral.com.br',
      '9832229988',
      'Mariana Costa',
      'Alimentos e Insumos',
      now,
      now
    );
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
          unitCostCents: product.costPriceCents,
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

  public getProductCurrentStock(productId: string): number {
    return this.getProductStockQuantity(productId);
  }

  // ============================================================================
  // HOTELARIA (HOTEL AUTO POSTO MILLA — PMS INTEGRADO AO RESTAURANTE/BAR)
  // ============================================================================

  private mapHotelRoomRow(r: Record<string, unknown>): HotelRoom {
    let amenities: string[] = ['Ar Condicionado', 'Wi-Fi', 'TV Smart', 'Frigobar'];
    if (r.amenities_json) {
      try {
        amenities = JSON.parse(String(r.amenities_json));
      } catch {
        // Fallback para lista padrão
      }
    }

    return {
      id: String(r.id),
      number: String(r.number),
      floorSector: r.floor_sector ? String(r.floor_sector) : 'Térreo',
      category: (r.category || 'STANDARD_DOUBLE') as HotelRoom['category'],
      maxGuests: r.max_guests != null ? Number(r.max_guests) : 2,
      bedCount: r.bed_count != null ? Number(r.bed_count) : 1,
      bedConfiguration: r.bed_configuration ? String(r.bed_configuration) : '1 Cama Casal',
      description: String(r.description || ''),
      amenities,
      dailyRateCents: Number(r.daily_rate_cents),
      status: (r.status || 'AVAILABLE') as HotelRoom['status'],
      occupancyStatus: (r.occupancy_status || 'LIVRE') as RoomOccupancyStatus,
      housekeepingStatus: (r.housekeeping_status || 'LIMPO') as RoomHousekeepingStatus,
      maintenanceStatus: (r.maintenance_status || 'DISPONIVEL') as RoomMaintenanceStatus,
      active: r.active != null ? Boolean(r.active) : true,
      currentGuestName: r.current_guest_name ? String(r.current_guest_name) : null,
      currentGuestId: r.current_guest_id ? String(r.current_guest_id) : null,
      activeTabId: r.active_tab_id ? String(r.active_tab_id) : null,
      activeStayId: r.active_stay_id ? String(r.active_stay_id) : null,
      internalNotes: String(r.internal_notes || ''),
      createdAt: r.created_at ? String(r.created_at) : undefined,
      updatedAt: String(r.updated_at)
    };
  }

  public listHotelRooms(options?: {
    activeOnly?: boolean;
    occupancyStatus?: RoomOccupancyStatus;
    housekeepingStatus?: RoomHousekeepingStatus;
  }): HotelRoom[] {
    let sql = 'SELECT * FROM hotel_rooms WHERE 1=1';
    const params: any[] = [];
    if (options?.activeOnly) {
      sql += ' AND active = 1';
    }
    if (options?.occupancyStatus) {
      sql += ' AND occupancy_status = ?';
      params.push(options.occupancyStatus);
    }
    if (options?.housekeepingStatus) {
      sql += ' AND housekeeping_status = ?';
      params.push(options.housekeepingStatus);
    }
    sql += ' ORDER BY number ASC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapHotelRoomRow(r));
  }

  public getHotelRoomById(id: string): HotelRoom | null {
    const row = this.db.prepare('SELECT * FROM hotel_rooms WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHotelRoomRow(row) : null;
  }

  public getHotelRoomByNumber(roomNumber: string): HotelRoom | null {
    const row = this.db.prepare('SELECT * FROM hotel_rooms WHERE number = ?').get(roomNumber) as Record<string, unknown> | undefined;
    return row ? this.mapHotelRoomRow(row) : null;
  }

  public createHotelRoom(input: {
    id?: string;
    number: string;
    floorSector?: string;
    category?: HotelRoomCategory;
    maxGuests?: number;
    bedCount?: number;
    bedConfiguration?: string;
    description?: string;
    amenities?: string[];
    dailyRateCents: number;
    internalNotes?: string;
    operatorUserId: string;
  }): HotelRoom {
    const existing = this.getHotelRoomByNumber(input.number);
    if (existing) {
      throw new Error(`Apartamento ${input.number} já cadastrado no sistema.`);
    }

    const id = input.id || `room-${input.number}`;
    const now = new Date().toISOString();
    const amenities = input.amenities || ['Ar Condicionado', 'Wi-Fi', 'TV Smart', 'Frigobar'];

    this.db.prepare(`
      INSERT INTO hotel_rooms (
        id, number, floor_sector, category, max_guests, bed_count, bed_configuration,
        description, amenities_json, daily_rate_cents, status, occupancy_status,
        housekeeping_status, maintenance_status, active, internal_notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', 'LIVRE', 'LIMPO', 'DISPONIVEL', 1, ?, ?, ?)
    `).run(
      id,
      input.number,
      input.floorSector || 'Térreo',
      input.category || 'STANDARD_DOUBLE',
      input.maxGuests || 2,
      input.bedCount || 1,
      input.bedConfiguration || '1 Cama Casal',
      input.description || '',
      JSON.stringify(amenities),
      input.dailyRateCents,
      input.internalNotes || '',
      now,
      now
    );

    const created = this.getHotelRoomById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-room-create-${id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_ROOM',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: created
    });

    this.recordAuditLog({
      actorUserId: input.operatorUserId,
      action: 'HOTEL_ROOM_CREATE',
      entityType: 'HOTEL_ROOM',
      entityId: id,
      metadata: { number: input.number, category: input.category, dailyRateCents: input.dailyRateCents }
    });

    return created;
  }

  public updateHotelRoom(
    id: string,
    updates: Partial<{
      number: string;
      floorSector: string;
      category: HotelRoomCategory;
      maxGuests: number;
      bedCount: number;
      bedConfiguration: string;
      description: string;
      amenities: string[];
      dailyRateCents: number;
      occupancyStatus: RoomOccupancyStatus;
      housekeepingStatus: RoomHousekeepingStatus;
      maintenanceStatus: RoomMaintenanceStatus;
      internalNotes: string;
      active: boolean;
    }>,
    operatorUserId: string
  ): HotelRoom {
    const existing = this.getHotelRoomById(id);
    if (!existing) {
      throw new Error(`Apartamento '${id}' não encontrado.`);
    }

    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (updates.number !== undefined) {
      fields.push('number = ?');
      params.push(updates.number);
    }
    if (updates.floorSector !== undefined) {
      fields.push('floor_sector = ?');
      params.push(updates.floorSector);
    }
    if (updates.category !== undefined) {
      fields.push('category = ?');
      params.push(updates.category);
    }
    if (updates.maxGuests !== undefined) {
      fields.push('max_guests = ?');
      params.push(updates.maxGuests);
    }
    if (updates.bedCount !== undefined) {
      fields.push('bed_count = ?');
      params.push(updates.bedCount);
    }
    if (updates.bedConfiguration !== undefined) {
      fields.push('bed_configuration = ?');
      params.push(updates.bedConfiguration);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      params.push(updates.description);
    }
    if (updates.amenities !== undefined) {
      fields.push('amenities_json = ?');
      params.push(JSON.stringify(updates.amenities));
    }
    if (updates.dailyRateCents !== undefined) {
      fields.push('daily_rate_cents = ?');
      params.push(updates.dailyRateCents);
    }
    if (updates.occupancyStatus !== undefined) {
      fields.push('occupancy_status = ?');
      params.push(updates.occupancyStatus);
      if (updates.occupancyStatus === 'OCUPADO') {
        fields.push("status = 'OCCUPIED'");
      } else if (updates.occupancyStatus === 'LIVRE') {
        fields.push("status = 'AVAILABLE'");
      }
    }
    if (updates.housekeepingStatus !== undefined) {
      fields.push('housekeeping_status = ?');
      params.push(updates.housekeepingStatus);
    }
    if (updates.maintenanceStatus !== undefined) {
      fields.push('maintenance_status = ?');
      params.push(updates.maintenanceStatus);
    }
    if (updates.internalNotes !== undefined) {
      fields.push('internal_notes = ?');
      params.push(updates.internalNotes);
    }
    if (updates.active !== undefined) {
      fields.push('active = ?');
      params.push(updates.active ? 1 : 0);
    }

    params.push(id);
    this.db.prepare(`UPDATE hotel_rooms SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = this.getHotelRoomById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-room-update-${id}-${Date.now()}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_ROOM',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 2,
      payload: updated
    });

    this.recordAuditLog({
      actorUserId: operatorUserId,
      action: 'HOTEL_ROOM_UPDATE',
      entityType: 'HOTEL_ROOM',
      entityId: id,
      metadata: updates
    });

    return updated;
  }

  public deactivateHotelRoom(id: string, operatorUserId: string): { success: boolean; room: HotelRoom } {
    const room = this.getHotelRoomById(id);
    if (!room) {
      throw new Error(`Apartamento '${id}' não encontrado.`);
    }

    // Regra Obrigatória da Seção 2: Não excluir fisicamente quartos com histórico de hospedagem
    const stayHistoryCount = (
      this.db.prepare('SELECT COUNT(*) as total FROM hotel_stays WHERE room_id = ?').get(room.id) as { total: number }
    ).total;

    if (stayHistoryCount > 0) {
      // Bloqueia exclusão física e aplica desativação lógica
      const updated = this.updateHotelRoom(id, { active: false }, operatorUserId);
      return { success: true, room: updated };
    }

    // Caso não haja histórico, pode ser desativado logicamente com segurança
    const updated = this.updateHotelRoom(id, { active: false }, operatorUserId);
    return { success: true, room: updated };
  }

  // ============================================================================
  // HÓSPEDES (HOTEL_GUESTS — LGPD E AUDITORIA)
  // ============================================================================

  private mapHotelGuestRow(r: Record<string, unknown>): HotelGuest {
    let addr: HotelGuestAddress = {
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      state: '',
      postalCode: ''
    };
    if (r.address_street || r.address_city) {
      addr = {
        street: String(r.address_street || ''),
        number: String(r.address_number || ''),
        neighborhood: String(r.address_neighborhood || ''),
        city: String(r.address_city || ''),
        state: String(r.address_state || ''),
        postalCode: String(r.address_postal_code || '')
      };
    }

    return {
      id: String(r.id),
      fullName: String(r.full_name),
      documentType: (r.document_type || 'CPF') as HotelGuestDocumentType,
      documentNumber: String(r.document_number),
      phone: String(r.phone || ''),
      email: String(r.email || ''),
      nationality: String(r.nationality || 'Brasileira'),
      birthDate: r.birth_date ? String(r.birth_date) : null,
      address: addr,
      notes: String(r.notes || ''),
      totalStaysCount: Number(r.total_stays_count || 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public listHotelGuests(search?: string): HotelGuest[] {
    let sql = 'SELECT * FROM hotel_guests WHERE 1=1';
    const params: any[] = [];
    if (search && search.trim() !== '') {
      const q = `%${search.trim().toLowerCase()}%`;
      sql += ' AND (lower(full_name) LIKE ? OR lower(document_number) LIKE ? OR lower(phone) LIKE ?)';
      params.push(q, q, q);
    }
    sql += ' ORDER BY full_name ASC LIMIT 100';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapHotelGuestRow(r));
  }

  public getHotelGuestById(id: string): HotelGuest | null {
    const row = this.db.prepare('SELECT * FROM hotel_guests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHotelGuestRow(row) : null;
  }

  public findGuestByDocument(documentNumber: string): HotelGuest | null {
    const row = this.db.prepare('SELECT * FROM hotel_guests WHERE document_number = ?').get(documentNumber) as Record<string, unknown> | undefined;
    return row ? this.mapHotelGuestRow(row) : null;
  }

  public createHotelGuest(input: {
    id?: string;
    fullName: string;
    documentType?: HotelGuestDocumentType;
    documentNumber: string;
    phone?: string;
    email?: string;
    nationality?: string;
    birthDate?: string | null;
    address?: HotelGuestAddress;
    notes?: string;
    operatorUserId: string;
  }): HotelGuest {
    const existing = this.findGuestByDocument(input.documentNumber);
    if (existing) {
      return existing;
    }

    const id = input.id || `guest-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const addr = input.address || {
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      state: '',
      postalCode: ''
    };

    this.db.prepare(`
      INSERT INTO hotel_guests (
        id, full_name, document_type, document_number, phone, email,
        nationality, birth_date, address_street, address_number, address_neighborhood,
        address_city, address_state, address_postal_code, notes, total_stays_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      id,
      input.fullName,
      input.documentType || 'CPF',
      input.documentNumber,
      input.phone || '',
      input.email || '',
      input.nationality || 'Brasileira',
      input.birthDate || null,
      addr.street || '',
      addr.number || '',
      addr.neighborhood || '',
      addr.city || '',
      addr.state || '',
      addr.postalCode || '',
      input.notes || '',
      now,
      now
    );

    const created = this.getHotelGuestById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-guest-create-${id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_GUEST',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: created
    });

    return created;
  }

  public updateHotelGuest(
    id: string,
    updates: Partial<{
      fullName: string;
      documentType: HotelGuestDocumentType;
      documentNumber: string;
      phone: string;
      email: string;
      nationality: string;
      birthDate: string | null;
      address: HotelGuestAddress;
      notes: string;
    }>,
    operatorUserId: string
  ): HotelGuest {
    const existing = this.getHotelGuestById(id);
    if (!existing) {
      throw new Error(`Hóspede '${id}' não encontrado.`);
    }

    const now = new Date().toISOString();
    const fields: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (updates.fullName !== undefined) {
      fields.push('full_name = ?');
      params.push(updates.fullName);
    }
    if (updates.documentType !== undefined) {
      fields.push('document_type = ?');
      params.push(updates.documentType);
    }
    if (updates.documentNumber !== undefined) {
      fields.push('document_number = ?');
      params.push(updates.documentNumber);
    }
    if (updates.phone !== undefined) {
      fields.push('phone = ?');
      params.push(updates.phone);
    }
    if (updates.email !== undefined) {
      fields.push('email = ?');
      params.push(updates.email);
    }
    if (updates.nationality !== undefined) {
      fields.push('nationality = ?');
      params.push(updates.nationality);
    }
    if (updates.birthDate !== undefined) {
      fields.push('birth_date = ?');
      params.push(updates.birthDate);
    }
    if (updates.notes !== undefined) {
      fields.push('notes = ?');
      params.push(updates.notes);
    }
    if (updates.address) {
      fields.push('address_street = ?, address_number = ?, address_neighborhood = ?, address_city = ?, address_state = ?, address_postal_code = ?');
      params.push(
        updates.address.street || '',
        updates.address.number || '',
        updates.address.neighborhood || '',
        updates.address.city || '',
        updates.address.state || '',
        updates.address.postalCode || ''
      );
    }

    params.push(id);
    this.db.prepare(`UPDATE hotel_guests SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = this.getHotelGuestById(id)!;
    return updated;
  }

  // ============================================================================
  // RESERVAS COM PROTEÇÃO DE SOBREPOSIÇÃO DE DATAS [in, out)
  // ============================================================================

  private mapHotelReservationRow(r: Record<string, unknown>): HotelReservation {
    return {
      id: String(r.id),
      reservationCode: String(r.reservation_code),
      guestId: String(r.guest_id),
      guestName: String(r.guest_name),
      guestPhone: String(r.guest_phone || ''),
      roomId: r.room_id ? String(r.room_id) : null,
      roomNumber: String(r.room_number),
      roomCategory: (r.room_category || 'STANDARD_DOUBLE') as HotelRoomCategory,
      guestsCount: Number(r.guests_count || 1),
      checkInDate: String(r.check_in_date),
      checkOutDate: String(r.check_out_date),
      dailyRateCents: Number(r.daily_rate_cents),
      estimatedTotalCents: Number(r.estimated_total_cents),
      depositCents: Number(r.deposit_cents || 0),
      depositPaid: Boolean(r.deposit_paid),
      sourceChannel: (r.source_channel || 'BALCAO') as HotelReservationSource,
      status: (r.status || 'CONFIRMADA') as HotelReservationStatus,
      cancellationReason: r.cancellation_reason ? String(r.cancellation_reason) : null,
      cancelledAt: r.cancelled_at ? String(r.cancelled_at) : null,
      cancelledByUserId: r.cancelled_by_user_id ? String(r.cancelled_by_user_id) : null,
      notes: String(r.notes || ''),
      createdByUserId: String(r.created_by_user_id),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public listHotelReservations(filters?: {
    roomNumber?: string;
    status?: HotelReservationStatus;
    startDate?: string;
    endDate?: string;
  }): HotelReservation[] {
    let sql = 'SELECT * FROM hotel_reservations WHERE 1=1';
    const params: any[] = [];
    if (filters?.roomNumber) {
      sql += ' AND room_number = ?';
      params.push(filters.roomNumber);
    }
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.startDate) {
      sql += ' AND check_out_date >= ?';
      params.push(filters.startDate);
    }
    if (filters?.endDate) {
      sql += ' AND check_in_date <= ?';
      params.push(filters.endDate);
    }
    sql += ' ORDER BY check_in_date ASC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapHotelReservationRow(r));
  }

  public getHotelReservationById(id: string): HotelReservation | null {
    const row = this.db.prepare('SELECT * FROM hotel_reservations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHotelReservationRow(row) : null;
  }

  public checkRoomAvailability(
    roomNumber: string,
    checkInDate: string,
    checkOutDate: string,
    excludeReservationId?: string
  ): { available: boolean; conflictReason?: string } {
    const room = this.getHotelRoomByNumber(roomNumber);
    if (!room) {
      return { available: false, conflictReason: `Apartamento ${roomNumber} não cadastrado.` };
    }
    if (!room.active) {
      return { available: false, conflictReason: `Apartamento ${roomNumber} está desativado.` };
    }
    if (room.maintenanceStatus === 'INTERDITADO') {
      return { available: false, conflictReason: `Apartamento ${roomNumber} está interditado para manutenção.` };
    }

    // Regra da Seção 5: Entrada inclusiva e saída exclusiva [inA, outA) vs [inB, outB)
    const activeReservations = this.listHotelReservations({ roomNumber });
    const conflicts = activeReservations.filter((r) => {
      if (excludeReservationId && r.id === excludeReservationId) return false;
      if (r.status === 'CANCELADA' || r.status === 'NO_SHOW' || r.status === 'CONCLUIDA') return false;
      return areDateIntervalsOverlapping(checkInDate, checkOutDate, r.checkInDate, r.checkOutDate);
    });

    if (conflicts.length > 0) {
      const c = conflicts[0]!;
      return {
        available: false,
        conflictReason: `Conflito com reserva ativa ${c.reservationCode} (${c.checkInDate} a ${c.checkOutDate}).`
      };
    }

    return { available: true };
  }

  public createHotelReservation(input: {
    id?: string;
    guestId: string;
    guestName?: string;
    guestPhone?: string;
    roomNumber: string;
    checkInDate: string; // YYYY-MM-DD
    checkOutDate: string; // YYYY-MM-DD
    guestsCount?: number;
    dailyRateCents?: number;
    depositCents?: number;
    depositPaid?: boolean;
    sourceChannel?: HotelReservationSource;
    notes?: string;
    operatorUserId: string;
  }): HotelReservation {
    const room = this.getHotelRoomByNumber(input.roomNumber);
    if (!room) {
      throw new Error(`Apartamento ${input.roomNumber} não encontrado.`);
    }

    const availability = this.checkRoomAvailability(input.roomNumber, input.checkInDate, input.checkOutDate);
    if (!availability.available) {
      throw new Error(`Apartamento indisponível para o período solicitado: ${availability.conflictReason}`);
    }

    const guest = this.getHotelGuestById(input.guestId);
    if (!guest) {
      throw new Error(`Hóspede '${input.guestId}' não encontrado.`);
    }

    const id = input.id || `res-${crypto.randomUUID()}`;
    const reservationCode = `RES-${input.checkInDate.replace(/-/g, '')}-${room.number}-${Date.now().toString().slice(-4)}`;
    const nights = calculateNightsCount(input.checkInDate, input.checkOutDate);
    const dailyRate = input.dailyRateCents ?? room.dailyRateCents;
    const estimatedTotalCents = nights * dailyRate;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO hotel_reservations (
        id, reservation_code, guest_id, guest_name, guest_phone, room_id, room_number,
        room_category, guests_count, check_in_date, check_out_date, daily_rate_cents,
        estimated_total_cents, deposit_cents, deposit_paid, source_channel, status,
        notes, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMADA', ?, ?, ?, ?)
    `).run(
      id,
      reservationCode,
      guest.id,
      input.guestName || guest.fullName,
      input.guestPhone || guest.phone,
      room.id,
      room.number,
      room.category,
      input.guestsCount || 1,
      input.checkInDate,
      input.checkOutDate,
      dailyRate,
      estimatedTotalCents,
      input.depositCents || 0,
      input.depositPaid ? 1 : 0,
      input.sourceChannel || 'BALCAO',
      input.notes || '',
      input.operatorUserId,
      now,
      now
    );

    const created = this.getHotelReservationById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-res-create-${id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_RESERVATION',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: created
    });

    this.recordAuditLog({
      actorUserId: input.operatorUserId,
      action: 'HOTEL_RESERVATION_CREATE',
      entityType: 'HOTEL_RESERVATION',
      entityId: id,
      metadata: { reservationCode, roomNumber: room.number, checkInDate: input.checkInDate, checkOutDate: input.checkOutDate }
    });

    return created;
  }

  public cancelHotelReservation(
    id: string,
    input: {
      reason: string;
      cancelledByUserId: string;
    }
  ): HotelReservation {
    const existing = this.getHotelReservationById(id);
    if (!existing) {
      throw new Error(`Reserva '${id}' não encontrada.`);
    }
    if (existing.status === 'CANCELADA') {
      return existing;
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE hotel_reservations
      SET status = 'CANCELADA',
          cancellation_reason = ?,
          cancelled_at = ?,
          cancelled_by_user_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(input.reason, now, input.cancelledByUserId, now, id);

    const updated = this.getHotelReservationById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-res-cancel-${id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_RESERVATION',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 2,
      payload: updated
    });

    this.recordAuditLog({
      actorUserId: input.cancelledByUserId,
      action: 'HOTEL_RESERVATION_CANCEL',
      entityType: 'HOTEL_RESERVATION',
      entityId: id,
      metadata: { reason: input.reason }
    });

    return updated;
  }

  public rescheduleHotelReservation(
    id: string,
    input: {
      newCheckInDate: string;
      newCheckOutDate: string;
      newRoomNumber?: string;
      operatorUserId: string;
    }
  ): HotelReservation {
    const existing = this.getHotelReservationById(id);
    if (!existing) {
      throw new Error(`Reserva '${id}' não encontrada.`);
    }

    const targetRoomNumber = input.newRoomNumber || existing.roomNumber;
    const availability = this.checkRoomAvailability(
      targetRoomNumber,
      input.newCheckInDate,
      input.newCheckOutDate,
      existing.id
    );

    if (!availability.available) {
      throw new Error(`Não há disponibilidade para o reagendamento: ${availability.conflictReason}`);
    }

    const room = this.getHotelRoomByNumber(targetRoomNumber)!;
    const nights = calculateNightsCount(input.newCheckInDate, input.newCheckOutDate);
    const estimatedTotalCents = nights * existing.dailyRateCents;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE hotel_reservations
      SET check_in_date = ?,
          check_out_date = ?,
          room_id = ?,
          room_number = ?,
          room_category = ?,
          estimated_total_cents = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.newCheckInDate,
      input.newCheckOutDate,
      room.id,
      room.number,
      room.category,
      estimatedTotalCents,
      now,
      id
    );

    const updated = this.getHotelReservationById(id)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-res-reschedule-${id}-${Date.now()}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_RESERVATION',
      entityId: id,
      operation: 'UPSERT',
      entityVersion: 3,
      payload: updated
    });

    return updated;
  }

  // ============================================================================
  // ESTADIAS / HOSPEDAGENS (HOTEL_STAYS — CHECK-IN & CHECK-OUT GUIADO)
  // ============================================================================

  private mapHotelStayRow(r: Record<string, unknown>): HotelStay {
    let companions: HotelCompanion[] = [];
    if (r.companions_json) {
      try {
        companions = JSON.parse(String(r.companions_json));
      } catch {
        // Fallback
      }
    }

    return {
      id: String(r.id),
      stayCode: String(r.stay_code),
      reservationId: r.reservation_id ? String(r.reservation_id) : null,
      roomId: String(r.room_id),
      roomNumber: String(r.room_number),
      guestId: String(r.guest_id),
      guestName: String(r.guest_name),
      guestDocument: String(r.guest_document),
      companions,
      checkInAt: String(r.check_in_at),
      checkOutScheduledAt: String(r.check_out_scheduled_at),
      checkOutActualAt: r.check_out_actual_at ? String(r.check_out_actual_at) : null,
      dailyRateCents: Number(r.daily_rate_cents),
      nightsCount: Number(r.nights_count || 1),
      earlyCheckinCents: Number(r.early_checkin_cents || 0),
      lateCheckoutCents: Number(r.late_checkout_cents || 0),
      extraGuestsCents: Number(r.extra_guests_cents || 0),
      discountCents: Number(r.discount_cents || 0),
      discountReason: r.discount_reason ? String(r.discount_reason) : null,
      tabId: String(r.tab_id),
      status: (r.status || 'ACTIVE') as HotelStayStatus,
      openedByUserId: String(r.opened_by_user_id),
      closedByUserId: r.closed_by_user_id ? String(r.closed_by_user_id) : null,
      notes: String(r.notes || ''),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  public listHotelStays(filters?: {
    status?: HotelStayStatus;
    roomNumber?: string;
  }): HotelStay[] {
    let sql = 'SELECT * FROM hotel_stays WHERE 1=1';
    const params: any[] = [];
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.roomNumber) {
      sql += ' AND room_number = ?';
      params.push(filters.roomNumber);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapHotelStayRow(r));
  }

  public getHotelStayById(id: string): HotelStay | null {
    const row = this.db.prepare('SELECT * FROM hotel_stays WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapHotelStayRow(row) : null;
  }

  public getActiveStayByRoomNumber(roomNumber: string): HotelStay | null {
    const row = this.db.prepare("SELECT * FROM hotel_stays WHERE room_number = ? AND status = 'ACTIVE' LIMIT 1")
      .get(roomNumber) as Record<string, unknown> | undefined;
    return row ? this.mapHotelStayRow(row) : null;
  }

  public checkInHotelStay(input: {
    reservationId?: string;
    roomNumber: string;
    guestId: string;
    companions?: HotelCompanion[];
    checkInAt?: string;
    checkOutScheduledAt: string;
    dailyRateCents?: number;
    earlyCheckinCents?: number;
    notes?: string;
    operatorUserId: string;
    operatorName: string;
  }): { stay: HotelStay; room: HotelRoom; folioTab: Tab; firstFolioEntry: HotelFolioEntry } {
    const room = this.getHotelRoomByNumber(input.roomNumber);
    if (!room) {
      throw new Error(`Apartamento ${input.roomNumber} não cadastrado.`);
    }
    if (!room.active) {
      throw new Error(`Apartamento ${input.roomNumber} está desativado.`);
    }
    if (room.occupancyStatus === 'OCUPADO' || room.activeStayId) {
      throw new Error(`Apartamento ${input.roomNumber} já se encontra ocupado por outra hospedagem.`);
    }
    if (room.maintenanceStatus === 'INTERDITADO') {
      throw new Error(`Apartamento ${input.roomNumber} está interditado para manutenção.`);
    }

    const guest = this.getHotelGuestById(input.guestId);
    if (!guest) {
      throw new Error(`Hóspede '${input.guestId}' não encontrado.`);
    }

    const now = new Date().toISOString();
    const checkInTime = input.checkInAt || now;
    const nights = calculateNightsCount(checkInTime, input.checkOutScheduledAt);
    const rate = input.dailyRateCents ?? room.dailyRateCents;

    const stayId = crypto.randomUUID();
    const stayCode = `STAY-${room.number}-${Date.now().toString().slice(-6)}`;

    // Abre ou obtém Comanda Tab de Folio
    const folioTab = this.openOrGetTab({
      code: `APTO-${room.number}`,
      type: 'HOTEL_FOLIO',
      customerName: guest.fullName,
      openedByUserId: input.operatorUserId
    });

    // Insere hotel_stays
    this.db.prepare(`
      INSERT INTO hotel_stays (
        id, stay_code, reservation_id, room_id, room_number, guest_id, guest_name, guest_document,
        companions_json, check_in_at, check_out_scheduled_at, daily_rate_cents, nights_count,
        early_checkin_cents, tab_id, status, opened_by_user_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
    `).run(
      stayId,
      stayCode,
      input.reservationId || null,
      room.id,
      room.number,
      guest.id,
      guest.fullName,
      guest.documentNumber,
      JSON.stringify(input.companions || []),
      checkInTime,
      input.checkOutScheduledAt,
      rate,
      nights,
      input.earlyCheckinCents || 0,
      folioTab.id,
      input.operatorUserId,
      input.notes || '',
      now,
      now
    );

    // Atualiza quarto
    this.db.prepare(`
      UPDATE hotel_rooms
      SET occupancy_status = 'OCUPADO',
          status = 'OCCUPIED',
          current_guest_name = ?,
          current_guest_id = ?,
          active_tab_id = ?,
          active_stay_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(guest.fullName, guest.id, folioTab.id, stayId, now, room.id);

    // Se houver reserva associada, atualiza status para CHECK_IN_REALIZADO
    if (input.reservationId) {
      this.db.prepare(`
        UPDATE hotel_reservations
        SET status = 'CHECK_IN_REALIZADO', updated_at = ?
        WHERE id = ?
      `).run(now, input.reservationId);
    }

    // Incrementa contador de hospedagens do hóspede
    this.db.prepare(`
      UPDATE hotel_guests
      SET total_stays_count = total_stays_count + 1, updated_at = ?
      WHERE id = ?
    `).run(now, guest.id);

    // Lança primeira diária no folio
    const firstFolioEntry = this.addFolioEntry({
      stayId,
      entryType: 'ROOM_RATE',
      description: `Diária (${nights} ${nights > 1 ? 'diárias' : 'diária'} - Apto ${room.number})`,
      amountCents: rate * nights + (input.earlyCheckinCents || 0),
      sourceReferenceType: 'ROOM_RATE',
      sourceReferenceId: stayId,
      operatorUserId: input.operatorUserId,
      operatorName: input.operatorName
    });

    const updatedRoom = this.getHotelRoomById(room.id)!;
    const stay = this.getHotelStayById(stayId)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-stay-checkin-${stay.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_STAY',
      entityId: stay.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: stay
    });

    this.appendOutboxEvent({
      idempotencyKey: `hotel-room-checkin-${room.id}-${stay.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_ROOM',
      entityId: room.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: updatedRoom
    });

    this.recordAuditLog({
      actorUserId: input.operatorUserId,
      action: 'HOTEL_CHECKIN',
      entityType: 'HOTEL_STAY',
      entityId: stay.id,
      metadata: { stayCode, roomNumber: room.number, guestName: guest.fullName, nights }
    });

    return { stay, room: updatedRoom, folioTab, firstFolioEntry };
  }

  // Método legado compatível para check-in rápido
  public checkInHotelRoom(input: { roomNumber: string; guestName: string }): { room: HotelRoom; folioTab: Tab } {
    let guest = this.listHotelGuests().find((g) => g.fullName.toLowerCase() === input.guestName.toLowerCase());
    if (!guest) {
      guest = this.createHotelGuest({
        fullName: input.guestName,
        documentNumber: `AUTOGEN-${Date.now().toString().slice(-6)}`,
        operatorUserId: 'usr-reception-01'
      });
    }

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = this.checkInHotelStay({
      roomNumber: input.roomNumber,
      guestId: guest.id,
      checkOutScheduledAt: tomorrow,
      operatorUserId: 'usr-reception-01',
      operatorName: 'Recepção Hotel Milla'
    });

    return { room: res.room, folioTab: res.folioTab };
  }

  public checkOutHotelStay(
    stayId: string,
    input: {
      operatorUserId: string;
      operatorName: string;
      notes?: string;
      allowOverrideWithAudit?: boolean;
    }
  ): { stay: HotelStay; room: HotelRoom; folioTab: Tab; balanceCents: number } {
    const stay = this.getHotelStayById(stayId);
    if (!stay) {
      throw new Error(`Estadia '${stayId}' não encontrada.`);
    }
    if (stay.status !== 'ACTIVE') {
      throw new Error(`Estadia '${stay.stayCode}' já foi encerrada anteriormente.`);
    }

    const entries = this.listFolioEntriesByStayId(stayId);
    const totals = calculateStayFolioTotals(entries);

    // Regra da Seção 14: Não permitir encerramento com saldo pendente sem auditoria
    if (totals.balanceCents !== 0 && !input.allowOverrideWithAudit) {
      throw new Error(
        `Check-out bloqueado: Conta do apartamento ${stay.roomNumber} possui saldo pendente de R$ ${(totals.balanceCents / 100).toFixed(2)}. Efetue o pagamento ou realize o ajuste financeiro antes do check-out.`
      );
    }

    const now = new Date().toISOString();

    // Encerra estadia
    this.db.prepare(`
      UPDATE hotel_stays
      SET status = 'CHECKED_OUT',
          check_out_actual_at = ?,
          closed_by_user_id = ?,
          notes = CASE WHEN ? != '' THEN notes || ' | ' || ? ELSE notes END,
          updated_at = ?
      WHERE id = ?
    `).run(now, input.operatorUserId, input.notes || '', input.notes || '', now, stayId);

    // Encerra comanda da hospedagem (tab)
    this.db.prepare(`
      UPDATE tabs
      SET status = 'CLOSED', closed_at = ?, closed_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, input.operatorUserId, now, stay.tabId);

    // Atualiza quarto: LIVRE e SUJO (enviado para governança/limpeza)
    this.db.prepare(`
      UPDATE hotel_rooms
      SET occupancy_status = 'LIVRE',
          status = 'AVAILABLE',
          housekeeping_status = 'SUJO',
          current_guest_name = NULL,
          current_guest_id = NULL,
          active_stay_id = NULL,
          active_tab_id = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(now, stay.roomId);

    // Registra log de governança
    this.db.prepare(`
      INSERT INTO hotel_housekeeping_logs (
        id, room_number, action, previous_status, new_status, attendant_user_id, attendant_name, notes, created_at
      ) VALUES (?, ?, 'SET_DIRTY', 'LIMPO', 'SUJO', ?, ?, 'Encaminhado para limpeza após check-out', ?)
    `).run(crypto.randomUUID(), stay.roomNumber, input.operatorUserId, input.operatorName, now);

    // Se havia reserva vinculada, encerra como CONCLUIDA
    if (stay.reservationId) {
      this.db.prepare(`
        UPDATE hotel_reservations
        SET status = 'CONCLUIDA', updated_at = ?
        WHERE id = ?
      `).run(now, stay.reservationId);
    }

    const updatedStay = this.getHotelStayById(stayId)!;
    const updatedRoom = this.getHotelRoomById(stay.roomId)!;
    const updatedTab = this.getTabById(stay.tabId)!;

    this.appendOutboxEvent({
      idempotencyKey: `hotel-stay-checkout-${stay.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_STAY',
      entityId: stay.id,
      operation: 'UPSERT',
      entityVersion: 2,
      payload: updatedStay
    });

    this.appendOutboxEvent({
      idempotencyKey: `hotel-room-checkout-${updatedRoom.id}-${stay.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_ROOM',
      entityId: updatedRoom.id,
      operation: 'UPSERT',
      entityVersion: 2,
      payload: updatedRoom
    });

    this.recordAuditLog({
      actorUserId: input.operatorUserId,
      action: 'HOTEL_CHECKOUT',
      entityType: 'HOTEL_STAY',
      entityId: stay.id,
      metadata: { stayCode: stay.stayCode, roomNumber: stay.roomNumber, balanceCents: totals.balanceCents }
    });

    return { stay: updatedStay, room: updatedRoom, folioTab: updatedTab, balanceCents: totals.balanceCents };
  }

  // ============================================================================
  // CONTA DO HÓSPEDE (HOTEL FOLIO & INTEGRAÇÃO RESTAURANTE)
  // ============================================================================

  private mapHotelFolioEntryRow(r: Record<string, unknown>): HotelFolioEntry {
    return {
      id: String(r.id),
      stayId: String(r.stay_id),
      tabId: String(r.tab_id),
      roomNumber: String(r.room_number),
      entryType: r.entry_type as HotelFolioEntryType,
      description: String(r.description),
      amountCents: Number(r.amount_cents),
      sourceReferenceType: r.source_reference_type ? String(r.source_reference_type) : null,
      sourceReferenceId: r.source_reference_id ? String(r.source_reference_id) : null,
      sourceDetailsJson: r.source_details_json ? String(r.source_details_json) : null,
      operatorUserId: String(r.operator_user_id),
      operatorName: String(r.operator_name),
      createdAt: String(r.created_at)
    };
  }

  public listFolioEntriesByStayId(stayId: string): HotelFolioEntry[] {
    const rows = this.db.prepare('SELECT * FROM hotel_folio_entries WHERE stay_id = ? ORDER BY created_at ASC')
      .all(stayId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapHotelFolioEntryRow(r));
  }

  public addFolioEntry(input: {
    stayId: string;
    entryType: HotelFolioEntryType;
    description: string;
    amountCents: number;
    sourceReferenceType?: string;
    sourceReferenceId?: string;
    sourceDetailsJson?: string;
    operatorUserId: string;
    operatorName: string;
  }): HotelFolioEntry {
    const stay = this.getHotelStayById(input.stayId);
    if (!stay) {
      throw new Error(`Estadia '${input.stayId}' não encontrada.`);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO hotel_folio_entries (
        id, stay_id, tab_id, room_number, entry_type, description, amount_cents,
        source_reference_type, source_reference_id, source_details_json,
        operator_user_id, operator_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      stay.id,
      stay.tabId,
      stay.roomNumber,
      input.entryType,
      input.description,
      input.amountCents,
      input.sourceReferenceType || null,
      input.sourceReferenceId || null,
      input.sourceDetailsJson || null,
      input.operatorUserId,
      input.operatorName,
      now
    );

    const entry: HotelFolioEntry = {
      id,
      stayId: stay.id,
      tabId: stay.tabId,
      roomNumber: stay.roomNumber,
      entryType: input.entryType,
      description: input.description,
      amountCents: input.amountCents,
      sourceReferenceType: input.sourceReferenceType || null,
      sourceReferenceId: input.sourceReferenceId || null,
      sourceDetailsJson: input.sourceDetailsJson || null,
      operatorUserId: input.operatorUserId,
      operatorName: input.operatorName,
      createdAt: now
    };

    this.appendOutboxEvent({
      idempotencyKey: `hotel-folio-entry-${id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'HOTEL_FOLIO_ENTRY',
      entityId: id,
      operation: 'APPEND_LEDGER',
      entityVersion: 1,
      payload: entry
    });

    return entry;
  }

  // Seção 10: Integração Restaurante -> Folio do Quarto
  public transferRestaurantTabToFolio(input: {
    restaurantTabId: string;
    roomNumber: string;
    operatorUserId: string;
    operatorName: string;
  }): { folioEntry: HotelFolioEntry; restaurantTab: Tab; payment: Payment } {
    const tab = this.getTabById(input.restaurantTabId);
    if (!tab) {
      throw new Error(`Comanda '${input.restaurantTabId}' não encontrada.`);
    }
    if (tab.status === 'CLOSED') {
      throw new Error(`Comanda '${tab.code}' já se encontra encerrada.`);
    }

    const stay = this.getActiveStayByRoomNumber(input.roomNumber);
    if (!stay) {
      throw new Error(`Apartamento ${input.roomNumber} não possui hospedagem ativa no momento.`);
    }

    // Regra da Seção 10: Impedir duplicidade de cobrança
    const existingTransfer = this.db.prepare(`
      SELECT id FROM hotel_folio_entries
      WHERE source_reference_type = 'TAB' AND source_reference_id = ?
    `).get(tab.id) as { id?: string } | undefined;

    if (existingTransfer) {
      throw new Error(`O consumo da comanda '${tab.code}' já foi transferido para a conta do quarto anteriormente.`);
    }

    const remainingCents = Math.max(0, tab.totalCents - tab.paidCents);

    if (remainingCents <= 0) {
      throw new Error(`Comanda '${tab.code}' não possui saldo pendente para transferência.`);
    }

    const now = new Date().toISOString();

    // 1. Registra pagamento na comanda com o método ROOM_CHARGE
    // Não baixa estoque novamente (já baixado no pedido) e não inflaciona dinheiro em caixa
    const { payment } = this.recordPayment({
      tabId: tab.id,
      amountCents: remainingCents,
      method: 'ROOM_CHARGE',
      operatorUserId: input.operatorUserId,
      confirmationMode: 'MANUAL_DECLARED',
      idempotencyKey: `room-charge-tab-${tab.id}-${Date.now()}`
    });

    // 2. Encerra a comanda do restaurante
    this.db.prepare(`
      UPDATE tabs
      SET status = 'CLOSED', closed_at = ?, closed_by_user_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, input.operatorUserId, now, tab.id);

    // 3. Libera mesa física caso estivesse vinculada
    if (tab.tableNumber) {
      this.db.prepare(`
        UPDATE dining_tables_qr
        SET physical_status = 'LIVRE', active_tab_id = NULL, guests_count = 0, opened_at = NULL, updated_at = ?
        WHERE table_number = ? AND active_tab_id = ?
      `).run(now, tab.tableNumber, tab.id);
    }

    // 4. Lança o débito correspondente no folio da hospedagem
    const folioEntry = this.addFolioEntry({
      stayId: stay.id,
      entryType: 'RESTAURANT_ORDER',
      description: `Consumo Restaurante/Bar — Comanda ${tab.code}${tab.tableNumber ? ` (Mesa ${tab.tableNumber})` : ''}`,
      amountCents: remainingCents,
      sourceReferenceType: 'TAB',
      sourceReferenceId: tab.id,
      sourceDetailsJson: JSON.stringify({
        tabId: tab.id,
        tabCode: tab.code,
        tableNumber: tab.tableNumber,
        customerName: tab.customerName,
        subtotalCents: tab.subtotalCents,
        serviceFeeCents: tab.serviceFeeCents
      }),
      operatorUserId: input.operatorUserId,
      operatorName: input.operatorName
    });

    const updatedTab = this.getTabById(tab.id)!;

    this.recordAuditLog({
      actorUserId: input.operatorUserId,
      action: 'HOTEL_TRANSFER_TAB_TO_FOLIO',
      entityType: 'TAB',
      entityId: tab.id,
      metadata: { roomNumber: input.roomNumber, stayId: stay.id, amountCents: remainingCents }
    });

    return { folioEntry, restaurantTab: updatedTab, payment };
  }

  // ============================================================================
  // FRIGOBAR (ITENS, CONSUMOS E REPOSIÇÃO)
  // ============================================================================

  public listMinibarItemsByRoom(roomNumber: string): HotelMinibarItem[] {
    const rows = this.db.prepare('SELECT * FROM hotel_minibar_items WHERE room_number = ? ORDER BY product_name ASC')
      .all(roomNumber) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      roomNumber: String(r.room_number),
      productId: String(r.product_id),
      productName: String(r.product_name),
      initialQuantity: Number(r.initial_quantity),
      currentQuantity: Number(r.current_quantity),
      unitPriceCents: Number(r.unit_price_cents),
      updatedAt: String(r.updated_at)
    }));
  }

  public configureMinibarItem(input: {
    roomNumber: string;
    productId: string;
    initialQuantity: number;
    unitPriceCents?: number;
  }): HotelMinibarItem {
    const prod = this.db.prepare('SELECT * FROM catalog_products WHERE id = ?').get(input.productId) as Record<string, unknown> | undefined;
    if (!prod) {
      throw new Error(`Produto '${input.productId}' não encontrado no catálogo.`);
    }
    const productName = String(prod.name);
    const price = input.unitPriceCents ?? Number(prod.price_cents);
    const now = new Date().toISOString();
    const id = `mb-${input.roomNumber}-${input.productId}`;

    this.db.prepare(`
      INSERT INTO hotel_minibar_items (id, room_number, product_id, product_name, initial_quantity, current_quantity, unit_price_cents, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_number, product_id) DO UPDATE SET
        initial_quantity = excluded.initial_quantity,
        current_quantity = excluded.initial_quantity,
        unit_price_cents = excluded.unit_price_cents,
        updated_at = excluded.updated_at
    `).run(id, input.roomNumber, input.productId, productName, input.initialQuantity, input.initialQuantity, price, now);

    return this.listMinibarItemsByRoom(input.roomNumber).find((i) => i.productId === input.productId)!;
  }

  public recordMinibarConsumption(input: {
    stayId: string;
    roomNumber: string;
    productId: string;
    quantity: number;
    operatorUserId: string;
    operatorName: string;
  }): { consumption: HotelMinibarConsumption; folioEntry: HotelFolioEntry } {
    const stay = this.getHotelStayById(input.stayId);
    if (!stay) {
      throw new Error(`Estadia '${input.stayId}' não encontrada.`);
    }
    const item = this.listMinibarItemsByRoom(input.roomNumber).find((i) => i.productId === input.productId);
    if (!item) {
      throw new Error(`Item de frigobar '${input.productId}' não configurado no quarto ${input.roomNumber}.`);
    }

    const now = new Date().toISOString();
    const consumptionId = crypto.randomUUID();
    const totalCents = item.unitPriceCents * input.quantity;

    // Lança consumo no folio
    const folioEntry = this.addFolioEntry({
      stayId: stay.id,
      entryType: 'MINIBAR',
      description: `Frigobar: ${input.quantity}x ${item.productName}`,
      amountCents: totalCents,
      sourceReferenceType: 'MINIBAR',
      sourceReferenceId: consumptionId,
      operatorUserId: input.operatorUserId,
      operatorName: input.operatorName
    });

    // Registra log de consumo de frigobar
    this.db.prepare(`
      INSERT INTO hotel_minibar_consumptions (
        id, stay_id, room_number, product_id, product_name, quantity, unit_price_cents, total_cents,
        movement_type, folio_entry_id, recorded_by_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONSUMPTION', ?, ?, ?)
    `).run(
      consumptionId,
      stay.id,
      input.roomNumber,
      item.productId,
      item.productName,
      input.quantity,
      item.unitPriceCents,
      totalCents,
      folioEntry.id,
      input.operatorUserId,
      now
    );

    // Atualiza quantidade restante no frigobar do apartamento
    const newQty = Math.max(0, item.currentQuantity - input.quantity);
    this.db.prepare(`
      UPDATE hotel_minibar_items
      SET current_quantity = ?, updated_at = ?
      WHERE room_number = ? AND product_id = ?
    `).run(newQty, now, input.roomNumber, item.productId);

    const consumption: HotelMinibarConsumption = {
      id: consumptionId,
      stayId: stay.id,
      roomNumber: input.roomNumber,
      productId: item.productId,
      productName: item.productName,
      quantity: input.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents,
      movementType: 'CONSUMPTION',
      folioEntryId: folioEntry.id,
      recordedByUserId: input.operatorUserId,
      createdAt: now
    };

    return { consumption, folioEntry };
  }

  public restockMinibarItem(input: {
    roomNumber: string;
    productId: string;
    addedQuantity: number;
    operatorUserId: string;
  }): HotelMinibarItem {
    const item = this.listMinibarItemsByRoom(input.roomNumber).find((i) => i.productId === input.productId);
    if (!item) {
      throw new Error(`Item de frigobar '${input.productId}' não configurado no quarto ${input.roomNumber}.`);
    }
    const now = new Date().toISOString();
    const newQty = item.currentQuantity + input.addedQuantity;
    this.db.prepare(`
      UPDATE hotel_minibar_items
      SET current_quantity = ?, updated_at = ?
      WHERE room_number = ? AND product_id = ?
    `).run(newQty, now, input.roomNumber, input.productId);

    return this.listMinibarItemsByRoom(input.roomNumber).find((i) => i.productId === input.productId)!;
  }

  // ============================================================================
  // SERVIÇOS ADICIONAIS (LAVANDERIA, CAFÉ, ESTACIONAMENTO, ETC.)
  // ============================================================================

  public listHotelServices(activeOnly: boolean = false): HotelService[] {
    const query = activeOnly
      ? 'SELECT * FROM hotel_services WHERE active = 1 ORDER BY name ASC'
      : 'SELECT * FROM hotel_services ORDER BY name ASC';
    const rows = this.db.prepare(query).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      category: r.category as HotelService['category'],
      defaultPriceCents: Number(r.default_price_cents),
      active: Boolean(r.active),
      createdAt: String(r.created_at)
    }));
  }

  public createHotelService(input: {
    id?: string;
    name: string;
    category?: HotelServiceCategory;
    defaultPriceCents: number;
  }): HotelService {
    const id = input.id || `srv-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO hotel_services (id, name, category, default_price_cents, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `).run(id, input.name, input.category || 'GERAL', input.defaultPriceCents, now);

    return {
      id,
      name: input.name,
      category: input.category || 'GERAL',
      defaultPriceCents: input.defaultPriceCents,
      active: true,
      createdAt: now
    };
  }

  public orderHotelService(input: {
    stayId: string;
    serviceId: string;
    quantity?: number;
    unitPriceCents?: number;
    operatorUserId: string;
    operatorName: string;
  }): { order: HotelServiceOrder; folioEntry: HotelFolioEntry } {
    const stay = this.getHotelStayById(input.stayId);
    if (!stay) {
      throw new Error(`Estadia '${input.stayId}' não encontrada.`);
    }
    const services = this.listHotelServices();
    const service = services.find((s) => s.id === input.serviceId);
    if (!service) {
      throw new Error(`Serviço '${input.serviceId}' não encontrado.`);
    }

    const qty = input.quantity ?? 1;
    const unitPrice = input.unitPriceCents ?? service.defaultPriceCents;
    const totalCents = qty * unitPrice;
    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();

    const folioEntry = this.addFolioEntry({
      stayId: stay.id,
      entryType: 'SERVICE',
      description: `Serviço: ${qty}x ${service.name}`,
      amountCents: totalCents,
      sourceReferenceType: 'SERVICE',
      sourceReferenceId: orderId,
      operatorUserId: input.operatorUserId,
      operatorName: input.operatorName
    });

    this.db.prepare(`
      INSERT INTO hotel_service_orders (
        id, stay_id, service_id, service_name, quantity, unit_price_cents, total_cents,
        folio_entry_id, status, operator_user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)
    `).run(
      orderId,
      stay.id,
      service.id,
      service.name,
      qty,
      unitPrice,
      totalCents,
      folioEntry.id,
      input.operatorUserId,
      now
    );

    const order: HotelServiceOrder = {
      id: orderId,
      stayId: stay.id,
      serviceId: service.id,
      serviceName: service.name,
      quantity: qty,
      unitPriceCents: unitPrice,
      totalCents,
      folioEntryId: folioEntry.id,
      status: 'CONFIRMED',
      operatorUserId: input.operatorUserId,
      createdAt: now
    };

    return { order, folioEntry };
  }

  // ============================================================================
  // GOVERNANÇA, LIMPEZA E MANUTENÇÃO
  // ============================================================================

  public listHousekeepingLogs(roomNumber?: string): HotelHousekeepingLog[] {
    const query = roomNumber
      ? 'SELECT * FROM hotel_housekeeping_logs WHERE room_number = ? ORDER BY created_at DESC'
      : 'SELECT * FROM hotel_housekeeping_logs ORDER BY created_at DESC LIMIT 100';
    const rows = roomNumber
      ? (this.db.prepare(query).all(roomNumber) as Array<Record<string, unknown>>)
      : (this.db.prepare(query).all() as Array<Record<string, unknown>>);

    return rows.map((r) => ({
      id: String(r.id),
      roomNumber: String(r.room_number),
      action: r.action as HotelHousekeepingAction,
      previousStatus: String(r.previous_status),
      newStatus: String(r.new_status),
      attendantUserId: String(r.attendant_user_id),
      attendantName: String(r.attendant_name),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at)
    }));
  }

  public updateHousekeepingStatus(input: {
    roomNumber: string;
    action: HotelHousekeepingAction;
    attendantUserId: string;
    attendantName: string;
    notes?: string;
  }): { room: HotelRoom; log: HotelHousekeepingLog } {
    const room = this.getHotelRoomByNumber(input.roomNumber);
    if (!room) {
      throw new Error(`Apartamento ${input.roomNumber} não cadastrado.`);
    }

    // Regra da Seção 15: Impedir liberação de quarto interditado ou em manutenção
    if ((room.maintenanceStatus === 'INTERDITADO' || room.maintenanceStatus === 'EM_MANUTENCAO') &&
        (input.action === 'APPROVE_INSPECTION' || input.action === 'FINISH_CLEANING')) {
      throw new Error(
        `Liberação bloqueada: Apartamento ${room.number} está sob manutenção (${room.maintenanceStatus}). Resolva a manutenção antes de liberar.`
      );
    }

    let newHousekeeping: RoomHousekeepingStatus = room.housekeepingStatus;
    switch (input.action) {
      case 'SET_DIRTY':
        newHousekeeping = 'SUJO';
        break;
      case 'START_CLEANING':
        newHousekeeping = 'EM_LIMPEZA';
        break;
      case 'FINISH_CLEANING':
        newHousekeeping = 'INSPECAO_PENDENTE';
        break;
      case 'REQUEST_INSPECTION':
        newHousekeeping = 'INSPECAO_PENDENTE';
        break;
      case 'APPROVE_INSPECTION':
        newHousekeeping = 'LIMPO';
        break;
      case 'REJECT_INSPECTION':
        newHousekeeping = 'SUJO';
        break;
    }

    const now = new Date().toISOString();
    const logId = crypto.randomUUID();

    this.db.prepare(`
      UPDATE hotel_rooms
      SET housekeeping_status = ?, updated_at = ?
      WHERE id = ?
    `).run(newHousekeeping, now, room.id);

    this.db.prepare(`
      INSERT INTO hotel_housekeeping_logs (
        id, room_number, action, previous_status, new_status, attendant_user_id, attendant_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      room.number,
      input.action,
      room.housekeepingStatus,
      newHousekeeping,
      input.attendantUserId,
      input.attendantName,
      input.notes || '',
      now
    );

    const updatedRoom = this.getHotelRoomById(room.id)!;
    const log: HotelHousekeepingLog = {
      id: logId,
      roomNumber: room.number,
      action: input.action,
      previousStatus: room.housekeepingStatus,
      newStatus: newHousekeeping,
      attendantUserId: input.attendantUserId,
      attendantName: input.attendantName,
      notes: input.notes || '',
      createdAt: now
    };

    return { room: updatedRoom, log };
  }

  public listMaintenanceRecords(filters?: {
    roomNumber?: string;
    status?: HotelMaintenanceStatus;
  }): HotelMaintenanceRecord[] {
    let sql = 'SELECT * FROM hotel_maintenance_records WHERE 1=1';
    const params: any[] = [];
    if (filters?.roomNumber) {
      sql += ' AND room_number = ?';
      params.push(filters.roomNumber);
    }
    if (filters?.status) {
      sql += ' AND maintenance_status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      roomNumber: String(r.room_number),
      issueDescription: String(r.issue_description),
      priority: r.priority as HotelMaintenancePriority,
      maintenanceStatus: r.maintenance_status as HotelMaintenanceStatus,
      reportedByUserId: String(r.reported_by_user_id),
      reportedByName: String(r.reported_by_name),
      assignedTo: String(r.assigned_to || ''),
      resolutionNotes: String(r.resolution_notes || ''),
      resolvedByUserId: r.resolved_by_user_id ? String(r.resolved_by_user_id) : null,
      resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    }));
  }

  public createMaintenanceRecord(input: {
    roomNumber: string;
    issueDescription: string;
    priority?: HotelMaintenancePriority;
    blockRoom?: boolean;
    reportedByUserId: string;
    reportedByName: string;
    assignedTo?: string;
  }): { record: HotelMaintenanceRecord; room: HotelRoom } {
    const room = this.getHotelRoomByNumber(input.roomNumber);
    if (!room) {
      throw new Error(`Apartamento ${input.roomNumber} não cadastrado.`);
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const priority = input.priority || 'NORMAL';
    const shouldBlock = input.blockRoom || priority === 'CRITICAL';
    const maintenanceStatus: HotelMaintenanceStatus = shouldBlock ? 'INTERDITADO' : 'EM_MANUTENCAO';

    this.db.prepare(`
      INSERT INTO hotel_maintenance_records (
        id, room_number, issue_description, priority, maintenance_status,
        reported_by_user_id, reported_by_name, assigned_to, resolution_notes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)
    `).run(
      id,
      room.number,
      input.issueDescription,
      priority,
      maintenanceStatus,
      input.reportedByUserId,
      input.reportedByName,
      input.assignedTo || '',
      now,
      now
    );

    if (shouldBlock) {
      this.db.prepare(`
        UPDATE hotel_rooms
        SET maintenance_status = ?,
            occupancy_status = CASE WHEN occupancy_status = 'LIVRE' THEN 'BLOQUEADO' ELSE occupancy_status END,
            updated_at = ?
        WHERE id = ?
      `).run(maintenanceStatus, now, room.id);
    } else {
      this.db.prepare(`
        UPDATE hotel_rooms
        SET maintenance_status = ?, updated_at = ?
        WHERE id = ?
      `).run(maintenanceStatus, now, room.id);
    }

    const updatedRoom = this.getHotelRoomById(room.id)!;
    const record: HotelMaintenanceRecord = {
      id,
      roomNumber: room.number,
      issueDescription: input.issueDescription,
      priority,
      maintenanceStatus,
      reportedByUserId: input.reportedByUserId,
      reportedByName: input.reportedByName,
      assignedTo: input.assignedTo || '',
      resolutionNotes: '',
      resolvedByUserId: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now
    };

    return { record, room: updatedRoom };
  }

  public resolveMaintenanceRecord(
    recordId: string,
    input: {
      resolutionNotes: string;
      resolvedByUserId: string;
    }
  ): { record: HotelMaintenanceRecord; room: HotelRoom } {
    const row = this.db.prepare('SELECT * FROM hotel_maintenance_records WHERE id = ?').get(recordId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Registro de manutenção '${recordId}' não encontrado.`);
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE hotel_maintenance_records
      SET maintenance_status = 'RESOLVED',
          resolution_notes = ?,
          resolved_by_user_id = ?,
          resolved_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(input.resolutionNotes, input.resolvedByUserId, now, now, recordId);

    const roomNumber = String(row.room_number);
    const remainingActive = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM hotel_maintenance_records
      WHERE room_number = ? AND maintenance_status IN ('EM_MANUTENCAO', 'INTERDITADO')
    `).get(roomNumber) as { cnt: number };

    if (remainingActive.cnt === 0) {
      this.db.prepare(`
        UPDATE hotel_rooms
        SET maintenance_status = 'DISPONIVEL',
            occupancy_status = CASE WHEN occupancy_status = 'BLOQUEADO' THEN 'LIVRE' ELSE occupancy_status END,
            updated_at = ?
        WHERE number = ?
      `).run(now, roomNumber);
    }

    const updatedRoom = this.getHotelRoomByNumber(roomNumber)!;
    const updatedRecord = this.listMaintenanceRecords().find((r) => r.id === recordId)!;

    return { record: updatedRecord, room: updatedRoom };
  }

  // ============================================================================
  // DASHBOARD HOTELEIRO & INDICADORES (ADR, RevPAR, OCUPAÇÃO)
  // ============================================================================

  public getHotelDashboardMetrics(): HotelDashboardMetrics {
    const rooms = this.listHotelRooms();
    const activeRooms = rooms.filter((r) => r.active);
    const totalRooms = activeRooms.length;
    const occupiedRooms = activeRooms.filter((r) => r.occupancyStatus === 'OCUPADO').length;
    const availableRooms = activeRooms.filter((r) => r.occupancyStatus === 'LIVRE' && r.maintenanceStatus === 'DISPONIVEL').length;
    const dirtyCleaningRooms = activeRooms.filter((r) => r.housekeepingStatus === 'SUJO' || r.housekeepingStatus === 'EM_LIMPEZA' || r.housekeepingStatus === 'INSPECAO_PENDENTE').length;
    const maintenanceRooms = activeRooms.filter((r) => r.maintenanceStatus === 'EM_MANUTENCAO' || r.maintenanceStatus === 'INTERDITADO').length;
    const blockedRooms = activeRooms.filter((r) => r.occupancyStatus === 'BLOQUEADO').length;

    const occupancyRatePercent = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 1000) / 10 : 0;

    // ADR (Diária Média): soma das diárias dos quartos ocupados / total de quartos ocupados
    const occupiedRoomRatesSum = activeRooms
      .filter((r) => r.occupancyStatus === 'OCUPADO')
      .reduce((sum, r) => sum + r.dailyRateCents, 0);
    const adrCents = occupiedRooms > 0 ? Math.round(occupiedRoomRatesSum / occupiedRooms) : 0;

    // RevPAR: Receita Total de Diárias / Total de Quartos Ativos
    const revparCents = totalRooms > 0 ? Math.round(occupiedRoomRatesSum / totalRooms) : 0;

    const todayStr = new Date().toISOString().slice(0, 10);

    // Check-ins previstos para hoje
    const expectedCheckInsToday = (
      this.db.prepare(`
        SELECT COUNT(*) as cnt FROM hotel_reservations
        WHERE check_in_date = ? AND status IN ('CONFIRMADA', 'PENDENTE')
      `).get(todayStr) as { cnt: number }
    ).cnt;

    // Check-outs previstos para hoje
    const expectedCheckOutsToday = (
      this.db.prepare(`
        SELECT COUNT(*) as cnt FROM hotel_stays
        WHERE substr(check_out_scheduled_at, 1, 10) = ? AND status = 'ACTIVE'
      `).get(todayStr) as { cnt: number }
    ).cnt;

    // Lançamentos no folio: Cobranças vs Pagamentos
    const folioEntries = this.db.prepare('SELECT amount_cents FROM hotel_folio_entries').all() as Array<{ amount_cents: number }>;
    let totalFolioRevenueCents = 0;
    let totalPaymentsReceivedCents = 0;

    for (const entry of folioEntries) {
      if (entry.amount_cents > 0) {
        totalFolioRevenueCents += entry.amount_cents;
      } else {
        totalPaymentsReceivedCents += Math.abs(entry.amount_cents);
      }
    }

    const totalBalancePendingCents = Math.max(0, totalFolioRevenueCents - totalPaymentsReceivedCents);

    return {
      totalRooms,
      occupiedRooms,
      availableRooms,
      dirtyCleaningRooms,
      maintenanceRooms,
      blockedRooms,
      occupancyRatePercent,
      adrCents,
      revparCents,
      expectedCheckInsToday,
      expectedCheckOutsToday,
      totalFolioRevenueCents,
      totalPaymentsReceivedCents,
      totalBalancePendingCents
    };
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

  // ============================================================================
  // ETAPA 6: MÉTODOS DE DELIVERY PRÓPRIO
  // ============================================================================

  public listDeliveryZones(activeOnly = true): DeliveryZone[] {
    const sql = activeOnly
      ? 'SELECT * FROM delivery_zones WHERE active = 1 ORDER BY fee_cents ASC'
      : 'SELECT * FROM delivery_zones ORDER BY fee_cents ASC';
    const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map((r) => this.mapDeliveryZoneRow(r));
  }

  public getDeliveryZoneById(id: string): DeliveryZone | null {
    const row = this.db.prepare('SELECT * FROM delivery_zones WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDeliveryZoneRow(row) : null;
  }

  public createDeliveryZone(zone: Omit<DeliveryZone, 'id'>): DeliveryZone {
    const id = `zone-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO delivery_zones (id, name, fee_cents, minimum_order_cents, estimated_minutes, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(id, zone.name, zone.feeCents, zone.minimumOrderCents, zone.estimatedMinutes, zone.active ? 1 : 0);
    return this.getDeliveryZoneById(id)!;
  }

  public updateDeliveryZone(id: string, updates: Partial<DeliveryZone>): DeliveryZone {
    const existing = this.getDeliveryZoneById(id);
    if (!existing) throw new Error(`Zona de entrega '${id}' não encontrada.`);
    const name = updates.name ?? existing.name;
    const feeCents = updates.feeCents ?? existing.feeCents;
    const minimumOrderCents = updates.minimumOrderCents ?? existing.minimumOrderCents;
    const estimatedMinutes = updates.estimatedMinutes ?? existing.estimatedMinutes;
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : (existing.active ? 1 : 0);
    this.db.prepare(`
      UPDATE delivery_zones
      SET name = ?, fee_cents = ?, minimum_order_cents = ?, estimated_minutes = ?, active = ?
      WHERE id = ?
    `).run(name, feeCents, minimumOrderCents, estimatedMinutes, active, id);
    return this.getDeliveryZoneById(id)!;
  }

  public listDeliveryCouriers(status?: DeliveryCourierStatus): DeliveryCourier[] {
    let sql = 'SELECT * FROM delivery_couriers WHERE active = 1';
    const params: (string | number | bigint | null)[] = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY name ASC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapDeliveryCourierRow(r));
  }

  public getDeliveryCourierById(id: string): DeliveryCourier | null {
    const row = this.db.prepare('SELECT * FROM delivery_couriers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDeliveryCourierRow(row) : null;
  }

  public createDeliveryCourier(courier: Omit<DeliveryCourier, 'id' | 'active'> & { active?: boolean }): DeliveryCourier {
    const id = `cr-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO delivery_couriers (id, name, phone, vehicle_type, vehicle_plate, fee_per_delivery_cents, status, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      courier.name,
      courier.phone,
      courier.vehicleType,
      courier.vehiclePlate ?? null,
      courier.feePerDeliveryCents,
      courier.status,
      courier.active !== false ? 1 : 0
    );
    return this.getDeliveryCourierById(id)!;
  }

  public updateDeliveryCourierStatus(id: string, status: DeliveryCourierStatus): DeliveryCourier {
    const existing = this.getDeliveryCourierById(id);
    if (!existing) throw new Error(`Entregador '${id}' não encontrado.`);
    this.db.prepare('UPDATE delivery_couriers SET status = ? WHERE id = ?').run(status, id);
    return this.getDeliveryCourierById(id)!;
  }

  public updateDeliveryCourier(id: string, updates: Partial<DeliveryCourier>): DeliveryCourier {
    const existing = this.getDeliveryCourierById(id);
    if (!existing) throw new Error(`Entregador '${id}' não encontrado.`);
    const name = updates.name ?? existing.name;
    const phone = updates.phone ?? existing.phone;
    const vehicleType = updates.vehicleType ?? existing.vehicleType;
    const vehiclePlate = updates.vehiclePlate !== undefined ? (updates.vehiclePlate ?? null) : (existing.vehiclePlate ?? null);
    const feePerDeliveryCents = updates.feePerDeliveryCents ?? existing.feePerDeliveryCents;
    const status = updates.status ?? existing.status;
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : (existing.active ? 1 : 0);
    this.db.prepare(`
      UPDATE delivery_couriers
      SET name = ?, phone = ?, vehicle_type = ?, vehicle_plate = ?, fee_per_delivery_cents = ?, status = ?, active = ?
      WHERE id = ?
    `).run(name, phone, vehicleType, vehiclePlate, feePerDeliveryCents, status, active, id);
    return this.getDeliveryCourierById(id)!;
  }

  public listDeliveryCustomers(search?: string): DeliveryCustomer[] {
    let sql = 'SELECT * FROM delivery_customers';
    const params: (string | number | bigint | null)[] = [];
    if (search && search.trim()) {
      sql += ' WHERE name LIKE ? OR phone LIKE ? OR document LIKE ?';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }
    sql += ' ORDER BY name ASC LIMIT 100';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => {
      const addresses = this.listDeliveryAddresses(String(r.id));
      return this.mapDeliveryCustomerRow(r, addresses);
    });
  }

  public getDeliveryCustomerById(id: string): DeliveryCustomer | null {
    const row = this.db.prepare('SELECT * FROM delivery_customers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const addresses = this.listDeliveryAddresses(id);
    return this.mapDeliveryCustomerRow(row, addresses);
  }

  public findDeliveryCustomerByPhone(phone: string): DeliveryCustomer | null {
    const cleanPhone = phone.replace(/\D/g, '');
    const row = this.db.prepare(`
      SELECT * FROM delivery_customers
      WHERE replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?
      LIMIT 1
    `).get(`%${cleanPhone}%`) as Record<string, unknown> | undefined;
    if (!row) return null;
    const addresses = this.listDeliveryAddresses(String(row.id));
    return this.mapDeliveryCustomerRow(row, addresses);
  }

  public createOrUpdateDeliveryCustomer(data: {
    name: string;
    phone: string;
    document?: string | null;
    email?: string | null;
    notes?: string | null;
  }): DeliveryCustomer {
    const now = new Date().toISOString();
    const existing = this.findDeliveryCustomerByPhone(data.phone);
    if (existing) {
      this.db.prepare(`
        UPDATE delivery_customers
        SET name = ?, document = COALESCE(?, document), email = COALESCE(?, email), notes = COALESCE(?, notes), updated_at = ?
        WHERE id = ?
      `).run(data.name, data.document ?? null, data.email ?? null, data.notes ?? null, now, existing.id);
      return this.getDeliveryCustomerById(existing.id)!;
    }
    const id = `cust-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO delivery_customers (id, name, phone, document, email, notes, total_orders, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, data.name, data.phone, data.document ?? null, data.email ?? null, data.notes ?? null, now, now);
    return this.getDeliveryCustomerById(id)!;
  }

  public listDeliveryAddresses(customerId: string): DeliveryAddress[] {
    const rows = this.db.prepare('SELECT * FROM delivery_addresses WHERE customer_id = ? ORDER BY is_default DESC, id ASC').all(customerId) as Record<string, unknown>[];
    return rows.map((r) => this.mapDeliveryAddressRow(r));
  }

  public addDeliveryAddress(
    customerId: string,
    address: Omit<DeliveryAddress, 'id' | 'customerId' | 'city'> & { city?: string }
  ): DeliveryAddress {
    const id = `addr-${crypto.randomUUID().slice(0, 8)}`;
    if (address.isDefault) {
      this.db.prepare('UPDATE delivery_addresses SET is_default = 0 WHERE customer_id = ?').run(customerId);
    }
    this.db.prepare(`
      INSERT INTO delivery_addresses (id, customer_id, street, number, complement, neighborhood, city, reference, delivery_zone_id, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      customerId,
      address.street,
      address.number,
      address.complement ?? null,
      address.neighborhood,
      address.city || 'Santa Inês',
      address.reference ?? null,
      address.deliveryZoneId ?? null,
      address.isDefault ? 1 : 0
    );
    const row = this.db.prepare('SELECT * FROM delivery_addresses WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapDeliveryAddressRow(row);
  }

  public listDeliveryOrders(filter?: {
    status?: DeliveryOrderStatus;
    courierId?: string;
    customerId?: string;
    date?: string;
  }): DeliveryOrder[] {
    let sql = 'SELECT * FROM delivery_orders WHERE 1=1';
    const params: (string | number | bigint | null)[] = [];
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.courierId) {
      sql += ' AND courier_id = ?';
      params.push(filter.courierId);
    }
    if (filter?.customerId) {
      sql += ' AND customer_id = ?';
      params.push(filter.customerId);
    }
    if (filter?.date) {
      sql += ' AND date(created_at) = ?';
      params.push(filter.date.slice(0, 10));
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapDeliveryOrderRow(r));
  }

  public getDeliveryOrderById(id: string): DeliveryOrder | null {
    const row = this.db.prepare('SELECT * FROM delivery_orders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapDeliveryOrderRow(row) : null;
  }

  public createDeliveryOrder(input: {
    customerId?: string;
    customerName: string;
    customerPhone: string;
    customerDocument?: string;
    customerEmail?: string;
    deliveryType: DeliveryType;
    origin: DeliveryOrigin;
    deliveryAddress?: Omit<DeliveryAddress, 'id' | 'customerId'>;
    deliveryZoneId?: string;
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
    paymentMethodDeclared: PaymentMethod;
    changeForCents?: number | null;
    notes?: string;
    waiterId?: string;
    courierId?: string;
  }): { deliveryOrder: DeliveryOrder; baseOrder: Order } {
    const now = new Date().toISOString();

    let customer: DeliveryCustomer;
    if (input.customerId) {
      const existing = this.getDeliveryCustomerById(input.customerId);
      if (!existing) throw new Error(`Cliente '${input.customerId}' não encontrado.`);
      customer = existing;
    } else {
      customer = this.createOrUpdateDeliveryCustomer({
        name: input.customerName,
        phone: input.customerPhone,
        document: input.customerDocument,
        email: input.customerEmail
      });
    }

    let resolvedAddress: DeliveryAddress | null = null;
    let resolvedZoneId = input.deliveryZoneId ?? null;
    let deliveryFeeCents = 0;

    if (input.deliveryType === 'DELIVERY') {
      if (input.deliveryAddress) {
        resolvedAddress = this.addDeliveryAddress(customer.id, input.deliveryAddress);
        if (!resolvedZoneId && resolvedAddress.deliveryZoneId) {
          resolvedZoneId = resolvedAddress.deliveryZoneId;
        }
      } else if (customer.addresses.length > 0) {
        resolvedAddress = customer.addresses[0]!;
        if (!resolvedZoneId && resolvedAddress.deliveryZoneId) {
          resolvedZoneId = resolvedAddress.deliveryZoneId;
        }
      }
      if (resolvedZoneId) {
        const zone = this.getDeliveryZoneById(resolvedZoneId);
        if (zone) deliveryFeeCents = zone.feeCents;
      } else {
        deliveryFeeCents = 500;
      }
    } else {
      deliveryFeeCents = 0;
    }

    const idempotencyKey = `d26-deliv-${crypto.randomUUID()}`;
    const salesChannel: SalesChannel = input.deliveryType === 'DELIVERY' ? 'DELIVERY' : 'PICKUP';

    const { order: baseOrder } = this.createOrder({
      idempotencyKey,
      channel: salesChannel,
      originNode: 'WINDOWS_PDV',
      items: input.items,
      customerNotes: input.notes,
      waiterUserId: input.waiterId ?? 'usr-cashier-01'
    });

    const itemsSubtotalCents = baseOrder.totalOrderCents;
    const discountCents = 0;
    const totalCents = itemsSubtotalCents + deliveryFeeCents - discountCents;

    const maxOrderRow = this.db.prepare('SELECT MAX(order_number) as max_num FROM delivery_orders').get() as { max_num?: number };
    const nextOrderNumber = (maxOrderRow?.max_num ?? 0) + 1;

    let courierName: string | null = null;
    let courierFeeCents = 0;
    if (input.courierId) {
      const courier = this.getDeliveryCourierById(input.courierId);
      if (courier) {
        courierName = courier.name;
        courierFeeCents = courier.feePerDeliveryCents;
      }
    }

    const deliveryOrderId = `deliv-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO delivery_orders (
        id, order_number, order_id, customer_id, customer_name, customer_phone,
        delivery_type, origin, status, delivery_address_json, delivery_zone_id,
        delivery_fee_cents, items_subtotal_cents, discount_cents, total_cents,
        payment_method_declared, payment_status, change_for_cents,
        courier_id, courier_name, courier_fee_cents,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, 'NOVO', ?, ?,
        ?, ?, ?, ?,
        ?, 'PENDING', ?,
        ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      deliveryOrderId,
      nextOrderNumber,
      baseOrder.id,
      customer.id,
      customer.name,
      customer.phone,
      input.deliveryType,
      input.origin,
      resolvedAddress ? JSON.stringify(resolvedAddress) : null,
      resolvedZoneId,
      deliveryFeeCents,
      itemsSubtotalCents,
      discountCents,
      totalCents,
      input.paymentMethodDeclared,
      input.changeForCents ?? null,
      input.courierId ?? null,
      courierName,
      courierFeeCents,
      input.notes ?? null,
      now,
      now
    );

    this.db.prepare('UPDATE delivery_customers SET total_orders = total_orders + 1, updated_at = ? WHERE id = ?').run(now, customer.id);

    this.createAccountReceivable({
      description: `Delivery #${nextOrderNumber} — ${customer.name}`,
      origin: 'DELIVERY',
      originReferenceId: deliveryOrderId,
      costCenterId: 'DELIV',
      categoryId: 'cat-rec-deliv',
      totalAmountCents: totalCents,
      accrualDate: now.slice(0, 10),
      dueDate: now.slice(0, 10),
      status: 'PENDING',
      customerName: customer.name,
      notes: `Pedido Delivery #${nextOrderNumber} (${input.origin})`
    });

    const deliveryOrder = this.getDeliveryOrderById(deliveryOrderId)!;
    return { deliveryOrder, baseOrder };
  }

  public updateDeliveryOrderStatus(
    deliveryOrderId: string,
    newStatus: DeliveryOrderStatus,
    actorUserId: string,
    reason?: string
  ): DeliveryOrder {
    const order = this.getDeliveryOrderById(deliveryOrderId);
    if (!order) throw new Error(`Pedido delivery '${deliveryOrderId}' não encontrado.`);

    const now = new Date().toISOString();
    let dispatchedAt = order.dispatchedAt;
    let deliveredAt = order.deliveredAt;
    let canceledAt = order.canceledAt;
    let cancelReason = order.cancelReason;
    let paymentStatus = order.paymentStatus;

    if (newStatus === 'SAIU_PARA_ENTREGA' && !dispatchedAt) {
      dispatchedAt = now;
    }
    if (newStatus === 'ENTREGUE') {
      if (!deliveredAt) deliveredAt = now;
      paymentStatus = 'PAID';
      const receivable = this.db.prepare(`
        SELECT id FROM accounts_receivable
        WHERE origin = 'DELIVERY' AND origin_reference_id = ? AND status != 'PAID'
      `).get(deliveryOrderId) as { id?: string } | undefined;
      if (receivable) {
        this.payAccountReceivable(receivable.id!, {
          amountCents: order.totalCents,
          financialAccountId: 'acc-caixa-geral',
          paymentMethod: order.paymentMethodDeclared,
          actorUserId,
          settlementDate: now.slice(0, 10),
          notes: `Baixa automática entrega concluída pedido #${order.orderNumber}`
        });
      }
      if (order.courierId) {
        this.updateDeliveryCourierStatus(order.courierId, 'DISPONIVEL');
      }
    }
    if (newStatus === 'CANCELADO') {
      canceledAt = now;
      cancelReason = reason || 'Cancelado pelo operador';
      this.db.prepare(`
        UPDATE accounts_receivable SET status = 'CANCELED', updated_at = ?
        WHERE origin = 'DELIVERY' AND origin_reference_id = ?
      `).run(now, deliveryOrderId);
      try {
        this.advanceOrderStatus({
          orderId: order.orderId,
          newStatus: 'CANCELLED',
          originNode: 'WINDOWS_PDV',
          reverseStockOnCancel: true,
          cancelReason,
          actorUserId
        });
      } catch {
        // Ignora se o pedido base já estava cancelado
      }
      if (order.courierId) {
        this.updateDeliveryCourierStatus(order.courierId, 'DISPONIVEL');
      }
    }

    this.db.prepare(`
      UPDATE delivery_orders
      SET status = ?, dispatched_at = ?, delivered_at = ?, canceled_at = ?, cancel_reason = ?, payment_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      newStatus,
      dispatchedAt ?? null,
      deliveredAt ?? null,
      canceledAt ?? null,
      cancelReason ?? null,
      paymentStatus,
      now,
      deliveryOrderId
    );

    return this.getDeliveryOrderById(deliveryOrderId)!;
  }

  public dispatchDeliveryOrder(deliveryOrderId: string, courierId: string, actorUserId: string): DeliveryOrder {
    const courier = this.getDeliveryCourierById(courierId);
    if (!courier) throw new Error(`Entregador '${courierId}' não encontrado.`);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE delivery_orders
      SET courier_id = ?, courier_name = ?, courier_fee_cents = ?, status = 'SAIU_PARA_ENTREGA', dispatched_at = ?, updated_at = ?
      WHERE id = ?
    `).run(courier.id, courier.name, courier.feePerDeliveryCents, now, now, deliveryOrderId);
    this.updateDeliveryCourierStatus(courier.id, 'EM_ENTREGA');
    return this.getDeliveryOrderById(deliveryOrderId)!;
  }

  public settleCourierDeliveries(params: {
    courierId: string;
    financialAccountId: string;
    deliveryOrderIds: string[];
    actorUserId: string;
    shiftId?: string;
    notes?: string;
  }): DeliverySettlement {
    const courier = this.getDeliveryCourierById(params.courierId);
    if (!courier) throw new Error(`Entregador '${params.courierId}' não encontrado.`);
    const account = this.getFinancialAccountById(params.financialAccountId);
    if (!account) throw new Error(`Conta financeira '${params.financialAccountId}' não encontrada.`);

    const orders: DeliveryOrder[] = [];
    let totalCashCollectedCents = 0;
    let totalCourierFeesCents = 0;

    for (const orderId of params.deliveryOrderIds) {
      const o = this.getDeliveryOrderById(orderId);
      if (!o) continue;
      orders.push(o);
      if (o.paymentMethodDeclared === 'CASH') {
        totalCashCollectedCents += o.totalCents;
      }
      totalCourierFeesCents += o.courierFeeCents;
    }

    const netAmountSettledCents = totalCashCollectedCents - totalCourierFeesCents;
    const settlementId = `stl-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO delivery_settlements (
        id, courier_id, courier_name, shift_id, financial_account_id,
        delivery_order_ids_json, total_deliveries, total_cash_collected_cents,
        total_courier_fees_cents, net_amount_settled_cents, status,
        settled_at, settled_by_staff_id, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SETTLED', ?, ?, ?)
    `).run(
      settlementId,
      courier.id,
      courier.name,
      params.shiftId ?? null,
      account.id,
      JSON.stringify(params.deliveryOrderIds),
      orders.length,
      totalCashCollectedCents,
      totalCourierFeesCents,
      netAmountSettledCents,
      now,
      params.actorUserId,
      params.notes ?? null
    );

    for (const orderId of params.deliveryOrderIds) {
      this.db.prepare('UPDATE delivery_orders SET settlement_id = ?, updated_at = ? WHERE id = ?').run(settlementId, now, orderId);
    }

    if (netAmountSettledCents !== 0) {
      const txId = `tx-${crypto.randomUUID().slice(0, 8)}`;
      const txType: FinancialTransactionType = netAmountSettledCents > 0 ? 'INCOME' : 'EXPENSE';
      const amountAbs = Math.abs(netAmountSettledCents);

      this.db.prepare(`
        INSERT INTO financial_transactions (
          id, financial_account_id, type, category_id, cost_center_id,
          amount_cents, payment_method, reference_type, reference_id,
          description, accrual_date, settlement_date, registered_by_staff_id, created_at
        ) VALUES (?, ?, ?, 'cat-rec-deliv', 'DELIV', ?, 'CASH', 'DELIVERY_SETTLEMENT', ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        account.id,
        txType,
        amountAbs,
        settlementId,
        `Prestação de contas entregador ${courier.name} (${orders.length} entregas)`,
        now.slice(0, 10),
        now.slice(0, 10),
        params.actorUserId,
        now
      );

      this.db.prepare(`
        UPDATE financial_accounts
        SET current_balance_cents = current_balance_cents + ?, updated_at = ?
        WHERE id = ?
      `).run(netAmountSettledCents, now, account.id);
    }

    this.updateDeliveryCourierStatus(courier.id, 'DISPONIVEL');
    const settlementRow = this.db.prepare('SELECT * FROM delivery_settlements WHERE id = ?').get(settlementId) as Record<string, unknown>;
    return this.mapDeliverySettlementRow(settlementRow);
  }

  public listDeliverySettlements(courierId?: string): DeliverySettlement[] {
    let sql = 'SELECT * FROM delivery_settlements';
    const params: (string | number | bigint | null)[] = [];
    if (courierId) {
      sql += ' WHERE courier_id = ?';
      params.push(courierId);
    }
    sql += ' ORDER BY settled_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapDeliverySettlementRow(r));
  }

  // ============================================================================
  // ETAPA 6: MÉTODOS DE GESTÃO FINANCEIRA, CONTAS E TESOURARIA
  // ============================================================================

  public listCostCenters(): CostCenter[] {
    const rows = this.db.prepare('SELECT * FROM cost_centers WHERE active = 1 ORDER BY code ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapCostCenterRow(r));
  }

  public listFinancialCategories(): FinancialCategory[] {
    const rows = this.db.prepare('SELECT * FROM financial_categories WHERE active = 1 ORDER BY code ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapFinancialCategoryRow(r));
  }

  public listFinancialAccounts(): FinancialAccount[] {
    const rows = this.db.prepare('SELECT * FROM financial_accounts WHERE active = 1 ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapFinancialAccountRow(r));
  }

  public getFinancialAccountById(id: string): FinancialAccount | null {
    const row = this.db.prepare('SELECT * FROM financial_accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapFinancialAccountRow(row) : null;
  }

  public createFinancialAccount(
    account: Omit<FinancialAccount, 'id' | 'createdAt' | 'updatedAt' | 'currentBalanceCents'> & {
      currentBalanceCents?: number;
      active?: boolean;
    }
  ): FinancialAccount {
    const id = `acc-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO financial_accounts (
        id, name, type, bank_name, account_number, pix_key,
        current_balance_cents, initial_balance_cents, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      account.name,
      account.type,
      account.bankName ?? null,
      account.accountNumber ?? null,
      account.pixKey ?? null,
      account.currentBalanceCents ?? account.initialBalanceCents,
      account.initialBalanceCents,
      account.active !== false ? 1 : 0,
      now,
      now
    );
    return this.getFinancialAccountById(id)!;
  }

  public updateFinancialAccount(id: string, updates: Partial<FinancialAccount>): FinancialAccount {
    const existing = this.getFinancialAccountById(id);
    if (!existing) throw new Error(`Conta financeira '${id}' não encontrada.`);
    const name = updates.name ?? existing.name;
    const type = updates.type ?? existing.type;
    const bankName = updates.bankName !== undefined ? (updates.bankName ?? null) : (existing.bankName ?? null);
    const accountNumber = updates.accountNumber !== undefined ? (updates.accountNumber ?? null) : (existing.accountNumber ?? null);
    const pixKey = updates.pixKey !== undefined ? (updates.pixKey ?? null) : (existing.pixKey ?? null);
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : (existing.active ? 1 : 0);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE financial_accounts
      SET name = ?, type = ?, bank_name = ?, account_number = ?, pix_key = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, type, bankName, accountNumber, pixKey, active, now, id);
    return this.getFinancialAccountById(id)!;
  }

  public listSuppliers(): Supplier[] {
    const rows = this.db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapSupplierRow(r));
  }

  public getSupplierById(id: string): Supplier | null {
    const row = this.db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapSupplierRow(row) : null;
  }

  public createSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Supplier {
    const id = `sup-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO suppliers (id, name, trade_name, document, email, phone, contact_person, category, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      supplier.name,
      supplier.tradeName ?? null,
      supplier.document ?? null,
      supplier.email ?? null,
      supplier.phone ?? null,
      supplier.contactPerson ?? null,
      supplier.category ?? null,
      supplier.active ? 1 : 0,
      now,
      now
    );
    return this.getSupplierById(id)!;
  }

  public updateSupplier(id: string, updates: Partial<Supplier>): Supplier {
    const existing = this.getSupplierById(id);
    if (!existing) throw new Error(`Fornecedor '${id}' não encontrado.`);
    const name = updates.name ?? existing.name;
    const tradeName = updates.tradeName !== undefined ? (updates.tradeName ?? null) : (existing.tradeName ?? null);
    const document = updates.document !== undefined ? (updates.document ?? null) : (existing.document ?? null);
    const email = updates.email !== undefined ? (updates.email ?? null) : (existing.email ?? null);
    const phone = updates.phone !== undefined ? (updates.phone ?? null) : (existing.phone ?? null);
    const contactPerson = updates.contactPerson !== undefined ? (updates.contactPerson ?? null) : (existing.contactPerson ?? null);
    const category = updates.category !== undefined ? (updates.category ?? null) : (existing.category ?? null);
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : (existing.active ? 1 : 0);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE suppliers
      SET name = ?, trade_name = ?, document = ?, email = ?, phone = ?, contact_person = ?, category = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(name, tradeName, document, email, phone, contactPerson, category, active, now, id);
    return this.getSupplierById(id)!;
  }

  public listAccountsReceivable(filters?: {
    status?: AccountsReceivableStatus;
    costCenterId?: string;
    startDate?: string;
    endDate?: string;
  }): AccountsReceivable[] {
    let sql = 'SELECT * FROM accounts_receivable WHERE 1=1';
    const params: (string | number | bigint | null)[] = [];
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.costCenterId) {
      sql += ' AND cost_center_id = ?';
      params.push(filters.costCenterId);
    }
    if (filters?.startDate) {
      sql += ' AND date(due_date) >= ?';
      params.push(filters.startDate.slice(0, 10));
    }
    if (filters?.endDate) {
      sql += ' AND date(due_date) <= ?';
      params.push(filters.endDate.slice(0, 10));
    }
    sql += ' ORDER BY due_date ASC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapAccountsReceivableRow(r));
  }

  public getAccountReceivableById(id: string): AccountsReceivable | null {
    const row = this.db.prepare('SELECT * FROM accounts_receivable WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAccountsReceivableRow(row) : null;
  }

  public createAccountReceivable(data: Omit<AccountsReceivable, 'id' | 'paidAmountCents' | 'remainingAmountCents' | 'createdAt' | 'updatedAt'>): AccountsReceivable {
    const id = `ar-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const paidAmountCents = 0;
    const remainingAmountCents = data.totalAmountCents;
    this.db.prepare(`
      INSERT INTO accounts_receivable (
        id, description, origin, origin_reference_id, cost_center_id, category_id,
        total_amount_cents, paid_amount_cents, remaining_amount_cents, accrual_date, due_date,
        status, customer_name, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.description,
      data.origin,
      data.originReferenceId ?? null,
      data.costCenterId,
      data.categoryId,
      data.totalAmountCents,
      paidAmountCents,
      remainingAmountCents,
      data.accrualDate,
      data.dueDate,
      data.status || 'PENDING',
      data.customerName ?? null,
      data.notes ?? null,
      now,
      now
    );
    return this.getAccountReceivableById(id)!;
  }

  public payAccountReceivable(
    id: string,
    params: {
      amountCents: number;
      financialAccountId: string;
      paymentMethod: PaymentMethod;
      actorUserId: string;
      settlementDate?: string;
      notes?: string;
    }
  ): { accountReceivable: AccountsReceivable; transaction: FinancialTransaction } {
    const ar = this.getAccountReceivableById(id);
    if (!ar) throw new Error(`Conta a receber '${id}' não encontrada.`);
    if (ar.status === 'PAID') throw new Error(`Conta a receber '${id}' já está totalmente quitada.`);
    if (params.amountCents <= 0) throw new Error('Valor de pagamento deve ser positivo.');

    const account = this.getFinancialAccountById(params.financialAccountId);
    if (!account) throw new Error(`Conta financeira '${params.financialAccountId}' não encontrada.`);

    const newPaid = ar.paidAmountCents + params.amountCents;
    const newRemaining = Math.max(0, ar.totalAmountCents - newPaid);
    const newStatus: AccountsReceivableStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';
    const now = new Date().toISOString();
    const settleDate = params.settlementDate || now.slice(0, 10);

    this.db.prepare(`
      UPDATE accounts_receivable
      SET paid_amount_cents = ?, remaining_amount_cents = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(newPaid, newRemaining, newStatus, now, id);

    const txId = `tx-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO financial_transactions (
        id, financial_account_id, type, category_id, cost_center_id,
        amount_cents, payment_method, reference_type, reference_id,
        description, accrual_date, settlement_date, registered_by_staff_id, created_at
      ) VALUES (?, ?, 'INCOME', ?, ?, ?, ?, 'ACCOUNTS_RECEIVABLE', ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      account.id,
      ar.categoryId,
      ar.costCenterId,
      params.amountCents,
      params.paymentMethod,
      id,
      params.notes || `Recebimento: ${ar.description}`,
      ar.accrualDate,
      settleDate,
      params.actorUserId,
      now
    );

    this.db.prepare(`
      UPDATE financial_accounts
      SET current_balance_cents = current_balance_cents + ?, updated_at = ?
      WHERE id = ?
    `).run(params.amountCents, now, account.id);

    const updatedAr = this.getAccountReceivableById(id)!;
    const txRow = this.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txId) as Record<string, unknown>;
    return { accountReceivable: updatedAr, transaction: this.mapFinancialTransactionRow(txRow) };
  }

  public listAccountsPayable(filters?: {
    status?: AccountsPayableStatus;
    costCenterId?: string;
    supplierId?: string;
    startDate?: string;
    endDate?: string;
  }): AccountsPayable[] {
    let sql = 'SELECT * FROM accounts_payable WHERE 1=1';
    const params: (string | number | bigint | null)[] = [];
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    if (filters?.costCenterId) {
      sql += ' AND cost_center_id = ?';
      params.push(filters.costCenterId);
    }
    if (filters?.supplierId) {
      sql += ' AND supplier_id = ?';
      params.push(filters.supplierId);
    }
    if (filters?.startDate) {
      sql += ' AND date(due_date) >= ?';
      params.push(filters.startDate.slice(0, 10));
    }
    if (filters?.endDate) {
      sql += ' AND date(due_date) <= ?';
      params.push(filters.endDate.slice(0, 10));
    }
    sql += ' ORDER BY due_date ASC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapAccountsPayableRow(r));
  }

  public getAccountPayableById(id: string): AccountsPayable | null {
    const row = this.db.prepare('SELECT * FROM accounts_payable WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapAccountsPayableRow(row) : null;
  }

  public createAccountPayable(data: Omit<AccountsPayable, 'id' | 'paidAmountCents' | 'remainingAmountCents' | 'createdAt' | 'updatedAt'>): AccountsPayable {
    const id = `ap-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const paidAmountCents = 0;
    const remainingAmountCents = data.totalAmountCents;
    this.db.prepare(`
      INSERT INTO accounts_payable (
        id, description, origin, origin_reference_id, supplier_id, supplier_name,
        cost_center_id, category_id, total_amount_cents, paid_amount_cents, remaining_amount_cents,
        accrual_date, due_date, status, invoice_number, barcode, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.description,
      data.origin,
      data.originReferenceId ?? null,
      data.supplierId ?? null,
      data.supplierName ?? null,
      data.costCenterId,
      data.categoryId,
      data.totalAmountCents,
      paidAmountCents,
      remainingAmountCents,
      data.accrualDate,
      data.dueDate,
      data.status || 'PENDING',
      data.invoiceNumber ?? null,
      data.barcode ?? null,
      data.notes ?? null,
      now,
      now
    );
    return this.getAccountPayableById(id)!;
  }

  public payAccountPayable(
    id: string,
    params: {
      amountCents: number;
      financialAccountId: string;
      paymentMethod: PaymentMethod;
      actorUserId: string;
      settlementDate?: string;
      notes?: string;
    }
  ): { accountPayable: AccountsPayable; transaction: FinancialTransaction } {
    const ap = this.getAccountPayableById(id);
    if (!ap) throw new Error(`Conta a pagar '${id}' não encontrada.`);
    if (ap.status === 'PAID') throw new Error(`Conta a pagar '${id}' já está totalmente quitada.`);
    if (params.amountCents <= 0) throw new Error('Valor de pagamento deve ser positivo.');

    const account = this.getFinancialAccountById(params.financialAccountId);
    if (!account) throw new Error(`Conta financeira '${params.financialAccountId}' não encontrada.`);

    const newPaid = ap.paidAmountCents + params.amountCents;
    const newRemaining = Math.max(0, ap.totalAmountCents - newPaid);
    const newStatus: AccountsPayableStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';
    const now = new Date().toISOString();
    const settleDate = params.settlementDate || now.slice(0, 10);

    this.db.prepare(`
      UPDATE accounts_payable
      SET paid_amount_cents = ?, remaining_amount_cents = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(newPaid, newRemaining, newStatus, now, id);

    const txId = `tx-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO financial_transactions (
        id, financial_account_id, type, category_id, cost_center_id,
        amount_cents, payment_method, reference_type, reference_id,
        description, accrual_date, settlement_date, registered_by_staff_id, created_at
      ) VALUES (?, ?, 'EXPENSE', ?, ?, ?, ?, 'ACCOUNTS_PAYABLE', ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      account.id,
      ap.categoryId,
      ap.costCenterId,
      params.amountCents,
      params.paymentMethod,
      id,
      params.notes || `Pagamento: ${ap.description}`,
      ap.accrualDate,
      settleDate,
      params.actorUserId,
      now
    );

    this.db.prepare(`
      UPDATE financial_accounts
      SET current_balance_cents = current_balance_cents - ?, updated_at = ?
      WHERE id = ?
    `).run(params.amountCents, now, account.id);

    const updatedAp = this.getAccountPayableById(id)!;
    const txRow = this.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txId) as Record<string, unknown>;
    return { accountPayable: updatedAp, transaction: this.mapFinancialTransactionRow(txRow) };
  }

  public listFinancialTransactions(filters?: {
    financialAccountId?: string;
    startDate?: string;
    endDate?: string;
    type?: FinancialTransactionType;
  }): FinancialTransaction[] {
    let sql = 'SELECT * FROM financial_transactions WHERE 1=1';
    const params: (string | number | bigint | null)[] = [];
    if (filters?.financialAccountId) {
      sql += ' AND financial_account_id = ?';
      params.push(filters.financialAccountId);
    }
    if (filters?.type) {
      sql += ' AND type = ?';
      params.push(filters.type);
    }
    if (filters?.startDate) {
      sql += ' AND date(settlement_date) >= ?';
      params.push(filters.startDate.slice(0, 10));
    }
    if (filters?.endDate) {
      sql += ' AND date(settlement_date) <= ?';
      params.push(filters.endDate.slice(0, 10));
    }
    sql += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapFinancialTransactionRow(r));
  }

  public createFinancialTransfer(params: {
    fromAccountId: string;
    toAccountId: string;
    amountCents: number;
    reason: string;
    actorUserId: string;
  }): { transfer: FinancialTransfer; debitTransaction: FinancialTransaction; creditTransaction: FinancialTransaction } {
    if (params.fromAccountId === params.toAccountId) {
      throw new Error('A conta de origem e destino devem ser diferentes.');
    }
    if (params.amountCents <= 0) {
      throw new Error('O valor da transferência deve ser estritamente positivo.');
    }
    const fromAcc = this.getFinancialAccountById(params.fromAccountId);
    if (!fromAcc) throw new Error(`Conta origem '${params.fromAccountId}' não encontrada.`);
    const toAcc = this.getFinancialAccountById(params.toAccountId);
    if (!toAcc) throw new Error(`Conta destino '${params.toAccountId}' não encontrada.`);

    const now = new Date().toISOString();
    const transferId = `trf-${crypto.randomUUID().slice(0, 8)}`;

    this.db.prepare(`
      INSERT INTO financial_transfers (id, from_account_id, to_account_id, amount_cents, reason, registered_by_staff_id, transferred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(transferId, fromAcc.id, toAcc.id, params.amountCents, params.reason, params.actorUserId, now, now);

    const debitTxId = `tx-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO financial_transactions (
        id, financial_account_id, type, amount_cents, payment_method, reference_type, reference_id,
        description, accrual_date, settlement_date, registered_by_staff_id, created_at
      ) VALUES (?, ?, 'INTERNAL_TRANSFER_OUT', ?, 'CASH', 'TRANSFER', ?, ?, ?, ?, ?, ?)
    `).run(
      debitTxId,
      fromAcc.id,
      params.amountCents,
      transferId,
      `Transferência enviada para ${toAcc.name}: ${params.reason}`,
      now.slice(0, 10),
      now.slice(0, 10),
      params.actorUserId,
      now
    );

    const creditTxId = `tx-${crypto.randomUUID().slice(0, 8)}`;
    this.db.prepare(`
      INSERT INTO financial_transactions (
        id, financial_account_id, type, amount_cents, payment_method, reference_type, reference_id,
        description, accrual_date, settlement_date, registered_by_staff_id, created_at
      ) VALUES (?, ?, 'INTERNAL_TRANSFER_IN', ?, 'CASH', 'TRANSFER', ?, ?, ?, ?, ?, ?)
    `).run(
      creditTxId,
      toAcc.id,
      params.amountCents,
      transferId,
      `Transferência recebida de ${fromAcc.name}: ${params.reason}`,
      now.slice(0, 10),
      now.slice(0, 10),
      params.actorUserId,
      now
    );

    this.db.prepare('UPDATE financial_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ? WHERE id = ?').run(params.amountCents, now, fromAcc.id);
    this.db.prepare('UPDATE financial_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ? WHERE id = ?').run(params.amountCents, now, toAcc.id);

    const transferRow = this.db.prepare('SELECT * FROM financial_transfers WHERE id = ?').get(transferId) as Record<string, unknown>;
    const debitRow = this.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(debitTxId) as Record<string, unknown>;
    const creditRow = this.db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(creditTxId) as Record<string, unknown>;

    return {
      transfer: this.mapFinancialTransferRow(transferRow),
      debitTransaction: this.mapFinancialTransactionRow(debitRow),
      creditTransaction: this.mapFinancialTransactionRow(creditRow)
    };
  }

  public listFinancialTransfers(): FinancialTransfer[] {
    const rows = this.db.prepare('SELECT * FROM financial_transfers ORDER BY transferred_at DESC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapFinancialTransferRow(r));
  }

  public getPurchaseInvoiceById(id: string): PurchaseInvoice | null {
    const row = this.db.prepare('SELECT * FROM purchase_invoices WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const itemRows = this.db.prepare('SELECT * FROM purchase_invoice_items WHERE invoice_id = ?').all(id) as Record<string, unknown>[];
    const items = itemRows.map((it) => this.mapPurchaseInvoiceItemRow(it));
    return this.mapPurchaseInvoiceRow(row, items);
  }

  public listPurchaseInvoices(): PurchaseInvoice[] {
    const rows = this.db.prepare('SELECT * FROM purchase_invoices ORDER BY issue_date DESC').all() as Record<string, unknown>[];
    return rows.map((r) => {
      const itemRows = this.db.prepare('SELECT * FROM purchase_invoice_items WHERE invoice_id = ?').all(String(r.id)) as Record<string, unknown>[];
      const items = itemRows.map((it) => this.mapPurchaseInvoiceItemRow(it));
      return this.mapPurchaseInvoiceRow(r, items);
    });
  }

  public createPurchaseInvoice(params: {
    invoiceNumber: string;
    supplierId: string;
    costCenterId: string;
    issueDate: string;
    dueDate?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitCostCents: number;
      unitOfMeasure?: string;
    }>;
    notes?: string;
    actorUserId: string;
  }): { invoice: PurchaseInvoice; accountsPayable: AccountsPayable } {
    const supplier = this.getSupplierById(params.supplierId);
    if (!supplier) throw new Error(`Fornecedor '${params.supplierId}' não encontrado.`);
    if (!params.items || params.items.length === 0) {
      throw new Error('A nota fiscal deve conter ao menos um item de produto.');
    }

    const now = new Date().toISOString();
    const invoiceId = `inv-${crypto.randomUUID().slice(0, 8)}`;
    let totalAmountCents = 0;

    const invoiceItems: PurchaseInvoiceItem[] = [];

    for (const item of params.items) {
      const product = this.getProductById(item.productId);
      if (!product) throw new Error(`Produto '${item.productId}' não encontrado no catálogo.`);
      const itemTotal = Math.round(item.quantity * item.unitCostCents);
      totalAmountCents += itemTotal;
      const itemId = `invit-${crypto.randomUUID().slice(0, 8)}`;

      invoiceItems.push({
        id: itemId,
        invoiceId,
        productId: product.id,
        productName: product.name,
        unitOfMeasure: item.unitOfMeasure || product.unitOfMeasure || 'UN',
        quantity: item.quantity,
        unitCostCents: item.unitCostCents,
        totalCostCents: itemTotal
      });

      this.adjustStock({
        productId: product.id,
        quantityDelta: item.quantity,
        movementType: 'PURCHASE_ENTRY',
        unitCostCents: item.unitCostCents,
        reason: `Entrada NF #${params.invoiceNumber} — ${supplier.name}`,
        userId: params.actorUserId
      });

      this.db.prepare('UPDATE catalog_products SET cost_price_cents = ?, updated_at = ? WHERE id = ?').run(item.unitCostCents, now, product.id);
    }

    const accountsPayable = this.createAccountPayable({
      description: `NF #${params.invoiceNumber} — ${supplier.name}`,
      origin: 'PURCHASE_INVOICE',
      originReferenceId: invoiceId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      costCenterId: params.costCenterId,
      categoryId: 'cat-custo-cmv-alim',
      totalAmountCents,
      accrualDate: params.issueDate,
      dueDate: params.dueDate || params.issueDate,
      status: 'PENDING',
      invoiceNumber: params.invoiceNumber,
      notes: params.notes ?? null
    });

    this.db.prepare(`
      INSERT INTO purchase_invoices (
        id, invoice_number, supplier_id, supplier_name, cost_center_id,
        issue_date, total_amount_cents, status, accounts_payable_id, stock_moved, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 1, ?, ?, ?)
    `).run(
      invoiceId,
      params.invoiceNumber,
      supplier.id,
      supplier.name,
      params.costCenterId,
      params.issueDate,
      totalAmountCents,
      accountsPayable.id,
      params.notes ?? null,
      now,
      now
    );

    const insertItem = this.db.prepare(`
      INSERT INTO purchase_invoice_items (id, invoice_id, product_id, product_name, unit_of_measure, quantity, unit_cost_cents, total_cost_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const it of invoiceItems) {
      insertItem.run(it.id, it.invoiceId, it.productId, it.productName, it.unitOfMeasure, it.quantity, it.unitCostCents, it.totalCostCents);
    }

    const invoice = this.getPurchaseInvoiceById(invoiceId)!;
    return { invoice, accountsPayable };
  }

  public reconcileFinancialAccount(params: {
    financialAccountId: string;
    reconciliationDate: string;
    declaredPhysicalBalanceCents: number;
    actorUserId: string;
    adjustBalance?: boolean;
    notes?: string;
  }): AccountReconciliation {
    const account = this.getFinancialAccountById(params.financialAccountId);
    if (!account) throw new Error(`Conta financeira '${params.financialAccountId}' não encontrada.`);

    const systemCalculatedBalanceCents = account.currentBalanceCents;
    const differenceCents = params.declaredPhysicalBalanceCents - systemCalculatedBalanceCents;
    const now = new Date().toISOString();
    const recId = `rec-${crypto.randomUUID().slice(0, 8)}`;
    let adjustmentTxId: string | null = null;
    let status: AccountReconciliation['status'] = differenceCents === 0 ? 'BALANCED' : 'DISCREPANCY_PENDING';

    if (differenceCents !== 0 && params.adjustBalance) {
      adjustmentTxId = `tx-${crypto.randomUUID().slice(0, 8)}`;
      const txType: FinancialTransactionType = differenceCents > 0 ? 'INCOME' : 'EXPENSE';
      const absDiff = Math.abs(differenceCents);

      this.db.prepare(`
        INSERT INTO financial_transactions (
          id, financial_account_id, type, amount_cents, payment_method, reference_type, reference_id,
          description, accrual_date, settlement_date, registered_by_staff_id, created_at
        ) VALUES (?, ?, ?, ?, 'CASH', 'MANUAL', ?, ?, ?, ?, ?, ?)
      `).run(
        adjustmentTxId,
        account.id,
        txType,
        absDiff,
        recId,
        `Ajuste de conciliação bancária/caixa: ${params.notes || 'Ajuste auditado'}`,
        params.reconciliationDate,
        params.reconciliationDate,
        params.actorUserId,
        now
      );

      this.db.prepare('UPDATE financial_accounts SET current_balance_cents = ?, updated_at = ? WHERE id = ?').run(
        params.declaredPhysicalBalanceCents,
        now,
        account.id
      );

      status = 'DISCREPANCY_ADJUSTED';
    }

    this.db.prepare(`
      INSERT INTO account_reconciliations (
        id, financial_account_id, reconciliation_date, system_calculated_balance_cents,
        declared_physical_balance_cents, difference_cents, adjustment_transaction_id, status,
        reconciled_by_staff_id, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      recId,
      account.id,
      params.reconciliationDate,
      systemCalculatedBalanceCents,
      params.declaredPhysicalBalanceCents,
      differenceCents,
      adjustmentTxId,
      status,
      params.actorUserId,
      params.notes ?? null,
      now
    );

    const row = this.db.prepare('SELECT * FROM account_reconciliations WHERE id = ?').get(recId) as Record<string, unknown>;
    return this.mapAccountReconciliationRow(row);
  }

  public listAccountReconciliations(financialAccountId?: string): AccountReconciliation[] {
    let sql = 'SELECT * FROM account_reconciliations';
    const params: (string | number | bigint | null)[] = [];
    if (financialAccountId) {
      sql += ' WHERE financial_account_id = ?';
      params.push(financialAccountId);
    }
    sql += ' ORDER BY reconciliation_date DESC';
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapAccountReconciliationRow(r));
  }

  // ============================================================================
  // ETAPA 6: DRE GERENCIAL, FLUXO DE CAIXA E RELATÓRIOS
  // ============================================================================

  public generateDreStatement(params: {
    startDate: string;
    endDate: string;
    costCenterId?: string | null;
  }): DreStatement {
    const startDay = params.startDate.slice(0, 10);
    const endDay = params.endDate.slice(0, 10);

    let restGrossRevenue = 0;
    let deductionsCents = 0;

    const tabSql = `
      SELECT subtotal_cents, service_fee_cents, discount_cents, total_cents
      FROM tabs
      WHERE date(COALESCE(closed_at, opened_at)) >= ? AND date(COALESCE(closed_at, opened_at)) <= ? AND status = 'CLOSED'
    `;
    const tabs = this.db.prepare(tabSql).all(startDay, endDay) as Array<{
      subtotal_cents: number;
      service_fee_cents: number;
      discount_cents: number;
      total_cents: number;
    }>;
    for (const t of tabs) {
      restGrossRevenue += (t.subtotal_cents + t.service_fee_cents);
      deductionsCents += t.discount_cents;
    }

    let deliveryGrossRevenue = 0;
    const delivOrders = this.db.prepare(`
      SELECT items_subtotal_cents, delivery_fee_cents, discount_cents, total_cents
      FROM delivery_orders
      WHERE date(created_at) >= ? AND date(created_at) <= ? AND status = 'ENTREGUE'
    `).all(startDay, endDay) as Array<{
      items_subtotal_cents: number;
      delivery_fee_cents: number;
      discount_cents: number;
      total_cents: number;
    }>;
    for (const d of delivOrders) {
      deliveryGrossRevenue += (d.items_subtotal_cents + d.delivery_fee_cents);
      deductionsCents += d.discount_cents;
    }

    let hotelGrossRevenue = 0;
    const hotelFolios = this.db.prepare(`
      SELECT entry_type, amount_cents
      FROM hotel_folio_entries
      WHERE date(created_at) >= ? AND date(created_at) <= ?
        AND (source_reference_type IS NULL OR source_reference_type != 'TAB')
        AND entry_type IN ('ROOM_RATE', 'MINIBAR', 'SERVICE', 'ADJUSTMENT')
        AND amount_cents > 0
    `).all(startDay, endDay) as Array<{
      entry_type: string;
      amount_cents: number;
    }>;
    for (const h of hotelFolios) {
      hotelGrossRevenue += h.amount_cents;
    }

    const folioDiscounts = this.db.prepare(`
      SELECT amount_cents
      FROM hotel_folio_entries
      WHERE date(created_at) >= ? AND date(created_at) <= ?
        AND entry_type = 'DISCOUNT'
    `).all(startDay, endDay) as Array<{ amount_cents: number }>;
    for (const fd of folioDiscounts) {
      deductionsCents += Math.abs(fd.amount_cents);
    }

    const manualAr = this.db.prepare(`
      SELECT cost_center_id, total_amount_cents
      FROM accounts_receivable
      WHERE date(accrual_date) >= ? AND date(accrual_date) <= ? AND origin = 'MANUAL' AND status != 'CANCELED'
    `).all(startDay, endDay) as Array<{ cost_center_id: string; total_amount_cents: number }>;
    let otherRevenue = 0;
    for (const m of manualAr) {
      otherRevenue += m.total_amount_cents;
    }

    const revenueByCostCenter: Record<string, number> = {
      REST: Math.round(restGrossRevenue * 0.7),
      BAR: Math.round(restGrossRevenue * 0.3),
      DELIV: deliveryGrossRevenue,
      HOTEL: hotelGrossRevenue,
      ADMIN: otherRevenue
    };

    let grossRevenueCents = restGrossRevenue + deliveryGrossRevenue + hotelGrossRevenue + otherRevenue;

    if (params.costCenterId && revenueByCostCenter[params.costCenterId] !== undefined) {
      grossRevenueCents = revenueByCostCenter[params.costCenterId]!;
    }

    let directCostsCents = 0;
    const movements = this.db.prepare(`
      SELECT sm.quantity_delta, COALESCE(sm.unit_cost_cents, cp.cost_price_cents, 0) as unit_cost_cents, sm.movement_type
      FROM stock_movements sm
      LEFT JOIN catalog_products cp ON cp.id = sm.product_id
      WHERE date(sm.created_at) >= ? AND date(sm.created_at) <= ?
        AND sm.movement_type IN ('SALE_DEDUCTION', 'RECIPE_CONSUMPTION', 'MINIBAR_RESTOCK')
    `).all(startDay, endDay) as Array<{
      quantity_delta: number;
      unit_cost_cents: number;
      movement_type: string;
    }>;
    for (const m of movements) {
      const cost = m.unit_cost_cents || 0;
      directCostsCents += Math.round(Math.abs(m.quantity_delta) * cost);
    }

    const courierFees = this.db.prepare(`
      SELECT SUM(courier_fee_cents) as total_courier
      FROM delivery_orders
      WHERE date(created_at) >= ? AND date(created_at) <= ? AND status = 'ENTREGUE'
    `).get(startDay, endDay) as { total_courier?: number };
    directCostsCents += (courierFees?.total_courier ?? 0);

    let operationalExpensesCents = 0;
    const expensesByCategory: Record<string, number> = {};

    const expenses = this.db.prepare(`
      SELECT ap.category_id, fc.name as category_name, SUM(ap.total_amount_cents) as total
      FROM accounts_payable ap
      JOIN financial_categories fc ON fc.id = ap.category_id
      WHERE date(ap.accrual_date) >= ? AND date(ap.accrual_date) <= ?
        AND fc.type = 'EXPENSE_OP' AND ap.status != 'CANCELED'
      GROUP BY ap.category_id, fc.name
    `).all(startDay, endDay) as Array<{ category_id: string; category_name: string; total: number }>;

    for (const exp of expenses) {
      operationalExpensesCents += exp.total;
      expensesByCategory[exp.category_name] = exp.total;
    }

    let financialResultCents = 0;
    const finTxs = this.db.prepare(`
      SELECT ft.type, ft.amount_cents
      FROM financial_transactions ft
      LEFT JOIN financial_categories fc ON fc.id = ft.category_id
      WHERE date(ft.accrual_date) >= ? AND date(ft.accrual_date) <= ?
        AND fc.type = 'FINANCIAL_RESULT'
    `).all(startDay, endDay) as Array<{ type: string; amount_cents: number }>;

    for (const f of finTxs) {
      if (f.type === 'INCOME') financialResultCents += f.amount_cents;
      else if (f.type === 'EXPENSE') financialResultCents -= f.amount_cents;
    }

    return calculateDreStatement({
      grossRevenueCents,
      deductionsCents,
      directCostsCents,
      operationalExpensesCents,
      financialResultCents,
      periodStart: startDay,
      periodEnd: endDay,
      costCenterId: params.costCenterId,
      revenueByCostCenter,
      expensesByCategory
    });
  }

  public generateCashFlowRealized(params: {
    startDate: string;
    endDate: string;
    accountId?: string | null;
  }): CashFlowRealizedSummary {
    const startDay = params.startDate.slice(0, 10);
    const endDay = params.endDate.slice(0, 10);

    let txSql = `
      SELECT ft.*, fc.name as category_name
      FROM financial_transactions ft
      LEFT JOIN financial_categories fc ON fc.id = ft.category_id
      WHERE date(ft.settlement_date) >= ? AND date(ft.settlement_date) <= ?
    `;
    const txParams: (string | number | bigint | null)[] = [startDay, endDay];
    if (params.accountId) {
      txSql += ' AND ft.financial_account_id = ?';
      txParams.push(params.accountId);
    }
    const txs = this.db.prepare(txSql).all(...txParams) as Array<Record<string, unknown>>;

    let totalInflowsCents = 0;
    let totalOutflowsCents = 0;
    const inflowsByCategory: Record<string, number> = {};
    const outflowsByCategory: Record<string, number> = {};
    const inflowsByPaymentMethod: Record<string, number> = {};

    for (const tx of txs) {
      const type = String(tx.type);
      const amount = Number(tx.amount_cents);
      const catName = tx.category_name ? String(tx.category_name) : 'Outros';
      const method = String(tx.payment_method || 'CASH');

      if (type === 'INCOME' || type === 'INTERNAL_TRANSFER_IN') {
        totalInflowsCents += amount;
        inflowsByCategory[catName] = (inflowsByCategory[catName] || 0) + amount;
        inflowsByPaymentMethod[method] = (inflowsByPaymentMethod[method] || 0) + amount;
      } else if (type === 'EXPENSE' || type === 'INTERNAL_TRANSFER_OUT') {
        totalOutflowsCents += amount;
        outflowsByCategory[catName] = (outflowsByCategory[catName] || 0) + amount;
      }
    }

    const netCashFlowCents = totalInflowsCents - totalOutflowsCents;

    let totalCurrentBalance = 0;
    if (params.accountId) {
      const acc = this.getFinancialAccountById(params.accountId);
      totalCurrentBalance = acc ? acc.currentBalanceCents : 0;
    } else {
      const accs = this.listFinancialAccounts();
      totalCurrentBalance = accs.reduce((sum, a) => sum + a.currentBalanceCents, 0);
    }
    const closingBalanceCents = totalCurrentBalance;
    const openingBalanceCents = closingBalanceCents - netCashFlowCents;

    return {
      periodStart: startDay,
      periodEnd: endDay,
      accountId: params.accountId ?? null,
      openingBalanceCents,
      totalInflowsCents,
      totalOutflowsCents,
      netCashFlowCents,
      closingBalanceCents,
      inflowsByCategory,
      outflowsByCategory,
      inflowsByPaymentMethod
    };
  }

  public generateCashFlowProjected(params: {
    startDate: string;
    endDate: string;
  }): CashFlowProjectedSummary {
    const startDay = params.startDate.slice(0, 10);
    const endDay = params.endDate.slice(0, 10);
    const nowDay = new Date().toISOString().slice(0, 10);

    const accs = this.listFinancialAccounts();
    const currentBalanceCents = accs.reduce((sum, a) => sum + a.currentBalanceCents, 0);

    const receivables = this.db.prepare(`
      SELECT due_date, SUM(remaining_amount_cents) as expected_in
      FROM accounts_receivable
      WHERE date(due_date) >= ? AND date(due_date) <= ? AND status IN ('PENDING', 'PARTIALLY_PAID')
      GROUP BY due_date
      ORDER BY due_date ASC
    `).all(startDay, endDay) as Array<{ due_date: string; expected_in: number }>;

    const payables = this.db.prepare(`
      SELECT due_date, SUM(remaining_amount_cents) as expected_out
      FROM accounts_payable
      WHERE date(due_date) >= ? AND date(due_date) <= ? AND status IN ('PENDING', 'PARTIALLY_PAID')
      GROUP BY due_date
      ORDER BY due_date ASC
    `).all(startDay, endDay) as Array<{ due_date: string; expected_out: number }>;

    const inByDate: Record<string, number> = {};
    for (const r of receivables) inByDate[r.due_date] = r.expected_in;
    const outByDate: Record<string, number> = {};
    for (const p of payables) outByDate[p.due_date] = p.expected_out;

    let totalReceivables = 0;
    for (const v of Object.values(inByDate)) totalReceivables += v;
    let totalPayables = 0;
    for (const v of Object.values(outByDate)) totalPayables += v;

    const datesSet = new Set([...Object.keys(inByDate), ...Object.keys(outByDate)]);
    const sortedDates = Array.from(datesSet).sort();

    let runningBalance = currentBalanceCents;
    const dailyProjections = sortedDates.map((d) => {
      const expectedIn = inByDate[d] || 0;
      const expectedOut = outByDate[d] || 0;
      runningBalance += (expectedIn - expectedOut);
      return {
        date: d,
        expectedInflowsCents: expectedIn,
        expectedOutflowsCents: expectedOut,
        projectedBalanceCents: runningBalance
      };
    });

    return {
      asOfDate: nowDay,
      periodStart: startDay,
      periodEnd: endDay,
      currentBalanceCents,
      projectedReceivablesCents: totalReceivables,
      projectedPayablesCents: totalPayables,
      projectedNetCashFlowCents: totalReceivables - totalPayables,
      projectedFinalBalanceCents: runningBalance,
      dailyProjections
    };
  }

  public getExecutiveDashboardMetrics(): ExecutiveDashboardMetrics {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const todayTabSales = (this.db.prepare(`
      SELECT SUM(total_cents) as total FROM tabs
      WHERE (date(closed_at) = ? OR date(opened_at) = ?) AND status = 'CLOSED'
    `).get(today, today) as { total?: number })?.total ?? 0;

    const todayDelivOrders = this.db.prepare(`
      SELECT COUNT(*) as count, SUM(total_cents) as total
      FROM delivery_orders
      WHERE date(created_at) = ? AND status != 'CANCELADO'
    `).get(today) as { count?: number; total?: number };

    const activeDelivOrdersCount = (this.db.prepare(`
      SELECT COUNT(*) as count FROM delivery_orders
      WHERE status NOT IN ('ENTREGUE', 'CANCELADO')
    `).get() as { count?: number })?.count ?? 0;

    const todayHotelRev = (this.db.prepare(`
      SELECT SUM(amount_cents) as total FROM hotel_folio_entries
      WHERE date(created_at) = ?
        AND (source_reference_type IS NULL OR source_reference_type != 'TAB')
        AND entry_type IN ('ROOM_RATE', 'MINIBAR', 'SERVICE', 'ADJUSTMENT')
        AND amount_cents > 0
    `).get(today) as { total?: number })?.total ?? 0;

    const hotelStats = this.db.prepare(`
      SELECT
        COUNT(*) as total_rooms,
        SUM(CASE WHEN occupancy_status = 'OCUPADO' THEN 1 ELSE 0 END) as occupied_rooms
      FROM hotel_rooms WHERE active = 1
    `).get() as { total_rooms?: number; occupied_rooms?: number };
    const occupancyRate = (hotelStats?.total_rooms && hotelStats.total_rooms > 0)
      ? Math.round(((hotelStats.occupied_rooms || 0) / hotelStats.total_rooms) * 10000) / 100
      : 0;

    const monthInflows = (this.db.prepare(`
      SELECT SUM(amount_cents) as total FROM financial_transactions
      WHERE date(settlement_date) >= ? AND type IN ('INCOME', 'INTERNAL_TRANSFER_IN')
    `).get(monthStart) as { total?: number })?.total ?? 0;

    const monthOutflows = (this.db.prepare(`
      SELECT SUM(amount_cents) as total FROM financial_transactions
      WHERE date(settlement_date) >= ? AND type IN ('EXPENSE', 'INTERNAL_TRANSFER_OUT')
    `).get(monthStart) as { total?: number })?.total ?? 0;

    const arOverdue = (this.db.prepare(`
      SELECT SUM(remaining_amount_cents) as total FROM accounts_receivable
      WHERE date(due_date) < ? AND status IN ('PENDING', 'PARTIALLY_PAID')
    `).get(today) as { total?: number })?.total ?? 0;

    const apDueToday = (this.db.prepare(`
      SELECT SUM(remaining_amount_cents) as total FROM accounts_payable
      WHERE date(due_date) <= ? AND status IN ('PENDING', 'PARTIALLY_PAID')
    `).get(today) as { total?: number })?.total ?? 0;

    const accounts = this.listFinancialAccounts();
    const treasuryTotal = accounts.reduce((sum, a) => sum + a.currentBalanceCents, 0);

    return {
      todaySalesCents: todayTabSales + (todayDelivOrders?.total ?? 0),
      todayDeliveryOrdersCount: todayDelivOrders?.count ?? 0,
      activeDeliveryOrdersCount: activeDelivOrdersCount,
      todayHotelRevenueCents: todayHotelRev,
      currentOccupancyRatePercent: occupancyRate,
      monthRealizedRevenueCents: monthInflows,
      monthRealizedExpensesCents: monthOutflows,
      monthEstimatedNetProfitCents: monthInflows - monthOutflows,
      accountsReceivableOverdueCents: arOverdue,
      accountsPayableDueTodayCents: apDueToday,
      treasuryTotalBalanceCents: treasuryTotal
    };
  }

  public exportReportCsv(
    reportType: 'sales' | 'dre' | 'cash_flow' | 'receivables' | 'payables' | 'stock' | 'delivery',
    params?: Record<string, string>
  ): string {
    const lines: string[] = [];

    if (reportType === 'delivery') {
      lines.push(['ID', 'Numero', 'Cliente', 'Telefone', 'Tipo', 'Canal', 'Status', 'Subtotal', 'Taxa', 'Total', 'Pagamento', 'Entregador', 'Data'].map(sanitizeCsvCell).join(','));
      const orders = this.listDeliveryOrders();
      for (const o of orders) {
        lines.push([
          o.id,
          o.orderNumber,
          o.customerName,
          o.customerPhone,
          o.deliveryType,
          o.origin,
          o.status,
          (o.itemsSubtotalCents / 100).toFixed(2),
          (o.deliveryFeeCents / 100).toFixed(2),
          (o.totalCents / 100).toFixed(2),
          o.paymentMethodDeclared,
          o.courierName || 'N/A',
          o.createdAt
        ].map(sanitizeCsvCell).join(','));
      }
    } else if (reportType === 'receivables') {
      lines.push(['ID', 'Descricao', 'Origem', 'Centro de Custo', 'Valor Total', 'Valor Pago', 'Saldo', 'Vencimento', 'Status', 'Cliente'].map(sanitizeCsvCell).join(','));
      const arList = this.listAccountsReceivable();
      for (const ar of arList) {
        lines.push([
          ar.id,
          ar.description,
          ar.origin,
          ar.costCenterId,
          (ar.totalAmountCents / 100).toFixed(2),
          (ar.paidAmountCents / 100).toFixed(2),
          (ar.remainingAmountCents / 100).toFixed(2),
          ar.dueDate,
          ar.status,
          ar.customerName || 'N/A'
        ].map(sanitizeCsvCell).join(','));
      }
    } else if (reportType === 'payables') {
      lines.push(['ID', 'Descricao', 'Origem', 'Fornecedor', 'Valor Total', 'Valor Pago', 'Saldo', 'Vencimento', 'Status'].map(sanitizeCsvCell).join(','));
      const apList = this.listAccountsPayable();
      for (const ap of apList) {
        lines.push([
          ap.id,
          ap.description,
          ap.origin,
          ap.supplierName || 'N/A',
          (ap.totalAmountCents / 100).toFixed(2),
          (ap.paidAmountCents / 100).toFixed(2),
          (ap.remainingAmountCents / 100).toFixed(2),
          ap.dueDate,
          ap.status
        ].map(sanitizeCsvCell).join(','));
      }
    } else if (reportType === 'dre') {
      const start = params?.startDate || new Date().toISOString().slice(0, 7) + '-01';
      const end = params?.endDate || new Date().toISOString().slice(0, 10);
      const dre = this.generateDreStatement({ startDate: start, endDate: end });
      lines.push(['Demonstrativo de Resultado do Exercício (DRE Gerencial por Competência)'].map(sanitizeCsvCell).join(','));
      lines.push(['Periodo:', `${dre.periodStart} a ${dre.periodEnd}`].map(sanitizeCsvCell).join(','));
      lines.push(['Linha DRE', 'Valor (R$)', '% Receita Liquida'].map(sanitizeCsvCell).join(','));
      lines.push(['(=) Receita Operacional Bruta', (dre.grossRevenueCents / 100).toFixed(2), '-'].map(sanitizeCsvCell).join(','));
      lines.push(['(-) Deduções e Cancelamentos', (dre.deductionsCents / 100).toFixed(2), '-'].map(sanitizeCsvCell).join(','));
      lines.push(['(=) Receita Operacional Líquida', (dre.netRevenueCents / 100).toFixed(2), '100.00%'].map(sanitizeCsvCell).join(','));
      lines.push(['(-) Custos Diretos / CMV (Kardex)', (dre.directCostsCents / 100).toFixed(2), `${((dre.directCostsCents / (dre.netRevenueCents || 1)) * 100).toFixed(2)}%`].map(sanitizeCsvCell).join(','));
      lines.push(['(=) Lucro Bruto', (dre.grossProfitCents / 100).toFixed(2), `${dre.grossMarginPercent.toFixed(2)}%`].map(sanitizeCsvCell).join(','));
      lines.push(['(-) Despesas Operacionais', (dre.operationalExpensesCents / 100).toFixed(2), `${((dre.operationalExpensesCents / (dre.netRevenueCents || 1)) * 100).toFixed(2)}%`].map(sanitizeCsvCell).join(','));
      lines.push(['(=) Resultado Operacional (EBITDA)', (dre.operatingResultCents / 100).toFixed(2), `${dre.operatingMarginPercent.toFixed(2)}%`].map(sanitizeCsvCell).join(','));
      lines.push(['(+/-) Resultado Financeiro', (dre.financialResultCents / 100).toFixed(2), `${((dre.financialResultCents / (dre.netRevenueCents || 1)) * 100).toFixed(2)}%`].map(sanitizeCsvCell).join(','));
      lines.push(['(=) Resultado Gerencial Líquido', (dre.netProfitCents / 100).toFixed(2), `${dre.netMarginPercent.toFixed(2)}%`].map(sanitizeCsvCell).join(','));
    } else if (reportType === 'cash_flow') {
      const start = params?.startDate || new Date().toISOString().slice(0, 7) + '-01';
      const end = params?.endDate || new Date().toISOString().slice(0, 10);
      const cf = this.generateCashFlowRealized({ startDate: start, endDate: end });
      lines.push(['Fluxo de Caixa Realizado'].map(sanitizeCsvCell).join(','));
      lines.push(['Periodo:', `${cf.periodStart} a ${cf.periodEnd}`].map(sanitizeCsvCell).join(','));
      lines.push(['Saldo Inicial:', (cf.openingBalanceCents / 100).toFixed(2)].map(sanitizeCsvCell).join(','));
      lines.push(['Total Entradas (+):', (cf.totalInflowsCents / 100).toFixed(2)].map(sanitizeCsvCell).join(','));
      lines.push(['Total Saídas (-):', (cf.totalOutflowsCents / 100).toFixed(2)].map(sanitizeCsvCell).join(','));
      lines.push(['Resultado do Período (=):', (cf.netCashFlowCents / 100).toFixed(2)].map(sanitizeCsvCell).join(','));
      lines.push(['Saldo Final Realizado:', (cf.closingBalanceCents / 100).toFixed(2)].map(sanitizeCsvCell).join(','));
    } else {
      lines.push(['Codigo', 'Produto', 'Unidade', 'Saldo Físico', 'Custo Unit (R$)', 'Valor Total (R$)'].map(sanitizeCsvCell).join(','));
      const prods = this.getCatalog({ includeInactive: true }).products;
      for (const p of prods) {
        const balance = this.getProductCurrentStock(p.id);
        const unitCost = p.costPriceCents || 0;
        const totalVal = Math.round(balance * unitCost);
        lines.push([
          p.id,
          p.name,
          p.unitOfMeasure,
          balance,
          (unitCost / 100).toFixed(2),
          (totalVal / 100).toFixed(2)
        ].map(sanitizeCsvCell).join(','));
      }
    }

    return lines.join('\r\n');
  }

  // ============================================================================
  // ETAPA 6: ROW MAPPERS
  // ============================================================================

  private mapDeliveryZoneRow(r: Record<string, unknown>): DeliveryZone {
    return {
      id: String(r.id),
      name: String(r.name),
      feeCents: Number(r.fee_cents),
      minimumOrderCents: Number(r.minimum_order_cents || 0),
      estimatedMinutes: Number(r.estimated_minutes || 40),
      active: Number(r.active) === 1
    };
  }

  private mapDeliveryCourierRow(r: Record<string, unknown>): DeliveryCourier {
    return {
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone),
      vehicleType: r.vehicle_type as DeliveryCourier['vehicleType'],
      vehiclePlate: r.vehicle_plate ? String(r.vehicle_plate) : null,
      feePerDeliveryCents: Number(r.fee_per_delivery_cents || 500),
      status: r.status as DeliveryCourierStatus,
      active: Number(r.active) === 1
    };
  }

  private mapDeliveryAddressRow(r: Record<string, unknown>): DeliveryAddress {
    return {
      id: String(r.id),
      customerId: String(r.customer_id),
      street: String(r.street),
      number: String(r.number),
      complement: r.complement ? String(r.complement) : null,
      neighborhood: String(r.neighborhood),
      city: String(r.city || 'Santa Inês'),
      reference: r.reference ? String(r.reference) : null,
      deliveryZoneId: r.delivery_zone_id ? String(r.delivery_zone_id) : null,
      isDefault: Number(r.is_default) === 1
    };
  }

  private mapDeliveryCustomerRow(r: Record<string, unknown>, addresses: DeliveryAddress[] = []): DeliveryCustomer {
    return {
      id: String(r.id),
      name: String(r.name),
      phone: String(r.phone),
      document: r.document ? String(r.document) : null,
      email: r.email ? String(r.email) : null,
      addresses,
      notes: r.notes ? String(r.notes) : null,
      totalOrders: Number(r.total_orders || 0),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapDeliveryOrderRow(r: Record<string, unknown>): DeliveryOrder {
    let address: DeliveryAddress | null = null;
    if (r.delivery_address_json) {
      try {
        address = JSON.parse(String(r.delivery_address_json));
      } catch {
        address = null;
      }
    }
    return {
      id: String(r.id),
      orderNumber: Number(r.order_number),
      orderId: String(r.order_id),
      customerId: String(r.customer_id),
      customerName: String(r.customer_name),
      customerPhone: String(r.customer_phone),
      deliveryType: r.delivery_type as DeliveryType,
      origin: r.origin as DeliveryOrigin,
      status: r.status as DeliveryOrderStatus,
      deliveryAddress: address,
      deliveryZoneId: r.delivery_zone_id ? String(r.delivery_zone_id) : null,
      deliveryFeeCents: Number(r.delivery_fee_cents || 0),
      itemsSubtotalCents: Number(r.items_subtotal_cents || 0),
      discountCents: Number(r.discount_cents || 0),
      totalCents: Number(r.total_cents || 0),
      paymentMethodDeclared: r.payment_method_declared as PaymentMethod,
      paymentStatus: r.payment_status as DeliveryOrder['paymentStatus'],
      changeForCents: r.change_for_cents !== null && r.change_for_cents !== undefined ? Number(r.change_for_cents) : null,
      courierId: r.courier_id ? String(r.courier_id) : null,
      courierName: r.courier_name ? String(r.courier_name) : null,
      courierFeeCents: Number(r.courier_fee_cents || 0),
      estimatedDeliveryAt: r.estimated_delivery_at ? String(r.estimated_delivery_at) : null,
      dispatchedAt: r.dispatched_at ? String(r.dispatched_at) : null,
      deliveredAt: r.delivered_at ? String(r.delivered_at) : null,
      canceledAt: r.canceled_at ? String(r.canceled_at) : null,
      cancelReason: r.cancel_reason ? String(r.cancel_reason) : null,
      settlementId: r.settlement_id ? String(r.settlement_id) : null,
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapDeliverySettlementRow(r: Record<string, unknown>): DeliverySettlement {
    let orderIds: string[] = [];
    if (r.delivery_order_ids_json) {
      try {
        orderIds = JSON.parse(String(r.delivery_order_ids_json));
      } catch {
        orderIds = [];
      }
    }
    return {
      id: String(r.id),
      courierId: String(r.courier_id),
      courierName: String(r.courier_name),
      shiftId: r.shift_id ? String(r.shift_id) : null,
      financialAccountId: String(r.financial_account_id),
      deliveryOrderIds: orderIds,
      totalDeliveries: Number(r.total_deliveries || 0),
      totalCashCollectedCents: Number(r.total_cash_collected_cents || 0),
      totalCourierFeesCents: Number(r.total_courier_fees_cents || 0),
      netAmountSettledCents: Number(r.net_amount_settled_cents || 0),
      status: r.status as DeliverySettlement['status'],
      settledAt: String(r.settled_at),
      settledByStaffId: String(r.settled_by_staff_id),
      notes: r.notes ? String(r.notes) : null
    };
  }

  private mapCostCenterRow(r: Record<string, unknown>): CostCenter {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      description: String(r.description),
      active: Number(r.active) === 1
    };
  }

  private mapFinancialCategoryRow(r: Record<string, unknown>): FinancialCategory {
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      type: r.type as FinancialCategoryType,
      parentId: r.parent_id ? String(r.parent_id) : null,
      active: Number(r.active) === 1
    };
  }

  private mapFinancialAccountRow(r: Record<string, unknown>): FinancialAccount {
    return {
      id: String(r.id),
      name: String(r.name),
      type: r.type as FinancialAccountType,
      bankName: r.bank_name ? String(r.bank_name) : null,
      accountNumber: r.account_number ? String(r.account_number) : null,
      pixKey: r.pix_key ? String(r.pix_key) : null,
      currentBalanceCents: Number(r.current_balance_cents || 0),
      initialBalanceCents: Number(r.initial_balance_cents || 0),
      active: Number(r.active) === 1,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapSupplierRow(r: Record<string, unknown>): Supplier {
    return {
      id: String(r.id),
      name: String(r.name),
      tradeName: r.trade_name ? String(r.trade_name) : null,
      document: r.document ? String(r.document) : null,
      email: r.email ? String(r.email) : null,
      phone: r.phone ? String(r.phone) : null,
      contactPerson: r.contact_person ? String(r.contact_person) : null,
      category: r.category ? String(r.category) : null,
      active: Number(r.active) === 1,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapAccountsReceivableRow(r: Record<string, unknown>): AccountsReceivable {
    return {
      id: String(r.id),
      description: String(r.description),
      origin: r.origin as AccountsReceivableOrigin,
      originReferenceId: r.origin_reference_id ? String(r.origin_reference_id) : null,
      costCenterId: String(r.cost_center_id),
      categoryId: String(r.category_id),
      totalAmountCents: Number(r.total_amount_cents),
      paidAmountCents: Number(r.paid_amount_cents || 0),
      remainingAmountCents: Number(r.remaining_amount_cents),
      accrualDate: String(r.accrual_date),
      dueDate: String(r.due_date),
      status: r.status as AccountsReceivableStatus,
      customerName: r.customer_name ? String(r.customer_name) : null,
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapAccountsPayableRow(r: Record<string, unknown>): AccountsPayable {
    return {
      id: String(r.id),
      description: String(r.description),
      origin: r.origin as AccountsPayableOrigin,
      originReferenceId: r.origin_reference_id ? String(r.origin_reference_id) : null,
      supplierId: r.supplier_id ? String(r.supplier_id) : null,
      supplierName: r.supplier_name ? String(r.supplier_name) : null,
      costCenterId: String(r.cost_center_id),
      categoryId: String(r.category_id),
      totalAmountCents: Number(r.total_amount_cents),
      paidAmountCents: Number(r.paid_amount_cents || 0),
      remainingAmountCents: Number(r.remaining_amount_cents),
      accrualDate: String(r.accrual_date),
      dueDate: String(r.due_date),
      status: r.status as AccountsPayableStatus,
      invoiceNumber: r.invoice_number ? String(r.invoice_number) : null,
      barcode: r.barcode ? String(r.barcode) : null,
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapFinancialTransactionRow(r: Record<string, unknown>): FinancialTransaction {
    return {
      id: String(r.id),
      financialAccountId: String(r.financial_account_id),
      type: r.type as FinancialTransactionType,
      categoryId: r.category_id ? String(r.category_id) : null,
      costCenterId: r.cost_center_id ? String(r.cost_center_id) : null,
      amountCents: Number(r.amount_cents),
      paymentMethod: r.payment_method as PaymentMethod,
      referenceType: r.reference_type as FinancialTransaction['referenceType'],
      referenceId: r.reference_id ? String(r.reference_id) : null,
      description: String(r.description),
      accrualDate: String(r.accrual_date),
      settlementDate: String(r.settlement_date),
      registeredByStaffId: String(r.registered_by_staff_id),
      createdAt: String(r.created_at)
    };
  }

  private mapFinancialTransferRow(r: Record<string, unknown>): FinancialTransfer {
    return {
      id: String(r.id),
      fromAccountId: String(r.from_account_id),
      toAccountId: String(r.to_account_id),
      amountCents: Number(r.amount_cents),
      reason: String(r.reason),
      registeredByStaffId: String(r.registered_by_staff_id),
      transferredAt: String(r.transferred_at),
      createdAt: String(r.created_at)
    };
  }

  private mapPurchaseInvoiceRow(r: Record<string, unknown>, items: PurchaseInvoiceItem[] = []): PurchaseInvoice {
    return {
      id: String(r.id),
      invoiceNumber: String(r.invoice_number),
      supplierId: String(r.supplier_id),
      supplierName: String(r.supplier_name),
      costCenterId: String(r.cost_center_id),
      issueDate: String(r.issue_date),
      totalAmountCents: Number(r.total_amount_cents),
      status: r.status as PurchaseInvoice['status'],
      accountsPayableId: r.accounts_payable_id ? String(r.accounts_payable_id) : null,
      stockMoved: Number(r.stock_moved) === 1,
      items,
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at)
    };
  }

  private mapPurchaseInvoiceItemRow(r: Record<string, unknown>): PurchaseInvoiceItem {
    return {
      id: String(r.id),
      invoiceId: String(r.invoice_id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      unitOfMeasure: String(r.unit_of_measure || 'UN'),
      quantity: Number(r.quantity),
      unitCostCents: Number(r.unit_cost_cents),
      totalCostCents: Number(r.total_cost_cents)
    };
  }

  private mapAccountReconciliationRow(r: Record<string, unknown>): AccountReconciliation {
    return {
      id: String(r.id),
      financialAccountId: String(r.financial_account_id),
      reconciliationDate: String(r.reconciliation_date),
      systemCalculatedBalanceCents: Number(r.system_calculated_balance_cents),
      declaredPhysicalBalanceCents: Number(r.declared_physical_balance_cents),
      differenceCents: Number(r.difference_cents),
      adjustmentTransactionId: r.adjustment_transaction_id ? String(r.adjustment_transaction_id) : null,
      status: r.status as AccountReconciliation['status'],
      reconciledByStaffId: String(r.reconciled_by_staff_id),
      notes: r.notes ? String(r.notes) : null,
      createdAt: String(r.created_at)
    };
  }

}
