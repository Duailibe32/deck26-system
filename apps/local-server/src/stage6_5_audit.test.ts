import { describe, expect, it } from 'vitest';
import { buildLocalServer, signSessionToken } from './server.js';
import {
  calculateStayFolioTotals,
  hasPermission,
  sanitizeCsvCell
} from '@deck26/contracts';

describe('DECK 26 — ETAPA 6.5: AUDITORIA GERAL, CORREÇÃO DE FALHAS E HOMOLOGAÇÃO OPERACIONAL', () => {
  // ==========================================================================
  // BLOCO 1: ARITMÉTICA FINANCEIRA E CENTAVOS EXATOS
  // ==========================================================================

  describe('1. Rigor Matemático e Centavos Inteiros (Zero Centavos Fantasmas)', () => {
    it('1.1. Pagamento fracionado em 3 parcelas fecha conta de R$ 101,99 com saldo exatamente R$ 0,00', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      // Cria produto com preço exato de R$ 101,99 (10199 centavos)
      const prod = store.createCatalogProduct({
        categoryId: 'cat-qualquer-hora',
        sku: 'D26-AUDIT-10199',
        name: 'Combo Especial Auditoria 101.99',
        priceCents: 10199,
        availableChannels: ['COUNTER_PDV'],
        prepStation: 'KITCHEN_COLD',
        trackStock: false
      });

      // Abre comanda de balcão (COUNTER não possui taxa de serviço por padrão)
      const tab = store.openOrGetTab({
        code: 'CMD-SPLIT-10199',
        type: 'COUNTER',
        openedByUserId: 'usr-waiter-01'
      });

      store.createOrder({
        idempotencyKey: 'idem-split-order-10199',
        tabId: tab.id,
        channel: 'COUNTER_PDV',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: prod.id, quantity: 1 }]
      });

      const tabRefreshed = store.getTabById(tab.id)!;
      expect(tabRefreshed.totalCents).toBe(10199);

      // Pagamento 1: R$ 40,00 (4000 centavos) via PIX
      const p1 = store.recordPayment({
        tabId: tab.id,
        amountCents: 4000,
        method: 'PIX',
        operatorUserId: 'usr-cashier-01',
        idempotencyKey: 'idem-split-01'
      });
      expect(p1.tab.paidCents).toBe(4000);
      expect(p1.tab.status).toBe('PARTIALLY_PAID');

      // Pagamento 2: R$ 30,50 (3050 centavos) via Dinheiro
      const p2 = store.recordPayment({
        tabId: tab.id,
        amountCents: 3050,
        method: 'CASH',
        operatorUserId: 'usr-cashier-01',
        idempotencyKey: 'idem-split-02'
      });
      expect(p2.tab.paidCents).toBe(7050);
      expect(p2.tab.status).toBe('PARTIALLY_PAID');

      // Pagamento 3: R$ 31,49 (3149 centavos) via Cartão de Débito
      const p3 = store.recordPayment({
        tabId: tab.id,
        amountCents: 3149,
        method: 'CREDIT_CARD',
        operatorUserId: 'usr-cashier-01',
        idempotencyKey: 'idem-split-03'
      });
      expect(p3.tab.paidCents).toBe(10199);
      expect(p3.tab.status).toBe('CLOSED');

      // Saldo pendente restante obrigatório: R$ 0,00 (0 centavos)
      const finalTab = store.getTabById(tab.id)!;
      const remainingBalanceCents = finalTab.totalCents - finalTab.paidCents;
      expect(remainingBalanceCents).toBe(0);

      await app.close();
    });

    it('1.2. Idempotência estrita: reenvio do mesmo pagamento retorna a transação original sem duplicar cobrança', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const tab = store.openOrGetTab({
        code: 'CMD-IDEM-PAY',
        type: 'COUNTER',
        openedByUserId: 'usr-waiter-01'
      });

      const prod = store.createCatalogProduct({
        categoryId: 'cat-qualquer-hora',
        sku: 'D26-IDEM-50',
        name: 'Item 50 Reais',
        priceCents: 5000,
        availableChannels: ['COUNTER_PDV'],
        prepStation: 'KITCHEN_COLD',
        trackStock: false
      });

      store.createOrder({
        idempotencyKey: 'idem-order-50',
        tabId: tab.id,
        channel: 'COUNTER_PDV',
        originNode: 'WINDOWS_PDV',
        items: [{ productId: prod.id, quantity: 1 }]
      });

      const idemKey = 'idem-payment-unique-12345';

      // Primeira requisição
      const pay1 = store.recordPayment({
        tabId: tab.id,
        amountCents: 5000,
        method: 'PIX',
        operatorUserId: 'usr-cashier-01',
        idempotencyKey: idemKey
      });

      // Segunda requisição com a mesma chave (ex.: timeout de rede no terminal)
      const pay2 = store.recordPayment({
        tabId: tab.id,
        amountCents: 5000,
        method: 'PIX',
        operatorUserId: 'usr-cashier-01',
        idempotencyKey: idemKey
      });

      expect(pay1.payment.id).toBe(pay2.payment.id);
      expect(pay2.tab.paidCents).toBe(5000); // Não somou para 10000

      const paymentsInDb = store.db.prepare('SELECT COUNT(*) as count FROM payments WHERE tab_id = ?').get(tab.id) as { count: number };
      expect(paymentsInDb.count).toBe(1);

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 2: INVARIANTES CONTÁBEIS DO CAIXA E DRE
  // ==========================================================================

  describe('2. Invariantes Contábeis do Caixa e DRE (Fonte Única da Verdade)', () => {
    it('2.1. Sangria NÃO é despesa e Suprimento NÃO é receita na DRE Gerencial', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });
      const today = new Date().toISOString().slice(0, 10);

      // Abre turno de caixa
      store.openCashRegisterSession({
        openedByUserId: 'usr-manager-01',
        openingBalanceCents: 10000
      });

      // Realiza Suprimento de R$ 300,00 (troco inicial adicional)
      store.recordCashRegisterMovement({
        movementType: 'SUPRIMENTO',
        amountCents: 30000,
        reason: 'Suprimento de troco matinal',
        createdByUserId: 'usr-manager-01'
      });

      // Realiza Sangria de R$ 200,00 (retirada para cofre)
      store.recordCashRegisterMovement({
        movementType: 'SANGRIA',
        amountCents: 20000,
        reason: 'Sangria de segurança para cofre',
        createdByUserId: 'usr-manager-01'
      });

      // Gera DRE do dia
      const dre = store.generateDreStatement({ startDate: today, endDate: today });

      // Suprimento NÃO pode figurar como receita bruta
      expect(dre.grossRevenueCents).toBe(0);
      // Sangria NÃO pode figurar como despesa operacional
      expect(dre.operationalExpensesCents).toBe(0);
      expect(dre.netProfitCents).toBe(0);

      await app.close();
    });

    it('2.2. Transferência interna entre contas NÃO afeta o faturamento nem o resultado líquido', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });
      const today = new Date().toISOString().slice(0, 10);

      // Transfere R$ 500,00 do Caixa Geral para a Conta PIX
      store.createFinancialTransfer({
        fromAccountId: 'acc-caixa-geral',
        toAccountId: 'acc-conta-pix',
        amountCents: 50000,
        reason: 'Depósito de sangria em conta bancária',
        actorUserId: 'usr-owner-01'
      });

      const dre = store.generateDreStatement({ startDate: today, endDate: today });
      expect(dre.grossRevenueCents).toBe(0);
      expect(dre.netProfitCents).toBe(0);

      await app.close();
    });

    it('2.3. Auditoria Crítica de ROOM_CHARGE: transferência para quarto NÃO reduz diária hoteleira e NÃO duplica receita de restaurante', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });
      const today = new Date().toISOString().slice(0, 10);

      // 1. Hospeda cliente no quarto 101 com diária de R$ 130,00 (13000 centavos)
      const guest = store.createHotelGuest({
        fullName: 'Hóspede Auditoria DRE',
        documentNumber: '999.888.777-66',
        operatorUserId: 'usr-01'
      });
      const { stay } = store.checkInHotelStay({
        roomNumber: '101',
        guestId: guest.id,
        checkInAt: `${today}T14:00:00.000Z`,
        checkOutScheduledAt: new Date(Date.now() + 86400000).toISOString(),
        dailyRateCents: 13000,
        operatorUserId: 'usr-reception-01',
        operatorName: 'Recepção'
      });

      // 2. Cliente consome no Restaurante: 3 caldos de macaxeira a R$ 10,00 + 10% serviço = R$ 33,00 (3300 centavos)
      const restTab = store.openOrGetTab({
        code: 'CMD-REST-AUDIT',
        type: 'TABLE',
        tableNumber: 2,
        openedByUserId: 'usr-waiter-01'
      });
      store.createOrder({
        idempotencyKey: 'idem-order-rest-audit',
        tabId: restTab.id,
        tableNumber: 2,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 3 }]
      });

      // 3. Transfere conta do restaurante para o quarto 101
      store.transferRestaurantTabToFolio({
        restaurantTabId: restTab.id,
        roomNumber: '101',
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });

      // 4. Tentativa de reenvio deve ser sumariamente REJEITADA
      expect(() => {
        store.transferRestaurantTabToFolio({
          restaurantTabId: restTab.id,
          roomNumber: '101',
          operatorUserId: 'usr-cashier-01',
          operatorName: 'Caixa'
        });
      }).toThrow(/já se encontra encerrada|já foi transferido/);

      // 5. Audita DRE Gerencial por competência
      const dreBeforePayment = store.generateDreStatement({ startDate: today, endDate: today });

      // Receita do Hotel deve ser EXATAMENTE a diária legítima (R$ 130,00), NÃO reduzida nem inflacionada
      expect(dreBeforePayment.revenueByCostCenter['HOTEL']).toBe(13000);

      // Receita do Restaurante/Bar deve ser EXATAMENTE o consumo de R$ 33,00
      const restRevenue = (dreBeforePayment.revenueByCostCenter['REST'] ?? 0) + (dreBeforePayment.revenueByCostCenter['BAR'] ?? 0);
      expect(restRevenue).toBe(3300);

      // Receita Bruta Total = 13000 + 3300 = 16300 centavos (sem duplicação!)
      expect(dreBeforePayment.grossRevenueCents).toBe(16300);

      // 6. Hóspede efetua pagamento do folio (liquidação financeira do saldo total de R$ 163,00)
      store.addFolioEntry({
        stayId: stay.id,
        entryType: 'PAYMENT',
        description: 'Pagamento Integral Check-out (Cartão de Crédito)',
        amountCents: -16300,
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });

      // 7. Re-audita DRE após o pagamento: o pagamento do folio NÃO pode reduzir a receita do hotel!
      const dreAfterPayment = store.generateDreStatement({ startDate: today, endDate: today });
      expect(dreAfterPayment.revenueByCostCenter['HOTEL']).toBe(13000);
      expect(dreAfterPayment.grossRevenueCents).toBe(16300);

      // Extrato do quarto (Folio) comprova balanço zerado
      const folioEntries = store.listFolioEntriesByStayId(stay.id);
      const totals = calculateStayFolioTotals(folioEntries);
      expect(totals.totalChargesCents).toBe(16300); // 13000 diária + 3300 restaurante
      expect(totals.totalPaymentsCents).toBe(16300);
      expect(totals.balanceCents).toBe(0);

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 3: DELIVERY PRÓPRIO E PRESTAÇÃO DE CONTAS DE ENTREGADORES
  // ==========================================================================

  describe('3. Delivery Próprio, Custódia Transitória e Repasse a Entregador', () => {
    it('3.1. Prestar contas de entregador transfere custódia sem criar segunda receita de venda', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });
      const today = new Date().toISOString().slice(0, 10);

      // Cria pedido delivery com dinheiro
      const { deliveryOrder: delivOrder } = store.createDeliveryOrder({
        customerName: 'Cliente Delivery Dinheiro',
        customerPhone: '98988881122',
        deliveryType: 'DELIVERY',
        origin: 'SITE_WEB',
        deliveryZoneId: 'zone-centro',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }], // 2000 + taxa 500 = 2500
        paymentMethodDeclared: 'CASH',
        changeForCents: 5000,
        waiterId: 'usr-cashier-01'
      });

      // Despacha com entregador
      const couriers = store.listDeliveryCouriers();
      const courier = couriers[0]!;
      store.dispatchDeliveryOrder(delivOrder.id, courier.id, 'usr-cashier-01');

      // Confirma entrega
      store.updateDeliveryOrderStatus(delivOrder.id, 'ENTREGUE', 'usr-cashier-01');

      // DRE reconhece venda e custo de entregador
      const dreDelivery = store.generateDreStatement({ startDate: today, endDate: today });
      expect(dreDelivery.revenueByCostCenter['DELIV']).toBe(2500); // 2000 itens + 500 taxa

      // Entregador presta contas do dinheiro arrecadado ao caixa
      const settlement = store.settleCourierDeliveries({
        courierId: courier.id,
        financialAccountId: 'acc-caixa-geral',
        deliveryOrderIds: [delivOrder.id],
        actorUserId: 'usr-cashier-01'
      });

      expect(settlement.status).toBe('SETTLED');
      expect(settlement.totalCashCollectedCents).toBe(2500);

      // Re-audita DRE após prestação de contas: a receita continua exatamente 2500 (sem duplicação ao passar para o caixa!)
      const dreAfterSettlement = store.generateDreStatement({ startDate: today, endDate: today });
      expect(dreAfterSettlement.revenueByCostCenter['DELIV']).toBe(2500);

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 4: CONTROLE DE ACESSO RBAC E PROTEÇÃO DE ENDPOINTS
  // ==========================================================================

  describe('4. Segurança e Autorização Granular RBAC', () => {
    it('4.1. Garçom e Cozinha são barrados (403 Forbidden) ao tentar acessar rotas financeiras restritas', async () => {
      const { app } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

      // Token assinado de Garçom
      const waiterToken = signSessionToken({
        userId: 'usr-waiter-01',
        name: 'Garçom Teste',
        role: 'WAITER',
        issuedAt: Date.now()
      });

      // Garçom tenta criar conta financeira
      const createAccRes = await app.inject({
        method: 'POST',
        url: '/api/finance/accounts',
        headers: { authorization: `Bearer ${waiterToken}` },
        payload: {
          name: 'Conta Tentativa Ilegal',
          type: 'BANK_ACCOUNT',
          initialBalanceCents: 100000
        }
      });
      expect(createAccRes.statusCode).toBe(403);
      expect(createAccRes.json().error).toContain('não possui a permissão');

      // Garçom tenta gerar DRE Gerencial
      const dreRes = await app.inject({
        method: 'GET',
        url: '/api/finance/dre?startDate=2026-11-01&endDate=2026-11-30',
        headers: { authorization: `Bearer ${waiterToken}` }
      });
      expect(dreRes.statusCode).toBe(403);

      // Cozinha tenta liquidar acerto de entregador
      const kitchenToken = signSessionToken({
        userId: 'usr-kitchen-01',
        name: 'Cozinheiro Chefe',
        role: 'KITCHEN',
        issuedAt: Date.now()
      });

      const settleRes = await app.inject({
        method: 'POST',
        url: '/api/delivery/settlements',
        headers: { authorization: `Bearer ${kitchenToken}` },
        payload: {
          courierId: 'courier-01',
          deliveryOrderIds: ['deliv-01']
        }
      });
      expect(settleRes.statusCode).toBe(403);

      await app.close();
    });

    it('4.2. Gestão de Contas Bancárias: proprietário/gerente pode renomear e desativar contas sem apagar histórico', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

      const ownerToken = signSessionToken({
        userId: 'usr-owner-01',
        name: 'Proprietário',
        role: 'OWNER',
        issuedAt: Date.now()
      });

      // Modifica nome da conta pré-cadastrada Banco do Brasil para Cooperativa Sicredi
      const updateRes = await app.inject({
        method: 'PUT',
        url: '/api/finance/accounts/acc-banco-brasil',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          name: 'Sicredi C/C Cooperativa',
          bankName: 'Sicredi',
          accountNumber: '99887-1'
        }
      });
      expect(updateRes.statusCode).toBe(200);
      expect(updateRes.json().name).toBe('Sicredi C/C Cooperativa');

      // Desativa conta sem apagar histórico
      const deactivateRes = await app.inject({
        method: 'PUT',
        url: '/api/finance/accounts/acc-banco-brasil',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: {
          active: false
        }
      });
      expect(deactivateRes.statusCode).toBe(200);
      expect(deactivateRes.json().active).toBe(false);

      // Registro continua no banco e pode ser consultado com seu histórico
      const acc = store.getFinancialAccountById('acc-banco-brasil');
      expect(acc).not.toBeNull();
      expect(acc?.active).toBe(false);

      await app.close();
    });
  });
});
