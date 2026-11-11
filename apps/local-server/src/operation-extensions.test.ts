import {DatabaseSync} from 'node:sqlite';
import {LocalOperationalStore} from './store.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalServer } from './server.js';
import { OperationExtensions } from './operation-extensions.js';
import { extensionSettings, inSchedule, promotionalPrice, stayOptionsSchema, localDate } from './extension-models.js';
const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date']
  });
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck26-extensions-'));
  vi.stubEnv('DECK26_OPERATION_DATA_DIR', dir);
  const {
    app,
    store
  } = await buildLocalServer({
    dbPath: ':memory:',
    demoMode: false,
    requireStrictAuth: true
  });
  cleanup.push(async () => {
    await app.close();
    store.close();
    if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'deck26-extensions-')) fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  });
  store.initializeLocalOperation({
    name: 'Gerência fixture',
    pin: '536821',
    importCatalog: true,
    actorIp: '127.0.0.1'
  });
  const login = (await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      pin: '536821'
    }
  })).json();
  const actor = {
    userId: login.userId ?? 'usr-owner-01',
    role: 'OWNER' as const,
    name: 'Gerência fixture'
  };
  actor.userId = (store.db.prepare("SELECT id FROM users WHERE role='OWNER'").get() as any).id;
  const ops = new OperationExtensions(store),
    headers = {
      authorization: 'Bearer ' + login.token
    };
  const product = (name: string, overrides: Record<string, any> = {}) => store.createCatalogProduct({
    sku: 'FIX-' + crypto.randomUUID().slice(0, 8),
    name,
    categoryId: store.getCatalog().categories[0]!.id,
    priceCents: 1000,
    costPriceCents: 200,
    channelPricesCents: {},
    availableChannels: ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM'],
    prepStation: 'KITCHEN_HOT',
    trackStock: true,
    initialStock: 20,
    minStockQuantity: 5,
    outOfStockPolicy: 'BLOCK_SALE',
    modifierGroups: [],
    ...overrides
  });
  const stay = (options: any = {}, roomNumber = '101') => {
    const guest = store.createHotelGuest({
      fullName: 'Hóspede fixture',
      documentType: 'CPF',
      documentNumber: '52998224725',
      operatorUserId: actor.userId
    });
    return store.checkInHotelStay({
      roomNumber,
      guestId: guest.id,
      checkInAt: '2026-11-05T15:00:00Z',
      checkOutScheduledAt: '2026-11-07T15:00:00Z',
      dailyRateCents: 10000,
      options: stayOptionsSchema.parse(options),
      operatorUserId: actor.userId,
      operatorName: actor.name
    }).stay;
  };
  const order = (productId: string, quantity = 1) => store.createOrder({
    channel: 'COUNTER_PDV',
    originNode: 'WINDOWS_PDV',
    idempotencyKey: 'fixture-' + crypto.randomUUID(),
    actorUserId: actor.userId,
    items: [{
      productId,
      quantity
    }]
  });
  return {
    app,
    store,
    ops,
    actor,
    headers,
    product,
    stay,
    order
  };
}
describe('Operação integrada: promoções, estoque, PMS e cliente', () => {
  it('happy hour não acumula descontos e expira às 20h01 no fuso de Fortaleza', async () => {
    const {
        ops,
        actor,
        store,
        product
      } = await fixture(),
      p = product('Petisco');
    const rule = {
      name: 'Happy hour',
      active: true,
      weekdays: [5],
      startMinute: 1020,
      endMinute: 1200,
      discountBps: 1500,
      productIds: [p.id],
      channels: ['DINE_IN']
    };
    ops.savePromotion(rule, actor);
    ops.savePromotion({
      ...rule,
      name: 'Oferta maior',
      discountBps: 2000
    }, actor);
    expect(promotionalPrice(store.db, p, 'DINE_IN', new Date('2026-11-06T23:00:00Z')).priceCents).toBe(800);
    expect(promotionalPrice(store.db, p, 'DINE_IN', new Date('2026-11-06T23:01:00Z')).priceCents).toBe(1000);
    expect(promotionalPrice(store.db, p, 'DELIVERY', new Date('2026-11-06T22:00:00Z')).priceCents).toBe(1000);
    expect(inSchedule([5], 1320, 120, new Date('2026-11-07T04:00:00Z'))).toBe(true);
  });
  it('pedido congela o preço promocional autorizado pelo servidor', async () => {
    const {
        ops,
        actor,
        store,
        product,
        order
      } = await fixture(),
      p = product('Prato');
    ops.savePromotion({
      name: 'Manhã',
      active: true,
      weekdays: [5],
      startMinute: 0,
      endMinute: 1439,
      discountBps: 1500,
      productIds: [p.id],
      channels: ['COUNTER_PDV']
    }, actor);
    expect(order(p.id).order.items[0]!.unitPriceCents).toBe(850);
    expect(store.getCatalog().products.find(i => i.id === p.id)!.channelPricesCents!.COUNTER_PDV).toBe(850);
    expect(store.getProductById(p.id)!.priceCents).toBe(1000);
  });
  it('couvert exige aviso, cobra por pessoa e fica fora da taxa de serviço e descontos', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      settings = extensionSettings(store.db);
    expect(settings.cover.enabled).toBe(false);
    expect(() => ops.saveSettings({
      ...settings,
      cover: {
        ...settings.cover,
        enabled: true,
        unitCents: 1000
      }
    }, actor)).toThrow(/aviso/);
    ops.saveSettings({
      ...settings,
      cover: {
        enabled: true,
        unitCents: 1000,
        notice: 'Música ao vivo com couvert de R$ 10 por pessoa.',
        weekdays: [5],
        startMinute: 0,
        endMinute: 1439
      }
    }, actor);
    const {
      tab
    } = store.openTable({
      tableNumber: 1,
      guestsCount: 4,
      waiterUserId: actor.userId
    });
    expect(tab.coverChargeCents).toBe(4000);
    const p = product('Prato');
    store.createOrder({
      tabId: tab.id,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      idempotencyKey: 'cover-fixture-order',
      items: [{
        productId: p.id,
        quantity: 1
      }]
    });
    const billed = store.getTabById(tab.id)!;
    expect(billed.serviceFeeCents).toBe(100);
    expect(billed.totalCents).toBe(5100);
    store.applyTabDiscount({
      tabId: tab.id,
      discountType: 'COURTESY',
      reason: 'Cortesia dos alimentos',
      actorUserId: actor.userId
    });
    expect(store.getTabById(tab.id)!.totalCents).toBe(4000);
  });
  it('couvert é separado no resultado e no resumo do proprietário', async () => {
    const {
      ops,
      store,
      actor
    } = await fixture();
    ops.saveSettings({
      ...extensionSettings(store.db),
      cover: {
        enabled: true,
        unitCents: 1000,
        notice: 'Couvert artístico informado antes do consumo.',
        weekdays: [5],
        startMinute: 0,
        endMinute: 1439
      }
    }, actor);
    store.openCashRegisterSession({
      openingBalanceCents: 0,
      openedByUserId: actor.userId
    });
    const {
      tab
    } = store.openTable({
      tableNumber: 1,
      guestsCount: 2,
      waiterUserId: actor.userId
    });
    store.recordPayment({
      tabId: tab.id,
      amountCents: 2000,
      method: 'PIX',
      operatorUserId: actor.userId,
      idempotencyKey: 'couvert-paid-fixture'
    });
    store.closeTabAndReleaseTable({
      tabId: tab.id,
      actorUserId: actor.userId
    });
    const dre = store.generateDreStatement({
      startDate: localDate(),
      endDate: localDate()
    });
    expect(dre.revenueByCostCenter!.MUSIC).toBe(2000);
    expect(dre.revenueByCostCenter!.REST).toBe(0);
    expect(ops.summary().text).toContain('Couvert (separado): R$');
  });
  it('executivo exige quatro escolhas e rejeita preço de adicional adulterado', async () => {
    const {
        ops,
        actor,
        product
      } = await fixture(),
      p = product('Executivo');
    ops.configureExecutive(p.id, actor);
    expect(() => ops.quote([{
      productId: p.id,
      quantity: 1
    }], 'DINE_IN')).toThrow(/Confira/);
    const edited = ops.store.getProductById(p.id)!;
    const modifiers = edited.modifierGroups.map(g => ({
      groupId: g.id,
      groupName: g.name,
      optionId: g.options[0]!.id,
      optionName: 'Nome manipulado',
      priceDeltaCents: -100000
    }));
    expect(ops.quote([{
      productId: p.id,
      quantity: 1,
      modifiers
    }], 'DINE_IN')).toBe(1000);
  });
  it('balde vende um combo e baixa cinco cervejas, sem baixar duas vezes no reenvio', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      beer = product('Cerveja'),
      bucket = product('Balde', {
        trackStock: false,
        initialStock: 0,
        priceCents: 4000
      });
    ops.configureBucket(bucket.id, beer.id, 5, actor);
    const payload = {
      channel: 'COUNTER_PDV' as const,
      originNode: 'WINDOWS_PDV' as const,
      idempotencyKey: 'bucket-fixture-idempotent',
      items: [{
        productId: bucket.id,
        quantity: 1
      }]
    };
    expect(store.createOrder(payload).order.totalOrderCents).toBe(4000);
    expect(store.getProductStockQuantity(beer.id)).toBe(15);
    store.createOrder(payload);
    expect(store.getProductStockQuantity(beer.id)).toBe(15);
  });
  it('produção preserva a massa, transforma o estoque e repete um lote sem duplicação', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      raw = product('Picanha bruta', {
        initialStock: 5,
        costPriceCents: 10000
      }),
      portion = product('Porção 220g', {
        initialStock: 0
      }),
      trimming = product('Aparas kg', {
        initialStock: 0
      });
    const payload = {
      idempotencyKey: 'production-fixture-key',
      inputs: [{
        productId: raw.id,
        quantity: 5,
        gramsPerUnit: 1000
      }],
      outputs: [{
        productId: portion.id,
        quantity: 20,
        gramsPerUnit: 220
      }, {
        productId: trimming.id,
        quantity: .6,
        gramsPerUnit: 1000
      }],
      wasteGrams: 0
    };
    expect(() => ops.production({
      ...payload,
      wasteGrams: 10
    }, actor)).toThrow(/Peso/);
    expect(store.getProductStockQuantity(raw.id)).toBe(5);
    ops.production(payload, actor);
    expect(store.getProductStockQuantity(raw.id)).toBe(0);
    expect(store.getProductStockQuantity(portion.id)).toBe(20);
    expect(store.getProductStockQuantity(trimming.id)).toBe(.6);
    expect(ops.production(payload, actor).idempotentReplay).toBe(true);
    expect(store.listPayments()).toHaveLength(0);
    expect(store.getProductById(portion.id)!.costPriceCents).toBe(2200);
  });
  it('falha na saída de produção reverte a baixa inteira da entrada', async () => {
    const {
        ops,
        actor,
        product,
        store
      } = await fixture(),
      raw = product('Matéria prima', {
        initialStock: 5
      }),
      out = product('Saída sem estoque', {
        trackStock: false
      });
    expect(() => ops.production({
      idempotencyKey: 'production-rollback-key',
      inputs: [{
        productId: raw.id,
        quantity: 1,
        gramsPerUnit: 1000
      }],
      outputs: [{
        productId: out.id,
        quantity: 1,
        gramsPerUnit: 1000
      }],
      wasteGrams: 0
    }, actor)).toThrow(/controlar estoque/);
    expect(store.getProductStockQuantity(raw.id)).toBe(5);
    expect(ops.rows('SELECT * FROM production_batches')).toHaveLength(0);
  });
  it('refeição da equipe baixa ingredientes e reconhece custo do hotel sem faturamento', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      ingredient = product('Ingrediente', {
        costPriceCents: 300
      }),
      meal = product('Refeição', {
        trackStock: false
      });
    store.saveProductRecipe({
      productId: meal.id,
      status: 'APPROVED',
      yieldQuantity: 1,
      approvedByUserId: actor.userId,
      items: [{
        ingredientProductId: ingredient.id,
        quantityUsed: 2
      }]
    });
    const payload = {
      idempotencyKey: 'meal-fixture-idempotent',
      staffName: 'Equipe hotel',
      center: 'HOTEL',
      items: [{
        productId: meal.id,
        quantity: 1
      }]
    };
    ops.staffMeal(payload, actor);
    ops.staffMeal(payload, actor);
    expect(store.getProductStockQuantity(ingredient.id)).toBe(18);
    expect(store.listOrders()).toHaveLength(0);
    expect(store.listFinancialTransactions()).toHaveLength(0);
    const dre = store.generateDreStatement({
      startDate: localDate(),
      endDate: localDate()
    });
    expect(dre.directCostsCents).toBe(600);
    expect(dre.grossRevenueCents).toBe(0);
  });
  it('custo maior alerta a margem e só muda o preço mediante ação explícita', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      p = product('Cuscuz', {
        costPriceCents: 300
      });
    ops.watchMargin(p.id, 6500, actor);
    store.adjustStock({
      productId: p.id,
      quantityDelta: 1,
      movementType: 'PURCHASE_ENTRY',
      unitCostCents: 600,
      reason: 'Compra com custo maior',
      userId: actor.userId
    });
    const row = ops.margins()[0]!;
    expect(row.alert).toBe(true);
    expect(row.baselineCostCents).toBe(300);
    expect(row.costCents).toBe(600);
    expect(row.suggestedPriceCents).toBe(1800);
    expect(store.getProductById(p.id)!.priceCents).toBe(1000);
    ops.applySuggestedPrice(p.id, 1800, actor);
    expect(store.getProductById(p.id)!.priceCents).toBe(1800);
  });
  it('compras agrupa fornecedor e calcula mínimo mais previsão semanal observada', async () => {
    const {
        ops,
        store,
        actor,
        product
      } = await fixture(),
      p = product('Reposição', {
        initialStock: 10,
        minStockQuantity: 5
      }),
      supplier = store.createSupplier({
        name: 'Fornecedor fixture',
        active: true
      });
    store.db.prepare('INSERT INTO product_suppliers VALUES(?,?)').run(p.id, supplier.id);
    store.adjustStock({
      productId: p.id,
      quantityDelta: -8,
      movementType: 'INTERNAL_USE',
      reason: 'Consumo de referência',
      userId: actor.userId
    });
    const row = ops.shopping().find(r => r.productId === p.id)!;
    expect(row.current).toBe(2);
    expect(row.weeklyForecast).toBe(2);
    expect(row.quantity).toBe(5);
    expect(row.supplierName).toBe('Fornecedor fixture');
  });
  it.each([['DAY_USE_4H', 4], ['DAY_USE_6H', 6]])('pacote %s calcula saída sem multiplicar o valor por dias', async (plan, hours) => {
    const {
      store,
      actor,
      stay
    } = await fixture();
    const s = stay({
      plan
    });
    expect(Date.parse(s.checkOutScheduledAt) - Date.parse(s.checkInAt)).toBe(hours * 3600000);
    expect(s.nightsCount).toBe(1);
    expect(store.listFolioEntriesByStayId(s.id)[0]!.amountCents).toBe(10000);
  });
  it('café gera crédito por pessoa/dia, consome uma vez e lança apenas o excedente', async () => {
    const {
      ops,
      store,
      actor,
      stay,
      product
    } = await fixture();
    store.openCashRegisterSession({
      openingBalanceCents: 0,
      openedByUserId: actor.userId
    });
    const s = stay({
        breakfastIncluded: true,
        breakfastGuests: 2,
        breakfastAllowanceCents: 600,
        vehiclePlate: 'ABC1D23',
        vehicleModel: 'Carro fixture'
      }, '102'),
      p = product('Café da manhã');
    const vouchers = ops.hotelOps().breakfast;
    expect(vouchers).toHaveLength(2);
    const initial = store.listFolioEntriesByStayId(s.id).reduce((sum, e) => sum + e.amountCents, 0);
    const payload = {
      idempotencyKey: 'breakfast-fixture-key',
      voucherId: vouchers[0].id,
      items: [{
        productId: p.id,
        quantity: 1
      }]
    };
    expect(ops.breakfastRedeem(payload, actor)).toMatchObject({
      creditedCents: 600,
      excessCents: 400
    });
    expect(ops.breakfastRedeem(payload, actor).idempotentReplay).toBe(true);
    expect(() => ops.breakfastRedeem({
      ...payload,
      idempotencyKey: 'another-breakfast-key'
    }, actor)).toThrow(/utilizado/);
    expect(store.getProductStockQuantity(p.id)).toBe(19);
    expect(store.listFolioEntriesByStayId(s.id).reduce((sum, e) => sum + e.amountCents, 0)).toBe(initial + 400);
    expect(store.listFinancialTransactions()).toHaveLength(0);
    expect(ops.hotelOps().stays[0]!.options.vehiclePlate).toBe('ABC1D23');
    expect(ops.summary().text).toMatch(/Restaurante\/Bar: R\$\s4,00/);
  });
  it('lista de café imprime uma vez por manhã e pacote avisa antes de vencer', async () => {
    const {
      ops,
      stay,
      store
    } = await fixture();
    stay({
      breakfastIncluded: true,
      breakfastAllowanceCents: 1000
    });
    ops.tick();
    ops.tick();
    expect(ops.rows('SELECT * FROM morning_prints')).toHaveLength(1);
    expect(store.listPrintJobs()[0]!.payloadText).toContain('CAFÉ DA MANHÃ');
    const s = stay({
      plan: 'DAY_USE_4H'
    }, '102');
    vi.setSystemTime(new Date(Date.parse(s.checkOutScheduledAt) - 29 * 60000));
    expect(ops.hotelOps().stays.find(row => row.id === s.id)!.dayUseAlert).toBe(true);
  });
  it('manutenção bloqueia disponibilidade e conclusão libera o período e reagenda', async () => {
    const {
      ops,
      actor,
      store
    } = await fixture();
    const p = ops.saveMaintenance({
      roomNumber: '104',
      name: 'Filtro ar-condicionado',
      intervalDays: 90,
      lastDone: '2026-08-01',
      nextDue: '2026-11-01',
      blockStart: '2026-11-10',
      blockEnd: '2026-11-12',
      active: true
    }, actor);
    expect(store.checkRoomAvailability('104', '2026-11-10', '2026-11-11').available).toBe(false);
    expect(store.checkRoomAvailability('104', '2026-11-12', '2026-11-13').available).toBe(true);
    expect(ops.hotelOps().maintenance[0].due).toBe(true);
    ops.completeMaintenance(p.id, actor);
    expect(store.checkRoomAvailability('104', '2026-11-10', '2026-11-11').available).toBe(true);
    expect(ops.hotelOps().maintenance[0].nextDue).toBe('2027-02-04');
  });
  it('convênio impede excesso de limite e gera uma fatura sem duplicar receita ou dinheiro', async () => {
    const {
        ops,
        store,
        actor,
        stay
      } = await fixture(),
      s = stay(),
      c = ops.saveCompany({
        name: 'Transportadora fixture',
        document: '12345678000190',
        creditLimitCents: 1000,
        cycle: 'FORTNIGHT',
        active: true
      }, actor);
    expect(() => ops.chargeCompany({
      companyId: c.id,
      stayId: s.id,
      signedBy: 'Motorista fixture'
    }, actor)).toThrow(/Limite/);
    const before = store.generateDreStatement({
      startDate: localDate(),
      endDate: localDate()
    }).grossRevenueCents;
    ops.saveCompany({
      ...c,
      creditLimitCents: 100000
    }, actor);
    ops.chargeCompany({
      companyId: c.id,
      stayId: s.id,
      signedBy: 'Motorista fixture'
    }, actor);
    expect(store.listFolioEntriesByStayId(s.id).reduce((sum, e) => sum + e.amountCents, 0)).toBe(0);
    const invoice = ops.invoice(c.id, localDate(), localDate(), actor);
    expect(invoice.receivable!.totalAmountCents).toBe(20000);
    expect(ops.invoice(c.id, localDate(), localDate(), actor).empty).toBe(true);
    expect(ops.companyExposure(c.id)).toBe(20000);
    expect(store.listFinancialTransactions()).toHaveLength(0);
    expect(store.generateDreStatement({
      startDate: localDate(),
      endDate: localDate()
    }).grossRevenueCents).toBe(before);
  });
  it('delivery público aguarda aceitação sem estoque ou cobrança, com confirmação idempotente', async () => {
    const {
        ops,
        actor,
        store,
        product,
        app,
        headers
      } = await fixture(),
      p = product('Pedido delivery');
    const body = {
      idempotencyKey: 'delivery-' + 'a'.repeat(32),
      customerName: 'Cliente fixture',
      customerPhone: '98999990000',
      deliveryType: 'PICKUP',
      items: [{
        productId: p.id,
        quantity: 1
      }],
      paymentMethodDeclared: 'PIX',
      quotedTotalCents: 1000
    };
    const result = ops.submitDelivery(body);
    expect(result.status).toBe('PENDING');
    expect(store.listOrders()).toHaveLength(0);
    expect(store.getProductStockQuantity(p.id)).toBe(20);
    expect(ops.submitDelivery(body).id).toBe(result.id);
    expect(() => ops.submitDelivery({
      ...body,
      customerName: 'Outro cliente'
    })).toThrow(/conteúdo/);
    ops.decideDelivery(result.id, true, actor);
    ops.decideDelivery(result.id, true, actor);
    expect(store.listOrders()).toHaveLength(1);
    expect(store.getProductStockQuantity(p.id)).toBe(19);
    expect(store.listTabs()).toHaveLength(0);
    expect(store.listFinancialTransactions()).toHaveLength(0);
    expect(store.listAccountsReceivable()).toHaveLength(1);
    expect(ops.deliveryStatus(body.idempotencyKey).status).toBe('ACCEPTED');
    expect((await app.inject('/api/ops/delivery-repeat?phone=98999990000')).statusCode).toBe(401);
    expect((await app.inject({
      url: '/api/ops/delivery-repeat?phone=98999990000',
      headers
    })).json().customerName).toBe('Cliente fixture');
  });
  it('delivery rejeita taxa/preço manipulado, mínimo e preço alterado durante aprovação', async () => {
    const {
        ops,
        actor,
        store,
        product
      } = await fixture(),
      p = product('Entrega'),
      zone = store.createDeliveryZone({
        name: 'Área fixture',
        feeCents: 700,
        minimumOrderCents: 2000,
        estimatedMinutes: 40,
        active: true
      }),
      address = {
        street: 'Rua fixture',
        number: '10',
        neighborhood: 'Centro',
        city: 'Cidade fixture'
      };
    expect(() => ops.deliveryQuote({
      items: [{
        productId: p.id,
        quantity: 1
      }],
      deliveryType: 'DELIVERY',
      deliveryZoneId: zone.id,
      deliveryAddress: address
    })).toThrow(/mínimo/);
    const body = {
      idempotencyKey: 'delivery-' + 'b'.repeat(32),
      customerName: 'Cliente fixture',
      customerPhone: '98999990000',
      deliveryType: 'DELIVERY',
      deliveryZoneId: zone.id,
      deliveryAddress: address,
      items: [{
        productId: p.id,
        quantity: 2
      }],
      paymentMethodDeclared: 'CASH',
      quotedTotalCents: 2700
    };
    expect(() => ops.submitDelivery({
      ...body,
      quotedTotalCents: 1
    })).toThrow(/Preços/);
    const pending = ops.submitDelivery(body);
    store.updateCatalogProduct(p.id, {
      priceCents: 1500
    });
    expect(() => ops.decideDelivery(pending.id, true, actor)).toThrow(/mudou/);
    expect(store.listOrders()).toHaveLength(0);
    expect(store.getProductStockQuantity(p.id)).toBe(20);
  });
  it('fila acima do limiar amplia ETA e menu destaca categorias pelo horário', async () => {
    const {
        ops,
        store,
        product,
        order
      } = await fixture(),
      p = product('Fila');
    for (let i = 0; i < 13; i++) order(p.id);
    expect(ops.eta()).toMatchObject({
      min: 50,
      max: 65,
      busy: true,
      queue: 13
    });
    expect(ops.highlights(new Date('2026-11-06T12:00:00Z'))).toContain('cafeteria');
    expect(ops.highlights(new Date('2026-11-06T16:00:00Z'))).toContain('executiv');
    expect(ops.highlights(new Date('2026-11-06T23:00:00Z'))).toContain('petisco');
  });
  it('novas rotas gerenciais não permitem acesso anônimo nem vazam custos no catálogo público', async () => {
    const {
      app
    } = await fixture();
    for (const url of ['/api/ops/hotel', '/api/ops/stock', '/api/ops/config', '/api/ops/company-finance', '/api/ops/shift-summary', '/api/ops/delivery-inbox']) expect((await app.inject(url)).statusCode).toBe(401);
    const c = (await app.inject('/api/public/delivery/catalog')).json();
    expect(c.catalog.products.length).toBeGreaterThan(0);
    expect(c.catalog.products[0]).not.toHaveProperty('costPriceCents');
    expect(c.catalog.products[0]).not.toHaveProperty('internalNotes');
  });
  it('fechamento automático recupera períodos encerrados enquanto o PC ficou desligado', async () => {
    const {
      ops,
      actor,
      store,
      stay
    } = await fixture();
    const s = stay(),
      company = ops.saveCompany({
        name: 'Frota quinzenal fixture',
        document: '12345678000190',
        creditLimitCents: 100000,
        cycle: 'FORTNIGHT'
      }, actor);
    ops.chargeCompany({
      companyId: company.id,
      stayId: s.id,
      signedBy: 'Motorista fixture'
    }, actor);
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));
    ops.tick();
    ops.tick();
    const invoices = ops.rows('SELECT * FROM company_invoices');
    expect(invoices).toHaveLength(1);
    expect(invoices[0].period_start).toBe('2026-11-01');
    expect(invoices[0].period_end).toBe('2026-11-15');
    expect(store.listFinancialTransactions()).toHaveLength(0);
  });
  it('check-in durante o café gera voucher da própria manhã sem exceder a capacidade', async () => {
    const {
      ops,
      store,
      actor
    } = await fixture();
    const guest = store.createHotelGuest({
      fullName: 'Hóspede cedo fixture',
      documentNumber: '52998224725',
      operatorUserId: actor.userId
    });
    store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkInAt: '2026-11-06T11:00:00Z',
      checkOutScheduledAt: '2026-11-07T15:00:00Z',
      dailyRateCents: 10000,
      options: stayOptionsSchema.parse({
        breakfastIncluded: true,
        breakfastAllowanceCents: 1000
      }),
      operatorUserId: actor.userId,
      operatorName: actor.name
    });
    expect(ops.hotelOps().breakfast).toHaveLength(1);
  });
  it('atendente vê disponibilidade para vender sem receber saldos e custos de estoque', async () => {
    const {
        app,
        headers,
        product
      } = await fixture(),
      p = product('Produto disponível fixture');
    const create = await app.inject({
      method: 'POST',
      url: '/api/operation/operators',
      headers,
      payload: {
        name: 'Caixa fixture',
        role: 'CASHIER',
        pin: '749251',
        active: true
      }
    });
    expect(create.statusCode).toBeLessThan(300);
    const token = (await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        pin: '749251'
      }
    })).json().token;
    const state = (await app.inject({
      url: '/api/state',
      headers: {
        authorization: 'Bearer ' + token
      }
    })).json();
    expect(state.stock.balances).toHaveLength(0);
    const visible = state.catalog.products.find((row: any) => row.id === p.id);
    expect(visible.availableForSale).toBe(true);
    expect(visible.costPriceCents).toBeUndefined();
    expect((await app.inject({
      url: '/api/ops/stock',
      headers: {
        authorization: 'Bearer ' + token
      }
    })).statusCode).toBe(403);
    expect((await app.inject({
      url: '/api/ops/config',
      headers: {
        authorization: 'Bearer ' + token
      }
    })).statusCode).toBe(403);
  });
  it('sem insumos, aprovação de delivery reverte estoque, pedido e conta a receber', async () => {
    const {
        ops,
        actor,
        product,
        store
      } = await fixture(),
      p = product('Sem saldo', {
        initialStock: 0
      });
    const request = ops.submitDelivery({
      idempotencyKey: 'delivery-' + 'c'.repeat(32),
      customerName: 'Cliente fixture',
      customerPhone: '98999990000',
      deliveryType: 'PICKUP',
      items: [{
        productId: p.id,
        quantity: 1
      }],
      paymentMethodDeclared: 'PIX',
      quotedTotalCents: 1000
    });
    expect(() => ops.decideDelivery(request.id, true, actor)).toThrow(/Estoque/);
    expect(store.listOrders()).toHaveLength(0);
    expect(store.listAccountsReceivable()).toHaveLength(0);
    expect(ops.deliveryStatus('delivery-' + 'c'.repeat(32)).status).toBe('PENDING');
    expect(ops.publicCatalog('DELIVERY').catalog.products.find(row => row.id === p.id)!.availableForSale).toBe(false);
  });
  it('prazo da região e fila movimentada compõem uma previsão maior no cliente', async () => {
    const {
        ops,
        product,
        store,
        order
      } = await fixture(),
      p = product('Fila extra'),
      zone = store.createDeliveryZone({
        name: 'Área distante',
        feeCents: 1000,
        minimumOrderCents: 0,
        estimatedMinutes: 60,
        active: true
      });
    expect(ops.etaForZone(zone.id)).toMatchObject({
      min: 60,
      max: 75
    });
    for (let i = 0; i < 13; i++) order(p.id);
    expect(ops.etaForZone(zone.id)).toMatchObject({
      min: 80,
      max: 95
    });
  });

 it('migração persistente preserva venda, estoque e caixa e pode reabrir sem duplicação',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'deck26-migration-'));const file=path.join(directory,'legacy.sqlite');let store:LocalOperationalStore|undefined;
 cleanup.push(async()=>{try{store?.close();}catch{}if(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'deck26-migration-'))fs.rmSync(directory,{recursive:true,force:true});});
 store=new LocalOperationalStore(file,false);store.initializeLocalOperation({name:'Responsável migração',pin:'536821',importCatalog:true,actorIp:'127.0.0.1'});const actor=(store.db.prepare("SELECT id FROM users WHERE role='OWNER'").get() as any).id,p=store.getCatalog().products.find(p=>!p.modifierGroups.length)!;store.adjustStock({productId:p.id,quantityDelta:5,movementType:'INVENTORY_ADJUST',reason:'Inventário fixture',userId:actor});store.openCashRegisterSession({openingBalanceCents:0,openedByUserId:actor});const {order}=store.createOrder({idempotencyKey:'migration-fixture-order',channel:'COUNTER_PDV',originNode:'WINDOWS_PDV',items:[{productId:p.id,quantity:1}]});const tab=store.getTabById(order.tabId!)!;store.recordPayment({tabId:tab.id,amountCents:tab.totalCents,method:'PIX',operatorUserId:actor,idempotencyKey:'migration-fixture-pay'});const quantity=store.getProductStockQuantity(p.id),balance=store.listFinancialAccounts().find(a=>a.id==='acc-conta-pix')!.currentBalanceCents;store.close();store=undefined;
 const legacy=new DatabaseSync(file);legacy.exec("DROP TABLE cover_charges; ALTER TABLE tabs DROP COLUMN cover_charge_cents; DELETE FROM schema_migrations WHERE version='0011_operation_extensions';");legacy.close();
 store=new LocalOperationalStore(file,false);expect(store.getTabById(tab.id)!.totalCents).toBe(tab.totalCents);expect(store.listPayments()).toHaveLength(1);expect(store.getProductStockQuantity(p.id)).toBe(quantity);expect(store.listFinancialAccounts().find(a=>a.id==='acc-conta-pix')!.currentBalanceCents).toBe(balance);expect(store.db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);store.close();store=new LocalOperationalStore(file,false);expect(store.listPayments()).toHaveLength(1);expect(store.db.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
 });

 it('unir e separar mesas conserva todos os couverts e não cobra de novo',async()=>{const {ops,store,actor}=await fixture();ops.saveSettings({...extensionSettings(store.db),cover:{enabled:true,unitCents:1000,notice:'Couvert informado antes do consumo.',weekdays:[5],startMinute:0,endMinute:1439}},actor);const a=store.openTable({tableNumber:1,guestsCount:2,waiterUserId:actor.userId}),b=store.openTable({tableNumber:2,guestsCount:3,waiterUserId:actor.userId});const joined=store.joinTables({primaryTableNumber:1,tableNumbersToJoin:[2],actorUserId:actor.userId});expect(joined.tab.coverChargeCents).toBe(5000);expect(joined.tab.totalCents).toBe(5000);store.joinTables({primaryTableNumber:1,tableNumbersToJoin:[2],actorUserId:actor.userId});expect(store.getTabById(a.tab.id)!.coverChargeCents).toBe(5000);const separated=store.unjoinTable({tableNumberToSeparate:2,actorUserId:actor.userId});expect(separated.primaryTab.coverChargeCents).toBe(2000);expect(separated.separatedTab!.coverChargeCents).toBe(3000);expect(separated.primaryTab.totalCents+separated.separatedTab!.totalCents).toBe(5000);expect(ops.rows('SELECT * FROM cover_charges')).toHaveLength(2);expect(store.listPayments()).toHaveLength(0);});
 it('couvert impede união com quantidade desconhecida e separação após pagamento parcial',async()=>{const {ops,store,actor}=await fixture();ops.saveSettings({...extensionSettings(store.db),cover:{enabled:true,unitCents:1000,notice:'Couvert informado antes do consumo.',weekdays:[5],startMinute:0,endMinute:1439}},actor);store.openTable({tableNumber:1,guestsCount:2,waiterUserId:actor.userId});expect(()=>store.joinTables({primaryTableNumber:1,tableNumbersToJoin:[2],actorUserId:actor.userId})).toThrow(/quantidade real/);store.openTable({tableNumber:2,guestsCount:3,waiterUserId:actor.userId});const joined=store.joinTables({primaryTableNumber:1,tableNumbersToJoin:[2],actorUserId:actor.userId});store.openCashRegisterSession({openingBalanceCents:0,openedByUserId:actor.userId});store.recordPayment({tabId:joined.tab.id,amountCents:1000,method:'PIX',operatorUserId:actor.userId,idempotencyKey:'cover-join-partial-payment'});expect(()=>store.unjoinTable({tableNumberToSeparate:2,actorUserId:actor.userId})).toThrow(/já recebeu pagamento/);expect(store.getTabById(joined.tab.id)!.totalCents).toBe(5000);expect(store.getDiningTableByNumber(2)!.activeTabId).toBe(joined.tab.id);});
});

