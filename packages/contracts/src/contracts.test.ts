import { describe, expect, it } from 'vitest';
import {
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  SYSTEM_MODULES,
  calculateTabTotals,
  formatBrlCents,
  hasPermission
} from './index.js';

describe('@deck26/contracts — Contratos Compartilhados, Navegação e Cardápio Oficial', () => {
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

  it('valida o catálogo oficial extraído das artes do Deck 26 com preços exatos em centavos', () => {
    expect(DECK26_INITIAL_CATEGORIES).toHaveLength(4);
    expect(DECK26_INITIAL_PRODUCTS.length).toBeGreaterThanOrEqual(30);

    const caldoMacaxeira = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-caldo-macaxeira');
    expect(caldoMacaxeira?.priceCents).toBe(1000); // R$ 10,00

    const salmao = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-exec-salmao');
    expect(salmao?.priceCents).toBe(5900); // R$ 59,00

    const parmegiana = DECK26_INITIAL_PRODUCTS.find((p) => p.id === 'prd-exec-parmegiana-classica');
    expect(parmegiana?.priceCents).toBe(5500); // R$ 55,00
  });

  it('aplica controle de acesso RBAC rigoroso por perfil operacional', () => {
    expect(hasPermission('OWNER', 'fiscal:configure')).toBe(true);
    expect(hasPermission('WAITER', 'orders:create')).toBe(true);
    expect(hasPermission('WAITER', 'fiscal:configure')).toBe(false);
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
          totalOrderCents: 5400, // R$ 54,00
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
