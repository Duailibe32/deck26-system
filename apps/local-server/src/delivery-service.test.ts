import { describe, it, expect, vi } from 'vitest';
import { deliveryServiceSchema, deliveryAvailability, deliveryStageAge, packageLabel } from './delivery-service.js';
import { lookupCep } from './delivery-cep.js';
describe('Disponibilidade do delivery e auxílio de endereço', () => {
  it('mantém a instalação existente aberta até configuração explícita', () => {
    expect(deliveryAvailability(deliveryServiceSchema.parse({})).open).toBe(true);
  });
  it('respeita abertura e fechamento exato no fuso de Fortaleza', () => {
    const c = deliveryServiceSchema.parse({
      enabled: true,
      hours: [{
        day: 5,
        open: 1080,
        close: 1380
      }]
    });
    expect(deliveryAvailability(c, new Date('2026-11-06T20:59Z')).open).toBe(false);
    expect(deliveryAvailability(c, new Date('2026-11-06T21:00Z')).open).toBe(true);
    expect(deliveryAvailability(c, new Date('2026-11-07T02:00Z')).open).toBe(false);
  });
  it('preserva janela que passa da meia-noite e respeita data fechada', () => {
    const c = deliveryServiceSchema.parse({
      enabled: true,
      hours: [{
        day: 5,
        open: 1200,
        close: 120
      }]
    });
    expect(deliveryAvailability(c, new Date('2026-11-07T04:00Z')).open).toBe(true);
    expect(deliveryAvailability(c, new Date('2026-11-07T05:00Z')).open).toBe(false);
    expect(deliveryAvailability({
      ...c,
      closedDates: ['2026-11-07']
    }, new Date('2026-11-07T04:00Z')).reason).toBe('EXCEPTION');
  });
  it('fechamento manual prevalece sobre pausa e pausa expira sem forçar fora do horário', () => {
    const c = deliveryServiceSchema.parse({
      mode: 'CLOSED',
      pausedUntil: '2026-11-06T15:00:00Z'
    });
    expect(deliveryAvailability(c, new Date('2026-11-06T14:00Z')).reason).toBe('MANUAL');
    expect(deliveryAvailability({
      ...c,
      mode: 'AUTO'
    }, new Date('2026-11-06T14:00Z')).reason).toBe('PAUSED');
    expect(deliveryAvailability({
      ...c,
      mode: 'AUTO'
    }, new Date('2026-11-06T15:00Z')).open).toBe(true);
    expect(deliveryAvailability({
      ...c,
      mode: 'AUTO',
      enabled: true
    }, new Date('2026-11-06T15:00Z')).open).toBe(false);
  });
  it('valida horários, limite de sugestões e SLA', () => {
    expect(() => deliveryServiceSchema.parse({
      hours: [{
        day: 0,
        open: 0,
        close: 0
      }]
    })).toThrow();
    expect(() => deliveryServiceSchema.parse({
      suggestionIds: Array(9).fill('id')
    })).toThrow();
    expect(() => deliveryServiceSchema.parse({
      slaMinutes: 0
    })).toThrow();
  });
  it('cronômetro não fica negativo e usa entrada na etapa', () => {
    expect(deliveryStageAge({
      createdAt: '2026-11-06T12:00Z',
      updatedAt: '2026-11-06T12:45Z'
    }, Date.parse('2026-11-06T13:00Z'))).toBe(15);
    expect(deliveryStageAge({
      createdAt: '2026-11-06T12:00Z',
      updatedAt: '2026-11-06T14:00Z'
    }, Date.parse('2026-11-06T13:00Z'))).toBe(0);
  });
  it('CEP inválido não faz chamada; consulta só envia CEP e filtra campos', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      logradouro: 'Rua teste',
      bairro: 'Centro',
      localidade: 'Cidade',
      uf: 'MA',
      secret: 'não devolver'
    })));
    await expect(lookupCep('../etc', fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const value = await lookupCep('65000000', fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://viacep.com.br/ws/65000000/json/');
    expect(value).toEqual({
      street: 'Rua teste',
      neighborhood: 'Centro',
      city: 'Cidade',
      state: 'MA'
    });
  });
  it('CEP inexistente e indisponibilidade permitem preenchimento manual', async () => {
    expect(await lookupCep('99999999', vi.fn().mockResolvedValue(new Response('{"erro":true}')))).toBeNull();
    await expect(lookupCep('65000000', vi.fn().mockRejectedValue(Error('offline')))).rejects.toThrow();
  });
  it('etiqueta identifica retirada e preserva observações sem controles da impressora', () => {
    const text = packageLabel({
      orderNumber: 7,
      customerName: 'Cliente\x1b',
      deliveryType: 'TAKEOUT'
    } as any, [{
      quantity: 2,
      productName: 'Café',
      notes: 'Sem açúcar',
      modifiers: [{
        optionName: 'Quente'
      }]
    }]);
    expect(text).toContain('RETIRADA NO BALCÃO');
    expect(text).toContain('2x Café');
    expect(text).toContain('Sem açúcar');
    expect(text).not.toContain('\x1b');
    expect(text).toContain('SIMULAÇÃO');
  });
});
