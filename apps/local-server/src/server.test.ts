import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalServer } from './server.js';
import { buildCloudApiServer } from '../../cloud-api/src/server.js';

describe('@deck26/local-server & @deck26/cloud-api — Bateria Completa de Testes da Etapa 2', () => {
  it('1. Produtos: cadastro, persistência, consulta, categorias, preços em centavos e estações de impressão', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/catalog/products',
      payload: {
        id: 'prd-test-suco-jarra',
        sku: 'D26-BEB-999',
        categoryId: 'cat-bebidas',
        name: 'Jarra de Suco Natural 1L',
        description: 'Acerola ou Cajá',
        priceCents: 1850, // R$ 18,50 em centavos
        prepStation: 'BAR_DRINKS',
        initialStock: 30
      }
    });
    expect(createRes.statusCode).toBe(201);

    const catalogRes = await app.inject({ method: 'GET', url: '/api/catalog' });
    const catalog = catalogRes.json();
    const found = catalog.products.find((p: { id: string }) => p.id === 'prd-test-suco-jarra');

    expect(found).toBeDefined();
    expect(found.priceCents).toBe(1850);
    expect(found.prepStation).toBe('BAR_DRINKS');
    expect(found.categoryId).toBe('cat-bebidas');

    await app.close();
  });

  it('2. Mesas & Pedidos Incrementais: Mesa 05 pede Picanha às 20h00 e Feijoada às 20h30 (segundo pedido NÃO reimprime o primeiro item)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // 20h00: Mesa 05 solicita uma Picanha (R$ 120,00)
    const order20h00 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'mesa05-20h00-picanha',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        waiterName: 'Garçom 01',
        items: [{ productId: 'prd-esp-picanha', quantity: 1 }]
      }
    });
    expect(order20h00.statusCode).toBe(201);
    const body20h00 = order20h00.json();

    expect(body20h00.tab.code).toBe('MESA-05');
    expect(body20h00.printJobs).toHaveLength(1);
    expect(body20h00.printJobs[0].targetPrinter).toBe('PRINTER_KITCHEN_HOT');
    expect(body20h00.printJobs[0].payloadText).toContain('PICANHA NA CHAPA');
    expect(body20h00.printJobs[0].payloadText).not.toContain('FEIJOADA');

    // 20h30: Mesa 05 solicita uma Feijoada (R$ 80,00)
    const order20h30 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'mesa05-20h30-feijoada',
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        waiterName: 'Garçom 01',
        items: [{ productId: 'prd-esp-feijoada', quantity: 1 }]
      }
    });
    expect(order20h30.statusCode).toBe(201);
    const body20h30 = order20h30.json();

    // Verifica que a comanda acumulou os dois pedidos (R$ 120 + R$ 80 = R$ 200,00 subtotal)
    expect(body20h30.tab.id).toBe(body20h00.tab.id);
    expect(body20h30.tab.subtotalCents).toBe(20000);

    // Verifica IMPRESSÃO INCREMENTAL: o segundo pedido gera apenas 1 ticket contendo SOMENTE a Feijoada (sem repetir a Picanha!)
    expect(body20h30.printJobs).toHaveLength(1);
    expect(body20h30.printJobs[0].targetPrinter).toBe('PRINTER_KITCHEN_HOT');
    expect(body20h30.printJobs[0].payloadText).toContain('FEIJOADA COMPLETA');
    expect(body20h30.printJobs[0].payloadText).not.toContain('PICANHA');

    expect(store.listOrdersByTab(body20h00.tab.id)).toHaveLength(2);
    await app.close();
  });

  it('3. Pagamento Parcial: Conta de R$ 200,00 -> PIX R$ 50,00 + Dinheiro R$ 80,00 -> Saldo restante R$ 70,00 (sem encerrar a mesa automaticamente)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre conta de Balcão/Mesa sem taxa de 10% (ou desabilita taxa) para total exato de R$ 200,00 (20000 centavos)
    const tab = store.openOrGetTab({
      code: 'CONTA-TESTE-200',
      type: 'COUNTER', // Sem taxa de 10% para validar exatamente R$ 200,00 -> R$ 50 + R$ 80 = R$ 70
      customerName: 'Cliente Teste Parcial'
    });

    // Adiciona Picanha (R$ 120,00) + Feijoada (R$ 80,00) = R$ 200,00 (20000 centavos)
    await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {
        idempotencyKey: 'conta200-itens',
        tabId: tab.id,
        channel: 'COUNTER_PDV',
        originNode: 'WINDOWS_PDV',
        items: [
          { productId: 'prd-esp-picanha', quantity: 1 },
          { productId: 'prd-esp-feijoada', quantity: 1 }
        ]
      }
    });

    const tabAfterOrder = store.getTabById(tab.id)!;
    expect(tabAfterOrder.totalCents).toBe(20000); // R$ 200,00

    // Pagamento 1: PIX de R$ 50,00 (5000 centavos)
    const payPixRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'pay-pix-50',
        tabId: tab.id,
        method: 'PIX',
        amountCents: 5000
      }
    });
    expect(payPixRes.statusCode).toBe(201);
    const afterPix = payPixRes.json();
    expect(afterPix.tab.paidCents).toBe(5000);
    expect(afterPix.tab.totalCents - afterPix.tab.paidCents).toBe(15000); // R$ 150,00 restantes
    expect(afterPix.tab.status).toBe('PARTIALLY_PAID');
    expect(afterPix.printJob.targetPrinter).toBe('PRINTER_CASHIER'); // Impresso no Caixa, separado da Cozinha

    // Pagamento 2: Dinheiro de R$ 80,00 (8000 centavos)
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
    expect(payCashRes.statusCode).toBe(201);
    const afterCash = payCashRes.json();

    // Verifica soma paga = R$ 130,00 (13000 centavos) e saldo restante = R$ 70,00 (7000 centavos)
    expect(afterCash.tab.paidCents).toBe(13000);
    const remainingCents = afterCash.tab.totalCents - afterCash.tab.paidCents;
    expect(remainingCents).toBe(7000); // R$ 70,00 exatos!
    expect(afterCash.tab.status).toBe('PARTIALLY_PAID'); // NÃO encerra a mesa automaticamente!
    expect(afterCash.tab.closedAt).toBeNull();

    // Verifica que tentar pagar R$ 90,00 quando só faltam R$ 70,00 é bloqueado contra inconsistência financeira
    const overPayRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'pay-over-90',
        tabId: tab.id,
        method: 'PIX',
        amountCents: 9000
      }
    });
    expect(overPayRes.statusCode).toBe(400);

    await app.close();
  });

  it('4. Estoque Automático: 50 unidades de refrigerante -> venda de 2 unidades -> saldo 48 -> reenvio do mesmo evento NÃO gera nova baixa', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Verifica saldo inicial de 50 unidades do Refrigerante Lata
    const stockBefore = store
      .listStockBalancesAndMovements()
      .balances.find((b) => b.productId === 'prd-beb-refrigerante-lata');
    expect(stockBefore?.currentQuantity).toBe(50);

    const salePayload = {
      idempotencyKey: 'venda-refri-2un-idem-001',
      tableNumber: 2,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      items: [{ productId: 'prd-beb-refrigerante-lata', quantity: 2 }]
    };

    // Primeira chamada: registra venda de 2 unidades
    const res1 = await app.inject({ method: 'POST', url: '/api/orders', payload: salePayload });
    expect(res1.statusCode).toBe(201);

    const stockAfter1 = store
      .listStockBalancesAndMovements()
      .balances.find((b) => b.productId === 'prd-beb-refrigerante-lata');
    expect(stockAfter1?.currentQuantity).toBe(48);

    // Segunda chamada com a mesma chave de idempotência (reenvio de rede): NÃO pode baixar novamente!
    const res2 = await app.inject({ method: 'POST', url: '/api/orders', payload: salePayload });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().idempotentReplay).toBe(true);

    const stockAfter2 = store
      .listStockBalancesAndMovements()
      .balances.find((b) => b.productId === 'prd-beb-refrigerante-lata');
    expect(stockAfter2?.currentQuantity).toBe(48);

    await app.close();
  });

  it('5. Persistência Real em Disco: reinicia o Servidor Local e o Servidor da VPS Simulada e confirma que os dados permanecem gravados', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deck26-persist-test-'));
    const localDbFile = path.join(tempDir, 'local.sqlite');
    const cloudDbFile = path.join(tempDir, 'cloud.sqlite');

    try {
      // 1ª Instância: grava um pedido no disco local e sincroniza com o disco da VPS
      const { app: local1, store: store1 } = await buildLocalServer({ dbPath: localDbFile });
      const { app: cloud1, closeDb: closeCloud1 } = await buildCloudApiServer({ dbPath: cloudDbFile });

      store1.createOrder({
        idempotencyKey: 'persist-disk-order-01',
        tableNumber: 11,
        channel: 'DINE_IN',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 3 }]
      });

      const pending = store1.listPendingSyncEvents();
      const syncRes = await cloud1.inject({
        method: 'POST',
        url: '/api/sync/batch',
        payload: {
          sourceNodeId: 'deck26-windows-main',
          sourceOrigin: 'WINDOWS_PDV',
          lastPulledRemoteCursor: 0,
          events: pending
        }
      });
      expect(syncRes.statusCode).toBe(200);

      // Fecha ambos os servidores e seus bancos SQLite (simulando reinicialização do Windows)
      await local1.close();
      store1.close();
      await cloud1.close();
      closeCloud1();

      // 2ª Instância: reabre os mesmos arquivos do disco e verifica se os dados continuam lá
      const { app: local2, store: store2 } = await buildLocalServer({ dbPath: localDbFile });
      const { app: cloud2, getLedger: getLedger2, closeDb: closeCloud2 } = await buildCloudApiServer({
        dbPath: cloudDbFile
      });

      expect(store2.listOrders()).toHaveLength(1);
      expect(store2.listOrders()[0]?.tableNumber).toBe(11);
      expect(getLedger2().length).toBeGreaterThanOrEqual(2);

      await local2.close();
      store2.close();
      await cloud2.close();
      closeCloud2();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('6. Teste de Sincronização (Online -> Falha de Comunicação com a VPS -> Fila Offline -> Reconexão -> Sem Duplicação)', async () => {
    const { app: localApp, store: localStore } = await buildLocalServer({ dbPath: ':memory:' });
    const { app: cloudApp, getLedger, closeDb } = await buildCloudApiServer({ dbPath: ':memory:' });

    // Etapa 8.1 & 8.2: Registrar pedido local #1 e sincronizar com a nuvem simulada
    localStore.createOrder({
      idempotencyKey: 'sync-step1-order',
      tableNumber: 1,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      items: [{ productId: 'prd-omelete-simples', quantity: 1 }]
    });

    const batch1 = localStore.listPendingSyncEvents();
    const sync1 = await cloudApp.inject({
      method: 'POST',
      url: '/api/sync/batch',
      payload: {
        sourceNodeId: 'deck26-windows-main',
        sourceOrigin: 'WINDOWS_PDV',
        lastPulledRemoteCursor: 0,
        events: batch1
      }
    });
    expect(sync1.statusCode).toBe(200);
    localStore.acknowledgeSyncEvents(sync1.json().ackedEventIds);

    // Etapa 8.3: Verificar persistência na nuvem simulada e fila local limpa
    expect(localStore.listPendingSyncEvents()).toHaveLength(0);
    const countAfterStep3 = getLedger().length;
    expect(countAfterStep3).toBe(batch1.length);

    // Etapa 8.4: Interromper a comunicação com a nuvem simulada (apontando para porta offline sem desligar o Wi-Fi)
    const unreachableSync = await localApp.inject({
      method: 'POST',
      url: '/api/sync/trigger'
    });
    expect(unreachableSync.json().synced).toBe(false);
    expect(unreachableSync.json().offlineModeActive).toBe(true);

    // Etapa 8.5 & 8.6: Registrar novos pedidos locais durante a queda e verificar a fila pendente (Outbox)
    localStore.createOrder({
      idempotencyKey: 'sync-offline-order-A',
      tableNumber: 8,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      items: [{ productId: 'prd-cuscuz-frango', quantity: 2 }]
    });
    localStore.createOrder({
      idempotencyKey: 'sync-offline-order-B',
      tableNumber: 9,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      items: [{ productId: 'prd-tapioca-ovos', quantity: 1 }]
    });

    const pendingOfflineQueue = localStore.listPendingSyncEvents();
    expect(pendingOfflineQueue.length).toBeGreaterThanOrEqual(4); // 2 Tabs + 2 Orders acumulados na fila pendente

    // Etapa 8.7 & 8.8: Restaurar comunicação e sincronizar eventos pendentes
    const syncRecovery = await cloudApp.inject({
      method: 'POST',
      url: '/api/sync/batch',
      payload: {
        sourceNodeId: 'deck26-windows-main',
        sourceOrigin: 'WINDOWS_PDV',
        lastPulledRemoteCursor: sync1.json().newRemoteCursor,
        events: pendingOfflineQueue
      }
    });
    expect(syncRecovery.statusCode).toBe(200);
    const recoveryJson = syncRecovery.json();
    expect(recoveryJson.ackedEventIds).toHaveLength(pendingOfflineQueue.length);

    localStore.acknowledgeSyncEvents(recoveryJson.ackedEventIds);
    expect(localStore.listPendingSyncEvents()).toHaveLength(0);

    // Etapa 8.9: Confirmar que reenviar o mesmo lote NÃO gera duplicações no Ledger da VPS
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
    expect(syncDuplicateAttempt.statusCode).toBe(200);
    expect(syncDuplicateAttempt.json().ackedEventIds).toHaveLength(0);
    expect(syncDuplicateAttempt.json().duplicateEventIds).toHaveLength(pendingOfflineQueue.length);
    expect(getLedger().length).toBe(countAfterStep3 + pendingOfflineQueue.length);

    await localApp.close();
    await cloudApp.close();
    closeDb();
  });

  it('7. Segurança e Autorização Real no Backend: bloqueia acesso sem PIN válido e impede que Garçom ajuste estoque', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

    // Tentativa sem token -> 401 Unauthorized
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/stock/adjust',
      payload: {
        productId: 'prd-beb-refrigerante-lata',
        quantityDelta: 10,
        movementType: 'PURCHASE_ENTRY',
        reason: 'Tentativa sem login'
      }
    });
    expect(unauthRes.statusCode).toBe(401);

    // Login como Garçom (PIN 3030)
    const loginWaiter = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { pin: '3030' }
    });
    expect(loginWaiter.statusCode).toBe(200);
    const waiterToken = loginWaiter.json().token;

    // Garçom pode criar pedido (201), mas NÃO pode ajustar estoque manualmente (403 Forbidden)
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
});
