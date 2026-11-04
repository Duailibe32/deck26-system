import React, { useEffect, useMemo, useState } from 'react';
import {
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  SalesChannel,
  formatBrlCents
} from '@deck26/contracts';
import { Deck26Logo, MenuPriceBadge } from '@deck26/ui';

type WebPortalView = 'QR_MENU' | 'DELIVERY' | 'HOTEL_RESERVAS' | 'OWNER_REMOTE';

export const WebPortalApp: React.FC = () => {
  const cloudApiBase = useMemo(() => {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4100`;
  }, []);

  const [activeView, setActiveView] = useState<WebPortalView>('QR_MENU');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [tableNumber, setTableNumber] = useState<number>(4);
  const [customerName, setCustomerName] = useState<string>('');
  const [customerNotes, setCustomerNotes] = useState<string>('');
  const [cart, setCart] = useState<Array<{ product: CatalogProduct; quantity: number }>>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [ownerOverview, setOwnerOverview] = useState<{
    totalEventsInCloud: number;
    currentCursor: number;
    recentEvents: Array<{ cursorSeq: number; event: { id: string; entityType: string; originNode: string; createdAt: string } }>;
  }>({ totalEventsInCloud: 0, currentCursor: 0, recentEvents: [] });

  const categories: CatalogCategory[] = DECK26_INITIAL_CATEGORIES;
  const products: CatalogProduct[] = DECK26_INITIAL_PRODUCTS;

  async function refreshOwnerOverview() {
    try {
      const res = await fetch(`${cloudApiBase}/api/owner/overview`);
      if (res.ok) {
        const data = await res.json();
        setOwnerOverview(data);
      }
    } catch {
      // Silencioso se a Cloud API não estiver rodando localmente
    }
  }

  useEffect(() => {
    if (activeView === 'OWNER_REMOTE') {
      refreshOwnerOverview();
    }
  }, [activeView]);

  function addItem(product: CatalogProduct) {
    setCart((prev) => {
      const found = prev.find((i) => i.product.id === product.id);
      if (found) {
        return prev.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { product, quantity: 1 }];
    });
  }

  async function submitPublicOrder(channel: SalesChannel) {
    if (cart.length === 0) return;
    const effectiveName = customerName.trim() || (channel === 'QR_TABLE' ? `Cliente Mesa ${tableNumber}` : 'Cliente Delivery');

    try {
      const res = await fetch(`${cloudApiBase}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: `web-${channel}-${Date.now()}`,
          channel,
          tableNumber: channel === 'QR_TABLE' ? tableNumber : null,
          customerName: effectiveName,
          customerNotes: customerNotes || undefined,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity
          }))
        })
      });

      if (!res.ok) throw new Error('Cloud API indisponível no momento');
      const data = await res.json();
      setCart([]);
      setStatusMessage(
        `Pedido #${data.order.id.slice(0, 8)} registrado na VPS (Cursor #${data.cursorSeq}) e enfileirado para sincronização imediata com a Cozinha Local do Deck 26!`
      );
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Erro ao enviar pedido');
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d26-black-950)', color: 'var(--d26-white)' }}>
      {/* HEADER INSTITUCIONAL E DE NAVEGAÇÃO DO SITE (HOSTINGER VPS) */}
      <header
        style={{
          background: 'linear-gradient(90deg, #09090D 0%, #1A0510 50%, #09090D 100%)',
          borderBottom: '2px solid #E6005C',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px'
        }}
      >
        <Deck26Logo size={48} variant="pink-ring" showHotelSubtitle />

        <nav style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`d26-btn ${activeView === 'QR_MENU' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('QR_MENU')}
          >
            📱 Cardápio Digital (QR Mesa)
          </button>
          <button
            className={`d26-btn ${activeView === 'DELIVERY' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('DELIVERY')}
          >
            🛵 Delivery Deck 26
          </button>
          <button
            className={`d26-btn ${activeView === 'HOTEL_RESERVAS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('HOTEL_RESERVAS')}
          >
            🏨 Hotel Auto Posto Milla
          </button>
          <button
            className={`d26-btn ${activeView === 'OWNER_REMOTE' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('OWNER_REMOTE')}
          >
            🔐 Portal Remoto do Proprietário
          </button>
        </nav>
      </header>

      {/* BANNER VISUAL INSPIRADO NO CARDÁPIO DIGITAL OFICIAL ANEXADO */}
      <section
        style={{
          background: 'radial-gradient(circle at top right, rgba(230, 0, 92, 0.28), transparent 60%), #101016',
          padding: '28px 24px',
          borderBottom: 'var(--d26-border-subtle)'
        }}
      >
        <div style={{ maxWidth: '1220px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <span className="d26-badge d26-badge-pink">HOTEL AUTO POSTO MILLA • HOTEL & CONVENIÊNCIA</span>
            <h1 style={{ fontSize: '2rem', fontWeight: 900, marginTop: '8px', letterSpacing: '-0.02em' }}>
              DECK <span style={{ color: '#FF1F78' }}>26</span> — CARDÁPIO DIGITAL & GESTÃO CLOUD
            </h1>
            <p style={{ color: 'var(--d26-gray-300)', maxWidth: '680px', marginTop: '4px', fontSize: '0.92rem' }}>
              Refeições, Pratos Executivos, Tapiocas Recheadas, Cuscuz Recheado, Petiscos e Bebidas. Catálogo lógico único sincronizado em tempo real com o PDV e Cozinha local.
            </p>
          </div>
        </div>
      </section>

      <main style={{ maxWidth: '1220px', margin: '0 auto', padding: '24px' }}>
        {statusMessage && (
          <div
            style={{
              background: 'rgba(16, 185, 129, 0.16)',
              border: '1px solid #10B981',
              padding: '12px 16px',
              borderRadius: '10px',
              marginBottom: '18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>{statusMessage}</span>
            <button className="d26-btn d26-btn-secondary" onClick={() => setStatusMessage(null)}>
              OK
            </button>
          </div>
        )}

        {(activeView === 'QR_MENU' || activeView === 'DELIVERY') && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.45fr 1fr', gap: '22px' }}>
            {/* LISTA DE CATEGORIAS E PRODUTOS FIEIS ÀS ARTES DO CARDÁPIO */}
            <div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <button
                  className={`d26-btn ${selectedCategoryId === 'ALL' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setSelectedCategoryId('ALL')}
                >
                  Cardápio Completo ({products.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    className={`d26-btn ${selectedCategoryId === cat.id ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    onClick={() => setSelectedCategoryId(cat.id)}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {categories
                .filter((cat) => selectedCategoryId === 'ALL' || cat.id === selectedCategoryId)
                .map((cat) => {
                  const catProducts = products.filter((p) => p.categoryId === cat.id);
                  return (
                    <div key={cat.id} className="d26-card" style={{ marginBottom: '18px' }}>
                      <h2
                        style={{
                          fontSize: '1.15rem',
                          fontWeight: 900,
                          color: '#FF1F78',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          borderBottom: '1px solid rgba(230, 0, 92, 0.35)',
                          paddingBottom: '8px',
                          marginBottom: '12px'
                        }}
                      >
                        {cat.name}
                      </h2>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {catProducts.map((prod) => (
                          <div
                            key={prod.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              paddingBottom: '10px',
                              borderBottom: '1px dashed rgba(255, 255, 255, 0.08)',
                              gap: '12px'
                            }}
                          >
                            <div>
                              <strong style={{ fontSize: '0.98rem', color: '#FFFFFF' }}>{prod.name}</strong>
                              <div style={{ fontSize: '0.8rem', color: 'var(--d26-gray-300)' }}>({prod.description})</div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                              <MenuPriceBadge cents={prod.priceCents} />
                              <button
                                className="d26-btn d26-btn-secondary"
                                style={{ padding: '6px 12px' }}
                                onClick={() => addItem(prod)}
                              >
                                + Pedir
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* SACOLA DE AUTOATENDIMENTO QR CODE / DELIVERY */}
            <div className="d26-card" style={{ height: 'fit-content', position: 'sticky', top: '20px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>
                {activeView === 'QR_MENU' ? '📱 Seu Pedido na Mesa (QR Code)' : '🛵 Seu Pedido Delivery'}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                {activeView === 'QR_MENU' && (
                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Número da Mesa no Deck 26</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      className="d26-input"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(Number(e.target.value) || 1)}
                    />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Seu Nome</label>
                  <input
                    className="d26-input"
                    placeholder="Ex: Carlos Eduardo"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                    Observações (ex: Com manteiga, sem cebola, endereço se Delivery)
                  </label>
                  <input
                    className="d26-input"
                    placeholder="Observações para a cozinha..."
                    value={customerNotes}
                    onChange={(e) => setCustomerNotes(e.target.value)}
                  />
                </div>
              </div>

              {cart.length === 0 ? (
                <p style={{ fontSize: '0.84rem', color: 'var(--d26-gray-400)', margin: '14px 0' }}>
                  Toque em "+ Pedir" nos itens do cardápio para montar seu pedido.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '14px' }}>
                  {cart.map((c) => (
                    <div
                      key={c.product.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        background: 'var(--d26-black-900)',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        fontSize: '0.85rem'
                      }}
                    >
                      <span>
                        {c.quantity}x {c.product.name}
                      </span>
                      <strong>{formatBrlCents(c.product.priceCents * c.quantity)}</strong>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>Total do Pedido</span>
                  <div style={{ fontSize: '1.3rem', fontWeight: 900, color: '#FF1F78' }}>
                    {formatBrlCents(cart.reduce((acc, c) => acc + c.product.priceCents * c.quantity, 0))}
                  </div>
                </div>
                <button
                  className="d26-btn d26-btn-primary"
                  disabled={cart.length === 0}
                  onClick={() => submitPublicOrder(activeView === 'QR_MENU' ? 'QR_TABLE' : 'DELIVERY')}
                >
                  Enviar Pedido p/ Cozinha
                </button>
              </div>
            </div>
          </div>
        )}

        {activeView === 'HOTEL_RESERVAS' && (
          <div className="d26-card">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '8px' }}>
              Hotel Auto Posto Milla — Hospedagem & Conveniência Integrada ao Deck 26
            </h2>
            <p style={{ color: 'var(--d26-gray-300)', fontSize: '0.9rem', marginBottom: '16px' }}>
              Os hóspedes do Hotel Auto Posto Milla contam com integração direta de consumo: qualquer pedido realizado no
              restaurante Deck 26 pode ser lançado diretamente no Folio do Apartamento (`HOTEL_FOLIO`) com auditoria completa.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Standard Individual</strong>
                <div style={{ color: '#FF1F78', fontWeight: 800, marginTop: '4px' }}>R$ 130,00 / diária</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginTop: '6px' }}>
                  Ar-condicionado, Wi-Fi, estacionamento privativo e serviço de quarto Deck 26.
                </p>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Standard Casal / Duplo</strong>
                <div style={{ color: '#FF1F78', fontWeight: 800, marginTop: '4px' }}>R$ 170,00 / diária</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginTop: '6px' }}>
                  Conforto completo com comanda integrada ao restaurante e conveniência.
                </p>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Suíte Luxo Casal</strong>
                <div style={{ color: '#FF1F78', fontWeight: 800, marginTop: '4px' }}>R$ 210,00 / diária</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginTop: '6px' }}>
                  Amplo espaço, frigobar e atendimento prioritário no Deck 26.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeView === 'OWNER_REMOTE' && (
          <div className="d26-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h2 style={{ fontSize: '1.15rem' }}>
                  Painel Remoto do Proprietário (Hostinger VPS Cloud Ledger)
                </h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>
                  Monitoramento em tempo real dos eventos sincronizados pelo computador Windows do estabelecimento e pedidos digitais.
                </p>
              </div>
              <button className="d26-btn d26-btn-primary" onClick={refreshOwnerOverview}>
                ↻ Atualizar Ledger da Nuvem
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>EVENTOS CONSOLIDADOS NA VPS</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{ownerOverview.totalEventsInCloud}</div>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>CURSOR MONOTÔNICO ATUAL</span>
                <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>#{ownerOverview.currentCursor}</div>
              </div>
            </div>

            <table className="d26-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Cursor VPS</th>
                  <th>ID do Evento</th>
                  <th>Entidade</th>
                  <th>Nó de Origem</th>
                  <th>Data/Hora</th>
                </tr>
              </thead>
              <tbody>
                {ownerOverview.recentEvents.map((item) => (
                  <tr key={item.cursorSeq}>
                    <td>#{item.cursorSeq}</td>
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.76rem' }}>{item.event.id}</td>
                    <td>{item.event.entityType}</td>
                    <td>{item.event.originNode}</td>
                    <td>{new Date(item.event.createdAt).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};
