import React, { useEffect, useMemo, useState } from 'react';
import {
  CatalogCategory,
  CatalogProduct,
  DECK26_INITIAL_CATEGORIES,
  DECK26_INITIAL_PRODUCTS,
  DiningTableQr,
  SalesChannel,
  formatBrlCents,
  resolveChannelPriceCents
} from '@deck26/contracts';
import { Deck26Logo, MenuPriceBadge } from '@deck26/ui';

type WebPortalView = 'QR_MENU' | 'DELIVERY' | 'PICKUP' | 'HOTEL_RESERVAS' | 'OWNER_REMOTE';

interface WebCartItem {
  cartItemId: string;
  product: CatalogProduct;
  quantity: number;
  notes: string;
  modifiers: Array<{
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceDeltaCents: number;
  }>;
}

export const WebPortalApp: React.FC = () => {
  const localApiBase = useMemo(() => {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4000`;
  }, []);

  const cloudApiBase = useMemo(() => {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:4100`;
  }, []);

  const urlQrToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('qr');
  }, []);

  const [activeView, setActiveView] = useState<WebPortalView>('QR_MENU');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [categories, setCategories] = useState<CatalogCategory[]>(DECK26_INITIAL_CATEGORIES);
  const [products, setProducts] = useState<CatalogProduct[]>(
    DECK26_INITIAL_PRODUCTS.filter((p) => p.active && p.dataSource !== 'TEST_ONLY')
  );
  const [availableQrTables, setAvailableQrTables] = useState<DiningTableQr[]>([]);
  const [validatedQrTable, setValidatedQrTable] = useState<DiningTableQr | null>(null);
  const [selectedQrToken, setSelectedQrToken] = useState<string>(urlQrToken ?? '');

  const [customerName, setCustomerName] = useState<string>('');
  const [customerNotes, setCustomerNotes] = useState<string>('');
  const [cart, setCart] = useState<WebCartItem[]>([]);
  const [customizingProduct, setCustomizingProduct] = useState<CatalogProduct | null>(null);
  const [itemNotes, setItemNotes] = useState<string>('');
  const [selectedModIds, setSelectedModIds] = useState<Record<string, string[]>>({});

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [ownerOverview, setOwnerOverview] = useState<{
    totalEventsInCloud: number;
    currentCursor: number;
    recentEvents: Array<{
      cursorSeq: number;
      event: { id: string; entityType: string; originNode: string; createdAt: string };
    }>;
  }>({ totalEventsInCloud: 0, currentCursor: 0, recentEvents: [] });

  const currentChannel: SalesChannel =
    activeView === 'DELIVERY' ? 'DELIVERY' : activeView === 'PICKUP' ? 'PICKUP' : 'QR_TABLE';

  useEffect(() => {
    async function loadLiveCatalogAndQr() {
      try {
        if (urlQrToken) {
          const qrRes = await fetch(`${localApiBase}/api/public/qr-table/${urlQrToken}`);
          if (qrRes.ok) {
            const data = await qrRes.json();
            setValidatedQrTable(data.qrTable);
            setSelectedQrToken(data.qrTable.qrToken);
            setCategories(data.catalog.categories);
            setProducts(
              data.catalog.products.filter(
                (p: CatalogProduct) => p.active && p.dataSource !== 'TEST_ONLY'
              )
            );
            return;
          }
        }

        const stateRes = await fetch(`${localApiBase}/api/state`);
        if (stateRes.ok) {
          const snap = await stateRes.json();
          setCategories(snap.catalog.categories.filter((c: CatalogCategory) => c.active));
          setProducts(
            snap.catalog.products.filter(
              (p: CatalogProduct) => p.active && p.dataSource !== 'TEST_ONLY'
            )
          );
          if (snap.qrTables && snap.qrTables.length > 0) {
            setAvailableQrTables(snap.qrTables);
            if (!selectedQrToken) {
              setSelectedQrToken(snap.qrTables[4]?.qrToken ?? snap.qrTables[0].qrToken);
              setValidatedQrTable(snap.qrTables[4] ?? snap.qrTables[0]);
            }
          }
        }
      } catch {
        // Fallback para catálogo embutido caso servidor esteja offline
      }
    }
    loadLiveCatalogAndQr();
  }, [localApiBase, urlQrToken]);

  async function refreshOwnerOverview() {
    try {
      const res = await fetch(`${cloudApiBase}/api/owner/overview`);
      if (res.ok) {
        const data = await res.json();
        setOwnerOverview(data);
      }
    } catch {
      // Silencioso
    }
  }

  useEffect(() => {
    if (activeView === 'OWNER_REMOTE') {
      refreshOwnerOverview();
    }
  }, [activeView]);

  function handleSelectProduct(product: CatalogProduct) {
    if (product.modifierGroups && product.modifierGroups.length > 0) {
      setCustomizingProduct(product);
      setItemNotes('');
      const defaults: Record<string, string[]> = {};
      for (const grp of product.modifierGroups) {
        if (grp.minSelect > 0 && grp.options[0]) {
          defaults[grp.id] = [grp.options[0].id];
        } else {
          defaults[grp.id] = [];
        }
      }
      setSelectedModIds(defaults);
      return;
    }
    addEntryToCart(product, [], '');
  }

  function addEntryToCart(
    product: CatalogProduct,
    modifiers: WebCartItem['modifiers'],
    notes: string
  ) {
    const sig = `${product.id}::${modifiers.map((m) => m.optionId).sort().join(',')}::${notes.trim()}`;
    setCart((prev) => {
      const found = prev.find((i) => i.cartItemId === sig);
      if (found) {
        return prev.map((i) => (i.cartItemId === sig ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          cartItemId: sig,
          product,
          quantity: 1,
          notes: notes.trim(),
          modifiers
        }
      ];
    });
    setCustomizingProduct(null);
  }

  function confirmProductModal() {
    if (!customizingProduct) return;
    const mods: WebCartItem['modifiers'] = [];
    for (const grp of customizingProduct.modifierGroups) {
      const chosen = selectedModIds[grp.id] ?? [];
      if (grp.required && chosen.length < grp.minSelect) {
        setStatusMessage(`Por favor, escolha pelo menos ${grp.minSelect} opção em "${grp.name}".`);
        return;
      }
      for (const id of chosen) {
        const opt = grp.options.find((o) => o.id === id);
        if (opt) {
          mods.push({
            groupId: grp.id,
            groupName: grp.name,
            optionId: opt.id,
            optionName: opt.name,
            priceDeltaCents: opt.priceDeltaCents
          });
        }
      }
    }
    addEntryToCart(customizingProduct, mods, itemNotes);
  }

  function updateQuantity(cartItemId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0)
    );
  }

  async function submitPublicOrder(channel: SalesChannel) {
    if (cart.length === 0) return;
    const effectiveName =
      customerName.trim() ||
      (channel === 'QR_TABLE'
        ? `Cliente ${validatedQrTable?.label ?? 'Mesa QR'}`
        : 'Cliente Digital Deck 26');

    const idempotencyKey = `web-${channel}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    try {
      // Quando em QR_TABLE e conectado ao servidor local na rede Wi-Fi, valida o QR Token diretamente e cria na comanda da mesa
      if (channel === 'QR_TABLE' && selectedQrToken) {
        const localQrRes = await fetch(`${localApiBase}/api/public/qr-orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey,
            qrToken: selectedQrToken,
            customerName: effectiveName,
            customerNotes: customerNotes || undefined,
            items: cart.map((c) => ({
              productId: c.product.id,
              quantity: c.quantity,
              notes: c.notes || undefined,
              modifiers: c.modifiers
            }))
          })
        });

        if (localQrRes.ok) {
          const data = await localQrRes.json();
          setCart([]);
          setStatusMessage(
            `Pedido #${data.order.id.slice(0, 8)} confirmado na Mesa ${data.order.tableNumber} (${data.order.status})! Comanda ${data.tab?.code ?? ''} atualizada e enviada para preparo.`
          );
          return;
        }
      }

      // Fallback / Delivery via VPS Cloud API
      const res = await fetch(`${cloudApiBase}/api/public/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          channel,
          tableNumber: validatedQrTable?.tableNumber ?? 5,
          qrToken: selectedQrToken || undefined,
          customerName: effectiveName,
          customerNotes: customerNotes || undefined,
          items: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
            notes: c.notes || undefined,
            modifiers: c.modifiers
          }))
        })
      });

      if (!res.ok) throw new Error('Não foi possível registrar o pedido no momento.');
      const data = await res.json();
      setCart([]);
      setStatusMessage(
        `Pedido #${data.order.id.slice(0, 8)} registrado com sucesso (Cursor #${data.cursorSeq}) e enfileirado para a Cozinha do Deck 26!`
      );
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Erro ao enviar pedido');
    }
  }

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.availableChannels.includes(currentChannel)) return false;
      if (selectedCategoryId !== 'ALL' && p.categoryId !== selectedCategoryId) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.description.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [products, currentChannel, selectedCategoryId, searchQuery]);

  const cartTotalCents = useMemo(() => {
    return cart.reduce((acc, c) => {
      const unitCents = resolveChannelPriceCents(c.product, currentChannel);
      const modCents = c.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
      return acc + (unitCents + modCents) * c.quantity;
    }, 0);
  }, [cart, currentChannel]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d26-black-950)', color: 'var(--d26-white)' }}>
      {/* HEADER RESPONSIVO PARA CELULAR (IPHONE / ANDROID) E DESKTOP */}
      <header
        style={{
          background: 'linear-gradient(90deg, #111111 0%, #1F082B 50%, #111111 100%)',
          borderBottom: '2px solid #F72585',
          padding: '14px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <Deck26Logo size={46} variant="pink-ring" showHotelSubtitle />

        <nav style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`d26-btn ${activeView === 'QR_MENU' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('QR_MENU')}
          >
            📱 Cardápio na Mesa (QR)
          </button>
          <button
            className={`d26-btn ${activeView === 'DELIVERY' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('DELIVERY')}
          >
            🛵 Delivery
          </button>
          <button
            className={`d26-btn ${activeView === 'PICKUP' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('PICKUP')}
          >
            🛍 Retirada no Balcão
          </button>
          <button
            className={`d26-btn ${activeView === 'HOTEL_RESERVAS' ? 'd26-btn-tertiary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('HOTEL_RESERVAS')}
          >
            🏨 Hotel Milla
          </button>
          <button
            className={`d26-btn ${activeView === 'OWNER_REMOTE' ? 'd26-btn-tertiary' : 'd26-btn-secondary'}`}
            onClick={() => setActiveView('OWNER_REMOTE')}
          >
            🔐 Proprietário
          </button>
        </nav>
      </header>

      {/* BANNER VISUAL INSPIRADO NO CARDÁPIO DIGITAL OFICIAL */}
      <section
        style={{
          background:
            'radial-gradient(circle at top right, rgba(247, 37, 133, 0.25), rgba(114, 9, 183, 0.2) 45%, transparent 75%), #111111',
          padding: '22px 20px',
          borderBottom: 'var(--d26-border-subtle)'
        }}
      >
        <div
          style={{
            maxWidth: '1220px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}
        >
          <div>
            <span className="d26-badge d26-badge-purple">
              HOTEL AUTO POSTO MILLA • HOTEL & CONVENIÊNCIA
            </span>
            <h1
              style={{
                fontSize: '1.85rem',
                fontWeight: 900,
                marginTop: '8px',
                letterSpacing: '-0.02em'
              }}
            >
              DECK <span style={{ color: '#F72585' }}>26</span> — CARDÁPIO DIGITAL OFICIAL
            </h1>
            <p
              style={{
                color: 'var(--d26-gray-300)',
                maxWidth: '680px',
                marginTop: '4px',
                fontSize: '0.9rem'
              }}
            >
              Para Qualquer Hora, Cuscuz Recheado, Tapioca Recheada e Pratos Executivos. Preços e disponibilidade integrados em tempo real com a cozinha e o estoque.
            </p>
          </div>
          {validatedQrTable && activeView === 'QR_MENU' && (
            <div
              className="d26-card"
              style={{
                border: '1px solid #F72585',
                padding: '10px 16px',
                background: 'rgba(247, 37, 133, 0.12)'
              }}
            >
              <div style={{ fontSize: '0.72rem', color: '#FFAFCC' }}>QR CODE SEGURO VALIDADO</div>
              <strong style={{ fontSize: '1.05rem' }}>{validatedQrTable.label}</strong>
            </div>
          )}
        </div>
      </section>

      <main style={{ maxWidth: '1220px', margin: '0 auto', padding: '20px' }}>
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
              alignItems: 'center',
              gap: '12px'
            }}
          >
            <span>{statusMessage}</span>
            <button className="d26-btn d26-btn-secondary" onClick={() => setStatusMessage(null)}>
              OK
            </button>
          </div>
        )}

        {/* MODAL DE PERSONALIZAÇÃO DE RECHEIO / ADICIONAIS NO CARDÁPIO DIGITAL */}
        {customizingProduct && (
          <div
            className="d26-card"
            style={{
              border: '2px solid #F72585',
              marginBottom: '20px',
              background: '#16161C',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem' }}>Escolha suas opções: {customizingProduct.name}</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--d26-gray-300)' }}>
                  {customizingProduct.description}
                </span>
              </div>
              <button
                className="d26-btn d26-btn-secondary"
                onClick={() => setCustomizingProduct(null)}
              >
                Fechar
              </button>
            </div>

            {customizingProduct.modifierGroups.map((grp) => {
              const chosen = selectedModIds[grp.id] ?? [];
              return (
                <div
                  key={grp.id}
                  style={{
                    background: 'var(--d26-black-900)',
                    padding: '10px 14px',
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{grp.name}</strong>
                    <span className="d26-badge d26-badge-outline-purple">
                      {grp.required ? `Escolha mín. ${grp.minSelect}` : 'Opcional'} (Máx {grp.maxSelect})
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {grp.options
                      .filter((o) => o.available !== false)
                      .map((opt) => {
                        const active = chosen.includes(opt.id);
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            className={`d26-btn ${active ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                            style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                            onClick={() => {
                              setSelectedModIds((prev) => {
                                const list = prev[grp.id] ?? [];
                                if (list.includes(opt.id)) {
                                  return { ...prev, [grp.id]: list.filter((x) => x !== opt.id) };
                                }
                                if (grp.maxSelect === 1) {
                                  return { ...prev, [grp.id]: [opt.id] };
                                }
                                if (list.length >= grp.maxSelect) return prev;
                                return { ...prev, [grp.id]: [...list, opt.id] };
                              });
                            }}
                          >
                            {active ? '✓ ' : '+ '}
                            {opt.name}
                            {opt.priceDeltaCents > 0 ? ` (+${formatBrlCents(opt.priceDeltaCents)})` : ''}
                          </button>
                        );
                      })}
                  </div>
                </div>
              );
            })}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                className="d26-input"
                style={{ flex: 1 }}
                placeholder="Observação deste item (ex: sem cebola, ponto da carne)..."
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
              />
              <button className="d26-btn d26-btn-primary" onClick={confirmProductModal}>
                Adicionar à Sacola
              </button>
            </div>
          </div>
        )}

        {(activeView === 'QR_MENU' || activeView === 'DELIVERY' || activeView === 'PICKUP') && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '22px'
            }}
          >
            {/* LISTA DE CATEGORIAS, BUSCA E PRODUTOS */}
            <div style={{ gridColumn: 'span 1' }}>
              <div style={{ marginBottom: '12px' }}>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="🔍 Buscar prato, tapioca, cuscuz ou ingrediente..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
                <button
                  className={`d26-btn ${selectedCategoryId === 'ALL' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  onClick={() => setSelectedCategoryId('ALL')}
                >
                  Todos ({filteredProducts.length})
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
                  const catProducts = filteredProducts.filter((p) => p.categoryId === cat.id);
                  if (catProducts.length === 0) return null;
                  return (
                    <div key={cat.id} className="d26-card" style={{ marginBottom: '18px' }}>
                      <h2
                        style={{
                          fontSize: '1.12rem',
                          fontWeight: 800,
                          color: '#F72585',
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          borderBottom: '1px solid rgba(114, 9, 183, 0.45)',
                          paddingBottom: '8px',
                          marginBottom: '12px'
                        }}
                      >
                        {cat.name}
                      </h2>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {catProducts.map((prod) => {
                          const effectivePrice = resolveChannelPriceCents(prod, currentChannel);
                          return (
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
                                <strong style={{ fontSize: '0.96rem', color: '#FFFFFF' }}>
                                  {prod.name}
                                </strong>
                                <div style={{ fontSize: '0.79rem', color: 'var(--d26-gray-300)' }}>
                                  ({prod.description})
                                </div>
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  flexShrink: 0
                                }}
                              >
                                <MenuPriceBadge cents={effectivePrice} />
                                <button
                                  className="d26-btn d26-btn-primary"
                                  style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                  onClick={() => handleSelectProduct(prod)}
                                >
                                  {prod.modifierGroups.length > 0 ? '+ Escolher' : '+ Pedir'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* SACOLA INTERATIVA DE AUTOATENDIMENTO QR CODE / DELIVERY / RETIRADA */}
            <div className="d26-card" style={{ height: 'fit-content', position: 'sticky', top: '20px' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '12px' }}>
                {activeView === 'QR_MENU'
                  ? '📱 Sua Sacola na Mesa (QR Code Seguro)'
                  : activeView === 'DELIVERY'
                    ? '🛵 Seu Pedido Delivery'
                    : '🛍 Seu Pedido para Retirada'}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
                {activeView === 'QR_MENU' && (
                  <div>
                    <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                      Identificador Seguro da Mesa (Token QR Criptográfico)
                    </label>
                    {urlQrToken ? (
                      <input
                        className="d26-input"
                        readOnly
                        value={
                          validatedQrTable
                            ? `${validatedQrTable.label} (Validado via QR)`
                            : `Token QR: ${urlQrToken}`
                        }
                      />
                    ) : (
                      <select
                        className="d26-select"
                        value={selectedQrToken}
                        onChange={(e) => {
                          setSelectedQrToken(e.target.value);
                          const found = availableQrTables.find((t) => t.qrToken === e.target.value);
                          if (found) setValidatedQrTable(found);
                        }}
                      >
                        {availableQrTables.length > 0 ? (
                          availableQrTables.map((t) => (
                            <option key={t.tableNumber} value={t.qrToken}>
                              {t.label} ({t.qrToken.slice(0, 14)}…)
                            </option>
                          ))
                        ) : (
                          <option value="">Mesa 05 — Salão Deck 26</option>
                        )}
                      </select>
                    )}
                  </div>
                )}
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Seu Nome *</label>
                  <input
                    className="d26-input"
                    placeholder="Ex: Carlos Eduardo"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                    {activeView === 'DELIVERY'
                      ? 'Endereço Completo de Entrega e Observações'
                      : 'Observações Gerais do Pedido'}
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
                  {cart.map((c) => {
                    const unit = resolveChannelPriceCents(c.product, currentChannel);
                    const modTotal = c.modifiers.reduce((s, m) => s + m.priceDeltaCents, 0);
                    return (
                      <div
                        key={c.cartItemId}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: 'var(--d26-black-900)',
                          padding: '8px 10px',
                          borderRadius: '8px',
                          fontSize: '0.84rem'
                        }}
                      >
                        <div>
                          <strong>
                            {c.quantity}x {c.product.name}
                          </strong>
                          {c.modifiers.length > 0 && (
                            <div style={{ fontSize: '0.74rem', color: '#FFAFCC' }}>
                              + {c.modifiers.map((m) => m.optionName).join(', ')}
                            </div>
                          )}
                          {c.notes && (
                            <div style={{ fontSize: '0.72rem', color: '#D8B4FE' }}>
                              Obs: {c.notes}
                            </div>
                          )}
                          <div style={{ fontSize: '0.76rem', color: 'var(--d26-gray-300)' }}>
                            {formatBrlCents((unit + modTotal) * c.quantity)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <button
                            className="d26-btn d26-btn-secondary"
                            style={{ padding: '3px 8px' }}
                            onClick={() => updateQuantity(c.cartItemId, -1)}
                          >
                            -
                          </button>
                          <span>{c.quantity}</span>
                          <button
                            className="d26-btn d26-btn-secondary"
                            style={{ padding: '3px 8px' }}
                            onClick={() => updateQuantity(c.cartItemId, 1)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '12px',
                  borderTop: 'var(--d26-border-subtle)',
                  paddingTop: '12px'
                }}
              >
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                    Total Confirmado
                  </span>
                  <div style={{ fontSize: '1.35rem', fontWeight: 900, color: '#F72585' }}>
                    {formatBrlCents(cartTotalCents)}
                  </div>
                </div>
                <button
                  className="d26-btn d26-btn-primary"
                  disabled={cart.length === 0}
                  onClick={() => submitPublicOrder(currentChannel)}
                >
                  Confirmar e Enviar Pedido
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
              Os hóspedes do Hotel Auto Posto Milla contam com integração direta de consumo: qualquer pedido realizado no restaurante Deck 26 pode ser lançado diretamente no Folio do Apartamento (<code>HOTEL_FOLIO</code>) com auditoria completa.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Standard Individual</strong>
                <div style={{ color: '#F72585', fontWeight: 800, marginTop: '4px' }}>R$ 130,00 / diária</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginTop: '6px' }}>
                  Ar-condicionado, Wi-Fi, estacionamento privativo e serviço de quarto Deck 26.
                </p>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Standard Casal / Duplo</strong>
                <div style={{ color: '#F72585', fontWeight: 800, marginTop: '4px' }}>R$ 170,00 / diária</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginTop: '6px' }}>
                  Conforto completo com comanda integrada ao restaurante e conveniência.
                </p>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <strong>Suíte Luxo Casal</strong>
                <div style={{ color: '#F72585', fontWeight: 800, marginTop: '4px' }}>R$ 210,00 / diária</div>
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
                <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                  EVENTOS CONSOLIDADOS NA VPS
                </span>
                <div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{ownerOverview.totalEventsInCloud}</div>
              </div>
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>
                  CURSOR MONOTÔNICO ATUAL
                </span>
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
                    <td style={{ fontFamily: 'var(--d26-font-mono)', fontSize: '0.76rem' }}>
                      {item.event.id}
                    </td>
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
