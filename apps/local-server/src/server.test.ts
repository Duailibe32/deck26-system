import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalServer } from './server.js';
import { buildCloudApiServer } from '../../cloud-api/src/server.js';

describe('@deck26/local-server & @deck26/cloud-api — Bateria Completa dos 18 Testes Obrigatórios da Etapa 3', () => {
  it('1. Cadastro de produto: criar produto completo e confirmar exibição nos canais', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/catalog/products',
      payload: {
        id: 'prd-test-suco-jarra',
        sku: 'D26-BEB-999',
        barcode: '7890000123456',
        categoryId: 'cat-bebidas',
        subcategory: 'Sucos Naturais',
        name: 'Jarra de Suco Natural 1L',
        description: 'Acerola ou Cajá',
        unitOfMeasure: 'L',
        priceCents: 1850,
        costPriceCents: 650,
        prepStation: 'BAR_DRINKS',
        prepTimeMinutes: 8,
        initialStock: 30,
        minStockQuantity: 6,
        ncm: '2009.89.90',
        cfop: '5102',
        availableChannels: ['DINE_IN', 'COUNTER_PDV', 'QR_TABLE', 'DELIVERY', 'PICKUP', 'HOTEL_ROOM']
      }
    });
    expect(createRes.statusCode).toBe(201);

    const qrCatalogRes = await app.inject({
      method: 'GET',
      url: '/api/catalog?channel=QR_TABLE'
    });
    const qrCatalog = qrCatalogRes.json();
    const found = qrCatalog.products.find((p: { id: string }) => p.id === 'prd-test-suco-jarra');

    expect(found).toBeDefined();
    expect(found.priceCents).toBe(1850);
    expect(found.costPriceCents).toBe(650);
    expect(found.prepStation).toBe('BAR_DRINKS');
    expect(found.targetPrinter).toBe('PRINTER_BAR');
    expect(found.ncm).toBe('2009.89.90');

    await app.close();
  });

  it('2. Edição de preço: alterar preço de produto e confirmar reflexo imediato nos canais, sem alterar pedidos antigos', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    // Pedido histórico com Caldo de Macaxeira a R$ 10,00 (1000 centavos)
    const oldOrderRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'old-order-caldo-10',
        tableNumber: 1,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }]
      }
    });
    expect(oldOrderRes.statusCode).toBe(201);
    const oldOrderId = oldOrderRes.json().order.id;
    expect(oldOrderRes.json().order.totalOrderCents).toBe(2000);

    // Edita o preço do Caldo de Macaxeira para R$ 13,50 (1350 centavos)
    const editRes = await app.inject({
      method: 'PUT',
      url: '/api/catalog/products/prd-caldo-macaxeira',
      payload: { priceCents: 1350 }
    });
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().product.priceCents).toBe(1350);

    // Novo pedido reflete o novo preço (2 x R$ 13,50 = R$ 27,00)
    const newOrderRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'new-order-caldo-1350',
        tableNumber: 2,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }]
      }
    });
    expect(newOrderRes.statusCode).toBe(201);
    expect(newOrderRes.json().order.totalOrderCents).toBe(2700);

    // Pedido antigo permanece intocado em R$ 20,00 (2000 centavos)
    const stateRes = await app.inject({ method: 'GET', url: '/api/state' });
    const oldOrderFromDb = stateRes.json().orders.find((o: { id: string }) => o.id === oldOrderId);
    expect(oldOrderFromDb.totalOrderCents).toBe(2000);
    expect(oldOrderFromDb.items[0].unitPriceCents).toBe(1000);

    await app.close();
  });

  it('3. Desativação de produto: desativar logicamente produto com histórico e bloquear venda no QR Code ou garçom', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Realiza uma venda para criar histórico referencial
    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'hist-omelete-01',
        tableNumber: 3,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-omelete-simples', quantity: 1 }]
      }
    });

    // Solicita exclusão/desativação -> deve aplicar LOGICAL_DEACTIVATED por possuir histórico
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/catalog/products/prd-omelete-simples'
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().mode).toBe('LOGICAL_DEACTIVATED');
    expect(delRes.json().product.active).toBe(false);

    // Tenta vender pelo Garçom -> bloqueado (400)
    const waiterTry = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'try-inactive-waiter',
        tableNumber: 4,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-omelete-simples', quantity: 1 }]
      }
    });
    expect(waiterTry.statusCode).toBe(400);

    // Tenta vender pelo QR Code -> bloqueado (400)
    const qrToken = store.listDiningTablesQr()[0]!.qrToken;
    const qrTry = await app.inject({
      method: 'POST',
      url: '/api/public/qr-orders',
      payload: {
        idempotencyKey: 'try-inactive-qr',
        qrToken,
        customerName: 'Cliente QR',
        items: [{ productId: 'prd-omelete-simples', quantity: 1 }]
      }
    });
    expect(qrTry.statusCode).toBe(400);

    await app.close();
  });

  it('4. Preço por canal: produto com R$ 30 no salão e R$ 34 no delivery aplica o valor correto em cada canal', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    await app.inject({
      method: 'PUT',
      url: '/api/catalog/products/prd-exec-strogonoff-frango',
      payload: {
        priceCents: 3000, // R$ 30,00 no salão
        channelPricesCents: {
          DINE_IN: 3000,
          DELIVERY: 3400 // R$ 34,00 no delivery
        }
      }
    });

    const dineInRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'ch-price-dinein',
        tableNumber: 6,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-strogonoff-frango', quantity: 1 }]
      }
    });
    expect(dineInRes.statusCode).toBe(201);
    expect(dineInRes.json().order.items[0].unitPriceCents).toBe(3000);
    expect(dineInRes.json().order.totalOrderCents).toBe(3000);

    const deliveryRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'ch-price-delivery',
        channel: 'DELIVERY',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-exec-strogonoff-frango', quantity: 1 }]
      }
    });
    expect(deliveryRes.statusCode).toBe(201);
    expect(deliveryRes.json().order.items[0].unitPriceCents).toBe(3400);
    expect(deliveryRes.json().order.totalOrderCents).toBe(3400);

    await app.close();
  });

  it('5. Adicionais: produto com adicional pago soma corretamente no pedido e comanda e baixa estoque de insumo vinculado', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Cria um insumo para o adicional (Queijo Extra) com 20 porções em estoque
    await app.inject({
      method: 'POST',
      url: '/api/catalog/products',
      payload: {
        id: 'prd-insumo-queijo-extra',
        sku: 'INS-QUEIJO-01',
        categoryId: 'cat-qualquer-hora',
        name: 'Porção Insumo Queijo Coalho',
        priceCents: 400,
        prepStation: 'NONE',
        initialStock: 20
      }
    });

    // Atualiza Cuscuz c/ Ovos (R$ 9,00 = 900c) adicionando opção de Queijo Extra (+R$ 4,00 = 400c) vinculada ao estoque
    await app.inject({
      method: 'PUT',
      url: '/api/catalog/products/prd-cuscuz-ovos',
      payload: {
        modifierGroups: [
          {
            id: 'grp-extras',
            name: 'Adicionais',
            required: false,
            minSelect: 0,
            maxSelect: 2,
            options: [
              {
                id: 'opt-queijo-extra',
                name: 'Queijo Coalho Extra',
                priceDeltaCents: 400,
                available: true,
                stockProductId: 'prd-insumo-queijo-extra',
                stockQuantityUsed: 1
              }
            ]
          }
        ]
      }
    });

    // Vende 2x Cuscuz c/ Ovos + Queijo Extra: 2 * (900 + 400) = 2600 centavos (R$ 26,00)
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'order-with-paid-modifier',
        tableNumber: 7,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [
          {
            productId: 'prd-cuscuz-ovos',
            quantity: 2,
            modifiers: [
              {
                groupId: 'grp-extras',
                groupName: 'Adicionais',
                optionId: 'opt-queijo-extra',
                optionName: 'Queijo Coalho Extra',
                priceDeltaCents: 400
              }
            ]
          }
        ]
      }
    });

    expect(orderRes.statusCode).toBe(201);
    const body = orderRes.json();
    expect(body.order.items[0].unitPriceCents).toBe(900);
    expect(body.order.items[0].modifiersTotalCents).toBe(400);
    expect(body.order.totalOrderCents).toBe(2600);
    expect(body.tab.subtotalCents).toBe(2600);

    // Verifica que o estoque do insumo Queijo Extra caiu de 20 para 18 (2 unidades consumidas)
    expect(store.getProductStockQuantity('prd-insumo-queijo-extra')).toBe(18);

    await app.close();
  });

  it('6. Entrada de estoque: registrar compra de 20 unidades e verificar aumento do saldo', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(50);

    const entryRes = await app.inject({
      method: 'POST',
      url: '/api/stock/adjust',
      payload: {
        idempotencyKey: 'compra-20-refri-nf001',
        productId: 'prd-beb-refrigerante-lata',
        quantityDelta: 20,
        movementType: 'PURCHASE_ENTRY',
        unitCostCents: 320,
        reason: 'Compra NF 10293 Distribuidora'
      }
    });

    expect(entryRes.statusCode).toBe(201);
    expect(entryRes.json().movement.balanceAfter).toBe(70);
    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(70);

    await app.close();
  });

  it('7. Baixa automática: vender 3 unidades reduz o saldo automaticamente (e respeita Ficha Técnica quando aprovada)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Caso A: Baixa direta de 3 unidades (50 -> 47)
    const saleRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'venda-3-unidades-direta',
        tableNumber: 3,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-beb-refrigerante-lata', quantity: 3 }]
      }
    });
    expect(saleRes.statusCode).toBe(201);
    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(47);

    // Avançar status para IN_PREPARATION, READY e DELIVERED NUNCA baixa o estoque novamente
    const orderId = saleRes.json().order.id;
    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'IN_PREPARATION' }
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'READY' }
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'DELIVERED' }
    });
    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(47);

    // Caso B: Baixa por Ficha Técnica Aprovada
    const rcpRes = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: {
        productId: 'prd-panqueca-carne-seca',
        status: 'APPROVED',
        yieldQuantity: 1,
        items: [{ ingredientProductId: 'prd-cuscuz-carne-sol-sem-catupiry', quantityUsed: 2, unitOfMeasure: 'UN' }]
      }
    });
    expect(rcpRes.statusCode).toBe(201);

    expect(store.getProductStockQuantity('prd-cuscuz-carne-sol-sem-catupiry')).toBe(50);
    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'venda-com-ficha-tecnica',
        tableNumber: 3,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-panqueca-carne-seca', quantity: 1 }]
      }
    });
    expect(store.getProductStockQuantity('prd-cuscuz-carne-sol-sem-catupiry')).toBe(48);

    await app.close();
  });

  it('8. Reenvio idempotente: reenviar a mesma requisição de pedido não baixa estoque duas vezes', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const salePayload = {
      idempotencyKey: 'venda-refri-2un-idem-001',
      tableNumber: 2,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      items: [{ productId: 'prd-beb-refrigerante-lata', quantity: 2 }]
    };

    const res1 = await app.inject({ method: 'POST', url: '/api/orders', payload: salePayload });
    expect(res1.statusCode).toBe(201);
    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(48);

    const res2 = await app.inject({ method: 'POST', url: '/api/orders', payload: salePayload });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().idempotentReplay).toBe(true);
    expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(48);

    await app.close();
  });

  it('9. Cancelamento e reversão: cancelar pedido elegível reverte o estoque com registro auditável REVERSAL_ENTRY', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    expect(store.getProductStockQuantity('prd-exec-salmao')).toBe(50);

    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'order-salmao-to-cancel',
        tableNumber: 9,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-salmao', quantity: 2 }]
      }
    });
    expect(orderRes.statusCode).toBe(201);
    const orderId = orderRes.json().order.id;
    expect(store.getProductStockQuantity('prd-exec-salmao')).toBe(48);

    // Cancela o pedido antes do preparo -> reverte estoque automaticamente para 50
    const cancelRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: {
        status: 'CANCELLED',
        reverseStockOnCancel: true,
        cancelReason: 'Cliente desistiu antes do preparo'
      }
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().order.status).toBe('CANCELLED');
    expect(store.getProductStockQuantity('prd-exec-salmao')).toBe(50);

    const movements = store.listStockBalancesAndMovements().recentMovements;
    const reversal = movements.find(
      (m) => m.productId === 'prd-exec-salmao' && m.movementType === 'REVERSAL_ENTRY'
    );
    expect(reversal).toBeDefined();
    expect(reversal?.quantityDelta).toBe(2);

    await app.close();
  });

  it('10. Produto sem estoque: configurar bloqueio de venda sem estoque (BLOCK_SALE) e verificar impedimento', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    await app.inject({
      method: 'POST',
      url: '/api/catalog/products',
      payload: {
        id: 'prd-esgotado-teste',
        sku: 'D26-ESG-01',
        categoryId: 'cat-executivos',
        name: 'Lagosta Especial Sob Consulta',
        priceCents: 9500,
        prepStation: 'KITCHEN_HOT',
        trackStock: true,
        initialStock: 1,
        outOfStockPolicy: 'BLOCK_SALE'
      }
    });

    // Tenta vender 2 unidades quando só há 1 disponível -> deve bloquear com HTTP 400
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'try-oversell-blocked',
        tableNumber: 4,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-esgotado-teste', quantity: 2 }]
      }
    });
    expect(blockedRes.statusCode).toBe(400);
    expect(blockedRes.json().error).toContain('Estoque insuficiente');

    await app.close();
  });

  it('11. Pedido por QR Code: cliente realiza pedido por QR Code seguro e sistema impede manipulação de mesa ou preço', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const table5Qr = store.listDiningTablesQr().find((t) => t.tableNumber === 5)!;
    expect(table5Qr.qrToken).toMatch(/^d26qr_m05_/);

    // Tentativa com token QR falso/adivinhado -> rejeitado
    const forgedRes = await app.inject({
      method: 'POST',
      url: '/api/public/qr-orders',
      payload: {
        idempotencyKey: 'qr-forged-token-01',
        qrToken: 'mesa-05-token-falso-12345',
        customerName: 'Invasor',
        items: [{ productId: 'prd-tapioca-frango-catupiry', quantity: 1 }]
      }
    });
    expect(forgedRes.statusCode).toBe(400);

    // Pedido legítimo com o token criptográfico da Mesa 05
    const validQrRes = await app.inject({
      method: 'POST',
      url: '/api/public/qr-orders',
      payload: {
        idempotencyKey: 'qr-valid-mesa05-01',
        qrToken: table5Qr.qrToken,
        customerName: 'Mariana Cliente Mesa 05',
        customerNotes: 'Tapioca bem quentinha',
        items: [{ productId: 'prd-tapioca-frango-catupiry', quantity: 2 }]
      }
    });
    expect(validQrRes.statusCode).toBe(201);
    const created = validQrRes.json();
    expect(created.order.tableNumber).toBe(5);
    expect(created.order.channel).toBe('QR_TABLE');
    expect(created.order.totalOrderCents).toBe(2800); // 2 x R$ 14,00 congelado pelo servidor
    expect(created.tab.code).toBe('MESA-05');

    await app.close();
  });

  it('12. Integração com comanda: dois pedidos na mesma mesa acumulam corretamente na comanda e permitem pagamento parcial', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const tab = store.openOrGetTab({
      code: 'CONTA-TESTE-200',
      type: 'COUNTER',
      customerName: 'Cliente Teste Parcial'
    });

    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'conta200-pedido-1',
        tabId: tab.id,
        channel: 'COUNTER_PDV',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-esp-picanha', quantity: 1 }] // R$ 120,00
      }
    });

    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'conta200-pedido-2',
        tabId: tab.id,
        channel: 'COUNTER_PDV',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-esp-feijoada', quantity: 1 }] // R$ 80,00
      }
    });

    const tabAccumulated = store.getTabById(tab.id)!;
    expect(tabAccumulated.totalCents).toBe(20000);

    // Pagamento parcial PIX R$ 50 + Dinheiro R$ 80 -> Restam R$ 70
    await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: { idempotencyKey: 'pay-pix-50', tabId: tab.id, method: 'PIX', amountCents: 5000 }
    });
    const payCashRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'pay-cash-80',
        tabId: tab.id,
        method: 'CASH',
        amountCents: 8000,
        receivedCashCents: 8000
      }
    });

    const afterCash = payCashRes.json();
    expect(afterCash.tab.paidCents).toBe(13000);
    expect(afterCash.tab.totalCents - afterCash.tab.paidCents).toBe(7000);
    expect(afterCash.tab.status).toBe('PARTIALLY_PAID');

    await app.close();
  });

  it('13. Separação por estação: bebida vai para bar (PRINTER_BAR), tapioca vai para chapa (PRINTER_GRIDDLE) e prato quente vai para cozinha (PRINTER_KITCHEN_HOT)', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const multiStationRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'order-multi-station-split',
        tableNumber: 12,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [
          { productId: 'prd-exec-file-mignon-trinchado', quantity: 1 }, // KITCHEN_HOT -> PRINTER_KITCHEN_HOT
          { productId: 'prd-tapioca-ovos', quantity: 1 }, // GRIDDLE_TAPIOCA -> PRINTER_GRIDDLE
          { productId: 'prd-beb-refrigerante-lata', quantity: 2 } // BAR_DRINKS -> PRINTER_BAR
        ]
      }
    });

    expect(multiStationRes.statusCode).toBe(201);
    const jobs = multiStationRes.json().printJobs as Array<{ targetPrinter: string; payloadText: string }>;
    expect(jobs).toHaveLength(3);

    const printers = jobs.map((j) => j.targetPrinter).sort();
    expect(printers).toEqual(['PRINTER_BAR', 'PRINTER_GRIDDLE', 'PRINTER_KITCHEN_HOT']);

    const barJob = jobs.find((j) => j.targetPrinter === 'PRINTER_BAR')!;
    expect(barJob.payloadText).toContain('REFRIGERANTE LATA');
    expect(barJob.payloadText).not.toContain('FILE MIGNON');

    const kitchenJob = jobs.find((j) => j.targetPrinter === 'PRINTER_KITCHEN_HOT')!;
    expect(kitchenJob.payloadText).toContain('FILÉ MIGNON');
    expect(kitchenJob.payloadText).not.toContain('REFRIGERANTE');

    await app.close();
  });

  it('14. Impressão incremental: segundo pedido na mesma mesa imprime somente os novos itens', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const order20h00 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'mesa05-20h00-picanha',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-esp-picanha', quantity: 1 }]
      }
    });
    expect(order20h00.statusCode).toBe(201);

    const order20h30 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'mesa05-20h30-feijoada',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-esp-feijoada', quantity: 1 }]
      }
    });
    expect(order20h30.statusCode).toBe(201);
    const body20h30 = order20h30.json();

    expect(body20h30.printJobs).toHaveLength(1);
    expect(body20h30.printJobs[0].payloadText).toContain('FEIJOADA COMPLETA');
    expect(body20h30.printJobs[0].payloadText).not.toContain('PICANHA');

    await app.close();
  });

  it('15. Persistência após reinício: reiniciar serviços confirma que produtos, preços, estoque e pedidos permanecem salvos', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck26-persist-stage3-'));
    const localDbFile = path.join(tempDir, 'local.sqlite');
    const cloudDbFile = path.join(tempDir, 'cloud.sqlite');

    try {
      const { app: local1, store: store1 } = await buildLocalServer({ dbPath: localDbFile });
      const { app: cloud1, closeDb: closeCloud1 } = await buildCloudApiServer({ dbPath: cloudDbFile });

      store1.updateCatalogProduct('prd-exec-panelada', { priceCents: 3300 });
      store1.createOrder({
        idempotencyKey: 'persist-disk-order-stage3',
        tableNumber: 11,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-exec-panelada', quantity: 2 }]
      });

      const pending = store1.listPendingSyncEvents();
      await cloud1.inject({
        method: 'POST',
        url: '/api/sync/batch',
        payload: {
          sourceNodeId: 'deck26-windows-main',
          sourceOrigin: 'WINDOWS_PDV',
          lastPulledRemoteCursor: 0,
          events: pending
        }
      });

      await local1.close();
      store1.close();
      await cloud1.close();
      closeCloud1();

      const { app: local2, store: store2 } = await buildLocalServer({ dbPath: localDbFile });
      const { app: cloud2, getLedger: getLedger2, closeDb: closeCloud2 } = await buildCloudApiServer({
        dbPath: cloudDbFile
      });

      expect(store2.getProductById('prd-exec-panelada')?.priceCents).toBe(3300);
      expect(store2.getProductStockQuantity('prd-exec-panelada')).toBe(48);
      expect(store2.listOrders()).toHaveLength(1);
      expect(store2.listOrders()[0]?.totalOrderCents).toBe(6600);
      expect(getLedger2().length).toBeGreaterThanOrEqual(2);

      await local2.close();
      store2.close();
      await cloud2.close();
      closeCloud2();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('16. Permissões de usuários: garçom não pode alterar preço de produto nem ajustar estoque sem permissão', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

    const loginWaiter = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: '3030' } // Garçom
    });
    expect(loginWaiter.statusCode).toBe(200);
    const waiterToken = loginWaiter.json().token;

    // Garçom tenta alterar preço de produto -> 403 Forbidden
    const forbiddenPriceEdit = await app.inject({
      method: 'PUT',
      url: '/api/catalog/products/prd-caldo-macaxeira',
      headers: { Authorization: `Bearer ${waiterToken}` },
      payload: { priceCents: 100 }
    });
    expect(forbiddenPriceEdit.statusCode).toBe(403);

    // Garçom tenta ajustar estoque -> 403 Forbidden
    const forbiddenStockRes = await app.inject({
      method: 'POST',
      url: '/api/stock/adjust',
      headers: { Authorization: `Bearer ${waiterToken}` },
      payload: {
        productId: 'prd-beb-refrigerante-lata',
        quantityDelta: 10,
        movementType: 'PURCHASE_ENTRY',
        reason: 'Tentativa por garcom'
      }
    });
    expect(forbiddenStockRes.statusCode).toBe(403);

    await app.close();
  });

  it('17. Sincronização após desconexão: criar produto e vender localmente com VPS desconectada e sincronizar depois sem duplicação', async () => {
    const { app: localApp, store: localStore } = await buildLocalServer({ dbPath: ':memory:' });
    const { app: cloudApp, getLedger, closeDb } = await buildCloudApiServer({ dbPath: ':memory:' });

    // Desconexão simulada: tentativa de sync falha mas mantém fila local
    const unreachableSync = await localApp.inject({
      method: 'POST',
      url: '/api/sync/trigger'
    });
    expect(unreachableSync.json().synced).toBe(false);
    expect(unreachableSync.json().offlineModeActive).toBe(true);

    // Cria produto e pedido durante desconexão
    localStore.createCatalogProduct({
      id: 'prd-offline-created',
      sku: 'D26-OFF-01',
      categoryId: 'cat-qualquer-hora',
      name: 'Macaxeira Frita Especial',
      priceCents: 2200,
      prepStation: 'KITCHEN_HOT'
    });

    localStore.createOrder({
      idempotencyKey: 'sync-offline-order-stage3',
      tableNumber: 8,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      items: [{ productId: 'prd-offline-created', quantity: 1 }]
    });

    const pendingOfflineQueue = localStore.listPendingSyncEvents();
    expect(pendingOfflineQueue.length).toBeGreaterThanOrEqual(3);

    // Reconexão: envia lote para a VPS
    const syncRecovery = await cloudApp.inject({
      method: 'POST',
      url: '/api/sync/batch',
      payload: {
        sourceNodeId: 'deck26-windows-main',
        sourceOrigin: 'WINDOWS_PDV',
        lastPulledRemoteCursor: 0,
        events: pendingOfflineQueue
      }
    });
    expect(syncRecovery.statusCode).toBe(200);
    const recoveryJson = syncRecovery.json();
    expect(recoveryJson.ackedEventIds).toHaveLength(pendingOfflineQueue.length);

    localStore.acknowledgeSyncEvents(recoveryJson.ackedEventIds);
    expect(localStore.listPendingSyncEvents()).toHaveLength(0);

    // Reenvio duplicado -> ignorado com idempotência
    const syncDuplicateAttempt = await cloudApp.inject({
      method: 'POST',
      url: '/api/sync/batch',
      payload: {
        sourceNodeId: 'deck26-windows-main',
        sourceOrigin: 'WINDOWS_PDV',
        lastPulledRemoteCursor: recoveryJson.newRemoteCursor,
        events: pendingOfflineQueue
      }
    });
    expect(syncDuplicateAttempt.json().ackedEventIds).toHaveLength(0);
    expect(syncDuplicateAttempt.json().duplicateEventIds).toHaveLength(pendingOfflineQueue.length);
    expect(getLedger()).toHaveLength(pendingOfflineQueue.length);

    await localApp.close();
    await cloudApp.close();
    closeDb();
  });

  it('18. Preservação do histórico financeiro: alterar preço de um produto não recalcula nem altera o valor de pedidos e comandas anteriores', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre comanda e vende Filé Mignon ao Molho Madeira por R$ 44,00 (4400 centavos)
    const order1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'hist-fin-order-1',
        tableNumber: 15,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-file-molho-madeira', quantity: 1 }]
      }
    });
    expect(order1.statusCode).toBe(201);
    const tabId = order1.json().tab.id;
    const order1Id = order1.json().order.id;

    // Subtotal = 4400, Taxa 10% = 440, Total Comanda = 4840
    expect(order1.json().tab.subtotalCents).toBe(4400);
    expect(order1.json().tab.totalCents).toBe(4840);

    // Reajusta o preço de cadastro do Filé ao Molho Madeira para R$ 58,00 (5800 centavos)
    await app.inject({
      method: 'PUT',
      url: '/api/catalog/products/prd-exec-file-molho-madeira',
      payload: { priceCents: 5800 }
    });

    // Verifica que a comanda e o pedido anterior continuam congelados com R$ 44,00
    const tabAfterPriceChange = store.getTabById(tabId)!;
    const order1AfterPriceChange = store.getOrderById(order1Id)!;
    expect(order1AfterPriceChange.items[0]?.unitPriceCents).toBe(4400);
    expect(order1AfterPriceChange.totalOrderCents).toBe(4400);
    expect(tabAfterPriceChange.subtotalCents).toBe(4400);
    expect(tabAfterPriceChange.totalCents).toBe(4840);

    // Proteção adicional de categoria: tentar excluir categoria com produtos vinculados falha de forma segura
    const delCatRes = await app.inject({
      method: 'DELETE',
      url: '/api/catalog/categories/cat-executivos'
    });
    expect(delCatRes.statusCode).toBe(400);

    await app.close();
  });
});