describe('Expedição e cardápio com disponibilidade controlada',()=>{
 const body=(id:string,key='b')=>({idempotencyKey:'delivery-'+key.repeat(32),customerName:'Cliente fictício',customerPhone:'98999990000',deliveryType:'PICKUP',items:[{productId:id,quantity:1}],paymentMethodDeclared:'PIX',quotedTotalCents:1000});
 it('bloqueia envio direto enquanto fechado sem estoque, contas ou fila parcial',async()=>{const {ops,store,actor,product,app}=await fixture();const p=product('Produto fixture');ops.saveDeliveryService({...ops.deliveryService(),mode:'CLOSED'},actor);const r=await app.inject({method:'POST',url:'/api/public/delivery/requests',payload:body(p.id)});expect(r.statusCode).toBe(400);expect(ops.deliveryInbox()).toHaveLength(0);expect(store.getProductStockQuantity(p.id)).toBe(20);expect(store.listOrders()).toHaveLength(0);expect(store.listAccountsReceivable()).toHaveLength(0);expect(ops.publicCatalog('DELIVERY').service.open).toBe(false);});
 it('mantém reenvio idempotente e permite conferir pedido anterior à pausa',async()=>{const {ops,store,actor,product}=await fixture();const p=product('Retirada fixture'),payload=body(p.id);const request=ops.submitDelivery(payload);ops.saveDeliveryService({...ops.deliveryService(),pausedUntil:'2026-11-06T13:00:00Z'},actor);expect(ops.submitDelivery(payload).id).toBe(request.id);expect(()=>ops.submitDelivery(body(p.id,'c'))).toThrow(/pausados/);ops.decideDelivery(request.id,true,actor);ops.decideDelivery(request.id,true,actor);expect(store.listOrders()).toHaveLength(1);expect(store.getProductStockQuantity(p.id)).toBe(19);expect(store.listFinancialTransactions()).toHaveLength(0);});
 it('exige permissão e preserva demais configurações; sugestão não gera consumo',async()=>{const {ops,store,actor,product,app,headers}=await fixture();const p=product('Sugestão fixture');expect((await app.inject({method:'POST',url:'/api/ops/delivery-service',payload:{}})).statusCode).toBe(401);ops.saveSettings({...extensionSettings(store.db),kitchenWorkflow:'KDS'},actor);const r=await app.inject({method:'POST',url:'/api/ops/delivery-service',headers,payload:{...ops.deliveryService(),suggestionIds:[p.id]}});expect(r.statusCode).toBe(200);expect(extensionSettings(store.db).kitchenWorkflow).toBe('KDS');expect(ops.publicCatalog('DELIVERY').suggestionIds).toEqual([p.id]);expect(store.getProductStockQuantity(p.id)).toBe(20);expect(store.listOrders()).toHaveLength(0);expect(()=>ops.saveDeliveryService({...ops.deliveryService(),suggestionIds:['ausente']},actor)).toThrow();});
 it('timeline usa identificador secreto e mostra eventos reais sem dados de contato',async()=>{const {ops,store,actor,product,app}=await fixture();const p=product('Linha do tempo fixture'),payload=body(p.id);const req=ops.submitDelivery(payload);ops.decideDelivery(req.id,true,actor);const order=store.listDeliveryOrders()[0]!;store.updateDeliveryOrderStatus(order.id,'CONFIRMADO',actor.userId);vi.setSystemTime(new Date('2026-11-06T12:10Z'));store.updateDeliveryOrderStatus(order.id,'EM_PREPARO',actor.userId);store.updateDeliveryOrderStatus(order.id,'EM_PREPARO',actor.userId);const status=ops.deliveryStatus(payload.idempotencyKey);expect(status.timeline.some(e=>e.status==='CONFIRMADO')).toBe(true);expect(status.timeline.some(e=>e.status==='EM_PREPARO')).toBe(true);expect(ops.rows("SELECT * FROM audit_logs WHERE action='DELIVERY_STAGE_CHANGED' AND entity_id=?",order.id)).toHaveLength(2);expect(JSON.stringify(status)).not.toContain('98999990000');expect((await app.inject('/api/public/delivery/status/'+order.id)).statusCode).toBe(400);});
 it('etiqueta exige sessão e escapa conteúdo antes de gerar HTML',async()=>{const {ops,store,actor,product,app,headers}=await fixture();const p=product('Produto etiqueta fixture');const req=ops.submitDelivery({...body(p.id),customerName:'<script>alert(1)</script>'});ops.decideDelivery(req.id,true,actor);const order=store.listDeliveryOrders()[0]!;expect((await app.inject('/api/ops/delivery-label/'+order.id)).statusCode).toBe(401);const r=await app.inject({url:'/api/ops/delivery-label/'+order.id,headers});expect(r.statusCode).toBe(200);expect(r.json().html).not.toContain('<script>');expect(r.json().html).toContain('&lt;script&gt;');expect(r.json().text).toContain('SEM VALIDADE FISCAL');});
 it('CEP público tem cache, limite e fallback sem chamada em formato inválido',async()=>{const {app}=await fixture();const mocked=vi.fn().mockResolvedValue(new Response('{"logradouro":"Rua teste","bairro":"Centro","localidade":"Cidade","uf":"MA"}'));vi.stubGlobal('fetch',mocked);try{expect((await app.inject('/api/public/delivery/cep/invalido')).statusCode).toBe(400);expect(mocked).not.toHaveBeenCalled();expect((await app.inject('/api/public/delivery/cep/65000000')).statusCode).toBe(200);expect((await app.inject('/api/public/delivery/cep/65000000')).statusCode).toBe(200);expect(mocked).toHaveBeenCalledTimes(1);for(let i=0;i<13;i++)await app.inject('/api/public/delivery/cep/65000000');expect((await app.inject('/api/public/delivery/cep/65000000')).statusCode).toBe(429);}finally{vi.unstubAllGlobals();}});
});

