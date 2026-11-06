import { z } from 'zod';
import crypto from 'node:crypto';
import type { SalesChannel, UserRole } from '@deck26/contracts';
import { formatBrlCents as money } from '@deck26/contracts';
import type { LocalOperationalStore } from './store.js';
import { localDate, localClock, promotionSchema, settingsSchema, extensionSettings, promotionalPrice, stayOptionsSchema, activeCover } from './extension-models.js';
export type Actor = {
  userId: string;
  name: string;
  role: UserRole;
};
const id = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key = z.string().min(12).max(120),
  cents = z.number().int().min(0).max(100000000),
  date = z.iso.date();
export const mealSchema = z.object({
  idempotencyKey: key,
  staffName: z.string().trim().min(2).max(100),
  center: z.enum(['REST', 'HOTEL']),
  items: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().positive().max(1000),
    notes: z.string().max(280).optional(),
    modifiers: z.array(z.object({
      groupId: z.string(),
      optionId: z.string(),
      groupName: z.string(),
      optionName: z.string(),
      priceDeltaCents: z.number().int().optional()
    })).optional()
  })).min(1).max(100)
}).strict();
const batchLine = z.object({
  productId: z.string().min(1),
  quantity: z.number().positive().max(100000),
  gramsPerUnit: z.number().positive().max(1000000)
});
export const productionSchema = z.object({
  idempotencyKey: key,
  inputs: z.array(batchLine).min(1).max(50),
  outputs: z.array(batchLine).min(1).max(50),
  wasteGrams: z.number().nonnegative().max(1000000)
}).strict();
export const maintenanceSchema = z.object({
  id: z.string().optional(),
  roomNumber: z.string().min(1),
  name: z.string().trim().min(3).max(120),
  intervalDays: z.number().int().min(1).max(730).default(90),
  lastDone: date,
  nextDue: date,
  blockStart: date.optional(),
  blockEnd: date.optional(),
  active: z.boolean().default(true)
}).refine(v => !v.blockStart && !v.blockEnd || !!v.blockStart && !!v.blockEnd && v.blockEnd > v.blockStart, 'Informe início e fim válidos do bloqueio.');
export const companySchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  document: z.string().trim().max(25),
  creditLimitCents: cents,
  cycle: z.enum(['FORTNIGHT', 'MONTH']),
  dueDays: z.number().int().min(0).max(90).default(7),
  active: z.boolean().default(true),
  autoInvoice: z.boolean().default(true)
}).strict();
export const orderItemsSchema = z.array(z.object({
  productId: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(100),
  notes: z.string().max(280).optional(),
  modifiers: z.array(z.object({
    groupId: z.string(),
    groupName: z.string(),
    optionId: z.string(),
    optionName: z.string(),
    priceDeltaCents: z.number().int().optional()
  })).max(30).optional()
})).min(1).max(100);
export const publicDeliverySchema = z.object({
  idempotencyKey: z.string().regex(/^delivery-[a-f0-9]{32}$/),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().regex(/^\+?[\d ()-]{10,20}$/).refine(value => value.replace(/\D/g, '').length >= 10 && value.replace(/\D/g, '').length <= 15, 'Telefone com DDD inválido.'),
  deliveryType: z.enum(['DELIVERY', 'PICKUP']),
  deliveryZoneId: z.string().optional(),
  deliveryAddress: z.object({
    street: z.string().trim().min(2).max(150),
    number: z.string().min(1).max(20),
    neighborhood: z.string().min(2).max(100),
    city: z.string().min(2).max(100),
    complement: z.string().max(150).optional(),
    reference: z.string().max(200).optional()
  }).optional(),
  items: orderItemsSchema,
  paymentMethodDeclared: z.enum(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD']),
  changeForCents: cents.optional(),
  notes: z.string().max(280).optional(),
  quotedTotalCents: cents
}).strict();
export class OperationExtensions {
  constructor(public store: LocalOperationalStore) {}
  get db() {
    return this.store.db;
  }
  atomic<T>(work: () => T) {
    return this.store.runOperationalTransaction(work);
  }
  audit(a: Actor, action: string, entityId: string, metadata: Record<string, unknown> = {}) {
    this.store.recordAuditLog({
      actorUserId: a.userId,
      action,
      entityType: 'OPERATION',
      entityId,
      metadata
    });
  }
  rows(sql: string, ...args: (string | number)[]) {
    return this.db.prepare(sql).all(...args) as any[];
  }
  jsonTable(table: 'promotion_rules' | 'maintenance_plans' | 'company_accounts') {
    return this.rows('SELECT id,json FROM ' + table).map(r => JSON.parse(r.json));
  }
  saveSettings(raw: unknown, a: Actor) {
    const d = settingsSchema.parse(raw);
    if (d.deliveryBaseMax < d.deliveryBaseMin) throw Error('Prazo máximo deve superar o mínimo.');
    if (d.cover.enabled && (!d.cover.unitCents || !d.cover.weekdays.length || d.cover.notice.trim().length < 10)) throw Error('Configure valor e aviso prévio do couvert antes de ativar.');
    this.db.prepare('INSERT INTO extension_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(JSON.stringify(d));
    this.audit(a, 'OPERATION_SETTINGS_CHANGED', 'settings');
    return d;
  }
  savePromotion(raw: unknown, a: Actor) {
    const d = promotionSchema.parse(raw);
    for (const p of d.productIds) if (!this.store.getProductById(p)) throw Error('Produto não encontrado.');
    const v = {
      ...d,
      id: d.id ?? id()
    };
    this.db.prepare('INSERT INTO promotion_rules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(v.id, JSON.stringify(v));
    this.audit(a, 'PROMOTION_CONFIGURED', v.id);
    return v;
  }
  eta() {
    const s = extensionSettings(this.db),
      queue = this.rows("SELECT COUNT(*) AS count FROM orders WHERE status IN ('RECEIVED','IN_PREPARATION')")[0].count,
      extra = queue > s.deliveryBusyThreshold ? s.deliveryBusyExtra : 0;
    return {
      min: s.deliveryBaseMin + extra,
      max: s.deliveryBaseMax + extra,
      queue,
      busy: extra > 0,
      extraMinutes: extra
    };
  }
  etaForZone(zoneId?: string) {
    const base = this.eta(),
      zone = zoneId ? this.store.getDeliveryZoneById(zoneId) : null;
    const min = zone ? Math.max(base.min, zone.estimatedMinutes + base.extraMinutes) : base.min;
    return {
      ...base,
      min,
      max: min + (base.max - base.min)
    };
  }
  highlights(at = new Date()) {
    const {
      minute: m
    } = localClock(at);
    return m >= 360 && m <= 630 ? ['cafeteria', 'cuscuz', 'tapioca', 'vitamina'] : m >= 660 && m <= 900 ? ['executiv', 'suco'] : m >= 1020 && m <= 1380 ? ['petisco', 'paste', 'lanche', 'bebida'] : [];
  }
  quote(items: z.infer<typeof orderItemsSchema>, channel: SalesChannel) {
    let total = 0;
    for (const item of items) {
      const p = this.store.getProductById(item.productId);
      if (!p?.active || !p.availableChannels.includes(channel)) throw Error('Produto indisponível neste atendimento.');
      const selected = item.modifiers ?? [];
      if (new Set(selected.map(m => m.groupId + ':' + m.optionId)).size !== selected.length) throw Error('Opções repetidas.');
      let extras = 0;
      for (const group of p.modifierGroups) {
        const choices = selected.filter(m => m.groupId === group.id);
        if (choices.length < group.minSelect || choices.length > group.maxSelect) throw Error('Confira ' + group.name + ' de ' + p.name);
        for (const choice of choices) {
          const option = group.options.find(o => o.id === choice.optionId && o.available !== false);
          if (!option) throw Error('Opção indisponível.');
          extras += option.priceDeltaCents;
        }
      }
      if (selected.some(m => !p.modifierGroups.some(g => g.id === m.groupId))) throw Error('Opção não cadastrada.');
      total += (promotionalPrice(this.db, p, channel).priceCents + extras) * item.quantity;
    }
    return total;
  }
  publicCatalog(channel: SalesChannel) {
    const c = this.store.getCatalog({
      channel
    });
    return {
      catalog: {
        categories: c.categories,
        products: c.products.map(({
          costPriceCents,
          internalNotes,
          ncm,
          cest,
          cfop,
          csosn,
          cstIcms,
          cstPis,
          cstCofins,
          verificationPending,
          ...p
        }) => p)
      },
      zones: this.store.listDeliveryZones(false).filter(z => z.active),
      eta: this.eta(),
      highlights: this.highlights(),
      coverNotice: activeCover(this.db, 1),
      serverTime: now()
    };
  }
  deliveryQuote(d: Pick<z.infer<typeof publicDeliverySchema>, 'items' | 'deliveryType' | 'deliveryZoneId' | 'deliveryAddress'>) {
    const subtotal = this.quote(d.items, d.deliveryType === 'PICKUP' ? 'PICKUP' : 'DELIVERY');
    let fee = 0;
    if (d.deliveryType === 'DELIVERY') {
      const zone = this.store.getDeliveryZoneById(d.deliveryZoneId ?? '');
      if (!zone?.active) throw Error('Escolha uma área de entrega disponível.');
      if (subtotal < (zone.minimumOrderCents ?? 0)) throw Error('Pedido mínimo: ' + money(zone.minimumOrderCents ?? 0));
      if (!d.deliveryAddress) throw Error('Informe o endereço completo.');
      fee = zone.feeCents;
    }
    return {
      itemsTotalCents: subtotal,
      deliveryFeeCents: fee,
      totalCents: subtotal + fee,
      eta: this.etaForZone(d.deliveryZoneId)
    };
  }
  submitDelivery(raw: unknown) {
    const d = publicDeliverySchema.parse(raw);
    return this.atomic(() => {
      const h = hash(d),
        prior = this.rows('SELECT * FROM public_delivery_requests WHERE idempotency_key=?', d.idempotencyKey)[0];
      if (prior) {
        if (prior.request_hash !== h) throw Error('O mesmo envio não pode mudar de conteúdo.');
        return this.deliveryStatus(d.idempotencyKey);
      }
      const quote = this.deliveryQuote(d);
      if (quote.totalCents !== d.quotedTotalCents) throw Error('Preços atualizados. Confira e envie novamente.');
      if (d.paymentMethodDeclared === 'CASH' && d.changeForCents !== undefined && d.changeForCents < quote.totalCents) throw Error('Valor para troco insuficiente.');
      this.db.prepare("INSERT INTO public_delivery_requests VALUES(?,?,?,?,?,'PENDING',NULL,?,?)").run(id(), d.idempotencyKey, h, JSON.stringify(d), quote.totalCents, now(), now());
      this.store.createNotification({
        eventType: 'PUBLIC_DELIVERY_REQUEST',
        targetRole: 'CASHIER',
        title: 'Novo pedido pelo cardápio',
        message: 'Aguardando conferência na fila de delivery.'
      });
      return this.deliveryStatus(d.idempotencyKey);
    });
  }
  deliveryStatus(cap: string) {
    const r = this.rows('SELECT id,status,quoted_total_cents,delivery_order_id,payload_json FROM public_delivery_requests WHERE idempotency_key=?', cap)[0];
    if (!r) throw Error('Pedido não encontrado.');
    const accepted = r.delivery_order_id ? this.store.getDeliveryOrderById(r.delivery_order_id) : null;
    return {
      id: r.id,
      status: r.status,
      totalCents: r.quoted_total_cents,
      orderNumber: accepted?.orderNumber,
      deliveryStatus: accepted?.status,
      eta: this.etaForZone(JSON.parse(r.payload_json).deliveryZoneId)
    };
  }
  deliveryInbox() {
    return this.rows("SELECT * FROM public_delivery_requests WHERE status='PENDING' ORDER BY created_at ASC").map(r => ({
      id: r.id,
      ...JSON.parse(r.payload_json),
      createdAt: r.created_at
    }));
  }
  decideDelivery(requestId: string, accept: boolean, a: Actor) {
    return this.atomic(() => {
      const r = this.rows('SELECT * FROM public_delivery_requests WHERE id=?', requestId)[0];
      if (!r) throw Error('Pedido não encontrado.');
      if (r.status !== 'PENDING') return {
        status: r.status
      };
      if (!accept) {
        this.db.prepare("UPDATE public_delivery_requests SET status='REJECTED',updated_at=? WHERE id=?").run(now(), requestId);
        this.audit(a, 'PUBLIC_DELIVERY_REJECTED', requestId);
        return {
          status: 'REJECTED'
        };
      }
      const d = publicDeliverySchema.parse(JSON.parse(r.payload_json)),
        quote = this.deliveryQuote(d);
      if (quote.totalCents !== r.quoted_total_cents) throw Error('Preço ou taxa mudou. Rejeite e peça ao cliente para conferir e reenviar.');
      const result = this.store.createDeliveryOrder({
        ...d,
        deliveryType: d.deliveryType === 'PICKUP' ? 'TAKEOUT' : 'DELIVERY',
        deliveryAddress: d.deliveryAddress ? {
          ...d.deliveryAddress,
          deliveryZoneId: d.deliveryZoneId ?? null,
          isDefault: false
        } : undefined,
        origin: 'SITE_WEB',
        waiterId: a.userId
      });
      this.db.prepare("UPDATE public_delivery_requests SET status='ACCEPTED',delivery_order_id=?,updated_at=? WHERE id=?").run(result.deliveryOrder.id, now(), requestId);
      this.audit(a, 'PUBLIC_DELIVERY_ACCEPTED', requestId, {
        amountCents: quote.totalCents
      });
      return result;
    });
  }
  repeatLast(phone: string) {
    const p = phone.replace(/\D/g, '');
    if (p.length < 10 || p.length > 15) throw Error('Telefone inválido.');
    const r = this.rows("SELECT * FROM delivery_orders WHERE replace(replace(replace(replace(replace(customer_phone,' ',''),'-',''),'(',''),')',''),'+','')=? AND status!='CANCELADO' ORDER BY created_at DESC LIMIT 1", p)[0];
    if (!r) return null;
    const order = this.store.getOrderById(r.order_id);
    return {
      customerName: r.customer_name,
      createdAt: r.created_at,
      items: order?.items.filter(i => i.status !== 'CANCELLED').map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        notes: i.notes,
        modifiers: i.modifiers
      })),
      deliveryType: r.delivery_type,
      deliveryZoneId: r.delivery_zone_id,
      address: r.address_snapshot_json ? JSON.parse(r.address_snapshot_json) : null
    };
  }
  effectiveCost(productId: string, trail: string[] = []): number {
    if (trail.includes(productId) || trail.length > 12) throw Error('Receita circular ou profunda demais.');
    const p = this.store.getProductById(productId);
    if (!p) throw Error('Produto não encontrado.');
    const r = this.store.getActiveRecipeForProduct(productId);
    return r ? Math.round(r.items.reduce((sum, i) => sum + this.effectiveCost(i.ingredientProductId, [...trail, productId]) * i.quantityUsed, 0) / r.yieldQuantity) : p.costPriceCents ?? 0;
  }
  requirements(items: {
    productId: string;
    quantity: number;
    modifiers?: {
      groupId: string;
      optionId: string;
    }[];
  }[]) {
    const leaves = new Map<string, number>();
    const walk = (productId: string, quantity: number, trail: string[] = []) => {
      if (trail.includes(productId) || trail.length > 12) throw Error('Receita circular.');
      const p = this.store.getProductById(productId);
      if (!p?.active) throw Error('Produto inativo ou ausente.');
      const r = this.store.getActiveRecipeForProduct(productId);
      if (r) for (const i of r.items) walk(i.ingredientProductId, quantity * i.quantityUsed / r.yieldQuantity, [...trail, productId]);else if (p.trackStock) leaves.set(productId, (leaves.get(productId) ?? 0) + quantity);
    };
    for (const i of items) {
      walk(i.productId, i.quantity);
      const p = this.store.getProductById(i.productId)!;
      for (const selected of i.modifiers ?? []) {
        const option = p.modifierGroups.find(g => g.id === selected.groupId)?.options.find(o => o.id === selected.optionId && o.available !== false);
        if (!option) throw Error('Adicional indisponível.');
        if (option.stockProductId && option.stockQuantityUsed) walk(option.stockProductId, option.stockQuantityUsed * i.quantity);
      }
    }
    return [...leaves].map(([productId, quantity]) => ({
      productId,
      quantity
    }));
  }
  staffMeal(raw: unknown, a: Actor) {
    const d = mealSchema.parse(raw);
    return this.atomic(() => {
      const h = hash({
          ...d,
          actor: a.userId
        }),
        prior = this.rows('SELECT * FROM internal_meals WHERE idempotency_key=?', d.idempotencyKey)[0];
      if (prior) {
        if (prior.request_hash !== h) throw Error('Envio repetido com conteúdo diferente.');
        return {
          id: prior.id,
          idempotentReplay: true
        };
      }
      const mealId = id(),
        ingredients = this.requirements(d.items);
      let cost = 0;
      for (const i of ingredients) {
        if (this.store.getProductStockQuantity(i.productId) + 1e-8 < i.quantity) throw Error('Estoque insuficiente para a refeição.');
        const unit = this.store.getProductById(i.productId)!.costPriceCents ?? 0;
        cost += Math.round(unit * i.quantity);
        this.store.adjustStock({
          idempotencyKey: mealId + i.productId,
          productId: i.productId,
          quantityDelta: -i.quantity,
          movementType: 'INTERNAL_USE',
          unitCostCents: unit,
          originChannel: 'STAFF_MEAL_' + d.center,
          reason: 'Refeição equipe: ' + d.staffName,
          userId: a.userId
        });
      }
      this.db.prepare('INSERT INTO internal_meals VALUES(?,?,?,?,?,?,?,?,?)').run(mealId, d.idempotencyKey, h, d.staffName, d.center, JSON.stringify(d.items), cost, a.userId, now());
      this.print('REFEIÇÃO DA EQUIPE — NÃO COBRAR\n' + d.staffName + ' · ' + d.center + '\n' + d.items.map(i => i.quantity + ' x ' + this.store.getProductById(i.productId)!.name).join('\n'), mealId);
      this.audit(a, 'STAFF_MEAL_RECORDED', mealId, {
        costCents: cost
      });
      return {
        id: mealId,
        costCents: cost
      };
    });
  }
  production(raw: unknown, a: Actor) {
    const d = productionSchema.parse(raw);
    return this.atomic(() => {
      const h = hash({
          ...d,
          actor: a.userId
        }),
        prior = this.rows('SELECT * FROM production_batches WHERE idempotency_key=?', d.idempotencyKey)[0];
      if (prior) {
        if (prior.request_hash !== h) throw Error('Lote repetido com conteúdo diferente.');
        return {
          id: prior.id,
          idempotentReplay: true
        };
      }
      if (new Set([...d.inputs, ...d.outputs].map(l => l.productId)).size !== d.inputs.length + d.outputs.length) throw Error('Não repita insumos entre entradas e saídas.');
      const mass = (lines: z.infer<typeof batchLine>[]) => lines.reduce((s, l) => s + l.quantity * l.gramsPerUnit, 0);
      if (Math.abs(mass(d.inputs) - mass(d.outputs) - d.wasteGrams) > 1) throw Error('Peso de entrada deve corresponder às porções, aparas e perdas (tolerância 1 g).');
      const batchId = id();
      let cost = 0;
      for (const l of d.inputs) {
        if (this.store.getProductStockQuantity(l.productId) < l.quantity) throw Error('Insumo insuficiente.');
        cost += Math.round((this.store.getProductById(l.productId)?.costPriceCents ?? 0) * l.quantity);
        this.store.adjustStock({
          idempotencyKey: batchId + l.productId,
          productId: l.productId,
          quantityDelta: -l.quantity,
          movementType: 'INVENTORY_ADJUST',
          reason: 'Produção interna ' + batchId,
          userId: a.userId
        });
      }
      const grams = mass(d.outputs);
      let allocated = 0;
      d.outputs.forEach((l, index) => {
        const p = this.store.getProductById(l.productId);
        if (!p?.trackStock) throw Error('Saída precisa controlar estoque.');
        const share = index === d.outputs.length - 1 ? cost - allocated : Math.round(cost * l.quantity * l.gramsPerUnit / grams);
        allocated += share;
        const previous = this.store.getProductStockQuantity(l.productId);
        if (previous < 0) throw Error('Regularize o estoque negativo antes de produzir.');
        const newCost = Math.round((previous * (p.costPriceCents ?? 0) + share) / (previous + l.quantity));
        this.store.adjustStock({
          idempotencyKey: batchId + l.productId,
          productId: l.productId,
          quantityDelta: l.quantity,
          movementType: 'INVENTORY_ADJUST',
          unitCostCents: newCost,
          reason: 'Porções produzidas ' + batchId,
          userId: a.userId
        });
        this.db.prepare('UPDATE catalog_products SET cost_price_cents=? WHERE id=?').run(newCost, l.productId);
      });
      this.db.prepare('INSERT INTO production_batches VALUES(?,?,?,?,?,?,?,?)').run(batchId, d.idempotencyKey, h, JSON.stringify(d.inputs), JSON.stringify(d.outputs), d.wasteGrams, a.userId, now());
      this.audit(a, 'PRODUCTION_BATCH_RECORDED', batchId);
      return {
        id: batchId,
        costCents: cost
      };
    });
  }
  watchMargin(productId: string, targetBps: number, a: Actor) {
    if (targetBps <= 0 || targetBps >= 10000) throw Error('Margem deve ficar entre zero e 100%.');
    const baseline = this.effectiveCost(productId);
    this.db.prepare('INSERT INTO margin_watch VALUES(?,?,?) ON CONFLICT(product_id) DO UPDATE SET target_bps=excluded.target_bps,baseline_cost_cents=excluded.baseline_cost_cents').run(productId, targetBps, baseline);
    this.audit(a, 'MARGIN_TARGET_CONFIGURED', productId);
  }
  margins() {
    return this.rows('SELECT * FROM margin_watch').map(r => {
      const p = this.store.getProductById(r.product_id)!,
        cost = this.effectiveCost(p.id),
        margin = p.priceCents ? Math.round((p.priceCents - cost) * 10000 / p.priceCents) : 0;
      return {
        productId: p.id,
        name: p.name,
        costCents: cost,
        baselineCostCents: r.baseline_cost_cents,
        priceCents: p.priceCents,
        targetBps: r.target_bps,
        marginBps: margin,
        alert: margin < r.target_bps,
        suggestedPriceCents: Math.ceil(cost * 10000 / (10000 - r.target_bps) / 100) * 100
      };
    });
  }
  applySuggestedPrice(productId: string, expected: number, a: Actor) {
    const r = this.margins().find(i => i.productId === productId);
    if (!r || r.suggestedPriceCents !== expected || expected <= 0) throw Error('Sugestão alterada. Atualize antes de aplicar.');
    const product = this.store.getProductById(productId)!;
    const channels = Object.fromEntries(Object.entries(product.channelPricesCents ?? {}).map(([channel, price]) => [channel, price === product.priceCents ? expected : price]));
    this.db.prepare('UPDATE catalog_products SET price_cents=?,channel_prices_json=?,updated_at=? WHERE id=?').run(expected, JSON.stringify(channels), now(), productId);
    this.audit(a, 'MARGIN_PRICE_APPLIED', productId, {
      amountCents: expected
    });
  }
  shopping() {
    const products = this.store.getCatalog().products,
      links = this.rows('SELECT * FROM product_suppliers'),
      suppliers = this.store.listSuppliers();
    return products.filter(p => p.trackStock && this.store.getProductStockQuantity(p.id) < (p.minStockQuantity ?? 0)).map(p => {
      const usage = this.rows("SELECT COALESCE(SUM(-quantity_delta),0) AS qty FROM stock_movements WHERE product_id=? AND quantity_delta<0 AND movement_type IN ('SALE_DEDUCTION','RECIPE_CONSUMPTION','INTERNAL_USE') AND julianday(created_at)>=julianday('now','-28 days')", p.id)[0].qty,
        current = this.store.getProductStockQuantity(p.id),
        forecast = Math.ceil(usage / 4),
        quantity = Math.max(0, (p.minStockQuantity ?? 0) + forecast - current),
        supplier = suppliers.find(s => s.id === links.find(l => l.product_id === p.id)?.supplier_id);
      return {
        productId: p.id,
        name: p.name,
        unit: p.unitOfMeasure ?? 'UN',
        current,
        minimum: p.minStockQuantity ?? 0,
        weeklyForecast: forecast,
        quantity: Math.ceil(quantity * 1000) / 1000,
        supplierId: supplier?.id ?? null,
        supplierName: supplier?.name ?? 'Fornecedor não definido'
      };
    });
  }
  configureExecutive(productId: string, a: Actor) {
    const p = this.store.getProductById(productId);
    if (!p?.active) throw Error('Produto não encontrado.');
    const groups = [['ponto', 'Ponto da carne', ['Mal passada', 'Ao ponto', 'Bem passada']], ['arroz', 'Arroz incluso', ['Arroz branco', 'Baião de dois']], ['feijao', 'Feijão incluso', ['Feijão tropeiro', 'Feijão de caldo']], ['guarnicao', 'Guarnição inclusa', ['Fritas', 'Macaxeira']]].map(([code, name, options]) => ({
      id: 'executivo-' + code,
      name: name as string,
      minSelect: 1,
      maxSelect: 1,
      options: (options as string[]).map((o, index) => ({
        id: String(code) + '-' + index,
        name: o,
        priceDeltaCents: 0,
        available: true
      }))
    }));
    this.db.prepare('UPDATE catalog_products SET modifier_groups_json=?,updated_at=? WHERE id=?').run(JSON.stringify([...p.modifierGroups.filter(g => !g.id.startsWith('executivo-')), ...groups]), now(), productId);
    this.audit(a, 'EXECUTIVE_CHOICES_CONFIGURED', productId);
  }
  configureBucket(productId: string, ingredientId: string, quantity: number, a: Actor) {
    if (productId === ingredientId || quantity < 1 || quantity > 100) throw Error('Confira combo e quantidade.');
    const p = this.store.getProductById(productId),
      ingredient = this.store.getProductById(ingredientId);
    if (!p?.active || !ingredient?.trackStock) throw Error('Escolha um combo cadastrado e bebida com estoque controlado.');
    const recipe = this.store.saveProductRecipe({
      productId,
      status: 'APPROVED',
      yieldQuantity: 1,
      approvedByUserId: a.userId,
      notes: 'Combo com baixa de unidades individuais',
      items: [{
        ingredientProductId: ingredientId,
        quantityUsed: quantity
      }]
    });
    this.db.prepare('UPDATE catalog_products SET track_stock=0 WHERE id=?').run(productId);
    this.audit(a, 'BUCKET_RECIPE_CONFIGURED', productId);
    return recipe;
  }
  print(text: string, ref: string) {
    const jobId = id();
    this.db.prepare("INSERT INTO print_jobs(id,target_printer,job_type,status,reference_entity_type,reference_entity_id,payload_text,attempts,created_at) VALUES(?,'PRINTER_KITCHEN_HOT','PRODUCTION_TICKET','QUEUED','ORDER',?,?,0,?)").run(jobId, ref, text, now());
    return jobId;
  }
  hotelOps() {
    const options = this.rows('SELECT * FROM hotel_stay_options'),
      stays = this.store.listHotelStays().filter(s => s.status === 'ACTIVE').map(s => {
        const extra = stayOptionsSchema.parse(JSON.parse(options.find(r => r.stay_id === s.id)?.json ?? '{}')),
          minutesRemaining = Math.ceil((Date.parse(s.checkOutScheduledAt) - Date.now()) / 60000);
        return {
          ...s,
          options: extra,
          minutesRemaining,
          dayUseAlert: extra.plan.startsWith('DAY_USE') && minutesRemaining <= 30
        };
      }),
      plans = this.jsonTable('maintenance_plans').map(p => ({
        ...p,
        due: p.active && p.nextDue <= localDate()
      })),
      breakfast = this.rows("SELECT v.*,s.room_number,s.guest_name FROM breakfast_vouchers v JOIN hotel_stays s ON s.id=v.stay_id WHERE v.service_date=? AND s.status='ACTIVE' ORDER BY s.room_number,v.guest_index", localDate());
    return {
      rooms: this.store.listHotelRooms().filter(r => r.active && r.commercialStatus === 'OPERACIONAL'),
      reservations: this.store.listHotelReservations(),
      stays,
      breakfast,
      maintenance: plans
    };
  }
  saveMaintenance(raw: unknown, a: Actor) {
    const d = maintenanceSchema.parse(raw);
    if (!this.store.getHotelRoomByNumber(d.roomNumber)) throw Error('Quarto não encontrado.');
    if (d.blockStart && d.blockEnd) {
      const available = this.store.checkRoomAvailability(d.roomNumber, d.blockStart, d.blockEnd);
      if (!available.available && !d.id) throw Error('Há reserva ou hospedagem no período. Reacomode antes de bloquear.');
    }
    const p = {
      ...d,
      id: d.id ?? id()
    };
    this.db.prepare('INSERT INTO maintenance_plans VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET room_number=excluded.room_number,json=excluded.json').run(p.id, p.roomNumber, JSON.stringify(p));
    this.audit(a, 'MAINTENANCE_SCHEDULED', p.id);
    return p;
  }
  completeMaintenance(planId: string, a: Actor) {
    const p = this.jsonTable('maintenance_plans').find(p => p.id === planId);
    if (!p) throw Error('Plano não encontrado.');
    return this.saveMaintenance({
      ...p,
      lastDone: localDate(),
      nextDue: localDate(new Date(Date.now() + p.intervalDays * 86400000)),
      blockStart: undefined,
      blockEnd: undefined
    }, a);
  }
  breakfastRedeem(raw: unknown, a: Actor) {
    const d = z.object({
      idempotencyKey: key,
      voucherId: z.string(),
      items: orderItemsSchema
    }).strict().parse(raw);
    return this.atomic(() => {
      const h = hash(d),
        prior = this.rows('SELECT * FROM breakfast_redemptions WHERE idempotency_key=?', d.idempotencyKey)[0];
      if (prior) {
        if (prior.request_hash !== h) throw Error('Mesmo crédito com conteúdo diferente.');
        return {
          creditedCents: prior.credited_cents,
          excessCents: prior.excess_cents,
          idempotentReplay: true
        };
      }
      const v = this.rows('SELECT * FROM breakfast_vouchers WHERE id=?', d.voucherId)[0];
      if (!v || v.redeemed_at || v.service_date !== localDate()) throw Error('Voucher indisponível ou já utilizado.');
      const s = extensionSettings(this.db);
      if (localClock().minute < s.breakfastPrintMinute || localClock().minute > s.breakfastServiceEnd) throw Error('Fora do horário de serviço do café.');
      const stay = this.store.getHotelStayById(v.stay_id);
      if (stay?.status !== 'ACTIVE') throw Error('Hospedagem encerrada.');
      this.quote(d.items, 'HOTEL_ROOM');
      const redemptionId = id(),
        tab = this.store.openOrGetTab({
          code: 'CAFE-' + redemptionId,
          type: 'COUNTER',
          customerName: 'Café incluso — Apto ' + stay.roomNumber,
          openedByUserId: a.userId
        });
      this.db.prepare('UPDATE tabs SET service_fee_enabled=0,service_fee_bps=0 WHERE id=?').run(tab.id);
      const {
        order
      } = this.store.createOrder({
        tabId: tab.id,
        idempotencyKey: d.idempotencyKey,
        channel: 'HOTEL_ROOM',
        originNode: 'WAITER_MOBILE',
        items: d.items,
        actorUserId: a.userId,
        customerNotes: 'Café incluso apto ' + stay.roomNumber
      });
      const credited = Math.min(v.allowance_cents, order.totalOrderCents),
        excess = order.totalOrderCents - credited;
      this.store.applyTabDiscount({
        tabId: tab.id,
        discountType: 'FIXED_CENTS',
        discountCents: credited,
        reason: 'Voucher de café da hospedagem ' + stay.stayCode,
        actorUserId: a.userId
      });
      if (excess > 0) this.store.transferRestaurantTabToFolio({
        restaurantTabId: tab.id,
        roomNumber: stay.roomNumber,
        operatorUserId: a.userId,
        operatorName: a.name
      });else this.db.prepare("UPDATE tabs SET status='CLOSED',closed_at=?,closed_by_user_id=? WHERE id=?").run(now(), a.userId, tab.id);
      const cost = d.items.reduce((sum, i) => sum + this.effectiveCost(i.productId) * i.quantity, 0);
      this.db.prepare('INSERT INTO breakfast_redemptions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(redemptionId, d.idempotencyKey, h, stay.id, v.id, credited, excess, Math.round(cost), order.id, a.userId, now());
      this.db.prepare('UPDATE breakfast_vouchers SET redeemed_at=?,redemption_id=? WHERE id=?').run(now(), redemptionId, v.id);
      this.audit(a, 'BREAKFAST_VOUCHER_REDEEMED', redemptionId, {
        roomNumber: stay.roomNumber,
        amountCents: credited
      });
      return {
        creditedCents: credited,
        excessCents: excess
      };
    });
  }
  companies() {
    return this.jsonTable('company_accounts').map(c => ({
      ...c,
      exposureCents: this.companyExposure(c.id)
    }));
  }
  companyExposure(companyId: string) {
    const unbilled = this.rows('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM company_charges WHERE company_id=? AND invoice_id IS NULL', companyId)[0].amount,
      invoices = this.rows("SELECT COALESCE(SUM(a.remaining_amount_cents),0) AS amount FROM company_invoices i JOIN accounts_receivable a ON a.id=i.receivable_id WHERE i.company_id=? AND a.status!='CANCELED'", companyId)[0].amount;
    return unbilled + invoices;
  }
  saveCompany(raw: unknown, a: Actor) {
    const d = companySchema.parse(raw),
      c = {
        ...d,
        id: d.id ?? id()
      };
    if (d.creditLimitCents < this.companyExposure(c.id)) throw Error('Limite menor que o saldo utilizado.');
    this.db.prepare('INSERT INTO company_accounts VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(c.id, JSON.stringify(c));
    this.audit(a, 'COMPANY_ACCOUNT_CONFIGURED', c.id);
    return c;
  }
  chargeCompany(raw: unknown, a: Actor) {
    const d = z.object({
      companyId: z.string(),
      stayId: z.string(),
      signedBy: z.string().trim().min(3).max(100)
    }).strict().parse(raw);
    return this.atomic(() => {
      const prior = this.rows('SELECT * FROM company_charges WHERE stay_id=?', d.stayId)[0];
      if (prior) {
        if (prior.company_id !== d.companyId) throw Error('Hospedagem já faturada para outra empresa.');
        return {
          id: prior.id,
          idempotentReplay: true
        };
      }
      const c = this.companies().find(c => c.id === d.companyId && c.active),
        stay = this.store.getHotelStayById(d.stayId);
      if (!c || stay?.status !== 'ACTIVE') throw Error('Empresa ou hospedagem indisponível.');
      const amount = this.rows('SELECT amount_cents FROM hotel_folio_entries WHERE stay_id=?', stay.id).reduce((sum, r) => sum + r.amount_cents, 0);
      if (amount <= 0) throw Error('Não há saldo para faturar.');
      if (c.exposureCents + amount > c.creditLimitCents) throw Error('Limite de crédito da empresa excedido.');
      const chargeId = id();
      this.store.addFolioEntry({
        stayId: stay.id,
        entryType: 'ADJUSTMENT',
        amountCents: -amount,
        description: 'Faturado para ' + c.name + ' · ciência: ' + d.signedBy,
        sourceReferenceType: 'CORPORATE_BILLING',
        sourceReferenceId: chargeId,
        operatorUserId: a.userId,
        operatorName: a.name
      });
      this.db.prepare('INSERT INTO company_charges VALUES(?,?,?,?,?,NULL,?)').run(chargeId, c.id, stay.id, amount, d.signedBy, now());
      this.audit(a, 'COMPANY_STAY_BILLED', chargeId, {
        amountCents: amount
      });
      return {
        id: chargeId,
        amountCents: amount
      };
    });
  }
  invoice(companyId: string, start: string, end: string, a: Actor) {
    date.parse(start);
    date.parse(end);
    if (end < start) throw Error('Período inválido.');
    return this.atomic(() => {
      const c = this.companies().find(c => c.id === companyId);
      if (!c) throw Error('Empresa não encontrada.');
      const charges = this.rows("SELECT * FROM company_charges WHERE company_id=? AND invoice_id IS NULL AND date(created_at,'-3 hours') BETWEEN ? AND ?", companyId, start, end);
      if (!charges.length) return {
        empty: true
      };
      const invoiceId = id(),
        total = charges.reduce((sum, r) => sum + r.amount_cents, 0),
        receivable = this.store.createAccountReceivable({
          description: 'Fatura ' + c.name + ' · ' + start + ' a ' + end,
          origin: 'HOTEL_FOLIO',
          originReferenceId: invoiceId,
          costCenterId: 'HOTEL',
          categoryId: 'cat-rec-hotel-diarias',
          totalAmountCents: total,
          accrualDate: localDate(),
          dueDate: localDate(new Date(Date.now() + c.dueDays * 86400000)),
          status: 'PENDING',
          customerName: c.name,
          notes: charges.map(r => r.stay_id + ' · ' + r.signed_by + ' · ' + money(r.amount_cents)).join('\n')
        });
      this.db.prepare('INSERT INTO company_invoices VALUES(?,?,?,?,?,?)').run(invoiceId, companyId, start, end, receivable.id, now());
      for (const charge of charges) this.db.prepare('UPDATE company_charges SET invoice_id=? WHERE id=?').run(invoiceId, charge.id);
      this.audit(a, 'COMPANY_INVOICE_CREATED', invoiceId, {
        amountCents: total
      });
      return {
        invoiceId,
        receivable
      };
    });
  }
  summary(day = localDate()) {
    date.parse(day);
    const tx = this.rows("SELECT payment_method,COALESCE(SUM(CASE WHEN type='INCOME' THEN amount_cents WHEN type='EXPENSE' THEN -amount_cents ELSE 0 END),0) AS amount FROM financial_transactions WHERE date(settlement_date)=? GROUP BY payment_method", day),
      cash = this.store.getCashierOperationalSummary() as any,
      hotel = this.hotelOps(),
      low = this.shopping(),
      cover = this.rows("SELECT COALESCE(SUM(cover_charge_cents),0) AS amount FROM tabs WHERE status='CLOSED' AND date(closed_at,'-3 hours')=?", day)[0].amount;
    const restaurantNet=this.rows("SELECT COALESCE(SUM(t.subtotal_cents+t.service_fee_cents-t.discount_cents),0) AS amount FROM tabs t WHERE t.type!='HOTEL_FOLIO' AND t.status='CLOSED' AND date(t.closed_at,'-3 hours')=? AND NOT EXISTS(SELECT 1 FROM orders o JOIN delivery_orders d ON d.order_id=o.id WHERE o.tab_id=t.id)",day)[0].amount+this.rows("SELECT COALESCE(SUM(amount_cents),0) AS amount FROM hotel_folio_entries WHERE entry_type IN ('RESTAURANT_ORDER','BAR_ORDER') AND COALESCE(source_reference_type,'')!='TAB' AND date(created_at,'-3 hours')=?",day)[0].amount;
    const deliveryNet=this.rows("SELECT COALESCE(SUM(items_subtotal_cents+delivery_fee_cents-discount_cents),0) AS amount FROM delivery_orders WHERE status='ENTREGUE' AND date(COALESCE(delivered_at,created_at),'-3 hours')=?",day)[0].amount;
    const hotelNet=this.rows("SELECT COALESCE(SUM(amount_cents),0) AS amount FROM hotel_folio_entries WHERE entry_type NOT IN ('PAYMENT','ADVANCE_PAYMENT','REFUND','RESTAURANT_ORDER','BAR_ORDER') AND COALESCE(source_reference_type,'') NOT IN ('TAB','CORPORATE_BILLING') AND date(created_at,'-3 hours')=?",day)[0].amount;
    return {
      day,
      text: '*DECK 26 — FECHAMENTO ' + day + '*\n\n*Vendas/serviços registrados — líquidos de descontos*\nRestaurante/Bar: ' + money(restaurantNet) + '\nDelivery: ' + money(deliveryNet) + '\nHotel: ' + money(hotelNet) + '\nCouvert (separado): ' + money(cover) + '\n\n*Recebimentos líquidos do dia*\n' + tx.map(r => r.payment_method + ': ' + money(r.amount)).join('\n') + '\nDinheiro esperado na gaveta: ' + money(cash.activeSession?.expectedCashCents ?? 0) + '\n\n*Hotel:* ' + hotel.stays.length + '/' + hotel.rooms.length + ' ocupados\n\n*Reposição de estoque*\n' + (low.map(r => '• ' + r.name + ': ' + r.current + ' ' + r.unit + ' (mín. ' + r.minimum + ')').join('\n') || 'Sem itens abaixo do mínimo') + '\n\nValores gerenciais. Vendas e recebimentos podem pertencer a datas diferentes.'
    };
  }
  tick() {
    const today = localDate(),
      clock = localClock(),
      settings = extensionSettings(this.db);
    if (clock.minute >= settings.breakfastPrintMinute && clock.minute <= settings.breakfastServiceEnd && !this.rows('SELECT service_date FROM morning_prints WHERE service_date=?', today).length) this.atomic(() => {
      const breakfast = this.hotelOps().breakfast;
      if (!breakfast.length) return;
      const rooms = [...new Set(breakfast.map(r => r.room_number))];
      const job = this.print('CAFÉ DA MANHÃ INCLUSO\n' + today + '\n' + rooms.map(room => 'Apto ' + room + ' — ' + breakfast.filter(v => v.room_number === room).length + ' hóspede(s)').join('\n') + '\nTOTAL: ' + breakfast.length + ' pessoas\nVIA INTERNA DA COZINHA', today);
      this.db.prepare('INSERT INTO morning_prints VALUES(?,?)').run(today, job);
    });
    for (const c of this.companies().filter(c => c.autoInvoice)) {
      const periods = new Map<string, {
        start: string;
        end: string;
      }>();
      for (const charge of this.rows('SELECT created_at FROM company_charges WHERE company_id=? AND invoice_id IS NULL', c.id)) {
        const day = localDate(new Date(charge.created_at)),
          half = c.cycle === 'FORTNIGHT',
          second = half && Number(day.slice(8)) > 15,
          start = day.slice(0, 8) + (second ? '16' : '01'),
          next = new Date(Date.parse(day.slice(0, 8) + '01T12:00:00-03:00'));
        next.setUTCMonth(next.getUTCMonth() + 1);
        const end = half && !second ? day.slice(0, 8) + '15' : localDate(new Date(next.getTime() - 86400000));
        if (end < today) periods.set(start, {
          start,
          end
        });
      }
      for (const p of periods.values()) this.invoice(c.id, p.start, p.end, {
        userId: 'SYSTEM',
        name: 'Rotina local',
        role: 'OWNER'
      });
    }
  }
}
