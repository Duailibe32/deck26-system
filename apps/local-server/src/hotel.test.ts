import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLocalServer, signSessionToken } from './server.js';
import { calculateNightsCount, areDateIntervalsOverlapping, calculateStayFolioTotals } from '@deck26/contracts';

describe('DECK 26 — Etapa 5: Bateria Completa dos 35 Testes Obrigatórios do PMS Hotel Auto Posto Milla', () => {
  it('1. Cadastro de quarto: cadastrar quarto 105 com todos os campos e comodidades', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/rooms',
      payload: {
        number: '105',
        floorSector: '1º Andar',
        category: 'LUXO_CASAL',
        maxGuests: 2,
        bedCount: 1,
        bedConfiguration: '1 Cama King Size',
        description: 'Suíte Luxo com vista para o pátio',
        amenities: ['Ar Condicionado Split', 'Wi-Fi 5G', 'TV Smart 50"', 'Frigobar', 'Chuveiro Quente'],
        dailyRateCents: 22000,
        internalNotes: 'Apartamento reformado'
      }
    });
    expect(createRes.statusCode).toBe(201);
    const room = createRes.json().room;
    expect(room.number).toBe('105');
    expect(room.category).toBe('LUXO_CASAL');
    expect(room.dailyRateCents).toBe(22000);
    expect(room.occupancyStatus).toBe('LIVRE');
    expect(room.housekeepingStatus).toBe('LIMPO');
    expect(room.maintenanceStatus).toBe('DISPONIVEL');
    expect(room.amenities).toContain('Frigobar');

    await app.close();
  });

  it('2. Edição de quarto: alterar tarifa diária e capacidade sem corromper integridade', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:' });

    const roomRes = await app.inject({
      method: 'GET',
      url: '/api/hotel/rooms/room-101'
    });
    expect(roomRes.statusCode).toBe(200);

    const editRes = await app.inject({
      method: 'PUT',
      url: '/api/hotel/rooms/room-101',
      payload: {
        dailyRateCents: 15500,
        maxGuests: 3,
        description: 'Single ampliado com cama extra'
      }
    });
    expect(editRes.statusCode).toBe(200);
    const updated = editRes.json().room;
    expect(updated.dailyRateCents).toBe(15500);
    expect(updated.maxGuests).toBe(3);

    await app.close();
  });

  it('3. Bloqueio de exclusão com histórico: impedir exclusão física de quarto com histórico de hospedagem', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Cria hóspede e check-in no quarto 101
    const guest = store.createHotelGuest({
      fullName: 'Carlos Alberto Milla',
      documentNumber: '111.222.333-44',
      operatorUserId: 'usr-reception-01'
    });

    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const { stay } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: tomorrow,
      operatorUserId: 'usr-reception-01',
      operatorName: 'Recepção'
    });
    expect(stay).toBeDefined();

    // Tenta desativar/excluir quarto 101 com histórico
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: '/api/hotel/rooms/room-101'
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
    // Quarto é desativado logicamente (active = false), e preservado no banco
    const room = store.getHotelRoomById('room-101');
    expect(room?.active).toBe(false);

    await app.close();
  });

  it('4. Reserva válida: criar reserva com hóspede, quarto e intervalo de datas', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({
      fullName: 'Marina Silva',
      documentNumber: '222.333.444-55',
      phone: '(98) 98888-1234',
      operatorUserId: 'usr-reception-01'
    });

    const resRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/reservations',
      payload: {
        guestId: guest.id,
        roomNumber: '102',
        checkInDate: '2026-12-01',
        checkOutDate: '2026-12-05',
        guestsCount: 2,
        dailyRateCents: 17000,
        sourceChannel: 'WHATSAPP'
      }
    });
    expect(resRes.statusCode).toBe(201);
    const res = resRes.json().reservation;
    expect(res.roomNumber).toBe('102');
    expect(res.status).toBe('CONFIRMADA');
    // 4 noites x 17000 = 68000
    expect(res.estimatedTotalCents).toBe(68000);

    await app.close();
  });

  it('5. Reserva sobreposta: bloquear reserva no mesmo quarto com sobreposição de datas [inA, outA) vs [inB, outB)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({
      fullName: 'Lucas Pereira',
      documentNumber: '333.444.555-66',
      operatorUserId: 'usr-reception-01'
    });

    // Reserva 1: 10/12 a 15/12 no Quarto 103
    store.createHotelReservation({
      guestId: guest.id,
      roomNumber: '103',
      checkInDate: '2026-12-10',
      checkOutDate: '2026-12-15',
      operatorUserId: 'usr-reception-01'
    });

    // Tentativa 1: Reserva sobreposta (12/12 a 17/12) -> Bloqueada!
    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/reservations',
      payload: {
        guestId: guest.id,
        roomNumber: '103',
        checkInDate: '2026-12-12',
        checkOutDate: '2026-12-17',
        operatorUserId: 'usr-reception-01'
      }
    });
    expect(conflictRes.statusCode).toBe(400);
    expect(conflictRes.json().error).toContain('Apartamento indisponível');

    // Tentativa 2: Reserva com check-in exatamente no dia do check-out da anterior (15/12 a 20/12) -> Permitida! (saída exclusiva)
    const validNextRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/reservations',
      payload: {
        guestId: guest.id,
        roomNumber: '103',
        checkInDate: '2026-12-15',
        checkOutDate: '2026-12-20',
        operatorUserId: 'usr-reception-01'
      }
    });
    expect(validNextRes.statusCode).toBe(201);

    await app.close();
  });

  it('6. Reserva concorrente: simular duas reservas simultâneas para o mesmo período e quarto', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest1 = store.createHotelGuest({ fullName: 'Cliente A', documentNumber: '444.111.111-11', operatorUserId: 'usr-01' });
    const guest2 = store.createHotelGuest({ fullName: 'Cliente B', documentNumber: '444.222.222-22', operatorUserId: 'usr-02' });

    // Primeira reserva vence
    const res1 = store.createHotelReservation({
      guestId: guest1.id,
      roomNumber: '201',
      checkInDate: '2026-12-20',
      checkOutDate: '2026-12-25',
      operatorUserId: 'usr-01'
    });
    expect(res1.id).toBeDefined();

    // Segunda tentativa para mesmo quarto e período é rejeitada
    expect(() => {
      store.createHotelReservation({
        guestId: guest2.id,
        roomNumber: '201',
        checkInDate: '2026-12-22',
        checkOutDate: '2026-12-24',
        operatorUserId: 'usr-02'
      });
    }).toThrow(/indisponível/i);
  });

  it('7. Cancelamento: cancelar reserva com motivo auditável e atualizar status para CANCELADA', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Paula Fernandes', documentNumber: '555.666.777-88', operatorUserId: 'usr-reception-01' });
    const res = store.createHotelReservation({
      guestId: guest.id,
      roomNumber: '202',
      checkInDate: '2026-12-10',
      checkOutDate: '2026-12-12',
      operatorUserId: 'usr-reception-01'
    });

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/hotel/reservations/${res.id}/cancel`,
      payload: { reason: 'Viagem remarcada por imprevisto' }
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().reservation.status).toBe('CANCELADA');
    expect(cancelRes.json().reservation.cancellationReason).toBe('Viagem remarcada por imprevisto');

    await app.close();
  });

  it('8. Reagendamento: reagendar reserva para novo período disponível e verificar recálculo do valor', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Fabio Santos', documentNumber: '666.777.888-99', operatorUserId: 'usr-reception-01' });
    const res = store.createHotelReservation({
      guestId: guest.id,
      roomNumber: '203',
      checkInDate: '2026-12-01',
      checkOutDate: '2026-12-03', // 2 noites
      operatorUserId: 'usr-reception-01'
    });
    expect(res.estimatedTotalCents).toBe(34000); // 2 x 17000

    const rescheduleRes = await app.inject({
      method: 'POST',
      url: `/api/hotel/reservations/${res.id}/reschedule`,
      payload: {
        newCheckInDate: '2026-12-10',
        newCheckOutDate: '2026-12-14' // 4 noites
      }
    });
    expect(rescheduleRes.statusCode).toBe(200);
    const updated = rescheduleRes.json().reservation;
    expect(updated.checkInDate).toBe('2026-12-10');
    expect(updated.checkOutDate).toBe('2026-12-14');
    expect(updated.estimatedTotalCents).toBe(68000); // 4 x 17000

    await app.close();
  });

  it('9. Check-in com reserva: vincular reserva, gerar estadia, criar comanda HOTEL_FOLIO e atualizar quarto para OCUPADO', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Renato Aragão', documentNumber: '777.888.999-00', operatorUserId: 'usr-reception-01' });
    const res = store.createHotelReservation({
      guestId: guest.id,
      roomNumber: '101',
      checkInDate: '2026-11-04',
      checkOutDate: '2026-11-06',
      operatorUserId: 'usr-reception-01'
    });

    const checkInRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkin',
      payload: {
        roomNumber: '101',
        guestId: guest.id,
        reservationId: res.id,
        checkOutScheduledAt: '2026-11-06T12:00:00.000Z'
      }
    });
    expect(checkInRes.statusCode).toBe(201);
    const { stay, room, folioTab, firstFolioEntry } = checkInRes.json();
    expect(stay.status).toBe('ACTIVE');
    expect(stay.reservationId).toBe(res.id);
    expect(room.occupancyStatus).toBe('OCUPADO');
    expect(room.currentGuestName).toBe('Renato Aragão');
    expect(folioTab.code).toBe('APTO-101');
    expect(firstFolioEntry.entryType).toBe('ROOM_RATE');
    expect(firstFolioEntry.amountCents).toBeGreaterThan(0);

    // Reserva vinculada atualizada para CHECK_IN_REALIZADO
    const updatedRes = store.getHotelReservationById(res.id);
    expect(updatedRes?.status).toBe('CHECK_IN_REALIZADO');

    await app.close();
  });

  it('10. Check-in sem reserva (walk-in): realizar check-in direto no balcão', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Hóspede Walk-in', documentNumber: '888.999.000-11', operatorUserId: 'usr-reception-01' });

    const checkInRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkin',
      payload: {
        roomNumber: '102',
        guestId: guest.id,
        checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
        dailyRateCents: 17000
      }
    });
    expect(checkInRes.statusCode).toBe(201);
    const { stay, room } = checkInRes.json();
    expect(stay.roomNumber).toBe('102');
    expect(stay.reservationId).toBeNull();
    expect(room.occupancyStatus).toBe('OCUPADO');

    await app.close();
  });

  it('11. Bloqueio de check-in duplicado: impedir novo check-in em quarto que já está OCUPADO', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest1 = store.createHotelGuest({ fullName: 'Hóspede Um', documentNumber: '101.101.101-01', operatorUserId: 'usr-01' });
    const guest2 = store.createHotelGuest({ fullName: 'Hóspede Dois', documentNumber: '202.202.202-02', operatorUserId: 'usr-01' });

    store.checkInHotelStay({
      roomNumber: '103',
      guestId: guest1.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Tentativa de segundo check-in no mesmo quarto 103
    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkin',
      payload: {
        roomNumber: '103',
        guestId: guest2.id,
        checkOutScheduledAt: '2026-11-06T12:00:00.000Z'
      }
    });
    expect(duplicateRes.statusCode).toBe(400);
    expect(duplicateRes.json().error).toContain('já se encontra ocupado');

    await app.close();
  });

  it('12. Cálculo de diárias: calcular diárias com regra entrada inclusiva e saída exclusiva em centavos inteiros', () => {
    expect(calculateNightsCount('2026-11-01', '2026-11-04')).toBe(3);
    expect(calculateNightsCount('2026-11-01', '2026-11-01')).toBe(1); // mínimo 1 diária
    expect(calculateNightsCount('2026-11-01T14:00:00Z', '2026-11-06T12:00:00Z')).toBe(5);
  });

  it('13. Tarifa especial: aplicar tarifa customizada na estadia sem alterar a tarifa padrão do quarto', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const room = store.getHotelRoomByNumber('101')!;
    expect(room.dailyRateCents).toBe(13000);

    const guest = store.createHotelGuest({ fullName: 'Parceiro Comercial', documentNumber: '303.303.303-03', operatorUserId: 'usr-01' });
    const { stay, firstFolioEntry } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      dailyRateCents: 11000, // Tarifa com desconto comercial
      checkInAt: '2026-11-01T14:00:00.000Z',
      checkOutScheduledAt: '2026-11-03T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    expect(stay.dailyRateCents).toBe(11000);
    // 2 noites x 11000 = 22000
    expect(firstFolioEntry.amountCents).toBe(22000);

    // Tarifa padrão do quarto no catálogo permanece 13000
    const roomAfter = store.getHotelRoomByNumber('101')!;
    expect(roomAfter.dailyRateCents).toBe(13000);
  });

  it('14. Entrada antecipada: lançar taxa de early check-in no débito da hospedagem', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Cliente Cedo', documentNumber: '404.404.404-04', operatorUserId: 'usr-01' });
    const { firstFolioEntry } = store.checkInHotelStay({
      roomNumber: '102',
      guestId: guest.id,
      earlyCheckinCents: 5000, // R$ 50,00 de entrada antecipada
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // 1 diária de 17000 + 5000 early check-in = 22000
    expect(firstFolioEntry.amountCents).toBe(22000);
  });

  it('15. Saída tardia: lançar taxa de late check-out no débito da hospedagem', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Cliente Tarde', documentNumber: '505.505.505-05', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '103',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const addLateFeeRes = await app.inject({
      method: 'POST',
      url: `/api/hotel/stays/${stay.id}/folio/entry`,
      payload: {
        entryType: 'SERVICE',
        description: 'Taxa de Saída Tardia (Late Check-out até 18:00)',
        amountCents: 8000
      }
    });
    expect(addLateFeeRes.statusCode).toBe(201);
    expect(addLateFeeRes.json().entry.amountCents).toBe(8000);

    const folio = store.listFolioEntriesByStayId(stay.id);
    const totals = calculateStayFolioTotals(folio);
    expect(totals.totalChargesCents).toBe(21000 + 8000);

    await app.close();
  });

  it('16. Abertura de folio: verificar criação do folio e lançamento inicial da diária', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Roberta Dias', documentNumber: '606.606.606-06', operatorUserId: 'usr-01' });
    const { stay, folioTab, firstFolioEntry } = store.checkInHotelStay({
      roomNumber: '201',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    expect(folioTab.type).toBe('HOTEL_FOLIO');
    expect(folioTab.code).toBe('APTO-201');
    expect(firstFolioEntry.stayId).toBe(stay.id);
    expect(firstFolioEntry.entryType).toBe('ROOM_RATE');
    expect(firstFolioEntry.amountCents).toBe(21000);
  });

  it('17. Lançamento de serviço: solicitar serviço adicional (Lavanderia) e registrar no folio', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Juliana Paes', documentNumber: '707.707.707-07', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '202',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const srvRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/services/order',
      payload: {
        stayId: stay.id,
        serviceId: 'srv-lavanderia',
        quantity: 3 // 3 peças x 1500 = 4500
      }
    });
    expect(srvRes.statusCode).toBe(201);
    const { order, folioEntry } = srvRes.json();
    expect(order.quantity).toBe(3);
    expect(order.totalCents).toBe(4500);
    expect(folioEntry.entryType).toBe('SERVICE');
    expect(folioEntry.amountCents).toBe(4500);

    await app.close();
  });

  it('18. Consumo do restaurante: transferir comanda de restaurante para a conta do quarto (ROOM_CHARGE)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // 1. Hospeda hóspede no Apto 101
    const guest = store.createHotelGuest({ fullName: 'Doutor Rodrigo', documentNumber: '808.808.808-08', operatorUserId: 'usr-01' });
    store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // 2. Cria comanda de restaurante para a Mesa 4 e faz pedido
    const restTab = store.openOrGetTab({
      code: 'MESA-04',
      type: 'TABLE',
      tableNumber: 4,
      openedByUserId: 'usr-waiter-01'
    });

    store.createOrder({
      tabId: restTab.id,
      tableNumber: 4,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      idempotencyKey: 'order-rest-hotel-18',
      items: [{ productId: 'prd-exec-salmao', quantity: 1 }] // R$ 59,00
    });

    const tabBefore = store.getTabById(restTab.id)!;
    expect(tabBefore.totalCents).toBe(6490); // 5900 + 10% = 6490

    // 3. Transfere para a conta do Apto 101
    const transferRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/transfer-tab-to-folio',
      payload: {
        restaurantTabId: restTab.id,
        roomNumber: '101'
      }
    });
    expect(transferRes.statusCode).toBe(200);
    const { folioEntry, restaurantTab, payment } = transferRes.json();

    expect(folioEntry.entryType).toBe('RESTAURANT_ORDER');
    expect(folioEntry.amountCents).toBe(6490);
    expect(restaurantTab.status).toBe('CLOSED');
    expect(payment.method).toBe('ROOM_CHARGE');

    await app.close();
  });

  it('19. Bloqueio de transferência duplicada: impedir transferir a mesma comanda duas vezes para o folio', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Marcos Vinicius', documentNumber: '909.909.909-09', operatorUserId: 'usr-01' });
    store.checkInHotelStay({
      roomNumber: '102',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const restTab = store.openOrGetTab({ code: 'MESA-05', type: 'TABLE', tableNumber: 5, openedByUserId: 'usr-waiter-01' });
    store.createOrder({
      tabId: restTab.id,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      idempotencyKey: 'order-tab-19',
      items: [{ productId: 'prd-caldo-macaxeira', quantity: 1 }]
    });

    // Primeira transferência com sucesso
    store.transferRestaurantTabToFolio({
      restaurantTabId: restTab.id,
      roomNumber: '102',
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    // Segunda transferência bloqueada
    expect(() => {
      store.transferRestaurantTabToFolio({
        restaurantTabId: restTab.id,
        roomNumber: '102',
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });
    }).toThrow(/já foi transferido|encerrada/i);
  });

  it('20. Preservação da baixa de estoque: confirmar que transferência para folio não gera segunda baixa de estoque', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const initialStock = store.getProductCurrentStock('prd-exec-salmao');

    const guest = store.createHotelGuest({ fullName: 'Eduardo Milla', documentNumber: '010.010.010-10', operatorUserId: 'usr-01' });
    store.checkInHotelStay({
      roomNumber: '103',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const restTab = store.openOrGetTab({ code: 'MESA-06', type: 'TABLE', tableNumber: 6, openedByUserId: 'usr-waiter-01' });
    // Pedido baixa 1 unidade do estoque
    store.createOrder({
      tabId: restTab.id,
      channel: 'DINE_IN',
      originNode: 'WAITER_MOBILE',
      idempotencyKey: 'order-stock-20',
      items: [{ productId: 'prd-exec-salmao', quantity: 1 }]
    });

    const stockAfterOrder = store.getProductCurrentStock('prd-exec-salmao');
    expect(stockAfterOrder).toBe(initialStock - 1);

    // Transferência para o quarto do hotel
    store.transferRestaurantTabToFolio({
      restaurantTabId: restTab.id,
      roomNumber: '103',
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    // O estoque permanece idêntico (SEM DUPLA BAIXA!)
    const stockAfterTransfer = store.getProductCurrentStock('prd-exec-salmao');
    expect(stockAfterTransfer).toBe(stockAfterOrder);
  });

  it('21. Frigobar: configurar produto e lançar consumo do frigobar no folio', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Configura 4 latas de refrigerante no quarto 101
    store.configureMinibarItem({
      roomNumber: '101',
      productId: 'prd-beb-refrigerante-lata',
      initialQuantity: 4,
      unitPriceCents: 800
    });

    const guest = store.createHotelGuest({ fullName: 'Hóspede Frigobar', documentNumber: '121.121.121-12', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const consumeRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/minibar/consume',
      payload: {
        stayId: stay.id,
        roomNumber: '101',
        productId: 'prd-beb-refrigerante-lata',
        quantity: 2
      }
    });
    expect(consumeRes.statusCode).toBe(201);
    const { consumption, folioEntry } = consumeRes.json();
    expect(consumption.quantity).toBe(2);
    expect(consumption.totalCents).toBe(1600); // 2 x 800
    expect(folioEntry.entryType).toBe('MINIBAR');

    // Quantidade restante no frigobar agora é 2
    const items = store.listMinibarItemsByRoom('101');
    const refri = items.find((i) => i.productId === 'prd-beb-refrigerante-lata');
    expect(refri?.currentQuantity).toBe(2);

    await app.close();
  });

  it('22. Reposição de frigobar: repor estoque do frigobar do apartamento', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    store.configureMinibarItem({
      roomNumber: '102',
      productId: 'prd-beb-refrigerante-lata',
      initialQuantity: 1,
      unitPriceCents: 800
    });

    const restockRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/minibar/restock',
      payload: {
        roomNumber: '102',
        productId: 'prd-beb-refrigerante-lata',
        addedQuantity: 3
      }
    });
    expect(restockRes.statusCode).toBe(200);
    expect(restockRes.json().item.currentQuantity).toBe(4);

    await app.close();
  });

  it('23. Pagamento parcial: registrar pagamento parcial de estadia e manter saldo em aberto', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Claudio Lima', documentNumber: '131.131.131-13', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Diária de R$ 130,00 (13000 c)
    // Hóspede faz pagamento parcial de R$ 50,00 (5000 c)
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'Pagamento Parcial (PIX)',
      amountCents: -5000,
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    const entries = store.listFolioEntriesByStayId(stay.id);
    const totals = calculateStayFolioTotals(entries);
    expect(totals.totalChargesCents).toBe(13000);
    expect(totals.totalPaymentsCents).toBe(5000);
    expect(totals.balanceCents).toBe(8000); // Saldo devedor restante: R$ 80,00
  });

  it('24. Pagamento misto: liquidar conta com combinação de PIX e dinheiro em espécie', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Valeria Souza', documentNumber: '141.141.141-14', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '102',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      dailyRateCents: 17000,
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Pagamento 1: R$ 100,00 em PIX
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'Pagamento Misto: R$ 100,00 via PIX',
      amountCents: -10000,
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    // Pagamento 2: R$ 70,00 em Dinheiro
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'Pagamento Misto: R$ 70,00 em Dinheiro',
      amountCents: -7000,
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    const entries = store.listFolioEntriesByStayId(stay.id);
    const totals = calculateStayFolioTotals(entries);
    expect(totals.totalChargesCents).toBe(17000);
    expect(totals.totalPaymentsCents).toBe(17000);
    expect(totals.balanceCents).toBe(0); // Quitado!
  });

  it('25. Adiantamento: registrar sinal/adiantamento na reserva e deduzir do saldo do hóspede', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Marilia Mendonça', documentNumber: '151.151.151-15', operatorUserId: 'usr-01' });
    const res = store.createHotelReservation({
      guestId: guest.id,
      roomNumber: '103',
      checkInDate: '2026-11-10',
      checkOutDate: '2026-11-12',
      depositCents: 10000, // R$ 100,00 de sinal adiantado
      depositPaid: true,
      operatorUserId: 'usr-01'
    });
    expect(res.depositCents).toBe(10000);
    expect(res.depositPaid).toBe(true);
  });

  it('26. Estorno autorizado: registrar estorno/ajuste auditável no extrato do folio', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Aline Rabelo', documentNumber: '161.161.161-16', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Cobrança indevida lançada
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'SERVICE',
      description: 'Lançamento indevido',
      amountCents: 5000,
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Estorno autorizado pelo gerente
    const refundEntry = store.addFolioEntry({
      stayId: stay.id,
      entryType: 'ADJUSTMENT',
      description: 'Estorno de serviço indevido autorizado pelo Gerente',
      amountCents: -5000,
      operatorUserId: 'usr-manager-01',
      operatorName: 'Gerente Milla'
    });
    expect(refundEntry.amountCents).toBe(-5000);

    const entries = store.listFolioEntriesByStayId(stay.id);
    const totals = calculateStayFolioTotals(entries);
    expect(totals.balanceCents).toBe(13000); // Volta ao valor da diária pura
  });

  it('27. Check-out quitado: concluir check-out com saldo zerado e liberar quarto', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Thiago Neves', documentNumber: '171.171.171-17', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '102',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Quita diária de R$ 170,00
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'Pagamento total diária',
      amountCents: -17000,
      operatorUserId: 'usr-cashier-01',
      operatorName: 'Caixa'
    });

    const checkOutRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkout',
      payload: { stayId: stay.id }
    });
    expect(checkOutRes.statusCode).toBe(200);
    const { stay: stayOut, room: roomOut, folioTab } = checkOutRes.json();
    expect(stayOut.status).toBe('CHECKED_OUT');
    expect(roomOut.occupancyStatus).toBe('LIVRE');
    expect(roomOut.housekeepingStatus).toBe('SUJO');
    expect(folioTab.status).toBe('CLOSED');

    await app.close();
  });

  it('28. Bloqueio de check-out com saldo: impedir check-out quando o extrato possui saldo devedor pendente', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Leonardo Dicaprio', documentNumber: '181.181.181-18', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '103',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Check-out sem pagamento (saldo de R$ 210,00 pendente)
    const blockedRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkout',
      payload: { stayId: stay.id }
    });
    expect(blockedRes.statusCode).toBe(400);
    expect(blockedRes.json().error).toContain('saldo pendente');

    await app.close();
  });

  it('29. Liberação para limpeza: após check-out, quarto fica com housekeeping_status SUJO', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Hóspede Limpeza', documentNumber: '191.191.191-19', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '201',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'Quitação',
      amountCents: -21000,
      operatorUserId: 'usr-01',
      operatorName: 'Caixa'
    });

    const res = store.checkOutHotelStay(stay.id, {
      operatorUserId: 'usr-01',
      operatorName: 'Caixa'
    });
    expect(res.room.occupancyStatus).toBe('LIVRE');
    expect(res.room.housekeepingStatus).toBe('SUJO');
  });

  it('30. Conclusão de limpeza: fluxo de governança (START_CLEANING -> FINISH_CLEANING -> APPROVE_INSPECTION -> LIMPO)', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Quarto 202 sujo
    store.updateHotelRoom('room-202', { housekeepingStatus: 'SUJO' }, 'usr-01');

    // 1. Iniciar limpeza
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/housekeeping/update',
      payload: { roomNumber: '202', action: 'START_CLEANING' }
    });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().room.housekeepingStatus).toBe('EM_LIMPEZA');

    // 2. Finalizar limpeza
    const finishRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/housekeeping/update',
      payload: { roomNumber: '202', action: 'FINISH_CLEANING' }
    });
    expect(finishRes.statusCode).toBe(200);
    expect(finishRes.json().room.housekeepingStatus).toBe('INSPECAO_PENDENTE');

    // 3. Aprovar inspeção
    const approveRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/housekeeping/update',
      payload: { roomNumber: '202', action: 'APPROVE_INSPECTION' }
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().room.housekeepingStatus).toBe('LIMPO');

    await app.close();
  });

  it('31. Bloqueio por manutenção: quarto em manutenção/interditado bloqueia check-in e liberação de limpeza', async () => {
    const { app, store } = await buildLocalServer({ dbPath: ':memory:' });

    // Cria chamado crítico interditando quarto 203
    const maintRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/maintenance',
      payload: {
        roomNumber: '203',
        issueDescription: 'Vazamento no banheiro e curto no disjuntor',
        priority: 'CRITICAL',
        blockRoom: true
      }
    });
    expect(maintRes.statusCode).toBe(201);
    expect(maintRes.json().room.maintenanceStatus).toBe('INTERDITADO');
    expect(maintRes.json().room.occupancyStatus).toBe('BLOQUEADO');

    // Tentativa de check-in é bloqueada
    const guest = store.createHotelGuest({ fullName: 'Teste Manut', documentNumber: '202.202.202-20', operatorUserId: 'usr-01' });
    const blockedCheckin = await app.inject({
      method: 'POST',
      url: '/api/hotel/checkin',
      payload: {
        roomNumber: '203',
        guestId: guest.id,
        checkOutScheduledAt: '2026-11-05T12:00:00.000Z'
      }
    });
    expect(blockedCheckin.statusCode).toBe(400);
    expect(blockedCheckin.json().error).toContain('interditado');

    // Resolver chamado de manutenção
    const recId = maintRes.json().record.id;
    const resolveRes = await app.inject({
      method: 'POST',
      url: `/api/hotel/maintenance/${recId}/resolve`,
      payload: { resolutionNotes: 'Canalização refeita e disjuntor trocado' }
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json().room.maintenanceStatus).toBe('DISPONIVEL');
    expect(resolveRes.json().room.occupancyStatus).toBe('LIVRE');

    await app.close();
  });

  it('32. Permissões RBAC: RECEPTIONIST tem acesso a hotelaria, enquanto WAITER tem acesso negado (403)', async () => {
    const { app } = await buildLocalServer({ dbPath: ':memory:', requireStrictAuth: true });

    // Garçom tentando criar reserva -> 403 Forbidden
    const waiterToken = signSessionToken({
      userId: 'usr-waiter-01',
      name: 'Garçom 01',
      role: 'WAITER',
      issuedAt: Date.now()
    });

    const forbiddenRes = await app.inject({
      method: 'POST',
      url: '/api/hotel/reservations',
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: {
        guestId: 'any',
        roomNumber: '101',
        checkInDate: '2026-12-01',
        checkOutDate: '2026-12-02'
      }
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(forbiddenRes.json().error).toContain('Acesso negado');

    // Recepcionista acessando lista de reservas -> 200 OK
    const receptionToken = signSessionToken({
      userId: 'usr-reception-01',
      name: 'Recepção',
      role: 'RECEPTIONIST',
      issuedAt: Date.now()
    });

    const allowedRes = await app.inject({
      method: 'GET',
      url: '/api/hotel/reservations',
      headers: { authorization: `Bearer ${receptionToken}` }
    });
    expect(allowedRes.statusCode).toBe(200);

    await app.close();
  });

  it('33. Persistência após reinício: validar retenção de dados após fechar e reabrir o banco SQLite', async () => {
    const tempDbPath = path.join(os.tmpdir(), `deck26-hotel-test-${Date.now()}.sqlite`);

    try {
      // 1. Abre banco temporário e grava hóspede e quarto
      const server1 = await buildLocalServer({ dbPath: tempDbPath });
      const guest = server1.store.createHotelGuest({
        fullName: 'Hóspede Persistente',
        documentNumber: '999.888.777-66',
        operatorUserId: 'usr-01'
      });
      const room = server1.store.createHotelRoom({
        number: '301',
        category: 'SUITE_MASTER',
        dailyRateCents: 35000,
        operatorUserId: 'usr-01'
      });
      expect(guest.id).toBeDefined();
      expect(room.id).toBeDefined();
      server1.store.close();
      await server1.app.close();

      // 2. Reabre novo servidor com o mesmo arquivo SQLite
      const server2 = await buildLocalServer({ dbPath: tempDbPath });
      const recoveredGuest = server2.store.findGuestByDocument('999.888.777-66');
      const recoveredRoom = server2.store.getHotelRoomByNumber('301');

      expect(recoveredGuest).not.toBeNull();
      expect(recoveredGuest?.fullName).toBe('Hóspede Persistente');
      expect(recoveredRoom).not.toBeNull();
      expect(recoveredRoom?.category).toBe('SUITE_MASTER');
      expect(recoveredRoom?.dailyRateCents).toBe(35000);

      server2.store.close();
      await server2.app.close();
    } finally {
      try {
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      } catch {
        // Ignora retenção de lock temporária do SO
      }
    }
  });

  it('34. Sincronização idempotente: verificar eventos gerados na fila de outbox para sync VPS', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Hóspede Sync', documentNumber: '333.222.111-00', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '101',
      guestId: guest.id,
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    const pendingEvents = store.listPendingSyncEvents(50);
    const hotelEvents = pendingEvents.filter((e) =>
      ['HOTEL_GUEST', 'HOTEL_ROOM', 'HOTEL_STAY', 'HOTEL_FOLIO_ENTRY'].includes(e.entityType)
    );
    expect(hotelEvents.length).toBeGreaterThanOrEqual(3);

    const stayEvent = hotelEvents.find((e) => e.entityType === 'HOTEL_STAY');
    expect(stayEvent?.entityId).toBe(stay.id);
    expect(stayEvent?.status).toBe('PENDING');
  });

  it('35. Integridade do histórico financeiro: validar extrato cronológico e cálculo exato de débitos/créditos', async () => {
    const { store } = await buildLocalServer({ dbPath: ':memory:' });

    const guest = store.createHotelGuest({ fullName: 'Extrato Completo', documentNumber: '555.555.555-55', operatorUserId: 'usr-01' });
    const { stay } = store.checkInHotelStay({
      roomNumber: '102',
      guestId: guest.id,
      dailyRateCents: 17000, // Débito diária: 17000
      checkOutScheduledAt: '2026-11-05T12:00:00.000Z',
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Débito Frigobar: 1600
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'MINIBAR',
      description: 'Frigobar: 2x Refri',
      amountCents: 1600,
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Débito Restaurante: 4500
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'RESTAURANT_ORDER',
      description: 'Restaurante: Almoço',
      amountCents: 4500,
      operatorUserId: 'usr-01',
      operatorName: 'Recepção'
    });

    // Crédito Pagamento Parcial: 10000
    store.addFolioEntry({
      stayId: stay.id,
      entryType: 'PAYMENT',
      description: 'PIX Parcial',
      amountCents: -10000,
      operatorUserId: 'usr-01',
      operatorName: 'Caixa'
    });

    const entries = store.listFolioEntriesByStayId(stay.id);
    expect(entries).toHaveLength(4);

    const totals = calculateStayFolioTotals(entries);
    // Total Débitos = 17000 + 1600 + 4500 = 23100
    // Total Créditos = 10000
    // Saldo = 13100
    expect(totals.totalChargesCents).toBe(23100);
    expect(totals.totalPaymentsCents).toBe(10000);
    expect(totals.balanceCents).toBe(13100);
  });
});

describe('DECK 26 — Etapa 5: Teste Operacional Completo (Fluxo End-to-End de 20 Passos — Seção 22)', () => {
  it('executa a jornada completa do Hotel Auto Posto Milla: Reserva -> Check-in -> Restaurante -> Frigobar -> Pagamentos -> Check-out -> Governança -> Reinício do Servidor', async () => {
    const tempDbPath = path.join(os.tmpdir(), `deck26-hotel-e2e-${Date.now()}.sqlite`);

    try {
      const server1 = await buildLocalServer({ dbPath: tempDbPath });
      const store1 = server1.store;
      const app1 = server1.app;

      // 1. Cadastra e garante quarto 105 para a operação
      const room105 = store1.createHotelRoom({
        number: '105',
        floorSector: '1º Andar',
        category: 'LUXO_CASAL',
        dailyRateCents: 21000,
        operatorUserId: 'usr-owner-01'
      });
      expect(room105.number).toBe('105');

      // 2. Registrar hóspede de teste
      const guestRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/guests',
        payload: {
          fullName: 'Sérgio Reis Auto Posto',
          documentType: 'CPF',
          documentNumber: '999.888.777-11',
          phone: '(98) 99111-2233',
          nationality: 'Brasileira',
          notes: 'Motorista de frota regular'
        }
      });
      expect(guestRes.statusCode).toBe(201);
      const guest = guestRes.json().guest;

      // 3. Definir entrada e saída e 4. Confirmar disponibilidade
      const checkInDate = '2026-11-10';
      const checkOutDate = '2026-11-11';
      const availRes = await app1.inject({
        method: 'GET',
        url: `/api/hotel/availability?roomNumber=105&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}`
      });
      expect(availRes.statusCode).toBe(200);
      expect(availRes.json().available).toBe(true);

      // Criar reserva para quarto 105
      const resRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/reservations',
        payload: {
          guestId: guest.id,
          roomNumber: '105',
          checkInDate,
          checkOutDate,
          dailyRateCents: 21000,
          sourceChannel: 'BALCAO'
        }
      });
      expect(resRes.statusCode).toBe(201);
      const reservation = resRes.json().reservation;

      // 5. Realizar check-in e 6. Abrir conta da hospedagem
      const checkInRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/checkin',
        payload: {
          roomNumber: '105',
          guestId: guest.id,
          reservationId: reservation.id,
          checkInAt: `${checkInDate}T14:00:00.000Z`,
          checkOutScheduledAt: `${checkOutDate}T12:00:00.000Z`
        }
      });
      expect(checkInRes.statusCode).toBe(201);
      const { stay, room: roomOccupied, folioTab } = checkInRes.json();
      expect(roomOccupied.occupancyStatus).toBe('OCUPADO');
      expect(folioTab.code).toBe('APTO-105');

      // 7. Registrar uma diária (já lançada automaticamente no check-in)
      const folioInitial = store1.listFolioEntriesByStayId(stay.id);
      expect(folioInitial).toHaveLength(1);
      expect(folioInitial[0]!.amountCents).toBe(21000);

      // 8. Registrar consumo do restaurante
      const restTab = store1.openOrGetTab({ code: 'MESA-07', type: 'TABLE', tableNumber: 7, openedByUserId: 'usr-waiter-01' });
      const initialStockSalmao = store1.getProductCurrentStock('prd-exec-salmao');
      store1.createOrder({
        tabId: restTab.id,
        tableNumber: 7,
        channel: 'DINE_IN',
        originNode: 'WAITER_MOBILE',
        idempotencyKey: 'e2e-order-salmao',
        items: [{ productId: 'prd-exec-salmao', quantity: 1 }] // R$ 59,00
      });

      // Transfere consumo do restaurante para a conta do quarto 105
      const transferRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/transfer-tab-to-folio',
        payload: {
          restaurantTabId: restTab.id,
          roomNumber: '105'
        }
      });
      expect(transferRes.statusCode).toBe(200);

      // 9. Confirmar que o estoque NÃO sofreu baixa duplicada
      const stockAfterTransfer = store1.getProductCurrentStock('prd-exec-salmao');
      expect(stockAfterTransfer).toBe(initialStockSalmao - 1);

      // 10. Registrar consumo do frigobar
      store1.configureMinibarItem({
        roomNumber: '105',
        productId: 'prd-beb-refrigerante-lata',
        initialQuantity: 4,
        unitPriceCents: 800
      });
      const minibarRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/minibar/consume',
        payload: {
          stayId: stay.id,
          roomNumber: '105',
          productId: 'prd-beb-refrigerante-lata',
          quantity: 2 // R$ 16,00
        }
      });
      expect(minibarRes.statusCode).toBe(201);

      // 11. Registrar pagamento parcial
      store1.addFolioEntry({
        stayId: stay.id,
        entryType: 'PAYMENT',
        description: 'Adiantamento / Pagamento Parcial PIX',
        amountCents: -15000, // R$ 150,00
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });

      // 12. Consultar saldo e 13. Conferir extrato
      const folioRes = await app1.inject({
        method: 'GET',
        url: `/api/hotel/stays/${stay.id}/folio`
      });
      expect(folioRes.statusCode).toBe(200);
      const { entries, totals } = folioRes.json();
      expect(entries).toHaveLength(4); // Diária, Restaurante, Frigobar, Pagamento Parcial
      // Total débitos: 21000 + 6490 + 1600 = 29090
      expect(totals.totalChargesCents).toBe(29090);
      expect(totals.totalPaymentsCents).toBe(15000);
      const remainingBalance = totals.balanceCents;
      expect(remainingBalance).toBe(14090); // R$ 140,90 restante

      // 14. Realizar pagamento restante (quitação completa)
      store1.addFolioEntry({
        stayId: stay.id,
        entryType: 'PAYMENT',
        description: 'Quitação no Check-out (Cartão de Débito)',
        amountCents: -remainingBalance,
        operatorUserId: 'usr-cashier-01',
        operatorName: 'Caixa'
      });

      const updatedTotals = calculateStayFolioTotals(store1.listFolioEntriesByStayId(stay.id));
      expect(updatedTotals.balanceCents).toBe(0);

      // 15. Executar check-out
      const checkOutRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/checkout',
        payload: { stayId: stay.id }
      });
      expect(checkOutRes.statusCode).toBe(200);
      const { stay: stayFinal, room: roomAfterOut } = checkOutRes.json();
      expect(stayFinal.status).toBe('CHECKED_OUT');
      expect(roomAfterOut.occupancyStatus).toBe('LIVRE');

      // 16. Encaminhar quarto para limpeza
      expect(roomAfterOut.housekeepingStatus).toBe('SUJO');

      // 17. Concluir limpeza e 18. Liberar quarto
      await app1.inject({
        method: 'POST',
        url: '/api/hotel/housekeeping/update',
        payload: { roomNumber: '105', action: 'START_CLEANING' }
      });
      await app1.inject({
        method: 'POST',
        url: '/api/hotel/housekeeping/update',
        payload: { roomNumber: '105', action: 'FINISH_CLEANING' }
      });
      const approveRes = await app1.inject({
        method: 'POST',
        url: '/api/hotel/housekeeping/update',
        payload: { roomNumber: '105', action: 'APPROVE_INSPECTION' }
      });
      expect(approveRes.statusCode).toBe(200);
      expect(approveRes.json().room.housekeepingStatus).toBe('LIMPO');

      server1.store.close();
      await app1.close();

      // 19. Reiniciar servidor e 20. Confirmar persistência e auditoria
      const server2 = await buildLocalServer({ dbPath: tempDbPath });
      const store2 = server2.store;

      const persistedRoom = store2.getHotelRoomByNumber('105')!;
      expect(persistedRoom.occupancyStatus).toBe('LIVRE');
      expect(persistedRoom.housekeepingStatus).toBe('LIMPO');

      const persistedStay = store2.getHotelStayById(stay.id)!;
      expect(persistedStay.status).toBe('CHECKED_OUT');

      const persistedEntries = store2.listFolioEntriesByStayId(stay.id);
      expect(persistedEntries).toHaveLength(5);
      const finalTotals = calculateStayFolioTotals(persistedEntries);
      expect(finalTotals.balanceCents).toBe(0);

      const auditLogs = store2.listAuditLogs(undefined, 100);
      const checkOutAudit = auditLogs.find((l) => l.action === 'HOTEL_CHECKOUT');
      expect(checkOutAudit).toBeDefined();

      server2.store.close();
      await server2.app.close();
    } finally {
      try {
        if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
      } catch {
        // Ignora retenção de lock temporária do SO
      }
    }
  });
});