describe('Estoque rápido, fotos e fila sem aceite',()=>{
 it('soma prateleiras, aplica o inventário em lote e bloqueia reenvios alterados',async()=>{
   const {app,headers,product,store}=await fixture();
   const a=product('Estoque em dois locais'),b=product('Estoque concorrente');
   const url='/api/ops/shelf-inventory';
   const lines=[
     {productId:a.id,shelf:'Balcão',quantity:3,expectedQuantity:20},
     {productId:a.id,shelf:'Depósito',quantity:5,expectedQuantity:20},
     {productId:b.id,shelf:'Cozinha',quantity:20,expectedQuantity:19}
   ];
   const idempotencyKey='inventory-'+'b'.repeat(32);
   expect((await app.inject({method:'POST',url,headers,payload:{idempotencyKey,lines}})).statusCode).toBe(400);
   expect(store.getProductStockQuantity(a.id)).toBe(20);
   lines[2]!.expectedQuantity=20;
   const post=()=>app.inject({method:'POST',url,headers,payload:{idempotencyKey,lines}});
   expect((await post()).json()).toMatchObject({products:2,adjusted:1,idempotentReplay:false});
   expect((await post()).json()).toMatchObject({idempotentReplay:true});
   expect(store.getProductStockQuantity(a.id)).toBe(8);
   expect(store.getProductStockQuantity(b.id)).toBe(20);
   lines[0]!.quantity=4;
   expect((await post()).statusCode).toBe(400);
   expect(store.getProductStockQuantity(a.id)).toBe(8);
 });
 const stockBody=(id:string,key='d',extra:Record<string,unknown>={})=>({idempotencyKey:'stock-ui-'+key.repeat(32),productId:id,mode:'ENTRY',quantity:5,expectedQuantity:20,reason:'Conferência fixture',...extra});
 it('entrada avulsa é auditada, não gera cobrança e reenvio não duplica',async()=>{const {app,headers,product,store}=await fixture();const p=product('Entrada rápida fixture');const payload=stockBody(p.id);const first=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload});expect(first.statusCode).toBe(200);expect(first.json().currentQuantity).toBe(25);const replay=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload});expect(replay.json().idempotentReplay).toBe(true);expect(store.getProductStockQuantity(p.id)).toBe(25);expect(store.listFinancialTransactions()).toHaveLength(0);expect(store.listAccountsReceivable()).toHaveLength(0);expect((store.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='STOCK_QUICK_RECORDED'").get() as any).n).toBe(1);});
 it('reenvio alterado é recusado sem aplicar uma segunda entrada',async()=>{const {app,headers,product,store}=await fixture();const p=product('Reenvio estoque fixture'),payload=stockBody(p.id);await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload});const changed=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:{...payload,quantity:8}});expect(changed.statusCode).toBe(400);expect(store.getProductStockQuantity(p.id)).toBe(25);});
 it('contagem calcula a diferença e permite contar zero explicitamente',async()=>{const {app,headers,product,store}=await fixture();const p=product('Inventário fixture');const r=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'a',{mode:'COUNT',quantity:0})});expect(r.json().delta).toBe(-20);expect(store.getProductStockQuantity(p.id)).toBe(0);expect(r.json().movement.movementType).toBe('INVENTORY_ADJUST');});
 it('contagem sem diferença registra conferência sem fabricar movimento',async()=>{const {app,headers,product,store}=await fixture();const p=product('Contagem igual fixture');const r=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'a',{mode:'COUNT',quantity:20})});expect(r.json().movement).toBeNull();expect(r.json().delta).toBe(0);expect(store.getStockMovementsByReference('MANUAL_AUDIT',p.id)).toHaveLength(0);expect((store.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='STOCK_QUICK_RECORDED'").get() as any).n).toBe(1);});
 it('saldo concorrente bloqueia contagem, sem perder uma venda ou entrada recente',async()=>{const {app,headers,product,store,actor}=await fixture();const p=product('Concorrência fixture');store.adjustStock({productId:p.id,quantityDelta:-2,movementType:'WASTE_OR_LOSS',reason:'Movimento concorrente',userId:actor.userId});const r=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'a',{mode:'COUNT',quantity:10})});expect(r.statusCode).toBe(400);expect(r.json().error).toMatch(/saldo mudou/);expect(store.getProductStockQuantity(p.id)).toBe(18);});
 it('saída maior que saldo é recusada e quantidade negativa não vira entrada',async()=>{const {app,headers,product,store}=await fixture();const p=product('Perda fixture');for(const quantity of [21,-1,0]){const r=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'a',{mode:'LOSS',quantity})});expect(r.statusCode).toBe(400);}expect(store.getProductStockQuantity(p.id)).toBe(20);});
 it('aceita fracionamento de três casas e atualiza custo somente na entrada',async()=>{const {app,headers,product,store}=await fixture();const p=product('Insumo kg fixture',{unitOfMeasure:'KG'});const r=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'a',{quantity:1.125,unitCostCents:2500})});expect(r.statusCode).toBe(200);expect(store.getProductStockQuantity(p.id)).toBeCloseTo(21.125,5);expect(store.getProductById(p.id)!.costPriceCents).toBe(2500);const invalid=await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id,'b',{mode:'LOSS',expectedQuantity:21.125,quantity:1.1234})});expect(invalid.statusCode).toBe(400);});
 it('exige sessão e rejeita produto sem controle físico',async()=>{const {app,headers,product,store}=await fixture();const p=product('Serviço fixture',{trackStock:false});expect((await app.inject({method:'POST',url:'/api/ops/stock-quick',payload:stockBody(p.id)})).statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/api/ops/stock-quick',headers,payload:stockBody(p.id)})).statusCode).toBe(400);expect((store.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='STOCK_QUICK_RECORDED'").get() as any).n).toBe(0);});
 const jpeg=()=>fs.readFileSync(new URL('../../desktop/public/brand/deck26-original.jpg',import.meta.url));
 it('foto local é servida como imagem sem alterar estoque, preço ou financeiro',async()=>{const {app,headers,product,store,ops}=await fixture();const p=product('Foto fixture');const bytes=jpeg();const response=await app.inject({method:'POST',url:'/api/ops/product-photo',headers,payload:{productId:p.id,dataUrl:'data:image/jpeg;base64,'+bytes.toString('base64')}});expect(response.statusCode).toBe(200);const url=response.json().imageUrl;expect(ops.publicCatalog('DELIVERY').catalog.products.find(v=>v.id===p.id)?.imageUrl).toBe(url);const image=await app.inject(url);expect(image.statusCode).toBe(200);expect(image.headers['content-type']).toBe('image/jpeg');expect(Buffer.compare(image.rawPayload,bytes)).toBe(0);expect(image.headers['x-content-type-options']).toBe('nosniff');expect(store.getProductStockQuantity(p.id)).toBe(20);expect(store.getProductById(p.id)!.priceCents).toBe(1000);expect(store.listFinancialTransactions()).toHaveLength(0);});
 it('foto requer autorização, recusa SVG/URL/arquivo excessivo e não expõe caminhos',async()=>{const {app,headers,product}=await fixture();const p=product('Imagem inválida fixture');expect((await app.inject({method:'POST',url:'/api/ops/product-photo',payload:{productId:p.id,dataUrl:null}})).statusCode).toBe(401);for(const dataUrl of ['data:image/svg+xml;base64,PHN2Zz4=','https://example.com/photo.jpg','data:image/jpeg;base64,'+'a'.repeat(850000)])expect((await app.inject({method:'POST',url:'/api/ops/product-photo',headers,payload:{productId:p.id,dataUrl}})).statusCode).toBe(400);expect((await app.inject('/api/public/product-photos/segredos-locais.json')).statusCode).toBe(404);});
 it('remover foto volta ao ícone e torna a URL anterior indisponível',async()=>{const {app,headers,product,store}=await fixture();const p=product('Remover foto fixture');const uploaded=(await app.inject({method:'POST',url:'/api/ops/product-photo',headers,payload:{productId:p.id,dataUrl:'data:image/jpeg;base64,'+jpeg().toString('base64')}})).json();expect(uploaded.imageUrl).toBeTruthy();const removed=await app.inject({method:'POST',url:'/api/ops/product-photo',headers,payload:{productId:p.id,dataUrl:null}});expect(removed.statusCode).toBe(200);expect(store.getProductById(p.id)!.imageUrl).toBeNull();expect((await app.inject(uploaded.imageUrl)).statusCode).toBe(404);});
 it('pedido sem aceite fica atrasado exatamente na meta, usando relógio do servidor',async()=>{const {ops,actor,product}=await fixture();const p=product('Espera fixture');ops.saveDeliveryService({...ops.deliveryService(),acceptanceSlaMinutes:3},actor);ops.submitDelivery({idempotencyKey:'delivery-'+'f'.repeat(32),customerName:'Cliente fixture',customerPhone:'98999990000',deliveryType:'PICKUP',items:[{productId:p.id,quantity:1}],paymentMethodDeclared:'PIX',quotedTotalCents:1000});vi.setSystemTime(new Date('2026-11-06T12:02:59Z'));expect(ops.deliveryInbox()[0].late).toBe(false);vi.setSystemTime(new Date('2026-11-06T12:03:00Z'));expect(ops.deliveryInbox()[0].late).toBe(true);expect(ops.deliveryInbox()[0].waitingMinutes).toBe(3);});
});

describe('Persistência e isolamento das novas rotinas',()=>{
 it('caixa sem permissão não altera estoque nem fotos',async()=>{const {app,headers,product,store}=await fixture();const p=product('ACL foto estoque fixture');await app.inject({method:'POST',url:'/api/operation/operators',headers,payload:{name:'Caixa restrito fixture',role:'CASHIER',pin:'749251',active:true}});const login=(await app.inject({method:'POST',url:'/api/auth/login',payload:{pin:'749251'}})).json();const cashier={authorization:'Bearer '+login.token};expect((await app.inject({method:'POST',url:'/api/ops/stock-quick',headers:cashier,payload:{idempotencyKey:'stock-ui-'+'a'.repeat(32),productId:p.id,mode:'COUNT',quantity:0,expectedQuantity:20,reason:'Tentativa sem permissão'}})).statusCode).toBe(403);expect((await app.inject({method:'POST',url:'/api/ops/product-photo',headers:cashier,payload:{productId:p.id,dataUrl:null}})).statusCode).toBe(403);expect(store.getProductStockQuantity(p.id)).toBe(20);});
 it('foto e saldos permanecem após reabrir o SQLite e a migração não repete',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck26-photos-persist-')),file=path.join(dir,'isolado.sqlite');cleanup.push(async()=>{if(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'deck26-photos-persist-'))fs.rmSync(dir,{recursive:true,force:true});});const first=new LocalOperationalStore(file,false);let productId='';try{first.initializeLocalOperation({name:'Owner fixture',pin:'536821',importCatalog:true,actorIp:'127.0.0.1'});const p=first.getCatalog().products.find(p=>p.trackStock)!;productId=p.id;first.adjustStock({productId:p.id,quantityDelta:3.25,movementType:'PURCHASE_ENTRY',reason:'Entrada persistente fixture',userId:'usr-owner-01'});const photo=fs.readFileSync(new URL('../../desktop/public/brand/deck26-original.jpg',import.meta.url));first.db.prepare('INSERT INTO product_photos VALUES(?,?,?,?)').run(p.id,'a'.repeat(64),photo,new Date().toISOString());first.updateCatalogProduct(p.id,{imageUrl:'/api/public/product-photos/'+'a'.repeat(64)+'.jpg'});}finally{first.close();}const second=new LocalOperationalStore(file,false);try{expect(second.getProductStockQuantity(productId)).toBe(3.25);expect(second.getProductById(productId)?.imageUrl).toContain('/api/public/product-photos/');expect((second.db.prepare('SELECT jpeg FROM product_photos WHERE product_id=?').get(productId) as any).jpeg.length).toBeGreaterThan(0);expect((second.db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='0012_product_photos'").get() as any).n).toBe(1);expect(second.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);}finally{second.close();}});
});
