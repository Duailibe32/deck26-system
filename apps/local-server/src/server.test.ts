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
      const { app: local1, store: store1 } = await buildLocalServer({ requireStrictAuth: false, demoMode: true, dbPath: localDbFile });
      const { app: cloud1, closeDb: closeCloud1 } = await buildCloudApiServer({ allowInsecureTestAccess: true, dbPath: cloudDbFile });

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

      const { app: local2, store: store2 } = await buildLocalServer({ requireStrictAuth: false, demoMode: true, dbPath: localDbFile });
      const { app: cloud2, getLedger: getLedger2, closeDb: closeCloud2 } = await buildCloudApiServer({ allowInsecureTestAccess: true,
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
    const { app: cloudApp, getLedger, closeDb } = await buildCloudApiServer({ allowInsecureTestAccess: true, dbPath: ':memory:' });

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

describe('@deck26/local-server — Bateria Completa dos 34 Testes Obrigatórios da Etapa 4 + Fluxo Operacional de 20 Passos', () => {
  it('1 e 2. Abertura de mesa livre com criação automática de comanda e bloqueio de abertura duplicada concorrente da mesma mesa', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const openRes = await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: {
        tableNumber: 1,
        guestsCount: 4,
        waiterUserId: 'usr-waiter-01',
        waiterName: 'Carlos Garçom',
        customerName: 'Família Silva',
        notes: 'Aniversariante na mesa'
      }
    });

    expect(openRes.statusCode).toBe(201);
    const body = openRes.json();
    expect(body.table.tableNumber).toBe(1);
    expect(body.table.physicalStatus).toBe('AGUARDANDO_PEDIDO');
    expect(body.table.guestsCount).toBe(4);
    expect(body.table.assignedWaiterName).toBe('Carlos Garçom');
    expect(body.tab.code).toBe('MESA-01');
    expect(body.tab.status).toBe('OPEN');
    expect(body.tab.guestsCount).toBe(4);
    expect(body.tab.waiterName).toBe('Carlos Garçom');

    // Tentativa concorrente de abrir novamente a Mesa 01 já ocupada -> bloqueada com HTTP 409 Conflict
    const duplicateOpenRes = await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: {
        tableNumber: 1,
        guestsCount: 2,
        waiterUserId: 'usr-waiter-02',
        waiterName: 'Marcos Garçom'
      }
    });

    expect(duplicateOpenRes.statusCode).toBe(409);
    expect(duplicateOpenRes.json().error).toContain('Abertura duplicada bloqueada');

    await app.close();
  });

  it('3, 4 e 5. Lançamento de pedido pelo garçom, pedido incremental na mesma mesa sem duplicar itens anteriores e impressão incremental somente dos novos itens', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: {
        tableNumber: 5,
        guestsCount: 3,
        waiterUserId: 'usr-waiter-01',
        waiterName: 'Carlos Garçom'
      }
    });

    // 1º Pedido às 20h00: 1x Picanha na Chapa (R$ 120,00) + 2x Refrigerante Lata (2x R$ 7,00 = R$ 14,00) -> R$ 134,00
    const order1Res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-m5-order1',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        waiterUserId: 'usr-waiter-01',
        waiterName: 'Carlos Garçom',
        items: [
          { productId: 'prd-esp-picanha', quantity: 1, notes: 'Ao ponto' },
          { productId: 'prd-beb-refrigerante-lata', quantity: 2 }
        ]
      }
    });
    expect(order1Res.statusCode).toBe(201);
    const order1Body = order1Res.json();
    expect(order1Body.order.totalOrderCents).toBe(13400);
    expect(order1Body.tab.subtotalCents).toBe(13400);
    expect(store.getDiningTableByNumber(5)?.physicalStatus).toBe('EM_ATENDIMENTO');

    // 2º Pedido Incremental às 20h25: 1x Tapioca de Frango c/ Catupiry (R$ 14,00)
    const order2Res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-m5-order2-inc',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        waiterUserId: 'usr-waiter-01',
        waiterName: 'Carlos Garçom',
        items: [{ productId: 'prd-tapioca-frango-catupiry', quantity: 1 }]
      }
    });
    expect(order2Res.statusCode).toBe(201);
    const order2Body = order2Res.json();

    // Verifica que o Pedido 2 contém apenas o item novo (R$ 14,00) e a comanda soma ambos (13400 + 1400 = 14800c)
    expect(order2Body.order.items).toHaveLength(1);
    expect(order2Body.order.totalOrderCents).toBe(1400);
    expect(order2Body.tab.subtotalCents).toBe(14800);
    expect(order2Body.tab.serviceFeeCents).toBe(1480);
    expect(order2Body.tab.totalCents).toBe(16280);

    // Impressão incremental: o ticket do Pedido 2 imprime somente a Tapioca, nunca reimprimindo a Picanha
    expect(order2Body.printJobs).toHaveLength(1);
    expect(order2Body.printJobs[0].targetPrinter).toBe('PRINTER_GRIDDLE');
    expect(order2Body.printJobs[0].payloadText).toContain('TAPIOCA DE FRANGO C/ CATUPIRY');
    expect(order2Body.printJobs[0].payloadText).not.toContain('PICANHA');

    await app.close();
  });

  it('6, 7, 8, 9 e 10. Separação por estação, KDS com SLA, ciclo RECEIVED -> IN_PREPARATION -> READY -> DELIVERED, notificação ao garçom e confirmação de entrega', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Configura SLA do KDS: atenção após 12 min, atraso após 25 min
    const slaRes = await app.inject({
      method: 'PUT',
      url: '/api/kds/sla',
      payload: { warningThresholdMinutes: 12, delayedThresholdMinutes: 25 }
    });
    expect(slaRes.statusCode).toBe(200);
    expect(slaRes.json().kdsSlaConfig.warningThresholdMinutes).toBe(12);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-kds-cycle-01',
        tableNumber: 2,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        priority: 'HIGH',
        waiterUserId: 'usr-waiter-01',
        waiterName: 'Carlos Garçom',
        items: [
          { productId: 'prd-exec-camarao-cremoso', quantity: 1 }, // KITCHEN_HOT
          { productId: 'prd-cuscuz-frango-catupiry', quantity: 1 }, // GRIDDLE_TAPIOCA
          { productId: 'prd-beb-refrigerante-lata', quantity: 2 } // BAR_DRINKS
        ]
      }
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    const orderId = created.order.id;

    // 6. Separação em 3 estações de impressão distintas
    expect(created.printJobs).toHaveLength(3);
    expect(created.order.priority).toBe('HIGH');

    // 7 e 8. KDS avança de RECEIVED -> IN_PREPARATION
    const inPrepRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'IN_PREPARATION', actorUserId: 'usr-kitchen-01' }
    });
    expect(inPrepRes.statusCode).toBe(200);
    expect(inPrepRes.json().order.status).toBe('IN_PREPARATION');
    expect(inPrepRes.json().order.prepStartedAt).toBeTruthy();

    // Avança para READY -> dispara notificação ORDER_READY para o garçom
    const readyRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'READY', actorUserId: 'usr-kitchen-01' }
    });
    expect(readyRes.statusCode).toBe(200);
    expect(readyRes.json().order.status).toBe('READY');
    expect(readyRes.json().order.readyAt).toBeTruthy();
    expect(readyRes.json().order.waiterNotifiedAt).toBeTruthy();

    // 9. Verifica notificação não confirmada para o garçom
    const notifRes = await app.inject({
      method: 'GET',
      url: '/api/notifications?unacknowledgedOnly=true'
    });
    expect(notifRes.statusCode).toBe(200);
    const readyNotif = notifRes
      .json()
      .notifications.find((n: { orderId: string; eventType: string }) => n.orderId === orderId && n.eventType === 'ORDER_READY');
    expect(readyNotif).toBeDefined();
    expect(readyNotif.tableNumber).toBe(2);

    // 10. Garçom confirma entrega na mesa (DELIVERED) -> grava deliveredAt e dá baixa automática na notificação
    const deliveredRes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${orderId}/status`,
      payload: { status: 'DELIVERED', actorUserId: 'usr-waiter-01' }
    });
    expect(deliveredRes.statusCode).toBe(200);
    expect(deliveredRes.json().order.status).toBe('DELIVERED');
    expect(deliveredRes.json().order.deliveredAt).toBeTruthy();
    expect(deliveredRes.json().order.deliveredByUserId).toBe('usr-waiter-01');

    const notifAfterDeliver = store.listNotifications({ unacknowledgedOnly: true });
    expect(
      notifAfterDeliver.find((n) => n.orderId === orderId && n.eventType === 'ORDER_READY')
    ).toBeUndefined();

    await app.close();
  });

  it('11 e 12. Transferência de mesa livre com preservação de pedidos e pagamentos, e bloqueio de transferência para mesa ocupada sem fluxo de junção', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre Mesa 03, lança pedido e registra pagamento parcial
    await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: { tableNumber: 3, guestsCount: 2, waiterName: 'Carlos Garçom' }
    });

    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-transfer-m3-ord',
        tableNumber: 3,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-parmegiana-classica', quantity: 1 }] // R$ 55,00 + 10% = R$ 60,50
      }
    });
    const tabId = ordRes.json().tab.id;

    await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-transfer-m3-pay',
        tabId,
        method: 'PIX',
        amountCents: 2000
      }
    });

    // Abre Mesa 09 para deixá-la OCUPADA
    await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: { tableNumber: 9, guestsCount: 2, waiterName: 'Marcos Garçom' }
    });

    // 12. Tenta transferir Mesa 03 para Mesa 09 (ocupada) -> bloqueado (400)
    const blockedTransfer = await app.inject({
      method: 'POST',
      url: '/api/tables/transfer',
      payload: {
        fromTableNumber: 3,
        toTableNumber: 9,
        actorUserId: 'usr-waiter-01',
        reason: 'Tentativa para mesa ocupada'
      }
    });
    expect(blockedTransfer.statusCode).toBe(400);
    expect(blockedTransfer.json().error).toContain('Junção de Mesas');

    // 11. Transfere Mesa 03 para Mesa 08 (LIVRE) -> sucesso
    const validTransfer = await app.inject({
      method: 'POST',
      url: '/api/tables/transfer',
      payload: {
        fromTableNumber: 3,
        toTableNumber: 8,
        actorUserId: 'usr-waiter-01',
        reason: 'Cliente preferiu mesa próxima à varanda'
      }
    });
    expect(validTransfer.statusCode).toBe(200);
    const trBody = validTransfer.json();
    expect(trBody.fromTable.physicalStatus).toBe('LIVRE');
    expect(trBody.fromTable.activeTabId).toBeNull();
    expect(trBody.toTable.physicalStatus).toBe('EM_ATENDIMENTO');
    expect(trBody.toTable.activeTabId).toBe(tabId);
    expect(trBody.tab.tableNumber).toBe(8);
    expect(trBody.tab.code).toBe('MESA-08');
    expect(trBody.tab.totalCents).toBe(6050);
    expect(trBody.tab.paidCents).toBe(2000);

    // Verifica auditoria registrada
    const logs = store.listAuditLogs(tabId);
    expect(logs.some((l) => l.action === 'TABLE_TRANSFERRED')).toBe(true);

    await app.close();
  });

  it('13. Junção de mesas sem duplicação de cobrança e separação posterior auditada', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre Mesa 04 e lança R$ 30,00 (Strogonoff)
    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-join-m4-ord',
        tableNumber: 4,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-strogonoff-frango', quantity: 1 }] // 3000c
      }
    });

    // Abre Mesa 05 e lança R$ 10,00 (Caldo de Macaxeira)
    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-join-m5-ord',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 1 }] // 1000c
      }
    });

    // Une Mesas 04 (principal) e 05 (secundária)
    const joinRes = await app.inject({
      method: 'POST',
      url: '/api/tables/join',
      payload: {
        primaryTableNumber: 4,
        tableNumbersToJoin: [5],
        actorUserId: 'usr-waiter-01',
        reason: 'Grupo unificou as mesas 04 e 05'
      }
    });
    expect(joinRes.statusCode).toBe(200);
    const joinBody = joinRes.json();

    expect(joinBody.tab.joinedTables).toEqual([4, 5]);
    // Subtotal consolidado sem duplicar: 3000 + 1000 = 4000c (+10% = 4400c)
    expect(joinBody.tab.subtotalCents).toBe(4000);
    expect(joinBody.tab.totalCents).toBe(4400);

    // A Mesa 05 aponta para a comanda principal da Mesa 04
    const table5 = store.getDiningTableByNumber(5)!;
    expect(table5.primaryTableNumber).toBe(4);
    expect(table5.activeTabId).toBe(joinBody.tab.id);

    // Separa posteriormente a Mesa 05 -> como havia um pedido originado na Mesa 05 e nenhum pagamento na comanda,
    // a Mesa 05 volta a ter sua comanda própria com os R$ 10,00 originais e a Mesa 04 fica com os R$ 30,00
    const unjoinRes = await app.inject({
      method: 'POST',
      url: '/api/tables/unjoin',
      payload: {
        tableNumberToSeparate: 5,
        actorUserId: 'usr-waiter-01',
        reason: 'Mesa 05 pediu conta separada'
      }
    });
    expect(unjoinRes.statusCode).toBe(200);
    const unjoinBody = unjoinRes.json();
    expect(unjoinBody.primaryTab.subtotalCents).toBe(3000);
    expect(unjoinBody.separatedTab.subtotalCents).toBe(1000);

    await app.close();
  });

  it('14 e 15. Transferência de item entre comandas sem nova baixa de estoque e sem reimpressão na cozinha, e bloqueio de transferência de item já pago ou cancelado', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const initialStock = store.getProductStockQuantity('prd-exec-file-tilapia'); // 50

    // Mesa 06 pede 2x Filé de Tilápia (2 x R$ 39,00 = R$ 78,00)
    const ord6Res = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-tritem-m6',
        tableNumber: 6,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-file-tilapia', quantity: 2 }]
      }
    });
    const tab6 = ord6Res.json().tab;
    const itemToTransfer = ord6Res.json().order.items[0];

    expect(store.getProductStockQuantity('prd-exec-file-tilapia')).toBe(initialStock - 2);
    const printJobsCountBefore = store.listPrintJobs().length;

    // Abre Mesa 07 para receber 1 unidade transferida
    const open7Res = await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: { tableNumber: 7, guestsCount: 2 }
    });
    const tab7 = open7Res.json().tab;

    // 14. Transfere 1 unidade do Filé de Tilápia da Mesa 06 para a Mesa 07
    const transferItemRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab6.id}/transfer-item`,
      payload: {
        orderItemId: itemToTransfer.id,
        quantityToTransfer: 1,
        targetTabId: tab7.id,
        actorUserId: 'usr-waiter-01',
        reason: 'Cliente mudou para a Mesa 07'
      }
    });
    expect(transferItemRes.statusCode).toBe(200);
    const trItemBody = transferItemRes.json();

    // Totais atualizados sem duplicar receita: Mesa 06 fica com R$ 39,00 (+10%) e Mesa 07 fica com R$ 39,00 (+10%)
    expect(trItemBody.sourceTab.subtotalCents).toBe(3900);
    expect(trItemBody.targetTab.subtotalCents).toBe(3900);

    // Estoque NÃO sofreu nova baixa (continua initialStock - 2)
    expect(store.getProductStockQuantity('prd-exec-file-tilapia')).toBe(initialStock - 2);
    // Fila de impressão na cozinha NÃO gerou novo ticket
    expect(store.listPrintJobs().length).toBe(printJobsCountBefore);

    // 15. Paga o item na Mesa 06 alocando o item -> depois tenta transferir o item já pago -> bloqueado!
    await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-pay-allocated-m6',
        tabId: tab6.id,
        method: 'PIX',
        amountCents: 4290,
        allocatedItems: [{ orderItemId: itemToTransfer.id, quantity: 1 }]
      }
    });

    const blockedPaidTransfer = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab6.id}/transfer-item`,
      payload: {
        orderItemId: itemToTransfer.id,
        quantityToTransfer: 1,
        targetTabId: tab7.id,
        actorUserId: 'usr-waiter-01',
        reason: 'Tentativa de transferir item ja pago'
      }
    });
    expect(blockedPaidTransfer.statusCode).toBe(400);
    expect(blockedPaidTransfer.json().error).toContain('já foi pago');

    await app.close();
  });

  it('16, 17, 18 e 19. Divisão de conta por valor livre, partes iguais, por itens sem corromper pedidos originais e pagamentos parciais múltiplos (PIX + dinheiro + cartão)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre Mesa 10 para 3 pessoas e consome:
    // 1x Filé Mignon Trinchado (R$ 42,00) + 1x Carne de Sol (R$ 44,00) + 2x Refrigerante (R$ 14,00) = R$ 100,00
    // Com taxa de serviço desativada para facilitar conferência exata = R$ 100,00 (10000c)
    await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: { tableNumber: 10, guestsCount: 3 }
    });

    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-split-m10-ord',
        tableNumber: 10,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [
          { productId: 'prd-exec-file-mignon-trinchado', quantity: 1 }, // 4200c
          { productId: 'prd-exec-carne-de-sol', quantity: 1 }, // 4400c
          { productId: 'prd-beb-refrigerante-lata', quantity: 2 } // 1400c
        ]
      }
    });
    const tabId = ordRes.json().tab.id;
    const orderItems = ordRes.json().order.items;

    await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/service-fee`,
      payload: { serviceFeeEnabled: false, actorUserId: 'usr-cashier-01' }
    });

    // 17. Divisão em partes iguais para 3 pessoas: 10000 / 3 = 3333c com resto de 1c
    const equalSplitRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/split`,
      payload: { mode: 'EQUAL_SHARES', sharesCount: 3 }
    });
    expect(equalSplitRes.statusCode).toBe(200);
    expect(equalSplitRes.json().splitSummary.shareAmountCents).toBe(3333);
    expect(equalSplitRes.json().splitSummary.remainderCents).toBe(1);

    // 18. Divisão por itens consumidos (Cliente 1 aloca Filé Mignon R$ 42,00 e 1 Refrigerante R$ 7,00 = R$ 49,00)
    const byItemsSplitRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/split`,
      payload: {
        mode: 'BY_ITEMS',
        itemAllocations: [
          { orderItemId: orderItems[0].id, quantity: 1, payerLabel: 'Cliente 1' },
          { orderItemId: orderItems[2].id, quantity: 1, payerLabel: 'Cliente 1' }
        ]
      }
    });
    expect(byItemsSplitRes.statusCode).toBe(200);
    const allocs = byItemsSplitRes.json().splitSummary.itemAllocations;
    expect(allocs[0].amountCents + allocs[1].amountCents).toBe(4900);

    // 16 e 19. Pagamentos parciais múltiplos:
    // Pagamento 1 (PIX - Cliente 1 paga seus itens: R$ 49,00)
    const pay1 = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-m10-pay1-pix',
        tabId,
        method: 'PIX',
        confirmationMode: 'MANUAL_DECLARED',
        amountCents: 4900,
        payerLabel: 'Cliente 1',
        allocatedItems: [
          { orderItemId: orderItems[0].id, quantity: 1 },
          { orderItemId: orderItems[2].id, quantity: 1 }
        ]
      }
    });
    expect(pay1.statusCode).toBe(201);
    expect(pay1.json().tab.paidCents).toBe(4900);
    expect(pay1.json().tab.status).toBe('PARTIALLY_PAID');

    // Pagamento 2 (Dinheiro por valor livre - Cliente 2 paga R$ 30,00 entregando nota de R$ 50,00 -> troco R$ 20,00)
    const pay2 = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-m10-pay2-cash',
        tabId,
        method: 'CASH',
        amountCents: 3000,
        receivedCashCents: 5000,
        payerLabel: 'Cliente 2'
      }
    });
    expect(pay2.statusCode).toBe(201);
    expect(pay2.json().payment.changeCents).toBe(2000);
    expect(pay2.json().tab.paidCents).toBe(7900);

    // Pagamento 3 (Cartão de Crédito - Cliente 3 quita os R$ 21,00 restantes)
    const pay3 = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-m10-pay3-card',
        tabId,
        method: 'CREDIT_CARD',
        confirmationMode: 'ELECTRONIC_PROVIDER_CONFIRMED',
        nsuOrTxId: 'NSU-998877',
        amountCents: 2100,
        payerLabel: 'Cliente 3'
      }
    });
    expect(pay3.statusCode).toBe(201);
    expect(pay3.json().tab.paidCents).toBe(10000);
    expect(pay3.json().tab.totalCents - pay3.json().tab.paidCents).toBe(0);

    // Confirma que os pedidos originais permanecem intactos
    const originalOrders = store.listOrdersByTab(tabId);
    expect(originalOrders).toHaveLength(1);
    expect(originalOrders[0]?.items).toHaveLength(3);

    await app.close();
  });

  it('20, 21 e 22. Estorno autorizado de pagamento sem duplicidade, aplicação de desconto com/sem permissão e taxa de serviço protegida contra quebra de pagamentos', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

    const loginWaiter = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { pin: '3030' } });
    const waiterToken = loginWaiter.json().token;

    const loginManager = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { pin: '1010' } });
    const managerToken = loginManager.json().token;

    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { Authorization: `Bearer ${waiterToken}` },
      payload: {
        idempotencyKey: 'st4-disc-ref-ord',
        tableNumber: 11,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-esp-picanha', quantity: 1 }] // R$ 120,00 + 10% (R$ 12,00) = R$ 132,00
      }
    });
    const tabId = ordRes.json().tab.id;

    // 21. Garçom tenta aplicar desconto sem permissão -> bloqueado (403)
    const waiterDiscountTry = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/discount`,
      headers: { Authorization: `Bearer ${waiterToken}` },
      payload: {
        discountType: 'FIXED_CENTS',
        discountCents: 1200,
        reason: 'Tentativa sem permissao'
      }
    });
    expect(waiterDiscountTry.statusCode).toBe(403);

    // Gerente aplica desconto de R$ 12,00 -> aprovado (total cai de 13200c para 12000c)
    const managerDiscountRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/discount`,
      headers: { Authorization: `Bearer ${managerToken}` },
      payload: {
        discountType: 'FIXED_CENTS',
        discountCents: 1200,
        reason: 'Desconto fidelidade autorizado pela gerência'
      }
    });
    expect(managerDiscountRes.statusCode).toBe(200);
    expect(managerDiscountRes.json().tab.discountCents).toBe(1200);
    expect(managerDiscountRes.json().tab.totalCents).toBe(12000);

    // Registra pagamento de R$ 115,00 (11500c)
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      headers: { Authorization: `Bearer ${managerToken}` },
      payload: {
        idempotencyKey: 'st4-pay-115',
        tabId,
        method: 'PIX',
        amountCents: 11500
      }
    });
    const paymentId = payRes.json().payment.id;

    // 22. Tenta desativar a taxa de serviço (R$ 12,00), o que reduziria o total para R$ 108,00 (< R$ 115,00 já pagos) -> bloqueado!
    const invalidFeeToggle = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tabId}/service-fee`,
      headers: { Authorization: `Bearer ${managerToken}` },
      payload: { serviceFeeEnabled: false }
    });
    expect(invalidFeeToggle.statusCode).toBe(400);
    expect(invalidFeeToggle.json().error).toContain('menor que os pagamentos já confirmados');

    // 20. Estorno autorizado do pagamento de R$ 115,00 pelo gerente
    const refundRes = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { Authorization: `Bearer ${managerToken}` },
      payload: { reason: 'Lançamento duplicado no PIX corrigido' }
    });
    expect(refundRes.statusCode).toBe(200);
    expect(refundRes.json().payment.status).toBe('REFUNDED');
    expect(refundRes.json().tab.paidCents).toBe(0);

    // Tentativa de estornar novamente o mesmo pagamento -> bloqueado
    const duplicateRefund = await app.inject({
      method: 'POST',
      url: `/api/payments/${paymentId}/refund`,
      headers: { Authorization: `Bearer ${managerToken}` },
      payload: { reason: 'Tentativa duplicada' }
    });
    expect(duplicateRefund.statusCode).toBe(400);
    expect(duplicateRefund.json().error).toContain('já foi estornado');

    await app.close();
  });

  it('23, 24 e 25. Cancelamento em 3 estágios: antes do preparo (reverte estoque), em preparo (exige autorização e não devolve estoque automaticamente) e após entrega (exige autorização e ajusta financeiro)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Estágio A (23): Cancelamento ANTES DO PREPARO (`RECEIVED`) -> reverte estoque automaticamente
    const stockBeforeA = store.getProductStockQuantity('prd-omelete-recheado');
    const ordARes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-cancel-stage-a',
        tableNumber: 12,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-omelete-recheado', quantity: 2 }]
      }
    });
    const ordAId = ordARes.json().order.id;
    expect(store.getProductStockQuantity('prd-omelete-recheado')).toBe(stockBeforeA - 2);

    const cancelARes = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordAId}/status`,
      payload: {
        status: 'CANCELLED',
        cancelReason: 'Cliente trocou de prato antes de iniciar preparo',
        actorUserId: 'usr-waiter-01',
        actorRole: 'WAITER'
      }
    });
    expect(cancelARes.statusCode).toBe(200);
    expect(cancelARes.json().order.cancelStage).toBe('BEFORE_PREP');
    expect(store.getProductStockQuantity('prd-omelete-recheado')).toBe(stockBeforeA);

    // Estágio B (24): Cancelamento EM PREPARO (`IN_PREPARATION`) -> exige autorização de gerente e NÃO devolve estoque automaticamente
    const stockBeforeB = store.getProductStockQuantity('prd-exec-carne-de-sol');
    const ordBRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-cancel-stage-b',
        tableNumber: 12,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-carne-de-sol', quantity: 1 }]
      }
    });
    const ordBId = ordBRes.json().order.id;
    expect(store.getProductStockQuantity('prd-exec-carne-de-sol')).toBe(stockBeforeB - 1);

    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordBId}/status`,
      payload: { status: 'IN_PREPARATION' }
    });

    // Garçom sem autorização de gerente tenta cancelar pedido já em preparo -> bloqueado (403 Forbidden)
    const waiterCancelInPrep = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordBId}/status`,
      payload: {
        status: 'CANCELLED',
        cancelReason: 'Tentativa sem gerente',
        actorUserId: 'usr-waiter-01',
        actorRole: 'WAITER'
      }
    });
    expect(waiterCancelInPrep.statusCode).toBe(403);

    // Gerente autoriza cancelamento em preparo -> registra perda e NÃO devolve estoque automaticamente
    const managerCancelInPrep = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordBId}/status`,
      payload: {
        status: 'CANCELLED',
        cancelReason: 'Cliente precisou sair com urgência durante preparo',
        actorUserId: 'usr-manager-01',
        actorRole: 'MANAGER'
      }
    });
    expect(managerCancelInPrep.statusCode).toBe(200);
    expect(managerCancelInPrep.json().order.cancelStage).toBe('DURING_PREP');
    expect(store.getProductStockQuantity('prd-exec-carne-de-sol')).toBe(stockBeforeB - 1);

    // Estágio C (25): Cancelamento APÓS ENTREGA (`DELIVERED`) -> exige autorização de gerente, ajusta financeiro da comanda e NÃO devolve estoque
    const stockBeforeC = store.getProductStockQuantity('prd-exec-salmao');
    const ordCRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-cancel-stage-c',
        tableNumber: 12,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-salmao', quantity: 1 }] // 5900c
      }
    });
    const ordCId = ordCRes.json().order.id;
    const tab12Id = ordCRes.json().tab.id;

    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordCId}/status`,
      payload: { status: 'DELIVERED' }
    });

    const managerCancelAfterDelivery = await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ordCId}/status`,
      payload: {
        status: 'CANCELLED',
        cancelReason: 'Prato substituído por cortesia da gerência',
        actorUserId: 'usr-manager-01',
        actorRole: 'MANAGER'
      }
    });
    expect(managerCancelAfterDelivery.statusCode).toBe(200);
    expect(managerCancelAfterDelivery.json().order.cancelStage).toBe('AFTER_DELIVERY');
    expect(store.getProductStockQuantity('prd-exec-salmao')).toBe(stockBeforeC - 1);
    expect(store.getTabById(tab12Id)?.totalCents).toBe(0);

    await app.close();
  });

  it('26 e 27. Tratamento de falha de impressão (FAILED / UNKNOWN_OUTCOME) sem duplicação automática e reimpressão autorizada marcada como 2ª via', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-print-recovery-01',
        tableNumber: 13,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-exec-panelada', quantity: 1 }]
      }
    });
    const job = ordRes.json().printJobs[0];

    // Simula queda de energia/rede durante envio -> UNKNOWN_OUTCOME
    const unknownRes = await app.inject({
      method: 'PATCH',
      url: `/api/print-jobs/${job.id}/status`,
      payload: {
        status: 'UNKNOWN_OUTCOME',
        errorMsg: 'Timeout de resposta da impressora após envio do buffer TCP'
      }
    });
    expect(unknownRes.statusCode).toBe(200);
    expect(unknownRes.json().printJob.status).toBe('UNKNOWN_OUTCOME');

    // 26. Tentativa de reenvio automático cego para SENDING ou QUEUED é bloqueada para evitar duplicidade física na cozinha
    const blindRetryRes = await app.inject({
      method: 'PATCH',
      url: `/api/print-jobs/${job.id}/status`,
      payload: { status: 'SENDING' }
    });
    expect(blindRetryRes.statusCode).toBe(400);
    expect(blindRetryRes.json().error).toContain('UNKNOWN_OUTCOME');

    // 27. Operador verifica que não saiu papel e solicita Reimpressão Autorizada -> marcada claramente como 2ª VIA (Cópia #2)
    const reprintRes = await app.inject({
      method: 'POST',
      url: `/api/print-jobs/${job.id}/reprint`
    });
    expect(reprintRes.statusCode).toBe(200);
    const reprintedJob = reprintRes.json().printJob;
    expect(reprintedJob.isReprint).toBe(true);
    expect(reprintedJob.copyNumber).toBe(2);
    expect(reprintedJob.payloadText).toContain('2a VIA / REIMPRESSAO AUTORIZADA (COPIA #2)');

    await app.close();
  });

  it('28, 29, 30, 31 e 32. Turno de caixa (abertura, sangria, suprimento, fechamento com conferência de diferença) e fechamento/bloqueio de liberação de mesa', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // 28. Abre turno de caixa com fundo inicial de R$ 250,00 (25000c)
    const openCashRes = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/open',
      payload: {
        openingBalanceCents: 25000,
        openedByUserId: 'usr-cashier-01',
        notes: 'Abertura turno noite'
      }
    });
    expect(openCashRes.statusCode).toBe(201);
    const sessionId = openCashRes.json().cashSession.id;

    // 29. Registra Suprimento (+R$ 50,00 = 5000c) e Sangria (-R$ 80,00 = 8000c)
    const supRes = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/movements',
      payload: {
        sessionId,
        movementType: 'SUPRIMENTO',
        amountCents: 5000,
        reason: 'Reforço de moedas para troco',
        createdByUserId: 'usr-cashier-01'
      }
    });
    expect(supRes.statusCode).toBe(201);

    const sangriaRes = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/movements',
      payload: {
        sessionId,
        movementType: 'SANGRIA',
        amountCents: 8000,
        reason: 'Retirada para cofre central',
        createdByUserId: 'usr-cashier-01',
        authorizedByUserId: 'usr-manager-01'
      }
    });
    expect(sangriaRes.statusCode).toBe(201);

    // Abre Mesa 14, vende R$ 40,00 (sem taxa = 4000c)
    await app.inject({
      method: 'POST',
      url: '/api/tables/open',
      payload: { tableNumber: 14, guestsCount: 2 }
    });
    const ordRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'st4-cash-m14-ord',
        tableNumber: 14,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 4 }] // 4 x R$ 10,00 = R$ 40,00
      }
    });
    const tab14Id = ordRes.json().tab.id;
    const ord14Id = ordRes.json().order.id;

    await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab14Id}/service-fee`,
      payload: { serviceFeeEnabled: false }
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/orders/${ord14Id}/status`,
      payload: { status: 'DELIVERED' }
    });

    // 32. Tenta fechar a comanda e liberar a Mesa 14 com R$ 40,00 pendentes -> bloqueado (400)
    const blockedCloseRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab14Id}/close`,
      payload: { actorUserId: 'usr-cashier-01', releaseStatus: 'LIVRE' }
    });
    expect(blockedCloseRes.statusCode).toBe(400);
    expect(blockedCloseRes.json().error).toContain('saldo pendente');

    // Paga R$ 40,00 em Dinheiro (entregando R$ 50,00 -> troco R$ 10,00)
    await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'st4-cash-m14-pay',
        tabId: tab14Id,
        method: 'CASH',
        amountCents: 4000,
        receivedCashCents: 5000
      }
    });

    // 31. Agora com saldo = 0, fecha a comanda e libera a Mesa 14 -> sucesso!
    const closeTabRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab14Id}/close`,
      payload: { actorUserId: 'usr-cashier-01', releaseStatus: 'LIVRE' }
    });
    expect(closeTabRes.statusCode).toBe(200);
    expect(closeTabRes.json().tab.status).toBe('CLOSED');
    expect(store.getDiningTableByNumber(14)?.physicalStatus).toBe('LIVRE');
    expect(store.getDiningTableByNumber(14)?.activeTabId).toBeNull();

    // 30. Fechamento de turno de caixa:
    // Esperado em espécie na gaveta = 25000 (abertura) + 5000 (suprimento) - 8000 (sangria) + 4000 (venda líquida em dinheiro) = 26000c (R$ 260,00)
    const closeCashRes = await app.inject({
      method: 'POST',
      url: '/api/cash-sessions/close',
      payload: {
        sessionId,
        countedCashCents: 25800, // Contou R$ 258,00 -> diferença de -R$ 2,00 (-200c)
        closedByUserId: 'usr-cashier-01',
        notes: 'Diferença de R$ 2,00 no fechamento'
      }
    });
    expect(closeCashRes.statusCode).toBe(200);
    const closedSession = closeCashRes.json().cashSession;
    expect(closedSession.status).toBe('CLOSED');
    expect(closedSession.expectedCashCents).toBe(26000);
    expect(closedSession.countedCashCents).toBe(25800);
    expect(closedSession.differenceCents).toBe(-200);

    await app.close();
  });

  it('33 e 34 + Seção 27. Fluxo Operacional Completo de 20 Passos + Persistência após reinício e Sincronização Offline -> Online', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck26-stage4-e2e-'));
    const localDbFile = path.join(tempDir, 'local-stage4.sqlite');
    const cloudDbFile = path.join(tempDir, 'cloud-stage4.sqlite');

    try {
      const { app, store } = await buildLocalServer({ requireStrictAuth: false, demoMode: true, dbPath: localDbFile });

      // Passo 1: Abrir turno de caixa com fundo inicial de R$ 200,00 (20000c)
      const step1 = await app.inject({
        method: 'POST',
        url: '/api/cash-sessions/open',
        payload: { openingBalanceCents: 20000, openedByUserId: 'usr-cashier-01' }
      });
      expect(step1.statusCode).toBe(201);

      // Passo 2: Abrir a Mesa 05 com 4 clientes e garçom responsável
      const step2 = await app.inject({
        method: 'POST',
        url: '/api/tables/open',
        payload: {
          tableNumber: 5,
          guestsCount: 4,
          waiterUserId: 'usr-waiter-01',
          waiterName: 'Carlos Garçom'
        }
      });
      expect(step2.statusCode).toBe(201);

      // Passo 3: Lançar pedido inicial com bebidas e pratos
      const step3 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        payload: {
          idempotencyKey: 'e2e20-step3-initial',
          tableNumber: 5,
          channel: 'DINE_IN',
          originNode: 'WAITER_MOBILE',
          waiterUserId: 'usr-waiter-01',
          waiterName: 'Carlos Garçom',
          items: [
            { productId: 'prd-exec-file-mignon-trinchado', quantity: 2 }, // 2 x R$ 42,00 = R$ 84,00 (KITCHEN_HOT)
            { productId: 'prd-beb-refrigerante-lata', quantity: 4 } // 4 x R$ 7,00 = R$ 28,00 (BAR_DRINKS)
          ]
        }
      });
      expect(step3.statusCode).toBe(201);
      const orderInitial = step3.json().order;

      // Passo 4: Confirmar baixa de estoque e envio para cozinha/bar
      expect(store.getProductStockQuantity('prd-exec-file-mignon-trinchado')).toBe(48);
      expect(store.getProductStockQuantity('prd-beb-refrigerante-lata')).toBe(46);
      expect(step3.json().printJobs).toHaveLength(2);

      // Passo 5: Na tela da cozinha (KDS), iniciar preparo (`IN_PREPARATION`)
      const step5 = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${orderInitial.id}/status`,
        payload: { status: 'IN_PREPARATION', actorUserId: 'usr-kitchen-01' }
      });
      expect(step5.statusCode).toBe(200);
      expect(step5.json().order.status).toBe('IN_PREPARATION');

      // Passo 6: Marcar pedido como pronto (`READY`)
      const step6 = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${orderInitial.id}/status`,
        payload: { status: 'READY', actorUserId: 'usr-kitchen-01' }
      });
      expect(step6.statusCode).toBe(200);

      // Passo 7: Confirmar alerta no terminal do garçom
      const step7 = store.listNotifications({ unacknowledgedOnly: true });
      expect(step7.some((n) => n.orderId === orderInitial.id && n.eventType === 'ORDER_READY')).toBe(true);

      // Passo 8: Confirmar entrega ao cliente (`DELIVERED`)
      const step8 = await app.inject({
        method: 'PATCH',
        url: `/api/orders/${orderInitial.id}/status`,
        payload: { status: 'DELIVERED', actorUserId: 'usr-waiter-01' }
      });
      expect(step8.statusCode).toBe(200);
      expect(step8.json().order.status).toBe('DELIVERED');

      // Passo 9: Lançar segundo pedido incremental na Mesa 05
      const step9 = await app.inject({
        method: 'POST',
        url: '/api/orders',
        payload: {
          idempotencyKey: 'e2e20-step9-incremental',
          tableNumber: 5,
          channel: 'DINE_IN',
          originNode: 'WAITER_MOBILE',
          waiterUserId: 'usr-waiter-01',
          waiterName: 'Carlos Garçom',
          items: [{ productId: 'prd-tapioca-doce', quantity: 1 }] // R$ 16,00 (GRIDDLE_TAPIOCA)
        }
      });
      expect(step9.statusCode).toBe(201);
      const orderInc = step9.json().order;

      // Passo 10: Confirmar que apenas os novos itens foram enviados/impressos
      expect(step9.json().printJobs).toHaveLength(1);
      expect(step9.json().printJobs[0].payloadText).toContain('TAPIOCA DOCE');
      expect(step9.json().printJobs[0].payloadText).not.toContain('FILÉ MIGNON');

      // Conclui entrega do pedido incremental
      await app.inject({
        method: 'PATCH',
        url: `/api/orders/${orderInc.id}/status`,
        payload: { status: 'DELIVERED', actorUserId: 'usr-waiter-01' }
      });

      // Passo 11: Transferir a Mesa 05 para a Mesa 08
      const step11 = await app.inject({
        method: 'POST',
        url: '/api/tables/transfer',
        payload: {
          fromTableNumber: 5,
          toTableNumber: 8,
          actorUserId: 'usr-waiter-01',
          reason: 'Transferência operacional para Mesa 08'
        }
      });
      expect(step11.statusCode).toBe(200);

      // Passo 12: Confirmar que a Mesa 05 ficou livre e a Mesa 08 assumiu a comanda
      expect(store.getDiningTableByNumber(5)?.physicalStatus).toBe('LIVRE');
      expect(store.getDiningTableByNumber(8)?.physicalStatus).toBe('EM_ATENDIMENTO');
      const mainTabId = step11.json().tab.id;

      // Passo 13: Unir a Mesa 08 com a Mesa 09
      const step13 = await app.inject({
        method: 'POST',
        url: '/api/tables/join',
        payload: {
          primaryTableNumber: 8,
          tableNumbersToJoin: [9],
          actorUserId: 'usr-waiter-01',
          reason: 'Mais convidados chegaram e ocuparam a Mesa 09'
        }
      });
      expect(step13.statusCode).toBe(200);
      expect(step13.json().tab.joinedTables).toEqual([8, 9]);

      // Passo 14: Solicitar fechamento da conta
      const step14 = await app.inject({
        method: 'POST',
        url: `/api/tabs/${mainTabId}/request-bill`,
        payload: { actorUserId: 'usr-waiter-01' }
      });
      expect(step14.statusCode).toBe(200);
      expect(step14.json().tab.status).toBe('BILL_REQUESTED');
      expect(store.getDiningTableByNumber(8)?.physicalStatus).toBe('AGUARDANDO_PAGAMENTO');

      // Subtotal = 8400 + 2800 + 1600 = 12800c (R$ 128,00)
      // Taxa 10% = 1280c (R$ 12,80) -> Total = 14080c (R$ 140,80)
      expect(step14.json().tab.totalCents).toBe(14080);

      // Passo 15: Dividir a conta entre clientes (4 partes iguais de R$ 35,20 = 3520c)
      const step15 = await app.inject({
        method: 'POST',
        url: `/api/tabs/${mainTabId}/split`,
        payload: { mode: 'EQUAL_SHARES', sharesCount: 4 }
      });
      expect(step15.statusCode).toBe(200);
      expect(step15.json().splitSummary.shareAmountCents).toBe(3520);

      // Passo 16: Registrar pagamento parcial por PIX (R$ 50,00 = 5000c)
      const step16 = await app.inject({
        method: 'POST',
        url: '/api/payments',
        payload: {
          idempotencyKey: 'e2e20-step16-pix',
          tabId: mainTabId,
          method: 'PIX',
          amountCents: 5000,
          payerLabel: 'Pagador 1 PIX'
        }
      });
      expect(step16.statusCode).toBe(201);
      expect(step16.json().tab.paidCents).toBe(5000);

      // Passo 17: Registrar pagamento parcial em dinheiro com cálculo de troco (Paga R$ 40,00 com nota de R$ 50,00 -> troco R$ 10,00)
      const step17 = await app.inject({
        method: 'POST',
        url: '/api/payments',
        payload: {
          idempotencyKey: 'e2e20-step17-cash',
          tabId: mainTabId,
          method: 'CASH',
          amountCents: 4000,
          receivedCashCents: 5000,
          payerLabel: 'Pagador 2 Dinheiro'
        }
      });
      expect(step17.statusCode).toBe(201);
      expect(step17.json().payment.changeCents).toBe(1000);
      expect(step17.json().tab.paidCents).toBe(9000);

      // Passo 18: Registrar pagamento final por cartão (Saldo restante = 14080 - 9000 = 5080c = R$ 50,80)
      const step18 = await app.inject({
        method: 'POST',
        url: '/api/payments',
        payload: {
          idempotencyKey: 'e2e20-step18-card',
          tabId: mainTabId,
          method: 'DEBIT_CARD',
          confirmationMode: 'ELECTRONIC_PROVIDER_CONFIRMED',
          nsuOrTxId: 'NSU-FINAL-5080',
          amountCents: 5080,
          payerLabel: 'Pagador 3 Cartão'
        }
      });
      expect(step18.statusCode).toBe(201);
      expect(step18.json().tab.paidCents).toBe(14080);

      // Passo 19: Encerrar a comanda e liberar as mesas 08 e 09
      const step19 = await app.inject({
        method: 'POST',
        url: `/api/tabs/${mainTabId}/close`,
        payload: { actorUserId: 'usr-cashier-01', releaseStatus: 'LIVRE' }
      });
      expect(step19.statusCode).toBe(200);
      expect(step19.json().tab.status).toBe('CLOSED');
      expect(store.getDiningTableByNumber(8)?.physicalStatus).toBe('LIVRE');
      expect(store.getDiningTableByNumber(9)?.physicalStatus).toBe('LIVRE');

      // Passo 20: Reiniciar os serviços e confirmar que todo o histórico, caixa e auditoria permanecem salvos + sincronizar com a VPS simulada
      const pendingEvents = store.listPendingSyncEvents(200);
      expect(pendingEvents.length).toBeGreaterThan(0);

      await app.close();
      store.close();

      const { app: appRestarted, store: storeRestarted } = await buildLocalServer({ requireStrictAuth: false, demoMode: true, dbPath: localDbFile });
      const { app: cloudApp, getLedger, closeDb: closeCloudDb } = await buildCloudApiServer({ allowInsecureTestAccess: true, dbPath: cloudDbFile });

      const persistedTab = storeRestarted.getTabById(mainTabId)!;
      expect(persistedTab.status).toBe('CLOSED');
      expect(persistedTab.totalCents).toBe(14080);
      expect(persistedTab.paidCents).toBe(14080);

      const cashSummary = storeRestarted.getCashierOperationalSummary();
      expect(cashSummary.financialSummary.actualReceivedTotalCents).toBe(14080);
      expect(cashSummary.financialSummary.totalChangeGivenCents).toBe(1000);
      expect(cashSummary.activeSession?.expectedCashCents).toBe(24000); // 20000 fundo + 4000 dinheiro líquido

      // Sincroniza lote acumulado offline com a VPS simulada sem duplicação
      const syncRes = await cloudApp.inject({
        method: 'POST',
        url: '/api/sync/batch',
        payload: {
          sourceNodeId: 'deck26-windows-main',
          sourceOrigin: 'WINDOWS_PDV',
          lastPulledRemoteCursor: 0,
          events: pendingEvents
        }
      });
      expect(syncRes.statusCode).toBe(200);
      expect(syncRes.json().ackedEventIds).toHaveLength(pendingEvents.length);
      expect(getLedger().length).toBe(pendingEvents.length);

      await appRestarted.close();
      storeRestarted.close();
      await cloudApp.close();
      closeCloudDb();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
