/**
 * DECK 26 — Repositório Transacional SQLite (node:sqlite nativo)
 *
 * Implementa toda a persistência local offline-first com ACID real:
 * - Executa a migração versionada `0001_initial_schema.sql`
 * - Semeia o catálogo real do Deck 26 (extraído das imagens oficiais do cardápio)
 * - Mantém Comanda (Tab), Pedido (Order), Pagamento (Payment), Impressão (PrintJob)
 *   e Movimentação de Estoque (StockMovement) em tabelas distintas
 * - Registra eventos de sincronização persistentes (Outbox) na mesma transação SQL
 *   com chave de idempotência e hash SHA-256 para sincronização bidirecional com a VPS.
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
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DECK26_INITIAL_STAFF,
  HotelRoom,
  Order,
  OrderItem,
  OrderStatus,
  OriginNode,
  Payment,
  PaymentMethod,
  PrintJob,
  PrintJobTarget,
  SalesChannel,
  StockMovement,
  SyncOutboxEvent,
  Tab,
  TabType,
  UserRole,
  buildEscPosProductionTicket,
  calculateTabTotals
} from '@deck26/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class LocalOperationalStore {
  public readonly db: DatabaseSyncType;

  constructor(dbFilePath: string = ':memory:') {
    if (dbFilePath !== ':memory:') {
      const dir = path.dirname(dbFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbFilePath);
    this.runMigrations();
    this.seedBaseCatalogAndInfrastructure();
  }

  private runMigrations(): void {
    const migrationPath = path.resolve(
      __dirname,
      '../../../packages/contracts/migrations/local/0001_initial_schema.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    this.db.exec(sql);

    const existing = this.db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get('0001_initial_schema') as { version?: string } | undefined;

    if (!existing) {
      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0001_initial_schema', new Date().toISOString());
    }
  }

  private seedBaseCatalogAndInfrastructure(): void {
    const now = new Date().toISOString();

    // 1. Semeia Categorias oficiais do Deck 26
    const insertCat = this.db.prepare(`
      INSERT OR IGNORE INTO catalog_categories (id, slug, name, sort_order, active)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const cat of DECK26_INITIAL_CATEGORIES) {
      insertCat.run(cat.id, cat.slug, cat.name, cat.sortOrder, cat.active ? 1 : 0);
    }

    // 2. Semeia Produtos oficiais do Deck 26 + Saldo de Estoque Inicial
    const insertProd = this.db.prepare(`
      INSERT OR IGNORE INTO catalog_products (
        id, sku, category_id, name, description, price_cents,
        available_channels_json, prep_station, track_stock, modifier_groups_json, active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertStockBalance = this.db.prepare(`
      INSERT OR IGNORE INTO stock_balances (product_id, current_quantity, updated_at)
      VALUES (?, ?, ?)
    `);

    for (const prod of DECK26_INITIAL_PRODUCTS) {
      insertProd.run(
        prod.id,
        prod.sku,
        prod.categoryId,
        prod.name,
        prod.description,
        prod.priceCents,
        JSON.stringify(prod.availableChannels),
        prod.prepStation,
        prod.trackStock ? 1 : 0,
        JSON.stringify(prod.modifierGroups),
        prod.active ? 1 : 0,
        prod.updatedAt
      );
      insertStockBalance.run(prod.id, 50, now);
    }

    // 3. Garante sessão de caixa aberta para operação imediata no PDV local
    const activeSession = this.db
      .prepare("SELECT id FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1")
      .get() as { id?: string } | undefined;

    if (!activeSession) {
      this.db
        .prepare(`
          INSERT INTO cash_register_sessions (id, opened_by_user_id, opened_at, opening_balance_cents, status)
          VALUES (?, ?, ?, ?, 'OPEN')
        `)
        .run('CASH-SESSION-INITIAL', 'usr-owner-01', now, 20000); // R$ 200,00 fundo de troco
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

    // 5. Configuração Fiscal Inicial Honesta (Desativada até configuração de Certificado A1 real)
    this.db
      .prepare(`
        INSERT OR IGNORE INTO fiscal_config (
          id, cnpj, razao_social, nome_fantasia, inscricao_estadual, uf, ambiente, mode, certificate_configured, updated_at
        ) VALUES (1, '', 'HOTEL AUTO POSTO MILLA LTDA', 'DECK 26 - HOTEL AUTO POSTO MILLA', '', 'MA', 'HOMOLOGATION', 'DISABLED_NOT_CONFIGURED', 0, ?)
      `)
      .run(now);

    // 6. Semeia Colaboradores Iniciais com Hash SHA-256 do PIN para Autenticação Real no Backend
    const insertUser = this.db.prepare(`
      INSERT OR IGNORE INTO users (id, name, role, pin_hash, active, created_at)
      VALUES (?, ?, ?, ?, 1, ?)
    `);
    for (const staff of DECK26_INITIAL_STAFF) {
      const pinHash = crypto.createHash('sha256').update(`deck26-pin:${staff.pin}`).digest('hex');
      insertUser.run(staff.id, staff.name, staff.role, pinHash, now);
    }
  }

  public close(): void {
    this.db.close();
  }

  public authenticateByPin(pin: string): { id: string; name: string; role: UserRole } | null {
    const pinHash = crypto.createHash('sha256').update(`deck26-pin:${pin.trim()}`).digest('hex');
    const row = this.db
      .prepare('SELECT id, name, role FROM users WHERE pin_hash = ? AND active = 1 LIMIT 1')
      .get(pinHash) as { id: string; name: string; role: UserRole } | undefined;

    return row ?? null;
  }

  public listStaffProfiles(): Array<{ id: string; name: string; role: UserRole }> {
    const rows = this.db
      .prepare('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name ASC')
      .all() as Array<{ id: string; name: string; role: UserRole }>;
    return rows;
  }

  public createCatalogProduct(input: {
    id?: string;
    sku: string;
    categoryId: string;
    name: string;
    description?: string;
    priceCents: number;
    prepStation: CatalogProduct['prepStation'];
    initialStock?: number;
    availableChannels?: SalesChannel[];
  }): CatalogProduct {
    const now = new Date().toISOString();
    const product: CatalogProduct = {
      id: input.id ?? `prd-${crypto.randomUUID().slice(0, 8)}`,
      sku: input.sku.trim().toUpperCase(),
      categoryId: input.categoryId,
      name: input.name.trim(),
      description: input.description ?? '',
      priceCents: input.priceCents,
      availableChannels: input.availableChannels ?? ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'HOTEL_ROOM'],
      prepStation: input.prepStation,
      trackStock: true,
      modifierGroups: [],
      active: true,
      updatedAt: now
    };

    this.db
      .prepare(`
        INSERT INTO catalog_products (
          id, sku, category_id, name, description, price_cents,
          available_channels_json, prep_station, track_stock, modifier_groups_json, active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '[]', 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          price_cents = excluded.price_cents,
          prep_station = excluded.prep_station,
          updated_at = excluded.updated_at
      `)
      .run(
        product.id,
        product.sku,
        product.categoryId,
        product.name,
        product.description,
        product.priceCents,
        JSON.stringify(product.availableChannels),
        product.prepStation,
        product.updatedAt
      );

    this.db
      .prepare(`
        INSERT INTO stock_balances (product_id, current_quantity, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET current_quantity = excluded.current_quantity, updated_at = excluded.updated_at
      `)
      .run(product.id, input.initialStock ?? 50, now);

    this.appendOutboxEvent({
      idempotencyKey: `catalog-product-${product.id}-${now}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'CATALOG_PRODUCT',
      entityId: product.id,
      operation: 'UPSERT',
      entityVersion: 1,
      payload: product
    });

    return product;
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

  public getCatalog(): { categories: CatalogCategory[]; products: CatalogProduct[] } {
    const catRows = this.db
      .prepare('SELECT * FROM catalog_categories WHERE active = 1 ORDER BY sort_order ASC')
      .all() as Array<Record<string, unknown>>;

    const prodRows = this.db
      .prepare('SELECT * FROM catalog_products WHERE active = 1 ORDER BY name ASC')
      .all() as Array<Record<string, unknown>>;

    return {
      categories: catRows.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        name: String(r.name),
        sortOrder: Number(r.sort_order),
        active: Boolean(r.active)
      })),
      products: prodRows.map((r) => ({
        id: String(r.id),
        sku: String(r.sku),
        categoryId: String(r.category_id),
        name: String(r.name),
        description: String(r.description),
        priceCents: Number(r.price_cents),
        availableChannels: JSON.parse(String(r.available_channels_json)),
        prepStation: r.prep_station as CatalogProduct['prepStation'],
        trackStock: Boolean(r.track_stock),
        modifierGroups: JSON.parse(String(r.modifier_groups_json)),
        active: Boolean(r.active),
        updatedAt: String(r.updated_at)
      }))
    };
  }

  public openOrGetTab(input: {
    code: string;
    type: TabType;
    tableNumber?: number | null;
    customerName?: string | null;
    guestsCount?: number;
    openedByUserId?: string;
    originNode?: OriginNode;
  }): Tab {
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
      serviceFeeEnabled: input.type === 'TABLE',
      serviceFeeBasisPoints: 1000,
      subtotalCents: 0,
      serviceFeeCents: 0,
      discountCents: 0,
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
          guests_count, service_fee_enabled, service_fee_bps, subtotal_cents,
          service_fee_cents, discount_cents, total_cents, paid_cents,
          opened_by_user_id, opened_at, closed_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        tab.serviceFeeEnabled ? 1 : 0,
        tab.serviceFeeBasisPoints,
        0,
        0,
        0,
        0,
        0,
        tab.openedByUserId,
        tab.openedAt,
        null,
        tab.version
      );

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
   * Registra um Pedido (Order) com Idempotência Garantida e Separação Estrita de Entidades:
   * 1. Cria Order + OrderItems
   * 2. Atualiza totais da Comanda (Tab) vinculada
   * 3. Gera trabalhos na Fila de Impressão Térmica (PrintJob) separados por praça
   * 4. Registra baixa automática no Razão de Estoque (StockMovement)
   * 5. Grava Eventos Persistentes na Outbox para Sincronização com a VPS
   */
  public createOrder(input: {
    idempotencyKey: string;
    tabId?: string | null;
    tableNumber?: number | null;
    channel: SalesChannel;
    originNode: OriginNode;
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
    // Verificação de Idempotência: se o celular do garçom reenviar o mesmo pedido por oscilação de Wi-Fi, retorna o pedido já gravado
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

    const now = new Date().toISOString();
    const orderId = crypto.randomUUID();

    // Resolve ou abre comanda automaticamente se tableNumber foi informado sem tabId
    let resolvedTab: Tab | null = null;
    if (input.tabId) {
      resolvedTab = this.getTabById(input.tabId);
    } else if (input.tableNumber) {
      resolvedTab = this.openOrGetTab({
        code: `MESA-${String(input.tableNumber).padStart(2, '0')}`,
        type: 'TABLE',
        tableNumber: input.tableNumber,
        openedByUserId: input.waiterUserId ?? 'usr-waiter',
        originNode: input.originNode
      });
    } else if (input.channel === 'COUNTER_PDV') {
      resolvedTab = this.openOrGetTab({
        code: `BALCAO-${orderId.slice(0, 6).toUpperCase()}`,
        type: 'COUNTER',
        openedByUserId: input.waiterUserId ?? 'usr-cashier',
        originNode: input.originNode
      });
    }

    const orderItems: OrderItem[] = [];
    for (const rawItem of input.items) {
      const prodRow = this.db
        .prepare('SELECT * FROM catalog_products WHERE id = ?')
        .get(rawItem.productId) as Record<string, unknown> | undefined;

      if (!prodRow) {
        throw new Error(`Produto não encontrado no catálogo lógico: ${rawItem.productId}`);
      }

      const unitPriceCents = Number(prodRow.price_cents);
      const modifiers = (rawItem.modifiers ?? []).map((m) => ({
        groupId: m.groupId,
        groupName: m.groupName,
        optionId: m.optionId,
        optionName: m.optionName,
        priceDeltaCents: m.priceDeltaCents ?? 0
      }));
      const modifiersTotalCents = modifiers.reduce((acc, m) => acc + m.priceDeltaCents, 0);
      const totalItemCents = Math.round((unitPriceCents + modifiersTotalCents) * rawItem.quantity);

      orderItems.push({
        id: crypto.randomUUID(),
        orderId,
        productId: String(prodRow.id),
        productName: String(prodRow.name),
        prepStation: prodRow.prep_station as OrderItem['prepStation'],
        quantity: rawItem.quantity,
        unitPriceCents,
        modifiersTotalCents,
        totalItemCents,
        notes: rawItem.notes,
        modifiers,
        status: 'RECEIVED'
      });
    }

    const totalOrderCents = orderItems.reduce((acc, item) => acc + item.totalItemCents, 0);

    const order: Order = {
      id: orderId,
      tabId: resolvedTab ? resolvedTab.id : null,
      channel: input.channel,
      originNode: input.originNode,
      idempotencyKey: input.idempotencyKey,
      status: 'RECEIVED',
      waiterUserId: input.waiterUserId ?? null,
      waiterName: input.waiterName ?? null,
      tableNumber: input.tableNumber ?? resolvedTab?.tableNumber ?? null,
      customerNotes: input.customerNotes,
      items: orderItems,
      totalOrderCents,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      // 1. Insere Pedido (Order)
      this.db
        .prepare(`
          INSERT INTO orders (
            id, tab_id, channel, origin_node, idempotency_key, status,
            waiter_user_id, waiter_name, table_number, customer_notes,
            total_order_cents, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          order.id,
          order.tabId ?? null,
          order.channel,
          order.originNode,
          order.idempotencyKey,
          order.status,
          order.waiterUserId ?? null,
          order.waiterName ?? null,
          order.tableNumber ?? null,
          order.customerNotes ?? null,
          order.totalOrderCents,
          order.createdAt,
          order.updatedAt,
          order.version
        );

      // 2. Insere Itens do Pedido (OrderItems)
      const insertItem = this.db.prepare(`
        INSERT INTO order_items (
          id, order_id, product_id, product_name, prep_station,
          quantity, unit_price_cents, modifiers_total_cents, total_item_cents,
          notes, modifiers_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

      // 3. Movimenta Estoque em entidade dedicada (StockMovement)
      const createdMovements: StockMovement[] = [];
      for (const item of order.items) {
        const balanceRow = this.db
          .prepare('SELECT current_quantity FROM stock_balances WHERE product_id = ?')
          .get(item.productId) as { current_quantity?: number } | undefined;

        const currentQty = balanceRow?.current_quantity ?? 0;
        const newBalance = currentQty - item.quantity;

        this.db
          .prepare(`
            INSERT INTO stock_balances (product_id, current_quantity, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET current_quantity = excluded.current_quantity, updated_at = excluded.updated_at
          `)
          .run(item.productId, newBalance, now);

        const movement: StockMovement = {
          id: crypto.randomUUID(),
          productId: item.productId,
          productName: item.productName,
          movementType: 'SALE_DEDUCTION',
          quantityDelta: -item.quantity,
          balanceAfter: newBalance,
          referenceEntityType: 'ORDER',
          referenceEntityId: order.id,
          reason: `Baixa automática Pedido #${order.id.slice(0, 8)} (${order.channel})`,
          createdByUserId: order.waiterUserId ?? 'system-pos',
          createdAt: now
        };

        this.db
          .prepare(`
            INSERT INTO stock_movements (
              id, product_id, product_name, movement_type, quantity_delta,
              balance_after, unit_cost_cents, reference_entity_type, reference_entity_id,
              reason, created_by_user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
          `)
          .run(
            movement.id,
            movement.productId,
            movement.productName,
            movement.movementType,
            movement.quantityDelta,
            movement.balanceAfter,
            movement.referenceEntityType ?? null,
            movement.referenceEntityId ?? null,
            movement.reason,
            movement.createdByUserId,
            movement.createdAt
          );

        createdMovements.push(movement);
      }

      // 4. Enfileira Impressão ESC/POS por Praça em entidade dedicada (PrintJob)
      const createdPrintJobs: PrintJob[] = [];
      const stationToPrinter: Record<OrderItem['prepStation'], PrintJobTarget | null> = {
        KITCHEN_HOT: 'PRINTER_KITCHEN_HOT',
        GRIDDLE_TAPIOCA: 'PRINTER_GRIDDLE',
        BAR_DRINKS: 'PRINTER_BAR',
        NONE: null
      };

      const groupedStations = new Set(order.items.map((i) => i.prepStation));
      for (const station of groupedStations) {
        const targetPrinter = stationToPrinter[station];
        if (!targetPrinter) continue;

        const stationOrderSlice: Order = {
          ...order,
          items: order.items.filter((i) => i.prepStation === station)
        };
        const printJob: PrintJob = {
          id: crypto.randomUUID(),
          targetPrinter,
          jobType: 'PRODUCTION_TICKET',
          status: 'QUEUED',
          referenceEntityType: 'ORDER',
          referenceEntityId: order.id,
          payloadText: buildEscPosProductionTicket(stationOrderSlice, resolvedTab?.code),
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            printJob.id,
            printJob.targetPrinter,
            printJob.jobType,
            printJob.status,
            printJob.referenceEntityType,
            printJob.referenceEntityId,
            printJob.payloadText,
            printJob.attempts,
            null,
            printJob.createdAt,
            null
          );

        createdPrintJobs.push(printJob);
      }

      // 5. Recalcula totais da Comanda (Tab) se vinculada
      if (resolvedTab) {
        resolvedTab = this.recalculateTabInTx(resolvedTab.id, order.originNode);
      }

      // 6. Registra Evento Persistente de Sincronização (Outbox)
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

  public advanceOrderStatus(input: {
    orderId: string;
    newStatus: OrderStatus;
    originNode: OriginNode;
  }): Order {
    const existing = this.getOrderById(input.orderId);
    if (!existing) {
      throw new Error(`Pedido ${input.orderId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;

    this.db
      .prepare('UPDATE orders SET status = ?, updated_at = ?, version = ? WHERE id = ?')
      .run(input.newStatus, now, nextVersion, input.orderId);

    this.db
      .prepare('UPDATE order_items SET status = ? WHERE order_id = ?')
      .run(input.newStatus, input.orderId);

    const updated = this.getOrderById(input.orderId)!;

    if (updated.tabId && input.newStatus === 'CANCELLED') {
      this.recalculateTabInTx(updated.tabId, input.originNode);
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

    return updated;
  }

  /**
   * Registra um Pagamento (Payment) em entidade separada e liquida parcial ou totalmente a Comanda (Tab).
   */
  public recordPayment(input: {
    idempotencyKey: string;
    tabId: string;
    method: PaymentMethod;
    amountCents: number;
    receivedCashCents?: number;
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

    const tab = this.getTabById(input.tabId);
    if (!tab) {
      throw new Error(`Comanda ${input.tabId} não encontrada para pagamento.`);
    }

    if (tab.status === 'CLOSED' || tab.status === 'CANCELLED') {
      throw new Error(`Comanda ${tab.code} já está encerrada (${tab.status}). Não é permitido novo pagamento.`);
    }

    const remainingBefore = Math.max(0, tab.totalCents - tab.paidCents);
    if (remainingBefore > 0 && input.amountCents > remainingBefore) {
      throw new Error(
        `Valor do pagamento (${input.amountCents} centavos) excede o saldo pendente da comanda (${remainingBefore} centavos).`
      );
    }

    const activeSession = this.db
      .prepare("SELECT id FROM cash_register_sessions WHERE status = 'OPEN' LIMIT 1")
      .get() as { id: string };

    const now = new Date().toISOString();
    const changeCents =
      input.method === 'CASH' && input.receivedCashCents && input.receivedCashCents > input.amountCents
        ? input.receivedCashCents - input.amountCents
        : 0;

    const payment: Payment = {
      id: crypto.randomUUID(),
      tabId: tab.id,
      cashRegisterSessionId: activeSession.id,
      method: input.method,
      status: 'CONFIRMED',
      amountCents: input.amountCents,
      receivedCashCents: input.receivedCashCents,
      changeCents,
      nsuOrTxId: input.nsuOrTxId,
      idempotencyKey: input.idempotencyKey,
      operatorUserId: input.operatorUserId ?? 'usr-cashier-01',
      createdAt: now
    };

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare(`
          INSERT INTO payments (
            id, tab_id, cash_register_session_id, method, status,
            amount_cents, received_cash_cents, change_cents, nsu_or_tx_id,
            idempotency_key, operator_user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          payment.id,
          payment.tabId,
          payment.cashRegisterSessionId,
          payment.method,
          payment.status,
          payment.amountCents,
          payment.receivedCashCents ?? null,
          payment.changeCents,
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
          `METODO:  ${payment.method}`,
          `VALOR:   R$ ${(payment.amountCents / 100).toFixed(2).replace('.', ',')}`,
          `TROCO:   R$ ${(payment.changeCents / 100).toFixed(2).replace('.', ',')}`,
          `STATUS COMANDA: ${updatedTab.status}`,
          '================================================'
        ].join('\n'),
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
      return { payment, tab: updatedTab, printJob: receiptJob, idempotentReplay: false };
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
    const totals = calculateTabTotals({
      orders: tabOrders,
      serviceFeeEnabled: currentTab.serviceFeeEnabled,
      serviceFeeBasisPoints: currentTab.serviceFeeBasisPoints,
      discountCents: currentTab.discountCents,
      paidCents
    });

    let nextStatus = currentTab.status;
    let closedAt = currentTab.closedAt ?? null;
    if (totals.totalCents > 0 && paidCents >= totals.totalCents) {
      nextStatus = 'CLOSED';
      closedAt = new Date().toISOString();
    } else if (paidCents > 0 && paidCents < totals.totalCents) {
      nextStatus = 'PARTIALLY_PAID';
    }

    const nextVersion = currentTab.version + 1;
    this.db
      .prepare(`
        UPDATE tabs
        SET subtotal_cents = ?, service_fee_cents = ?, total_cents = ?,
            paid_cents = ?, status = ?, closed_at = ?, version = ?
        WHERE id = ?
      `)
      .run(
        totals.subtotalCents,
        totals.serviceFeeCents,
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

  public markPrintJobPrinted(jobId: string): PrintJob {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE print_jobs SET status = 'PRINTED', attempts = attempts + 1, printed_at = ? WHERE id = ?")
      .run(now, jobId);
    const row = this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as Record<string, unknown>;
    return this.mapPrintJobRow(row);
  }

  public getPrintJobsByReference(refType: string, refId: string): PrintJob[] {
    const rows = this.db
      .prepare('SELECT * FROM print_jobs WHERE reference_entity_type = ? AND reference_entity_id = ?')
      .all(refType, refId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapPrintJobRow(r));
  }

  public listStockBalancesAndMovements(): {
    balances: Array<{ productId: string; productName: string; sku: string; currentQuantity: number; updatedAt: string }>;
    recentMovements: StockMovement[];
  } {
    const balancesRows = this.db
      .prepare(`
        SELECT b.product_id, p.name as product_name, p.sku, b.current_quantity, b.updated_at
        FROM stock_balances b
        JOIN catalog_products p ON p.id = b.product_id
        ORDER BY p.name ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const movRows = this.db
      .prepare('SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 100')
      .all() as Array<Record<string, unknown>>;

    return {
      balances: balancesRows.map((r) => ({
        productId: String(r.product_id),
        productName: String(r.product_name),
        sku: String(r.sku),
        currentQuantity: Number(r.current_quantity),
        updatedAt: String(r.updated_at)
      })),
      recentMovements: movRows.map((r) => this.mapStockMovementRow(r))
    };
  }

  public adjustStock(input: {
    productId: string;
    quantityDelta: number;
    movementType: StockMovement['movementType'];
    reason: string;
    userId?: string;
  }): StockMovement {
    const prod = this.db
      .prepare('SELECT id, name FROM catalog_products WHERE id = ?')
      .get(input.productId) as { id: string; name: string } | undefined;

    if (!prod) {
      throw new Error(`Produto ${input.productId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const balRow = this.db
      .prepare('SELECT current_quantity FROM stock_balances WHERE product_id = ?')
      .get(input.productId) as { current_quantity?: number } | undefined;

    const balanceAfter = (balRow?.current_quantity ?? 0) + input.quantityDelta;
    this.db
      .prepare(`
        INSERT INTO stock_balances (product_id, current_quantity, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET current_quantity = excluded.current_quantity, updated_at = excluded.updated_at
      `)
      .run(input.productId, balanceAfter, now);

    const mov: StockMovement = {
      id: crypto.randomUUID(),
      productId: prod.id,
      productName: prod.name,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      balanceAfter,
      referenceEntityType: 'MANUAL_AUDIT',
      reason: input.reason,
      createdByUserId: input.userId ?? 'usr-manager-local',
      createdAt: now
    };

    this.db
      .prepare(`
        INSERT INTO stock_movements (
          id, product_id, product_name, movement_type, quantity_delta,
          balance_after, unit_cost_cents, reference_entity_type, reference_entity_id,
          reason, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'MANUAL_AUDIT', NULL, ?, ?, ?)
      `)
      .run(
        mov.id,
        mov.productId,
        mov.productName,
        mov.movementType,
        mov.quantityDelta,
        mov.balanceAfter,
        mov.reason,
        mov.createdByUserId,
        mov.createdAt
      );

    this.appendOutboxEvent({
      idempotencyKey: `stock-mov-${mov.id}`,
      originNode: 'WINDOWS_PDV',
      entityType: 'STOCK_MOVEMENT',
      entityId: mov.id,
      operation: 'APPEND_LEDGER',
      entityVersion: 1,
      payload: mov
    });

    return mov;
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

  /**
   * Recebe eventos vindos da VPS Hostinger (ex: Pedido QR Code na mesa, Pedido Delivery ou atualização de preço pelo Proprietário)
   * com verificação estrita de idempotência na tabela `sync_inbox_applied`.
   */
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
      // Se um pedido foi criado na VPS (QR Code ou Delivery), materializa localmente para a Cozinha (KDS) e Impressora
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
      this.db
        .prepare('UPDATE catalog_products SET price_cents = ?, name = ?, updated_at = ? WHERE id = ?')
        .run(payload.priceCents, payload.name, now, payload.id);
    }

    this.db
      .prepare(`
        INSERT INTO sync_inbox_applied (idempotency_key, event_id, origin_node, entity_type, entity_id, applied_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(event.idempotencyKey, event.id, event.originNode, event.entityType, event.entityId, now);

    return { applied: true, duplicate: false };
  }

  private mapTabRow(r: Record<string, unknown>): Tab {
    return {
      id: String(r.id),
      code: String(r.code),
      type: r.type as Tab['type'],
      status: r.status as Tab['status'],
      tableNumber: r.table_number !== null && r.table_number !== undefined ? Number(r.table_number) : null,
      hotelReservationId: r.hotel_reservation_id ? String(r.hotel_reservation_id) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      guestsCount: Number(r.guests_count),
      serviceFeeEnabled: Boolean(r.service_fee_enabled),
      serviceFeeBasisPoints: Number(r.service_fee_bps),
      subtotalCents: Number(r.subtotal_cents),
      serviceFeeCents: Number(r.service_fee_cents),
      discountCents: Number(r.discount_cents),
      totalCents: Number(r.total_cents),
      paidCents: Number(r.paid_cents),
      openedByUserId: String(r.opened_by_user_id),
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
      waiterUserId: r.waiter_user_id ? String(r.waiter_user_id) : null,
      waiterName: r.waiter_name ? String(r.waiter_name) : null,
      tableNumber: r.table_number !== null && r.table_number !== undefined ? Number(r.table_number) : null,
      customerNotes: r.customer_notes ? String(r.customer_notes) : undefined,
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
        status: ir.status as OrderItem['status']
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
      status: r.status as Payment['status'],
      amountCents: Number(r.amount_cents),
      receivedCashCents: r.received_cash_cents !== null && r.received_cash_cents !== undefined ? Number(r.received_cash_cents) : undefined,
      changeCents: Number(r.change_cents),
      nsuOrTxId: r.nsu_or_tx_id ? String(r.nsu_or_tx_id) : undefined,
      idempotencyKey: String(r.idempotency_key),
      operatorUserId: String(r.operator_user_id),
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
      attempts: Number(r.attempts),
      lastError: r.last_error ? String(r.last_error) : null,
      createdAt: String(r.created_at),
      printedAt: r.printed_at ? String(r.printed_at) : null
    };
  }

  private mapStockMovementRow(r: Record<string, unknown>): StockMovement {
    return {
      id: String(r.id),
      productId: String(r.product_id),
      productName: String(r.product_name),
      movementType: r.movement_type as StockMovement['movementType'],
      quantityDelta: Number(r.quantity_delta),
      balanceAfter: Number(r.balance_after),
      unitCostCents: r.unit_cost_cents !== null && r.unit_cost_cents !== undefined ? Number(r.unit_cost_cents) : undefined,
      referenceEntityType: r.reference_entity_type ? (r.reference_entity_type as StockMovement['referenceEntityType']) : undefined,
      referenceEntityId: r.reference_entity_id ? String(r.reference_entity_id) : undefined,
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
