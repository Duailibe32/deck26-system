import { describe, expect, it } from 'vitest';
import {
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  SYSTEM_MODULES,
  calculateGrossMarginPercent,
  calculateTabTotals,
  formatBrlCents,
  hasPermission,
  resolveChannelPriceCents
} from './index.js';

describe('@deck26/contracts — Contratos Compartilhados, Navegação e Cardápio Oficial (Etapa 3)', () => {
  it('contém exatamente os 16 módulos arquiteturais exigidos', () => {
    expect(SYSTEM_MODULES).toHaveLength(16);
    const ids = SYSTEM_MODULES.map((m) => m.id);
    expect(ids).toEqual([
      'dashboard',
      'caixa-pdv',
      'mesas-comandas',
      'pedidos',
      'garcons',
      'cozinha',
      'produtos-cardapio',
      'estoque',
      'hotel-reservas',
      'financeiro',
      'relatorios',
      'funcionarios',
      'administracao',
      'impressoras',
      'configuracoes-fiscais',
      'sincronizacao'
    ]);
  });

  it('valida o catálogo oficial extraído das artes do Deck 26 e separa itens OFFICIAL_MENU de TEST_ONLY', () => {
    expect(DECK26_INITIAL_CATEGORIES).toHaveLength(6);
    expect(DECK26_INITIAL_PRODUCTS.length).toBeGreaterThanOrEqual(34);

    const officialProducts = DECK26_INITIAL_PRODUCTS.filter((p) => p.dataSource !== 'TEST_ONLY');
    const testOnlyProducts = DECK26_INITIAL_PRODUCTS.filter((p) => p.dataSource === 'TEST_ONLY');

    expect(officialProducts).toHaveLength(32);
    expect(testOnlyProducts).toHaveLength(3);

    const caldoMacaxeira = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-caldo-macaxeira');
    expect(caldoMacaxeira?.priceCents).toBe(1000); // R$ 10,00

    const salmao = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-exec-salmao');
    expect(salmao?.priceCents).toBe(5900); // R$ 59,00

    const picanha = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-esp-picanha');
    expect(picanha?.priceCents).toBe(12000); // R$ 120,00
    expect(picanha?.dataSource).toBe('TEST_ONLY');
  });

  it('calcula margem bruta percentual e resolve preços específicos por canal de venda', () => {
    expect(calculateGrossMarginPercent(10000, 4000)).toBe(60);

    const baseProd = DECK26_INITIAL_PRODUCTS[0]!;
    const prodWithChannelOverride = {
      ...baseProd,
      priceCents: 3000,
      channelPricesCents: {
        DELIVERY: 3400,
        HOTEL_ROOM: 3500
      }
    };

    expect(resolveChannelPriceCents(prodWithChannelOverride, 'DINE_IN')).toBe(3000);
    expect(resolveChannelPriceCents(prodWithChannelOverride, 'QR_TABLE')).toBe(3000);
    expect(resolveChannelPriceCents(prodWithChannelOverride, 'DELIVERY')).toBe(3400);
    expect(resolveChannelPriceCents(prodWithChannelOverride, 'HOTEL_ROOM')).toBe(3500);
  });

  it('aplica controle de acesso RBAC rigoroso por perfil operacional', () => {
    expect(hasPermission('OWNER', 'fiscal:configure')).toBe(true);
    expect(hasPermission('WAITER', 'orders:create')).toBe(true);
    expect(hasPermission('WAITER', 'catalog:manage')).toBe(false);
    expect(hasPermission('WAITER', 'stock:adjust')).toBe(false);
    expect(hasPermission('KITCHEN', 'orders:advance_kitchen')).toBe(true);
    expect(hasPermission('KITCHEN', 'pos:operate')).toBe(false);
  });

  it('calcula subtotal, taxa de serviço de 10% e saldo de comanda em centavos inteiros sem erro de ponto flutuante', () => {
    const totals = calculateTabTotals({
      orders: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          tabId: '550e8400-e29b-41d4-a716-446655440001',
          channel: 'DINE_IN',
          originNode: 'WAITER_MOBILE',
          idempotencyKey: 'idem-test-001',
          status: 'RECEIVED',
          items: [],
          totalOrderCents: 5400,
          createdAt: '2026-11-03T12:00:00.000Z',
          updatedAt: '2026-11-03T12:00:00.000Z',
          version: 1
        }
      ],
      serviceFeeEnabled: true,
      serviceFeeBasisPoints: 1000,
      discountCents: 0,
      paidCents: 2000
    });

    expect(totals.subtotalCents).toBe(5400);
    expect(totals.serviceFeeCents).toBe(540);
    expect(totals.totalCents).toBe(5940);
    expect(totals.remainingCents).toBe(3940);
    expect(formatBrlCents(totals.totalCents)).toBe('R$ 59,40');
  });
});
