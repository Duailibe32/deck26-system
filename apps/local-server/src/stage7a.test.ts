import { describe, expect, it } from 'vitest';
import { buildLocalServer, signSessionToken } from './server.js';
import {
  DECK26_INITIAL_ROOMS_24,
  DECK26_STAGE7A_CATEGORIES,
  DECK26_STAGE7A_MENU_93,
  DECK26_INITIAL_FISCAL_ESTABLISHMENTS
} from '@deck26/contracts';

describe('DECK 26 — Etapa 7A: Bateria de Testes Automatizados (Hotel 24 Qts, Cardápio 93 Prods, Simulação Fiscal)', () => {
  it('1. Estrutura dos 24 Apartamentos: 12 operacionais e 12 em construção carregados', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const rooms = store.listHotelRooms();
    expect(rooms.length).toBe(24);

    const operationalRooms = rooms.filter(r => r.commercialStatus === 'OPERACIONAL');
    const underConstructionRooms = rooms.filter(r => r.commercialStatus === 'EM_CONSTRUCAO');

    expect(operationalRooms.length).toBe(12);
    expect(underConstructionRooms.length).toBe(12);

    // Confere se apartamentos em construção têm nomes e avisos de reforma
    const room108 = rooms.find(r => r.number === '108');
    expect(room108).toBeDefined();
    expect(room108?.commercialStatus).toBe('EM_CONSTRUCAO');
    expect(room108?.name).toContain('Obra');

    await app.close();
  });

  it('2. Bloqueio Comercial: apartamento em construção rejeita criação de reserva', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const underConstRoom = store.listHotelRooms().find(r => r.commercialStatus === 'EM_CONSTRUCAO')!;
    expect(underConstRoom).toBeDefined();

    const guest = store.createHotelGuest({
      fullName: 'Cliente Tentando Reservar Obra',
      documentType: 'CPF',
      documentNumber: '999.888.777-66',
      operatorUserId: 'usr-manager-01'
    });

    const checkInDate = '2026-12-01';
    const checkOutDate = '2026-12-05';

    // Tentativa direta no store passando o número do quarto em construção
    expect(() => {
      store.createHotelReservation({
        guestId: guest.id,
        roomNumber: underConstRoom.number,
        checkInDate,
        checkOutDate,
        dailyRateCents: 15000,
        sourceChannel: 'WHATSAPP',
        operatorUserId: 'usr-manager-01'
      });
    }).toThrow(/está em construção/);

    await app.close();
  });

  it('3. Bloqueio Operacional: apartamento em construção rejeita check-in direto', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const underConstRoom = store.listHotelRooms().find(r => r.commercialStatus === 'EM_CONSTRUCAO')!;

    const guest = store.createHotelGuest({
      fullName: 'Hóspede Tentando Check-in Obra',
      documentType: 'RG',
      documentNumber: '1234567-SSP',
      operatorUserId: 'usr-manager-01'
    });

    expect(() => {
      store.checkInHotelStay({
        guestId: guest.id,
        roomNumber: underConstRoom.number,
        checkOutScheduledAt: '2026-12-02T12:00:00.000Z',
        dailyRateCents: 16000,
        operatorUserId: 'usr-manager-01',
        operatorName: 'Gerente Milla'
      });
    }).toThrow(/está em construção/);

    await app.close();
  });

  it('4. Cálculo de Ocupação Hoteleira: exclui estritamente quartos em construção do denominador', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Estado inicial: 12 operacionais livres, 12 em construção. Total no banco: 24
    expect(store.listHotelRooms().length).toBe(24);
    let metrics = store.getHotelDashboardMetrics();
    expect(metrics.totalRooms).toBe(12); // quartos operacionais
    expect(metrics.underConstructionRooms).toBe(12);
    expect(metrics.occupancyRatePercent).toBe(0);

    // Faz check-in em 3 quartos operacionais (101, 102, 103)
    const opRooms = store.listHotelRooms().filter(r => r.commercialStatus === 'OPERACIONAL');
    expect(opRooms.length).toBe(12);

    for (let i = 0; i < 3; i++) {
      const g = store.createHotelGuest({
        fullName: `Hóspede Teste ${i + 1}`,
        documentType: 'CPF',
        documentNumber: `111.222.333-0${i}`,
        operatorUserId: 'usr-manager-01'
      });
      store.checkInHotelStay({
        guestId: g.id,
        roomNumber: opRooms[i]!.number,
        checkOutScheduledAt: '2026-12-10T12:00:00.000Z',
        dailyRateCents: 18000,
        operatorUserId: 'usr-manager-01',
        operatorName: 'Gerente Milla'
      });
    }

    // 3 ocupados de 12 operacionais = 3/12 = 25% (e NÃO 3/24 = 12.5%)
    metrics = store.getHotelDashboardMetrics();
    expect(metrics.occupiedRooms).toBe(3);
    expect(metrics.underConstructionRooms).toBe(12);
    expect(metrics.occupancyRatePercent).toBe(25);

    // Confere se métricas executivas também excluem obras do denominador
    const execMetrics = store.getExecutiveDashboardMetrics();
    expect(execMetrics.currentOccupancyRatePercent).toBe(25);

    await app.close();
  });

  it('5. Customização Hoteleira: atualização de nome fantasia, fotos e alternância de status comercial', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const room101 = store.listHotelRooms().find(r => r.number === '101')!;
    expect(room101).toBeDefined();

    const updated = store.updateHotelRoom(room101.id, {
      name: 'Suíte Master Presidencial Deck',
      photos: ['/uploads/hotel/101-main.jpg', '/uploads/hotel/101-bathroom.jpg'],
      dailyRateCents: 35000
    }, 'usr-manager-01');

    expect(updated.name).toBe('Suíte Master Presidencial Deck');
    expect(updated.photos).toHaveLength(2);
    expect(updated.dailyRateCents).toBe(35000);

    // Alterna um quarto de EM_CONSTRUCAO para OPERACIONAL
    const room108 = store.listHotelRooms().find(r => r.number === '108')!;
    expect(room108.commercialStatus).toBe('EM_CONSTRUCAO');

    const activated108 = store.updateHotelRoom(room108.id, {
      name: 'Apartamento 108 Standard Superior',
      commercialStatus: 'OPERACIONAL',
      dailyRateCents: 16000
    }, 'usr-manager-01');

    expect(activated108.commercialStatus).toBe('OPERACIONAL');

    // Agora são 13 operacionais e 11 em construção
    const metrics = store.getHotelDashboardMetrics();
    expect(metrics.underConstructionRooms).toBe(11);
    expect(metrics.totalRooms).toBe(13);

    await app.close();
  });

  it('6. Catálogo Digital: exatamente 93 produtos nas 10 categorias', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const catalog = store.getCatalog({ includeInactive: true });
    const stage7Products = catalog.products.filter(p => p.dataSource === 'STAGE7A_CARDAPIO_DIGITAL');
    expect(stage7Products.length).toBe(93);

    // Distribuição exata nas 10 categorias
    const countByCategory: Record<string, number> = {};
    for (const p of stage7Products) {
      countByCategory[p.categoryId] = (countByCategory[p.categoryId] || 0) + 1;
    }

    expect(countByCategory['cat-executivos']).toBe(11);
    expect(countByCategory['cat-tapioca']).toBe(7);
    expect(countByCategory['cat-qualquer-hora']).toBe(7);
    expect(countByCategory['cat-cuscuz']).toBe(7);
    expect(countByCategory['cat-pasteis']).toBe(8);
    expect(countByCategory['cat-lanches']).toBe(9);
    expect(countByCategory['cat-petiscos']).toBe(21);
    expect(countByCategory['cat-cafeteria']).toBe(7);
    expect(countByCategory['cat-sucos']).toBe(9);
    expect(countByCategory['cat-vitaminas']).toBe(7);

    // Soma exata = 93
    const total = Object.values(countByCategory).reduce((acc, v) => acc + v, 0);
    expect(total).toBe(93);

    await app.close();
  });

  it('7. Idempotência do Catálogo: nova chamada de seed não duplica itens', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const before = store.getCatalog({ includeInactive: true }).products.filter(p => p.dataSource === 'STAGE7A_CARDAPIO_DIGITAL').length;
    expect(before).toBe(93);

    // Executa a carga idempotente novamente
    (store as any).seedBaseCatalogAndInfrastructure();

    const after = store.getCatalog({ includeInactive: true }).products.filter(p => p.dataSource === 'STAGE7A_CARDAPIO_DIGITAL').length;
    expect(after).toBe(93);
    expect(store.listHotelRooms().length).toBe(24);

    await app.close();
  });

  it('8. Ficha e Classificação Fiscal do Cardápio: pendência e campos NCM/CFOP/CSOSN', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const products = store.getCatalog({ includeInactive: true }).products;

    // Item específico com verificação de nomenclatura pendente
    const pendingItem = products.find(p => p.sku === 'D26-CZ-005');
    expect(pendingItem).toBeDefined();
    expect(pendingItem?.name).toContain('Cuscuz de Carne de Sol');
    expect(pendingItem?.verificationPending).toContain('CONFIRMAR_NOMENCLATURA');

    // Valida classificação fiscal de produtos de bar e cozinha
    const cafeExpresso = products.find(p => p.sku === 'D26-CF-001')!;
    expect(cafeExpresso.ncm).toBe('0901.21.00');
    expect(cafeExpresso.cfop).toBe('5.102');
    expect(cafeExpresso.csosn).toBe('102');
    expect(cafeExpresso.prepStation).toBe('BAR_DRINKS');

    const filhote = products.find(p => p.sku === 'D26-EX-004')!;
    expect(filhote.ncm).toBe('2106.90.90');
    expect(filhote.prepStation).toBe('KITCHEN_HOT');

    await app.close();
  });

  it('9. Multi-estabelecimento Fiscal: Restaurante e Hotel possuem CNPJs e inscrições distintas', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const establishments = store.listFiscalEstablishments();
    expect(establishments.length).toBe(2);

    const restaurant = establishments.find(e => e.segment === 'RESTAURANT')!;
    expect(restaurant).toBeDefined();
    expect(restaurant.cnpj).toBe('12345678000190');
    expect(restaurant.code).toBe('RESTAURANTE');

    const hotel = establishments.find(e => e.segment === 'HOTEL')!;
    expect(hotel).toBeDefined();
    expect(hotel.cnpj).toBe('12345678000271');
    expect(hotel.code).toBe('HOTEL');
    expect(hotel.inscricaoMunicipal).toBe('554433');

    await app.close();
  });

  it('10. Simulação Fiscal NFC-e para Comanda do Restaurante: gera documento simulado com marca d água', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Abre mesa com comanda
    const { tab } = store.openTable({
      tableNumber: 15,
      customerName: 'Carlos Visitante Demo'
    });

    const products = store.getCatalog({ includeInactive: true }).products;
    const prod1 = products.find(p => p.sku === 'D26-EX-005')!; // Peito de Frango R$ 26,00
    const prod2 = products.find(p => p.sku === 'D26-SC-002')!; // Suco Acerola R$ 6,00

    store.createOrder({
      idempotencyKey: 'ord-sim-01',
      tabId: tab.id,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      waiterUserId: 'usr-waiter-01',
      items: [
        { productId: prod1.id, quantity: 2, notes: '' },
        { productId: prod2.id, quantity: 2, notes: 'Sem açúcar' }
      ]
    });

    // Subtotal com serviço = 11000 centavos
    const fiscalDoc = store.simulateFiscalDocumentEmission({
      documentType: 'NFCE',
      originReferenceType: 'TAB',
      originReferenceId: tab.id,
      customerTaxId: '123.456.789-00',
      customerName: 'Carlos Visitante Demo',
      operatorUserId: 'usr-cashier-01'
    });

    expect(fiscalDoc.status).toBe('SIMULATED_DEMO');
    expect(fiscalDoc.documentType).toBe('NFCE');
    expect(fiscalDoc.accessKey).toMatch(/^\d{44}$/);
    expect(fiscalDoc.watermark).toBe('SEM VALIDADE FISCAL - DEMO');
    expect(fiscalDoc.netTotalCents).toBe(11000);
    expect(fiscalDoc.itemsSummary.length).toBe(2);
    expect(fiscalDoc.establishmentCnpj).toBe('12345678000190');

    // Confere via API HTTP
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/fiscal/documents/${fiscalDoc.id}`,
      headers: { authorization: `Bearer ${signSessionToken({ userId: 'usr-manager-01', name: 'Gerente', role: 'MANAGER', issuedAt: Date.now() })}` }
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().fiscalDocument.id).toBe(fiscalDoc.id);

    await app.close();
  });

  it('11. Simulação Fiscal NFS-e para Hospedagem Hotel: emite com CNPJ do hotel e diárias', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({
      fullName: 'Dra. Maria Hóspede Executiva',
      documentType: 'CPF',
      documentNumber: '333.444.555-66',
      operatorUserId: 'usr-manager-01'
    });

    const opRoom = store.listHotelRooms().find(r => r.number === '201')!;

    const { stay } = store.checkInHotelStay({
      guestId: guest.id,
      roomNumber: opRoom.number,
      checkInAt: '2026-11-05T12:00:00.000Z',
      checkOutScheduledAt: '2026-11-10T12:00:00.000Z',
      dailyRateCents: 22000,
      operatorUserId: 'usr-manager-01',
      operatorName: 'Gerente Milla'
    });

    const fiscalDoc = store.simulateFiscalDocumentEmission({
      documentType: 'NFSE',
      originReferenceType: 'STAY',
      originReferenceId: stay.id,
      customerTaxId: guest.documentNumber,
      customerName: guest.fullName,
      operatorUserId: 'usr-manager-01'
    });

    expect(fiscalDoc.status).toBe('SIMULATED_DEMO');
    expect(fiscalDoc.documentType).toBe('NFSE');
    expect(fiscalDoc.watermark).toBe('SEM VALIDADE FISCAL - DEMO');
    expect(fiscalDoc.establishmentCnpj).toBe('12345678000271');
    expect(fiscalDoc.netTotalCents).toBe(110000);
    expect(fiscalDoc.itemsSummary[0]?.name).toContain('Diária');

    await app.close();
  });

  it('12. Distinção Fiscal: Pré-conta de conferência gera comprovante sem valor fiscal', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const { tab } = store.openTable({
      tableNumber: 8,
      customerName: 'Cliente Pré-Conta'
    });

    const products = store.getCatalog({ includeInactive: true }).products;
    const prod = products.find(p => p.sku === 'D26-LN-001')!; // Pão com Ovo R$ 6,00
    store.createOrder({
      idempotencyKey: 'ord-sim-02',
      tabId: tab.id,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      waiterUserId: 'usr-waiter-01',
      items: [{ productId: prod.id, quantity: 2 }]
    });

    const token = signSessionToken({ userId: 'usr-waiter-01', name: 'Garçom', role: 'WAITER', issuedAt: Date.now() });

    const preContaRes = await app.inject({
      method: 'POST',
      url: `/api/tabs/${tab.id}/pre-conta`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(preContaRes.statusCode).toBe(200);
    const body = preContaRes.json();
    expect(body.id).toBeDefined();
    expect(body.jobType).toBe('TAB_BILL_PREVIEW');
    expect(body.payloadText).toContain('CONFERÊNCIA DE CONTA');
    expect(body.payloadText).toContain('NÃO É DOCUMENTO FISCAL');

    await app.close();
  });

  it('13. Cancelamento Fiscal: cancela documento simulado e registra auditoria', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const { tab } = store.openTable({ tableNumber: 1, customerName: 'Cliente Cancelamento' });
    const products = store.getCatalog({ includeInactive: true }).products;
    const prod = products.find(p => p.sku === 'D26-PS-001')!; // Pastel Frango R$ 8,00
    store.createOrder({
      idempotencyKey: 'ord-sim-03',
      tabId: tab.id,
      channel: 'DINE_IN',
      originNode: 'WINDOWS_PDV',
      waiterUserId: 'usr-waiter-01',
      items: [{ productId: prod.id, quantity: 1 }]
    });

    const doc = store.simulateFiscalDocumentEmission({
      documentType: 'NFCE',
      originReferenceType: 'TAB',
      originReferenceId: tab.id,
      operatorUserId: 'usr-cashier-01'
    });
    expect(doc.status).toBe('SIMULATED_DEMO');

    const token = signSessionToken({ userId: 'usr-manager-01', name: 'Gerente', role: 'MANAGER', issuedAt: Date.now() });
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/fiscal/documents/${doc.id}/cancel`,
      headers: { authorization: `Bearer ${token}` },
      payload: { justification: 'Cliente desistiu do pedido no momento do pagamento' }
    });

    expect(cancelRes.statusCode).toBe(200);
    const cancelledDoc = cancelRes.json().fiscalDocument;
    expect(cancelledDoc.status).toBe('CANCELED');
    expect(cancelledDoc.cancellationReason).toBe('Cliente desistiu do pedido no momento do pagamento');
    expect(cancelledDoc.canceledAt).toBeDefined();

    await app.close();
  });
});
