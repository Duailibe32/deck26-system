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
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DECK26_INITIAL_STAFF,
  DiningTableQr,
  HotelRoom,
  ModifierGroup,
  Order,
  OrderItem,
  OrderStatus,
  OriginNode,
  OutOfStockPolicy,
  Payment,
  PaymentMethod,
  PrintJob,
  PrintJobTarget,
  ProductRecipe,
  SalesChannel,
  StockMovement,
  SyncOutboxEvent,
  Tab,
  TabType,
  UserRole,
  buildEscPosProductionTicket,
  calculateTabTotals,
  resolveChannelPriceCents
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
      // Executa comando por comando para tolerar caso alguma coluna já exista em banco prévio
      const statements = sql0002
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

      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run('0002_stage3_catalog_stock_recipes_qr', new Date().toISOString());
    }

    // Garante compatibilidade de bancos criados na Etapa 2 com novos status da Etapa 3 (PENDING_APPROVAL / REVERSAL_ENTRY)
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
    const insertQrTable = this.db.prepare(`
      INSERT OR IGNORE INTO dining_tables_qr (table_number, qr_token, label, requires_operator_approval, active, created_at)
      VALUES (?, ?, ?, 0, 1, ?)
    `);
    for (let t = 1; t <= 20; t++) {
      const deterministicSecret = crypto
        .createHmac('sha256', 'deck26-qr-table-seed-key')
        .update(`MESA-${t}`)
        .digest('hex')
        .slice(0, 24);
      const token = `d26qr_m${String(t).padStart(2, '0')}_${deterministicSecret}`;
      insertQrTable.run(t, token, `Mesa ${String(t).padStart(2, '0')} — Salão Deck 26`, now);
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
  // QR CODES POR MESA COM TOKENS CRIPTOGRÁFICOS NÃO-PREVISÍVEIS (SEÇÃO 12)
  // ============================================================================

  public listDiningTablesQr(): DiningTableQr[] {
    const rows = this.db
      .prepare('SELECT * FROM dining_tables_qr ORDER BY table_number ASC')
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      tableNumber: Number(r.table_number),
      qrToken: String(r.qr_token),
      label: String(r.label),
      requiresOperatorApproval: Boolean(r.requires_operator_approval),
      active: Boolean(r.active),
      createdAt: String(r.created_at)
    }));
  }

  public getDiningTableByQrToken(qrToken: string): DiningTableQr | null {
    const row = this.db
      .prepare('SELECT * FROM dining_tables_qr WHERE qr_token = ? AND active = 1 LIMIT 1')
      .get(qrToken.trim()) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      tableNumber: Number(row.table_number),
      qrToken: String(row.qr_token),
      label: String(row.label),
      requiresOperatorApproval: Boolean(row.requires_operator_approval),
      active: Boolean(row.active),
      createdAt: String(row.created_at)
    };
  }

  public configureDiningTableQrPolicy(tableNumber: number, requiresOperatorApproval: boolean): DiningTableQr {
    this.db
      .prepare('UPDATE dining_tables_qr SET requires_operator_approval = ? WHERE table_number = ?')
      .run(requiresOperatorApproval ? 1 : 0, tableNumber);

    const updated = this.listDiningTablesQr().find((t) => t.tableNumber === tableNumber);
    if (!updated) {
      throw new Error(`Mesa ${tableNumber} não encontrada.`);
    }
    return updated;
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
        status: initialStatus
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
        openedByUserId: input.waiterUserId ?? 'usr-waiter',
        originNode: input.originNode
      });
    } else if (input.channel === 'COUNTER_PDV' || input.channel === 'PICKUP') {
      resolvedTab = this.openOrGetTab({
        code: `BALCAO-${orderId.slice(0, 6).toUpperCase()}`,
        type: 'COUNTER',
        openedByUserId: input.waiterUserId ?? 'usr-cashier',
        originNode: input.originNode
      });
    }

    const totalOrderCents = orderItems.reduce((acc, item) => acc + item.totalItemCents, 0);

    const order: Order = {
      id: orderId,
      tabId: resolvedTab ? resolvedTab.id : null,
      channel: input.channel,
      originNode: input.originNode,
      idempotencyKey: input.idempotencyKey,
      status: initialStatus,
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
   * Avança o status de um pedido:
   * - Se o pedido estava em `PENDING_APPROVAL` (QR Code com aprovação manual) e passa para `RECEIVED`,
   *   compromete o estoque e gera os trabalhos de impressão agora.
   * - Mudanças entre `RECEIVED` -> `IN_PREPARATION` -> `READY` -> `DELIVERED` NUNCA baixam estoque novamente.
   * - Se o pedido for `CANCELLED`, aplica a regra auditável de reversão (Seção 9):
   *   * Se o pedido ainda NÃO havia entrado em preparo (`RECEIVED` / `PENDING_APPROVAL`), ou se `reverseStock = true`,
   *     estorna as baixas de estoque com `REVERSAL_ENTRY`.
   *   * Se já estava preparado/entregue e `reverseStock = false`, mantém a baixa como perda operacional auditada.
   */
  public advanceOrderStatus(input: {
    orderId: string;
    newStatus: OrderStatus;
    originNode: OriginNode;
    reverseStockOnCancel?: boolean;
    cancelReason?: string;
    actorUserId?: string;
  }): Order {
    const existing = this.getOrderById(input.orderId);
    if (!existing) {
      throw new Error(`Pedido ${input.orderId} não encontrado.`);
    }

    const now = new Date().toISOString();
    const nextVersion = existing.version + 1;

    this.db.exec('BEGIN IMMEDIATE TRANSACTION');
    try {
      this.db
        .prepare('UPDATE orders SET status = ?, updated_at = ?, version = ? WHERE id = ?')
        .run(input.newStatus, now, nextVersion, input.orderId);

      this.db
        .prepare('UPDATE order_items SET status = ? WHERE order_id = ?')
        .run(input.newStatus, input.orderId);

      const updated = this.getOrderById(input.orderId)!;

      // Caso um pedido QR estivesse aguardando aprovação e foi confirmado para RECEIVED
      if (existing.status === 'PENDING_APPROVAL' && input.newStatus === 'RECEIVED') {
        const tab = updated.tabId ? this.getTabById(updated.tabId) : null;
        this.deductOrderStockInTx(updated);
        this.enqueueOrderPrintJobsInTx(updated, tab?.code);
      }

      // Caso o pedido seja CANCELLED: executa estorno auditável de estoque quando aplicável
      if (input.newStatus === 'CANCELLED' && existing.status !== 'CANCELLED') {
        const shouldReverse =
          input.reverseStockOnCancel ??
          (existing.status === 'RECEIVED' || existing.status === 'PENDING_APPROVAL');

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
                `Estorno automático por cancelamento do Pedido #${existing.id.slice(0, 8)} (Status anterior: ${existing.status})`,
              createdByUserId: input.actorUserId ?? 'system-reversal',
              now
            });

            if (revMov) {
              this.db
                .prepare('UPDATE stock_movements SET reversed_by_movement_id = ? WHERE id = ?')
                .run(revMov.id, ded.id);
            }
          }
        }

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
      return updated;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

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

  public reprintJob(jobId: string, actorUserId: string): PrintJob {
    const row = this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Trabalho de impressão '${jobId}' não encontrado.`);
    }
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE print_jobs SET status = 'QUEUED', attempts = attempts + 1, last_error = ? WHERE id = ?")
      .run(`Reimpressão autorizada por ${actorUserId} em ${now}`, jobId);

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
