import { describe, expect, it } from 'vitest';
import { buildLocalServer } from './server.js';
import {
  calculateDreStatement,
  calculateGrossMarginPercent,
  calculateStayFolioTotals,
  formatBrlCents,
  hasPermission,
  sanitizeCsvCell
} from '@deck26/contracts';

describe('DECK 26 — ETAPA 6: Delivery Próprio, Gestão Financeira, Fluxo de Caixa, DRE e Relatórios', () => {
  // ==========================================================================
  // BLOCO 1: REGRAS E CONTRATOS (ZOD, FORMULA INJECTION, RBAC)
  // ==========================================================================

  describe('1. Segurança, Sanitização de Fórmulas CSV e RBAC Financeiro', () => {
    it('1.1. sanitizeCsvCell neutraliza ataques de CSV Formula Injection (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvCell('=1+1')).toBe('"\'=1+1"');
      expect(sanitizeCsvCell('+cmd|/c calc')).toBe('"\'+cmd|/c calc"');
      expect(sanitizeCsvCell('-200')).toBe('"\'-200"');
      expect(sanitizeCsvCell('@SUM(A1:A10)')).toBe('"\'@SUM(A1:A10)"');
      expect(sanitizeCsvCell('\tmalicious')).toBe('"\'\tmalicious"');
      expect(sanitizeCsvCell('Normal Text')).toBe('"Normal Text"');
      expect(sanitizeCsvCell('Texto com "aspas"')).toBe('"Texto com ""aspas"""');
      expect(sanitizeCsvCell(null)).toBe('""');
      expect(sanitizeCsvCell(undefined)).toBe('""');
      expect(sanitizeCsvCell(1500)).toBe('"1500"');
    });

    it('1.2. RBAC: valida permissões granulares de delivery e finanças por cargo', () => {
      expect(hasPermission('OWNER', 'delivery:manage_orders')).toBe(true);
      expect(hasPermission('OWNER', 'delivery:settle')).toBe(true);
      expect(hasPermission('OWNER', 'finance:view_dre')).toBe(true);
      expect(hasPermission('OWNER', 'finance:transfers')).toBe(true);

      expect(hasPermission('MANAGER', 'delivery:manage_orders')).toBe(true);
      expect(hasPermission('MANAGER', 'finance:manage_receivables')).toBe(true);
      expect(hasPermission('MANAGER', 'finance:view_dre')).toBe(true);

      expect(hasPermission('CASHIER', 'delivery:manage_orders')).toBe(true);
      expect(hasPermission('CASHIER', 'delivery:settle')).toBe(true);
      expect(hasPermission('CASHIER', 'finance:view_overview')).toBe(true);
      expect(hasPermission('CASHIER', 'finance:view_dre')).toBe(false);
      expect(hasPermission('CASHIER', 'finance:transfers')).toBe(false);

      expect(hasPermission('WAITER', 'delivery:manage_orders')).toBe(false);
      expect(hasPermission('WAITER', 'finance:view_dre')).toBe(false);

      expect(hasPermission('STOCK_CLERK', 'finance:manage_suppliers')).toBe(true);
      expect(hasPermission('STOCK_CLERK', 'delivery:manage_orders')).toBe(false);
    });

    it('1.3. calculateDreStatement: valida cálculo aritmético exato de margem e EBITDA sem ponto flutuante', () => {
      const dre = calculateDreStatement({
        grossRevenueCents: 100000, // R$ 1.000,00
        deductionsCents: 5000,     // R$ 50,00
        directCostsCents: 38000,   // R$ 380,00 (CMV)
        operationalExpensesCents: 20000, // R$ 200,00
        financialResultCents: -2000,     // -R$ 20,00 (taxas)
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30'
      });

      expect(dre.netRevenueCents).toBe(95000); // 100000 - 5000
      expect(dre.grossProfitCents).toBe(57000); // 95000 - 38000
      expect(dre.grossMarginPercent).toBe(60);  // (57000 / 95000) * 100 = 60%
      expect(dre.operatingResultCents).toBe(37000); // 57000 - 20000
      expect(dre.operatingMarginPercent).toBe(38.95); // 37000 / 95000 = 38.947% -> 38.95%
      expect(dre.netProfitCents).toBe(35000); // 37000 - 2000
      expect(dre.netMarginPercent).toBe(36.84); // 35000 / 95000 = 36.842% -> 36.84%
    });
  });

  // ==========================================================================
  // BLOCO 2: DELIVERY PRÓPRIO (REGIÕES, ENTREGADORES, CLIENTES, PEDIDOS)
  // ==========================================================================

  describe('2. Delivery Próprio: Regiões, Taxas, Entregadores e Clientes', () => {
    it('2.1. Regiões de entrega: lista zonas padrão semeadas e cria nova zona', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const zones = store.listDeliveryZones();
      expect(zones.length).toBeGreaterThanOrEqual(5);
      const centro = zones.find((z) => z.id === 'zone-centro');
      expect(centro).toBeDefined();
      expect(centro?.feeCents).toBe(500); // R$ 5,00

      const newZoneRes = await app.inject({
        method: 'POST',
        url: '/api/delivery/zones',
        payload: {
          name: 'Zona Rural Km 12',
          feeCents: 1500,
          minimumOrderCents: 5000,
          estimatedMinutes: 60,
          active: true
        }
      });
      expect(newZoneRes.statusCode).toBe(201);
      const created = newZoneRes.json();
      expect(created.name).toBe('Zona Rural Km 12');
      expect(created.feeCents).toBe(1500);

      await app.close();
    });

    it('2.2. Entregadores: cadastra, altera status (DISPONIVEL -> EM_ENTREGA -> DISPONIVEL) e lista por status', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const courier = store.createDeliveryCourier({
        name: 'Marcos Motoboy',
        phone: '98991234567',
        vehicleType: 'MOTO',
        vehiclePlate: 'HPX-2026',
        feePerDeliveryCents: 600,
        status: 'DISPONIVEL',
        active: true
      });
      expect(courier.id).toBeDefined();
      expect(courier.status).toBe('DISPONIVEL');

      store.updateDeliveryCourierStatus(courier.id, 'EM_ENTREGA');
      expect(store.getDeliveryCourierById(courier.id)?.status).toBe('EM_ENTREGA');

      const onlyBusy = store.listDeliveryCouriers('EM_ENTREGA');
      expect(onlyBusy.some((c) => c.id === courier.id)).toBe(true);

      await app.close();
    });

    it('2.3. Clientes de Delivery e Endereços: busca por telefone flexível e adiciona múltiplos endereços', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const customer = store.createOrUpdateDeliveryCustomer({
        name: 'Ana Carolina Silva',
        phone: '98 98765-4321',
        document: '123.456.789-00',
        email: 'ana@example.com'
      });
      expect(customer.name).toBe('Ana Carolina Silva');

      const found = store.findDeliveryCustomerByPhone('98987654321');
      expect(found?.id).toBe(customer.id);

      const addr = store.addDeliveryAddress(customer.id, {
        street: 'Avenida Brasil',
        number: '100',
        neighborhood: 'Centro Comercial',
        city: 'Santa Inês',
        deliveryZoneId: 'zone-centro',
        isDefault: true
      });
      expect(addr.id).toBeDefined();

      const reloadedCust = store.getDeliveryCustomerById(customer.id);
      expect(reloadedCust?.addresses).toHaveLength(1);
      expect(reloadedCust?.addresses[0]?.street).toBe('Avenida Brasil');

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 3: CICLO DE VIDA DO PEDIDO DE DELIVERY & PRESTAÇÃO DE CONTAS
  // ==========================================================================

  describe('3. Ciclo de Vida do Delivery e Despacho de Entregador', () => {
    it('3.1. Cria pedido de delivery: recálculo seguro no backend, baixa única de estoque e taxa de zona', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const stockBefore = store.getProductCurrentStock('prd-caldo-macaxeira');

      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/orders',
        payload: {
          customerName: 'Cliente Delivery Teste',
          customerPhone: '98981112233',
          deliveryType: 'DELIVERY',
          origin: 'SITE_WEB',
          deliveryZoneId: 'zone-centro',
          items: [
            { productId: 'prd-caldo-macaxeira', quantity: 2 } // R$ 10,00 x 2 = R$ 20,00
          ],
          paymentMethodDeclared: 'CASH',
          changeForCents: 5000
        }
      });

      expect(res.statusCode).toBe(201);
      const { deliveryOrder, baseOrder } = res.json();
      expect(deliveryOrder.itemsSubtotalCents).toBe(2000);
      expect(deliveryOrder.deliveryFeeCents).toBe(500); // Taxa Centro
      expect(deliveryOrder.totalCents).toBe(2500); // R$ 25,00
      expect(deliveryOrder.status).toBe('NOVO');

      const stockAfter = store.getProductCurrentStock('prd-caldo-macaxeira');
      expect(stockAfter).toBe(stockBefore - 2);

      const arList = store.listAccountsReceivable({ costCenterId: 'DELIV' });
      const linkedAr = arList.find((ar) => ar.originReferenceId === deliveryOrder.id);
      expect(linkedAr).toBeDefined();
      expect(linkedAr?.totalAmountCents).toBe(2500);
      expect(linkedAr?.status).toBe('PENDING');

      await app.close();
    });

    it('3.2. Retirada no balcão (TAKEOUT): taxa de entrega deve ser R$ 0,00', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const res = await app.inject({
        method: 'POST',
        url: '/api/delivery/orders',
        payload: {
          customerName: 'Cliente Balcão',
          customerPhone: '98982223344',
          deliveryType: 'TAKEOUT',
          origin: 'COUNTER',
          items: [{ productId: 'prd-caldo-macaxeira', quantity: 1 }],
          paymentMethodDeclared: 'PIX'
        }
      });

      expect(res.statusCode).toBe(201);
      const { deliveryOrder } = res.json();
      expect(deliveryOrder.deliveryFeeCents).toBe(0);
      expect(deliveryOrder.totalCents).toBe(1000);

      await app.close();
    });

    it('3.3. Máquina de estados: NOVO -> CONFIRMADO -> EM_PREPARO -> PRONTO -> SAIU_PARA_ENTREGA -> ENTREGUE', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const { deliveryOrder } = store.createDeliveryOrder({
        customerName: 'Lucas Lima',
        customerPhone: '98983334455',
        deliveryType: 'DELIVERY',
        origin: 'PHONE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 1 }],
        paymentMethodDeclared: 'CREDIT_CARD'
      });

      store.updateDeliveryOrderStatus(deliveryOrder.id, 'CONFIRMADO', 'usr-cashier-01');
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'EM_PREPARO', 'usr-kitchen-01');
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'PRONTO', 'usr-kitchen-01');

      const courier = store.listDeliveryCouriers()[0]!;
      store.dispatchDeliveryOrder(deliveryOrder.id, courier.id, 'usr-cashier-01');

      const dispatched = store.getDeliveryOrderById(deliveryOrder.id);
      expect(dispatched?.status).toBe('SAIU_PARA_ENTREGA');
      expect(dispatched?.courierId).toBe(courier.id);
      expect(store.getDeliveryCourierById(courier.id)?.status).toBe('EM_ENTREGA');

      store.updateDeliveryOrderStatus(deliveryOrder.id, 'ENTREGUE', 'usr-cashier-01');
      const delivered = store.getDeliveryOrderById(deliveryOrder.id);
      expect(delivered?.status).toBe('ENTREGUE');
      expect(delivered?.paymentStatus).toBe('PAID');
      expect(store.getDeliveryCourierById(courier.id)?.status).toBe('DISPONIVEL');

      await app.close();
    });

    it('3.4. Cancelamento de pedido de delivery: reverte conta a receber e estorna estoque no Kardex', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const stockBefore = store.getProductCurrentStock('prd-caldo-macaxeira');
      const { deliveryOrder } = store.createDeliveryOrder({
        customerName: 'Cliente Desistente',
        customerPhone: '98984445566',
        deliveryType: 'DELIVERY',
        origin: 'SITE_WEB',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 1 }],
        paymentMethodDeclared: 'CASH'
      });

      expect(store.getProductCurrentStock('prd-caldo-macaxeira')).toBe(stockBefore - 1);

      store.updateDeliveryOrderStatus(deliveryOrder.id, 'CANCELADO', 'usr-cashier-01', 'Cliente desistiu');
      const cancelled = store.getDeliveryOrderById(deliveryOrder.id);
      expect(cancelled?.status).toBe('CANCELADO');

      expect(store.getProductCurrentStock('prd-caldo-macaxeira')).toBe(stockBefore);

      const ar = store.listAccountsReceivable().find((a) => a.originReferenceId === deliveryOrder.id);
      expect(ar?.status).toBe('CANCELED');

      await app.close();
    });

    it('3.5. Prestação de contas de motoboy: calcula dinheiro coletado, desconta comissões e transfere custódia ao caixa', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const courier = store.listDeliveryCouriers()[0]!;

      const order1 = store.createDeliveryOrder({
        customerName: 'Entrega 1',
        customerPhone: '98985556677',
        deliveryType: 'DELIVERY',
        origin: 'PHONE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }],
        paymentMethodDeclared: 'CASH',
        courierId: courier.id
      }).deliveryOrder;

      const order2 = store.createDeliveryOrder({
        customerName: 'Entrega 2',
        customerPhone: '98986667788',
        deliveryType: 'DELIVERY',
        origin: 'PHONE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 3 }],
        paymentMethodDeclared: 'CASH',
        courierId: courier.id
      }).deliveryOrder;

      store.updateDeliveryOrderStatus(order1.id, 'ENTREGUE', 'usr-cashier-01');
      store.updateDeliveryOrderStatus(order2.id, 'ENTREGUE', 'usr-cashier-01');

      const cashAccountBefore = store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;

      const settlement = store.settleCourierDeliveries({
        courierId: courier.id,
        financialAccountId: 'acc-caixa-geral',
        deliveryOrderIds: [order1.id, order2.id],
        actorUserId: 'usr-cashier-01'
      });

      expect(settlement.totalCashCollectedCents).toBe(6000);
      expect(settlement.totalCourierFeesCents).toBe(1000);
      expect(settlement.netAmountSettledCents).toBe(5000);
      expect(settlement.status).toBe('SETTLED');

      const cashAccountAfter = store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;
      expect(cashAccountAfter).toBe(cashAccountBefore + 5000);

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 4: GESTÃO FINANCEIRA (CONTAS, RECEBÍVEIS, PAGÁVEIS, COMPRAS)
  // ==========================================================================

  describe('4. Gestão Financeira Integrada: Contas, Recebíveis, Pagáveis e Compras', () => {
    it('4.1. Contas financeiras e tesouraria: saldos independentes e criação de conta bancária', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const accounts = store.listFinancialAccounts();
      expect(accounts.length).toBeGreaterThanOrEqual(5);

      const caixa = store.getFinancialAccountById('acc-caixa-geral');
      const banco = store.getFinancialAccountById('acc-banco-brasil');
      expect(caixa?.currentBalanceCents).toBe(50000);
      expect(banco?.currentBalanceCents).toBe(1500000);

      const newAcc = store.createFinancialAccount({
        name: 'Bradesco C/C Eventos',
        type: 'BANK_ACCOUNT',
        bankName: 'Bradesco',
        accountNumber: '9988-7',
        initialBalanceCents: 100000,
        active: true
      });
      expect(newAcc.currentBalanceCents).toBe(100000);

      await app.close();
    });

    it('4.2. Fornecedores: cadastro, edição e listagem', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const suppliers = store.listSuppliers();
      expect(suppliers.length).toBeGreaterThanOrEqual(2);

      const newSup = store.createSupplier({
        name: 'Frango & Cia Ltda',
        tradeName: 'Distribuidora Frango Forte',
        document: '33.444.555/0001-22',
        email: 'vendas@frangoforte.com.br',
        phone: '9832321122',
        contactPerson: 'Fernando Alves',
        category: 'Aves e Carnes',
        active: true
      });
      expect(newSup.id).toBeDefined();

      store.updateSupplier(newSup.id, { contactPerson: 'Roberto Carlos' });
      expect(store.getSupplierById(newSup.id)?.contactPerson).toBe('Roberto Carlos');

      await app.close();
    });

    it('4.3. Contas a Receber: criação manual, recebimento parcial e quitação com movimentação na conta', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const ar = store.createAccountReceivable({
        description: 'Locação Espaço Deck 26 para Evento',
        origin: 'MANUAL',
        costCenterId: 'ADMIN',
        categoryId: 'cat-rec-rest',
        totalAmountCents: 100000,
        accrualDate: '2026-11-04',
        dueDate: '2026-11-10',
        status: 'PENDING',
        customerName: 'Empresa Alpha'
      });

      expect(ar.status).toBe('PENDING');
      expect(ar.remainingAmountCents).toBe(100000);

      const caixaBefore = store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;

      const step1 = store.payAccountReceivable(ar.id, {
        amountCents: 40000,
        financialAccountId: 'acc-caixa-geral',
        paymentMethod: 'PIX',
        actorUserId: 'usr-cashier-01'
      });
      expect(step1.accountReceivable.status).toBe('PARTIALLY_PAID');
      expect(step1.accountReceivable.paidAmountCents).toBe(40000);
      expect(step1.accountReceivable.remainingAmountCents).toBe(60000);
      expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(caixaBefore + 40000);

      const step2 = store.payAccountReceivable(ar.id, {
        amountCents: 60000,
        financialAccountId: 'acc-caixa-geral',
        paymentMethod: 'CASH',
        actorUserId: 'usr-cashier-01'
      });
      expect(step2.accountReceivable.status).toBe('PAID');
      expect(step2.accountReceivable.remainingAmountCents).toBe(0);
      expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(caixaBefore + 100000);

      await app.close();
    });

    it('4.4. Contas a Pagar: registro de despesa operacional e liquidação com débito em conta bancária', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const ap = store.createAccountPayable({
        description: 'Fatura Energia Elétrica Equatorial Nov/2026',
        origin: 'UTILITY',
        costCenterId: 'ADMIN',
        categoryId: 'cat-desp-energia-agua',
        totalAmountCents: 250000,
        accrualDate: '2026-11-04',
        dueDate: '2026-11-15',
        status: 'PENDING'
      });

      const bancoBefore = store.getFinancialAccountById('acc-banco-brasil')!.currentBalanceCents;

      const payment = store.payAccountPayable(ap.id, {
        amountCents: 250000,
        financialAccountId: 'acc-banco-brasil',
        paymentMethod: 'PIX',
        actorUserId: 'usr-manager-01'
      });

      expect(payment.accountPayable.status).toBe('PAID');
      expect(payment.accountPayable.remainingAmountCents).toBe(0);
      expect(store.getFinancialAccountById('acc-banco-brasil')!.currentBalanceCents).toBe(bancoBefore - 250000);

      await app.close();
    });

    it('4.5. Transferências internas: transferência atômica entre contas sem alterar patrimônio e sem receita/despesa', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const totalBefore = store.listFinancialAccounts().reduce((sum, a) => sum + a.currentBalanceCents, 0);
      const caixaBefore = store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;
      const cofreBefore = store.getFinancialAccountById('acc-cofre-sede')!.currentBalanceCents;

      const result = store.createFinancialTransfer({
        fromAccountId: 'acc-caixa-geral',
        toAccountId: 'acc-cofre-sede',
        amountCents: 30000,
        reason: 'Sangria de segurança término de turno',
        actorUserId: 'usr-manager-01'
      });

      expect(result.transfer.id).toBeDefined();
      expect(store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents).toBe(caixaBefore - 30000);
      expect(store.getFinancialAccountById('acc-cofre-sede')!.currentBalanceCents).toBe(cofreBefore + 30000);

      const totalAfter = store.listFinancialAccounts().reduce((sum, a) => sum + a.currentBalanceCents, 0);
      expect(totalAfter).toBe(totalBefore);

      await app.close();
    });

    it('4.6. Registro de Compras (NF): entrada física no Kardex e geração de conta a pagar vinculada', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const supplier = store.listSuppliers()[0]!;
      const stockBefore = store.getProductCurrentStock('prd-caldo-macaxeira');

      const { invoice, accountsPayable } = store.createPurchaseInvoice({
        invoiceNumber: 'NF-99881',
        supplierId: supplier.id,
        costCenterId: 'REST',
        issueDate: '2026-11-04',
        dueDate: '2026-11-20',
        items: [
          {
            productId: 'prd-caldo-macaxeira',
            quantity: 50,
            unitCostCents: 450
          }
        ],
        actorUserId: 'usr-stock-01'
      });

      expect(invoice.id).toBeDefined();
      expect(invoice.totalAmountCents).toBe(50 * 450);
      expect(accountsPayable.id).toBeDefined();
      expect(accountsPayable.totalAmountCents).toBe(22500);

      expect(store.getProductCurrentStock('prd-caldo-macaxeira')).toBe(stockBefore + 50);

      const prod = store.getProductById('prd-caldo-macaxeira');
      expect(prod?.costPriceCents).toBe(450);

      await app.close();
    });

    it('4.7. Conciliação Manual de Contas: detecta divergência física vs contábil e registra ajuste auditado', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const account = store.getFinancialAccountById('acc-caixa-geral')!;
      const calculated = account.currentBalanceCents;

      const declared = calculated - 1000;

      const rec = store.reconcileFinancialAccount({
        financialAccountId: account.id,
        reconciliationDate: '2026-11-04',
        declaredPhysicalBalanceCents: declared,
        actorUserId: 'usr-manager-01',
        adjustBalance: true,
        notes: 'Diferença de centavos apurada no fechamento'
      });

      expect(rec.differenceCents).toBe(-1000);
      expect(rec.status).toBe('DISCREPANCY_ADJUSTED');
      expect(store.getFinancialAccountById(account.id)!.currentBalanceCents).toBe(declared);

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 5: DRE GERENCIAL POR COMPETÊNCIA & FLUXO DE CAIXA
  // ==========================================================================

  describe('5. DRE Gerencial por Competência e Fluxo de Caixa Realizado/Previsto', () => {
    it('5.1. DRE: invariante contábil — compra de estoque é ativo (NÃO é despesa imediata) e CMV é via consumo', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const supplier = store.listSuppliers()[0]!;
      store.createPurchaseInvoice({
        invoiceNumber: 'NF-ESTOQUE-10K',
        supplierId: supplier.id,
        costCenterId: 'REST',
        issueDate: '2026-11-04',
        items: [
          { productId: 'prd-caldo-macaxeira', quantity: 2000, unitCostCents: 500 }
        ],
        actorUserId: 'usr-stock-01'
      });

      const dreZeroSales = store.generateDreStatement({
        startDate: '2026-11-04',
        endDate: '2026-11-04'
      });

      expect(dreZeroSales.operationalExpensesCents).toBe(0);
      expect(dreZeroSales.directCostsCents).toBe(0);
      expect(dreZeroSales.netProfitCents).toBe(0);

      await app.close();
    });

    it('5.2. DRE: invariante contábil — transferência de comanda para hotel (ROOM_CHARGE) NÃO duplica receita', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const guest = store.createHotelGuest({
        fullName: 'Hóspede Milla Teste',
        documentNumber: '11122233344',
        operatorUserId: 'usr-01'
      });
      store.checkInHotelStay({
        roomNumber: '101',
        guestId: guest.id,
        checkOutScheduledAt: new Date(Date.now() + 86400000).toISOString(),
        dailyRateCents: 0,
        operatorUserId: 'usr-reception-01',
        operatorName: 'Recepção'
      });

      const restTab = store.openOrGetTab({
        code: 'CMD-DRE-01',
        type: 'TABLE',
        tableNumber: 1,
        openedByUserId: 'usr-waiter-01'
      });
      store.createOrder({
        idempotencyKey: 'idem-tab-dre-01',
        tabId: restTab.id,
        tableNumber: 1,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 5 }]
      });

      store.transferRestaurantTabToFolio({
        restaurantTabId: restTab.id,
        roomNumber: '101',
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });

      const today = new Date().toISOString().slice(0, 10);
      const dre = store.generateDreStatement({
        startDate: today,
        endDate: today
      });

      expect(dre.revenueByCostCenter['HOTEL']).toBe(0);
      expect((dre.revenueByCostCenter['REST'] ?? 0) + (dre.revenueByCostCenter['BAR'] ?? 0)).toBe(5500);
      expect(dre.grossRevenueCents).toBe(5500);

      await app.close();
    });

    it('5.3. Fluxo de Caixa Realizado: entradas, saídas e saldos exatos por meio de pagamento', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const start = '2026-11-01';
      const end = '2026-11-30';

      const cashFlow = store.generateCashFlowRealized({ startDate: start, endDate: end });
      expect(cashFlow.periodStart).toBe(start);
      expect(cashFlow.periodEnd).toBe(end);
      expect(cashFlow.closingBalanceCents).toBeDefined();

      await app.close();
    });

    it('5.4. Fluxo de Caixa Projetado: projeta recebimentos e pagamentos futuros por vencimento', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      store.createAccountReceivable({
        description: 'Recebimento Futuro Evento',
        origin: 'MANUAL',
        costCenterId: 'REST',
        categoryId: 'cat-rec-rest',
        totalAmountCents: 50000,
        accrualDate: '2026-11-04',
        dueDate: '2026-11-10',
        status: 'PENDING'
      });

      store.createAccountPayable({
        description: 'Boleto Fornecedor Carnes',
        origin: 'MANUAL',
        costCenterId: 'REST',
        categoryId: 'cat-custo-cmv-alim',
        totalAmountCents: 30000,
        accrualDate: '2026-11-04',
        dueDate: '2026-11-12',
        status: 'PENDING'
      });

      const projection = store.generateCashFlowProjected({
        startDate: '2026-11-01',
        endDate: '2026-11-30'
      });

      expect(projection.projectedReceivablesCents).toBeGreaterThanOrEqual(50000);
      expect(projection.projectedPayablesCents).toBeGreaterThanOrEqual(30000);
      expect(projection.projectedNetCashFlowCents).toBe(projection.projectedReceivablesCents - projection.projectedPayablesCents);

      await app.close();
    });

    it('5.5. Exportação de Relatórios CSV: gera dados formatados e sanitizados contra fórmula injection', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      const dreCsv = store.exportReportCsv('dre');
      expect(dreCsv).toContain('Demonstrativo de Resultado');
      expect(dreCsv).toContain('Receita Operacional Líquida');

      const delivCsv = store.exportReportCsv('delivery');
      expect(delivCsv).toContain('"ID","Numero","Cliente"');

      const recCsv = store.exportReportCsv('receivables');
      expect(recCsv).toContain('"ID","Descricao","Origem"');

      await app.close();
    });
  });

  // ==========================================================================
  // BLOCO 6: TESTE PONTA A PONTA OPERACIONAL INTEGRADO (28 PASSOS)
  // ==========================================================================

  describe('6. Teste Ponta a Ponta Operacional Integrado (28 Passos)', () => {
    it('executa a jornada completa: turnos, compras, restaurante, delivery, hotel, transferências, conciliação e DRE', async () => {
      const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

      // Passo 1: Abre turno de caixa com R$ 500,00 de fundo
      const caixaAcc = store.getFinancialAccountById('acc-caixa-geral')!;
      expect(caixaAcc.currentBalanceCents).toBe(50000);

      // Passo 2: Cadastra fornecedor de insumos
      const sup = store.createSupplier({
        name: 'Frigorífico Central Milla',
        document: '55.666.777/0001-88',
        phone: '9832112233',
        category: 'Carnes e Alimentos',
        active: true
      });
      expect(sup.id).toBeDefined();

      // Passo 3: Cadastra nota fiscal de compra de 100 caldos a R$ 4,00 (Total R$ 400,00)
      const stockBeforePurchase = store.getProductCurrentStock('prd-caldo-macaxeira');
      const { invoice, accountsPayable: purchaseAp } = store.createPurchaseInvoice({
        invoiceNumber: 'NF-E2E-001',
        supplierId: sup.id,
        costCenterId: 'REST',
        issueDate: '2026-11-04',
        dueDate: '2026-11-25',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 100, unitCostCents: 400 }],
        actorUserId: 'usr-stock-01'
      });
      expect(invoice.totalAmountCents).toBe(40000);
      expect(store.getProductCurrentStock('prd-caldo-macaxeira')).toBe(stockBeforePurchase + 100);

      // Passo 4: Abre mesa 05 e faz pedido salão de 2 caldos (R$ 20,00)
      const tabSalao = store.openOrGetTab({
        code: 'CMD-E2E-SALAO',
        type: 'TABLE',
        tableNumber: 5,
        openedByUserId: 'usr-waiter-01'
      });
      store.createOrder({
        idempotencyKey: 'idem-e2e-salao-01',
        tabId: tabSalao.id,
        tableNumber: 5,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 2 }]
      });

      // Passo 5: Cozinha prepara e entrega pedido salão
      const salaoOrder = store.listOrdersByTab(tabSalao.id)[0]!;
      store.advanceOrderStatus({ orderId: salaoOrder.id, newStatus: 'IN_PREPARATION', originNode: 'WINDOWS_PDV' });
      store.advanceOrderStatus({ orderId: salaoOrder.id, newStatus: 'READY', originNode: 'WINDOWS_PDV' });
      store.advanceOrderStatus({ orderId: salaoOrder.id, newStatus: 'DELIVERED', originNode: 'WINDOWS_PDV' });

      // Passo 6: Cadastra cliente de delivery
      const delivCust = store.createOrUpdateDeliveryCustomer({
        name: 'Mariana Delivery E2E',
        phone: '98991919191',
        document: '999.888.777-66'
      });
      store.addDeliveryAddress(delivCust.id, {
        street: 'Rua das Flores',
        number: '123',
        neighborhood: 'Centro Comercial',
        deliveryZoneId: 'zone-centro',
        isDefault: true
      });

      // Passo 7: Cria pedido de delivery de 3 caldos (R$ 30,00 + taxa R$ 5,00 = R$ 35,00) em dinheiro
      const { deliveryOrder } = store.createDeliveryOrder({
        customerId: delivCust.id,
        customerName: delivCust.name,
        customerPhone: delivCust.phone,
        deliveryType: 'DELIVERY',
        origin: 'SITE_WEB',
        items: [{ productId: 'prd-caldo-macaxeira', quantity: 3 }],
        paymentMethodDeclared: 'CASH',
        changeForCents: 5000
      });
      expect(deliveryOrder.totalCents).toBe(3500);

      // Passo 8: Avança pedido de delivery até PRONTO
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'CONFIRMADO', 'usr-cashier-01');
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'EM_PREPARO', 'usr-kitchen-01');
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'PRONTO', 'usr-kitchen-01');

      // Passo 9: Cadastra motoboy e despacha entrega
      const courier = store.createDeliveryCourier({
        name: 'Pedro Motoboy E2E',
        phone: '98992223344',
        vehicleType: 'MOTO',
        feePerDeliveryCents: 500,
        status: 'DISPONIVEL'
      });
      store.dispatchDeliveryOrder(deliveryOrder.id, courier.id, 'usr-cashier-01');
      expect(store.getDeliveryCourierById(courier.id)?.status).toBe('EM_ENTREGA');

      // Passo 10: Motoboy entrega e recebe dinheiro
      store.updateDeliveryOrderStatus(deliveryOrder.id, 'ENTREGUE', 'usr-cashier-01');
      expect(store.getDeliveryCourierById(courier.id)?.status).toBe('DISPONIVEL');

      // Passo 11: Realiza prestação de contas do motoboy no caixa
      const settlement = store.settleCourierDeliveries({
        courierId: courier.id,
        financialAccountId: 'acc-caixa-geral',
        deliveryOrderIds: [deliveryOrder.id],
        actorUserId: 'usr-cashier-01'
      });
      expect(settlement.netAmountSettledCents).toBe(3000);

      // Passo 12: Cadastra hóspede do Hotel Auto Posto Milla
      const guest = store.createHotelGuest({
        fullName: 'Dr. Fernando Hóspede E2E',
        documentNumber: '888.777.666-55',
        operatorUserId: 'usr-01'
      });

      // Passo 13: Check-in no quarto 102 (diária R$ 200,00)
      const { stay: stay102 } = store.checkInHotelStay({
        roomNumber: '102',
        guestId: guest.id,
        checkOutScheduledAt: new Date(Date.now() + 86400000).toISOString(),
        dailyRateCents: 20000,
        operatorUserId: 'usr-reception-01',
        operatorName: 'Recepção'
      });

      // Passo 14: Transfere comanda do restaurante para a conta do quarto (ROOM_CHARGE)
      store.transferRestaurantTabToFolio({
        restaurantTabId: tabSalao.id,
        roomNumber: '102',
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });
      expect(store.getTabById(tabSalao.id)?.status).toBe('CLOSED');

      // Passo 15: Lança serviço de lavanderia no quarto (R$ 30,00 x 2)
      const service = store.listHotelServices().find((s) => s.id === 'srv-lavanderia')!;
      store.orderHotelService({
        stayId: stay102.id,
        serviceId: service.id,
        quantity: 2,
        operatorUserId: 'usr-reception-01',
        operatorName: 'Recepção'
      });

      // Passo 16: Check-out do hóspede com quitação do saldo
      const folioEntries = store.listFolioEntriesByStayId(stay102.id);
      const folioTotals = calculateStayFolioTotals(folioEntries);
      if (folioTotals.balanceCents > 0) {
        store.addFolioEntry({
          stayId: stay102.id,
          entryType: 'PAYMENT',
          description: 'Quitação Check-out (PIX)',
          amountCents: -folioTotals.balanceCents,
          operatorUserId: 'usr-reception-01',
          operatorName: 'Recepção'
        });
      }
      const checkout = store.checkOutHotelStay(stay102.id, {
        operatorUserId: 'usr-reception-01',
        operatorName: 'Recepção'
      });
      expect(checkout.stay.status).toBe('CHECKED_OUT');

      // Passo 17: Paga fatura do fornecedor de carnes com a conta bancária
      const bancoBefore = store.getFinancialAccountById('acc-banco-brasil')!.currentBalanceCents;
      store.payAccountPayable(purchaseAp.id, {
        amountCents: purchaseAp.totalAmountCents,
        financialAccountId: 'acc-banco-brasil',
        paymentMethod: 'PIX',
        actorUserId: 'usr-manager-01'
      });
      expect(store.getFinancialAccountById('acc-banco-brasil')!.currentBalanceCents).toBe(bancoBefore - 40000);

      // Passo 18: Faz sangria de segurança do Caixa para o Cofre (R$ 100,00)
      store.createFinancialTransfer({
        fromAccountId: 'acc-caixa-geral',
        toAccountId: 'acc-cofre-sede',
        amountCents: 10000,
        reason: 'Sangria de fechamento',
        actorUserId: 'usr-manager-01'
      });

      // Passo 19: Faz conciliação do Caixa Físico
      const caixaNow = store.getFinancialAccountById('acc-caixa-geral')!.currentBalanceCents;
      const today = new Date().toISOString().slice(0, 10);
      const rec = store.reconcileFinancialAccount({
        financialAccountId: 'acc-caixa-geral',
        reconciliationDate: today,
        declaredPhysicalBalanceCents: caixaNow,
        actorUserId: 'usr-manager-01',
        adjustBalance: false
      });
      expect(rec.differenceCents).toBe(0);
      expect(rec.status).toBe('BALANCED');

      // Passo 20: Gera DRE Gerencial do dia e audita todas as linhas
      const dre = store.generateDreStatement({
        startDate: today,
        endDate: today
      });

      expect(dre.grossRevenueCents).toBe(28700);
      expect(dre.directCostsCents).toBe(2500);
      expect(dre.grossProfitCents).toBe(26200);

      // Passo 21: Gera Fluxo de Caixa Realizado e Previsto
      const cfRealized = store.generateCashFlowRealized({
        startDate: today,
        endDate: today
      });
      expect(cfRealized.totalInflowsCents).toBeGreaterThan(0);

      const cfProjected = store.generateCashFlowProjected({
        startDate: today,
        endDate: '2026-12-31'
      });
      expect(cfProjected.dailyProjections).toBeDefined();

      // Passo 22: Exporta CSVs de Auditoria protegidos contra formula injection
      const csvDelivery = store.exportReportCsv('delivery');
      expect(csvDelivery).toContain('Mariana Delivery E2E');

      const csvDre = store.exportReportCsv('dre');
      expect(csvDre).toContain('Demonstrativo de Resultado');

      // Passo 23: Dashboard executivo
      const dash = store.getExecutiveDashboardMetrics();
      expect(dash.treasuryTotalBalanceCents).toBeGreaterThan(0);

      await app.close();
    });
  });
});
