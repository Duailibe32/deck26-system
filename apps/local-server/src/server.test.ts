import { describe, expect, it } from 'vitest';
import { buildLocalServer } from './server.js';
import { buildCloudApiServer } from '../../cloud-api/src/server.js';

describe('@deck26/local-server & @deck26/cloud-api — Operação Offline-First e Sincronização Bidirecional', () => {
  it('separa estritamente Comanda (Tab), Pedido (Order), Pagamento (Payment), Impressão (PrintJob) e Estoque (StockMovement) com idempotência', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // 1. Garçom 01 dispara pedido via Wi-Fi Local para a Mesa 07
    const orderPayload = {
      idempotencyKey: 'waiter01-mesa07-req001',
      tableNumber: 7,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      waiterName: 'Garçom 01',
      items: [
        { productId: 'prd-exec-file-mignon-trinchado', quantity: 1 }, // R$ 42,00 (KITCHEN_HOT)
        { productId: 'prd-tapioca-carne-sol-catupiry', quantity: 2 }  // 2x R$ 14,00 = R$ 28,00 (GRIDDLE_TAPIOCA)
      ]
    };

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderPayload
    });
    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();

    // Verifica que abriu a Comanda MESA-07 (R$ 70,00 subtotal + R$ 7,00 taxa 10% = R$ 77,00 total)
    expect(body1.tab.code).toBe('MESA-07');
    expect(body1.tab.subtotalCents).toBe(7000);
    expect(body1.tab.serviceFeeCents).toBe(700);
    expect(body1.tab.totalCents).toBe(7700);

    // Verifica separação de Impressão (2 praças distintas: Cozinha Quente e Chapa)
    expect(body1.printJobs).toHaveLength(2);
    const printers = body1.printJobs.map((j: { targetPrinter: string }) => j.targetPrinter).sort();
    expect(printers).toEqual(['PRINTER_GRIDDLE', 'PRINTER_KITCHEN_HOT']);

    // Verifica separação de Movimentação de Estoque (2 baixas no razão Kardex)
    expect(body1.stockMovements).toHaveLength(2);
    expect(body1.stockMovements[0].movementType).toBe('SALE_DEDUCTION');

    // 2. Teste de Idempotência: celular do garçom reenvia a mesma requisição por oscilação de Wi-Fi
    const resDuplicate = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: orderPayload
    });
    expect(resDuplicate.statusCode).toBe(200);
    const bodyDup = resDuplicate.json();
    expect(bodyDup.idempotentReplay).toBe(true);
    expect(bodyDup.order.id).toBe(body1.order.id);
    expect(store.listOrders()).toHaveLength(1); // Nunca duplica o pedido!

    // 3. Liquidação na entidade Payment separada
    const payRes = await app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: {
        idempotencyKey: 'pay-mesa07-001',
        tabId: body1.tab.id,
        method: 'PIX',
        amountCents: 7700
      }
    });
    expect(payRes.statusCode).toBe(201);
    const payBody = payRes.json();
    expect(payBody.tab.status).toBe('CLOSED');
    expect(payBody.tab.paidCents).toBe(7700);
    expect(payBody.printJob.targetPrinter).toBe('PRINTER_CASHIER');

    await app.close();
  });

  it('sincroniza bidirecionalmente eventos persistentes entre o Servidor Local e a VPS Hostinger com idempotência', async () => {
    const { app: localApp, store: localStore } = await buildLocalServer({ dbPath: ':memory:' });
    const { app: cloudApp, getLedger } = await buildCloudApiServer();

    // 1. Cria um pedido offline no Servidor Local
    localStore.createOrder({
      idempotencyKey: 'offline-local-order-01',
      tableNumber: 3,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }]
    });

    const pendingBefore = localStore.listPendingSyncEvents();
    expect(pendingBefore.length).toBeGreaterThanOrEqual(2); // TAB + ORDER

    // 2. Cliente faz um pedido via QR Code na VPS Hostinger enquanto o restaurante opera
    const qrOrderRes = await cloudApp.inject({
      method: 'POST',
      url: '/api/public/orders',
      payload: {
        idempotencyKey: 'cloud-qr-mesa09-001',
        channel: 'QR_TABLE',
        tableNumber: 9,
        customerName: 'Mariana QR',
        items: [{ productId: 'prd-cuscuz-frango-catupiry', quantity: 1 }]
      }
    });
    expect(qrOrderRes.statusCode).toBe(201);

    // 3. O Servidor Local faz o Push dos seus eventos pendentes para a VPS e recebe (Pull) o pedido QR Code da Mesa 9
    const syncRes = await cloudApp.inject({
      method: 'POST',
      url: '/api/sync/batch',
      payload: {
        sourceNodeId: 'deck26-windows-main',
        sourceOrigin: 'WINDOWS_PDV',
        lastPulledRemoteCursor: 0,
        events: pendingBefore
      }
    });
    expect(syncRes.statusCode).toBe(200);
    const syncData = syncRes.json();

    expect(syncData.ackedEventIds).toHaveLength(pendingBefore.length);
    expect(syncData.remoteEventsToPull).toHaveLength(1);
    expect(syncData.remoteEventsToPull[0].idempotencyKey).toBe('cloud-qr-mesa09-001');

    // Confirma ACK local e aplica o pedido vindo da VPS no banco SQLite local
    localStore.acknowledgeSyncEvents(syncData.ackedEventIds);
    expect(localStore.listPendingSyncEvents()).toHaveLength(0);

    const applied = localStore.applyRemoteSyncEvent(syncData.remoteEventsToPull[0]);
    expect(applied.applied).toBe(true);
    expect(applied.duplicate).toBe(false);

    // Reaplicar o mesmo evento remoto garante idempotência (não duplica)
    const reApplied = localStore.applyRemoteSyncEvent(syncData.remoteEventsToPull[0]);
    expect(reApplied.applied).toBe(false);
    expect(reApplied.duplicate).toBe(true);

    expect(getLedger().length).toBe(pendingBefore.length + 1);

    await localApp.close();
    await cloudApp.close();
  });
});
