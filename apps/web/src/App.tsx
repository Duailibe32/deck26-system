import React, { useMemo, useState } from 'react';
import {
  CatalogCategory,
  CatalogProduct,
  DECK26_STAGE7A_CATEGORIES,
  DECK26_STAGE7A_MENU_93,
  DECK26_INITIAL_ROOMS_24,
  DECK26_INITIAL_FISCAL_ESTABLISHMENTS,
  formatBrlCents,
  PrepStation,
  RoomCommercialStatus,
  FiscalDocumentRecord
} from '@deck26/contracts';
import { Deck26Logo } from '@deck26/ui';

type CommercialDemoTab =
  | 'DASHBOARD'
  | 'CARDAPIO'
  | 'MESAS'
  | 'HOTEL'
  | 'DELIVERY'
  | 'FINANCEIRO'
  | 'FISCAL';

export const WebPortalApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<CommercialDemoTab>('DASHBOARD');

  // Filtros de Cardápio
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('ALL');
  const [cardapioSearch, setCardapioSearch] = useState<string>('');

  // Filtros de Hotel
  const [hotelFilter, setHotelFilter] = useState<'ALL' | 'OPERACIONAL' | 'EM_CONSTRUCAO'>('ALL');
  const [selectedRoomNumber, setSelectedRoomNumber] = useState<string | null>(null);
  const [simulatedCheckinAlert, setSimulatedCheckinAlert] = useState<string | null>(null);

  // Simulação de Mesas & Comanda
  const [selectedTableNumber, setSelectedTableNumber] = useState<number>(1);
  const [tableCart, setTableCart] = useState<Array<{ product: CatalogProduct; quantity: number }>>([
    { product: DECK26_STAGE7A_MENU_93[0]!, quantity: 2 },
    { product: DECK26_STAGE7A_MENU_93.find(p => p.sku === 'D26-SC-002') || DECK26_STAGE7A_MENU_93[85]!, quantity: 2 }
  ]);
  const [showPreContaModal, setShowPreContaModal] = useState<boolean>(false);

  // Simulação Fiscal
  const [selectedFiscalEstablishment, setSelectedFiscalEstablishment] = useState<'RESTAURANTE' | 'HOTEL'>('RESTAURANTE');
  const [simulatedFiscalDoc, setSimulatedFiscalDoc] = useState<FiscalDocumentRecord | null>(null);
  const [fiscalCustomerTaxId, setFiscalCustomerTaxId] = useState<string>('123.456.789-00');
  const [fiscalCustomerName, setFiscalCustomerName] = useState<string>('Cliente Demonstração');

  // Simulação Delivery
  const [deliveryAddress, setDeliveryAddress] = useState<string>('Av. Principal, 1500 - Centro');
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number>(3.5);

  // Produtos filtrados do Cardápio Oficial 93
  const filteredProducts = useMemo(() => {
    return DECK26_STAGE7A_MENU_93.filter((prod) => {
      const matchCat = selectedCategoryId === 'ALL' || prod.categoryId === selectedCategoryId;
      const matchSearch =
        !cardapioSearch ||
        prod.name.toLowerCase().includes(cardapioSearch.toLowerCase()) ||
        prod.description.toLowerCase().includes(cardapioSearch.toLowerCase()) ||
        prod.sku.toLowerCase().includes(cardapioSearch.toLowerCase());
      return matchCat && matchSearch;
    });
  }, [selectedCategoryId, cardapioSearch]);

  // Totais da Comanda da Mesa
  const tableSubtotalCents = useMemo(() => {
    return tableCart.reduce((sum, item) => sum + item.product.priceCents * item.quantity, 0);
  }, [tableCart]);
  const tableServiceFeeCents = Math.round(tableSubtotalCents * 0.1);
  const tableTotalCents = tableSubtotalCents + tableServiceFeeCents;

  // Cálculo da Taxa de Delivery
  const deliveryFeeCents = Math.round(500 + deliveryDistanceKm * 250); // R$ 5,00 + R$ 2,50/km

  // Ação de Simular Emissão Fiscal
  function handleSimulateFiscal(type: 'NFCE' | 'NFSE') {
    const isRestaurant = type === 'NFCE';
    const est = isRestaurant ? DECK26_INITIAL_FISCAL_ESTABLISHMENTS[0]! : DECK26_INITIAL_FISCAL_ESTABLISHMENTS[1]!;
    const now = new Date().toISOString();
    const docNumber = Math.floor(1000 + Math.random() * 9000);
    const key = `212611${est.cnpj}65001${String(docNumber).padStart(9, '0')}1234567890`;

    const items = isRestaurant
      ? tableCart.map(c => ({
          productId: c.product.id,
          name: c.product.name,
          quantity: c.quantity,
          unitPriceCents: c.product.priceCents,
          totalCents: c.product.priceCents * c.quantity,
          ncm: c.product.ncm || '2106.90.90',
          cfop: c.product.cfop || '5.102',
          csosn: c.product.csosn || '102'
        }))
      : [
          {
            name: 'Diária de Hospedagem - Apartamento 201',
            quantity: 2,
            unitPriceCents: 22000,
            totalCents: 44000,
            ncm: '0000.00.00',
            cfop: '5.933',
            csosn: '102'
          }
        ];

    const gross = items.reduce((s, it) => s + it.totalCents, 0);

    const doc: FiscalDocumentRecord = {
      id: `fisc-sim-${Date.now()}`,
      documentType: type,
      establishmentId: est.id,
      establishmentCnpj: est.cnpj,
      series: 1,
      number: docNumber,
      accessKey: key,
      originReferenceType: isRestaurant ? 'TAB' : 'STAY',
      originReferenceId: isRestaurant ? `TAB-MESA-${selectedTableNumber}` : 'STAY-DEMO-201',
      customerName: fiscalCustomerName || 'Consumidor Final',
      customerTaxId: fiscalCustomerTaxId || '',
      grossTotalCents: gross,
      discountCents: 0,
      netTotalCents: gross,
      taxSummary: {
        icmsCents: Math.round(gross * 0.04),
        pisCents: Math.round(gross * 0.0065),
        cofinsCents: Math.round(gross * 0.03),
        issCents: isRestaurant ? 0 : Math.round(gross * 0.05),
        approximateTaxesCents: Math.round(gross * 0.12)
      },
      itemsSummary: items,
      status: 'SIMULATED_DEMO',
      isSimulated: true,
      watermark: 'SEM VALIDADE FISCAL - DEMO',
      qrCodeUrl: `https://sefaz.ma.gov.br/nfce/qrcode?p=${key}`,
      simulatedXml: `<nfeProc versao="4.00"><NFe><infNFe Id="NFe${key}"><emit><CNPJ>${est.cnpj}</CNPJ><xNome>${est.razaoSocial}</xNome></emit><total><ICMSTot><vNF>${(gross / 100).toFixed(2)}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`,
      simulatedDanfeText: `DANFE SIMULADO - ${est.nomeFantasia} - CNPJ: ${est.cnpj} - CHAVE: ${key}`,
      createdAt: now,
      updatedAt: now
    };

    setSimulatedFiscalDoc(doc);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1A1A1A',
        color: '#FFFFFF',
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* =====================================================================
          1. BANNER FIXO DE DEMONSTRAÇÃO COMERCIAL
         ===================================================================== */}
      <div
        style={{
          background: 'linear-gradient(90deg, #F72585 0%, #7209B7 100%)',
          color: '#FFFFFF',
          padding: '8px 14px',
          textAlign: 'center',
          fontSize: '0.82rem',
          fontWeight: 700,
          letterSpacing: '0.3px',
          boxShadow: '0 2px 10px rgba(247, 37, 133, 0.35)',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}
      >
        ✨ MODO DEMONSTRAÇÃO COMERCIAL — DECK 26 & HOTEL AUTO POSTO MILLA (DADOS SIMULADOS)
      </div>

      {/* =====================================================================
          2. HEADER PRINCIPAL (DESKTOP E MOBILE)
         ===================================================================== */}
      <header
        style={{
          padding: '12px 16px',
          background: '#111111',
          borderBottom: '1px solid #2D2D2D',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Deck26Logo size={32} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: '6px' }}>
              DECK 26 <span style={{ fontSize: '0.72rem', background: '#F72585', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>Demo</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
              Restaurante, Bar & Hotel Auto Posto Milla
            </div>
          </div>
        </div>

        {/* Badges de Destaque da Versão */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', background: '#242424', padding: '4px 8px', borderRadius: '4px', border: '1px solid #333' }}>
            📱 Mobile-First
          </span>
          <span style={{ fontSize: '0.72rem', background: '#242424', padding: '4px 8px', borderRadius: '4px', border: '1px solid #333' }}>
            ⚡ Offline-First
          </span>
          <span style={{ fontSize: '0.72rem', background: 'rgba(247, 37, 133, 0.15)', color: '#FF70A6', padding: '4px 8px', borderRadius: '4px', border: '1px solid #F72585' }}>
            🏢 24 Apts Hotel
          </span>
          <span style={{ fontSize: '0.72rem', background: 'rgba(114, 9, 183, 0.15)', color: '#C77DFF', padding: '4px 8px', borderRadius: '4px', border: '1px solid #7209B7' }}>
            📖 93 Itens Cardápio
          </span>
        </div>
      </header>

      {/* =====================================================================
          3. NAVEGAÇÃO SUPERIOR (PILL TABS PARA TABLET/DESKTOP)
         ===================================================================== */}
      <nav
        style={{
          background: '#161616',
          borderBottom: '1px solid #262626',
          padding: '8px 12px',
          display: 'flex',
          gap: '6px',
          overflowX: 'auto',
          scrollbarWidth: 'none'
        }}
      >
        {[
          { id: 'DASHBOARD', label: '📊 Dashboard', desc: 'KPIs Executivos' },
          { id: 'CARDAPIO', label: '📖 Cardápio (93)', desc: '10 Categorias' },
          { id: 'MESAS', label: '🍽️ Mesas & Comandas', desc: 'Salão Deck' },
          { id: 'HOTEL', label: '🏨 Hotel (24 Qts)', desc: '12 Oper. + 12 Obras' },
          { id: 'DELIVERY', label: '🛵 Delivery Próprio', desc: 'Taxa por KM' },
          { id: 'FINANCEIRO', label: '💰 DRE & Caixa', desc: 'Margem & Fluxo' },
          { id: 'FISCAL', label: '🧾 Fiscal Demo', desc: 'NFC-e / NFS-e' }
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as CommercialDemoTab)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                border: isActive ? '1px solid #F72585' : '1px solid #2D2D2D',
                background: isActive ? '#F72585' : '#222222',
                color: isActive ? '#FFFFFF' : '#D0D0D0',
                fontSize: '0.82rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* =====================================================================
          4. CONTEÚDO PRINCIPAL DINÂMICO
         ===================================================================== */}
      <main style={{ flex: 1, padding: '16px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box', paddingBottom: '90px' }}>
        
        {/* =================== ABA 1: DASHBOARD EXECUTIVO =================== */}
        {activeTab === 'DASHBOARD' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: '0 0 4px 0' }}>Painel Executivo Integrado</h2>
              <p style={{ fontSize: '0.82rem', color: '#A0A0A0', margin: 0 }}>
                Visão consolidada em tempo real da operação de Restaurante, Bar, Hotel e Delivery.
              </p>
            </div>

            {/* Grid de KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              <div style={{ background: '#242424', padding: '14px', borderRadius: '10px', border: '1px solid #333' }}>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', textTransform: 'uppercase' }}>Faturamento do Dia</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#4ADE80', marginTop: '4px' }}>R$ 4.850,00</div>
                <div style={{ fontSize: '0.72rem', color: '#A0A0A0', marginTop: '4px' }}>42 pedidos atendidos</div>
              </div>

              <div style={{ background: '#242424', padding: '14px', borderRadius: '10px', border: '1px solid #333' }}>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', textTransform: 'uppercase' }}>Taxa de Ocupação Hotel</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#F72585', marginTop: '4px' }}>25,0%</div>
                <div style={{ fontSize: '0.72rem', color: '#FFAFCC', marginTop: '4px' }}>
                  3 de 12 operacionais (12 em obras)
                </div>
              </div>

              <div style={{ background: '#242424', padding: '14px', borderRadius: '10px', border: '1px solid #333' }}>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', textTransform: 'uppercase' }}>Receita Hotel (Diárias)</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#7209B7', marginTop: '4px' }}>R$ 1.650,00</div>
                <div style={{ fontSize: '0.72rem', color: '#C77DFF', marginTop: '4px' }}>Diária média: R$ 180,00</div>
              </div>

              <div style={{ background: '#242424', padding: '14px', borderRadius: '10px', border: '1px solid #333' }}>
                <div style={{ fontSize: '0.75rem', color: '#A0A0A0', textTransform: 'uppercase' }}>Lucro Operacional Estimado</div>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: '#38BDF8', marginTop: '4px' }}>R$ 1.940,00</div>
                <div style={{ fontSize: '0.72rem', color: '#38BDF8', marginTop: '4px' }}>Margem líquida est.: 40%</div>
              </div>
            </div>

            {/* Quadro de Distribuição por Canal */}
            <div style={{ background: '#242424', padding: '16px', borderRadius: '10px', border: '1px solid #333' }}>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 12px 0' }}>Distribuição das Vendas por Canal Comercial</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
                {[
                  { channel: '🍽️ Salão / Mesas', amount: 'R$ 2.450,00', pct: '50.5%' },
                  { channel: '🏨 Hotel Milla', amount: 'R$ 1.650,00', pct: '34.0%' },
                  { channel: '🛵 Delivery Próprio', amount: 'R$ 550,00', pct: '11.3%' },
                  { channel: '🛍️ Balcão / Retirada', amount: 'R$ 200,00', pct: '4.2%' }
                ].map((item, idx) => (
                  <div key={idx} style={{ background: '#1C1C1C', padding: '10px', borderRadius: '8px', border: '1px solid #2C2C2C' }}>
                    <div style={{ fontSize: '0.74rem', color: '#D0D0D0' }}>{item.channel}</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', marginTop: '4px' }}>{item.amount}</div>
                    <div style={{ fontSize: '0.7rem', color: '#F72585', fontWeight: 600 }}>{item.pct} do total</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =================== ABA 2: CARDÁPIO DIGITAL OFICIAL 93 =================== */}
        {activeTab === 'CARDAPIO' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>Cardápio Digital Oficial</h2>
                <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                  93 produtos catalogados rigorosamente nas 10 categorias oficiais do DECK 26.
                </p>
              </div>
              <div style={{ background: '#7209B7', color: '#FFFFFF', padding: '4px 10px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700 }}>
                {filteredProducts.length} itens exibidos
              </div>
            </div>

            {/* Barra de Pesquisa */}
            <input
              type="text"
              placeholder="🔍 Buscar produto por nome, ingrediente ou SKU..."
              value={cardapioSearch}
              onChange={(e) => setCardapioSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                background: '#242424',
                border: '1px solid #3A3A3A',
                color: '#FFFFFF',
                fontSize: '0.88rem',
                boxSizing: 'border-box'
              }}
            />

            {/* Seletor Horizontal de Categorias (10 Categorias Oficiais) */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px', scrollbarWidth: 'none' }}>
              <button
                onClick={() => setSelectedCategoryId('ALL')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: selectedCategoryId === 'ALL' ? '#F72585' : '#242424',
                  color: '#FFFFFF',
                  border: '1px solid #3A3A3A',
                  fontSize: '0.78rem',
                  fontWeight: selectedCategoryId === 'ALL' ? 700 : 500,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer'
                }}
              >
                Todas (93)
              </button>
              {DECK26_STAGE7A_CATEGORIES.map((cat) => {
                const count = DECK26_STAGE7A_MENU_93.filter(p => p.categoryId === cat.id).length;
                const isSelected = selectedCategoryId === cat.id;
                return (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategoryId(cat.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      background: isSelected ? '#F72585' : '#242424',
                      color: '#FFFFFF',
                      border: '1px solid #3A3A3A',
                      fontSize: '0.78rem',
                      fontWeight: isSelected ? 700 : 500,
                      whiteSpace: 'nowrap',
                      cursor: 'pointer'
                    }}
                  >
                    {cat.name} ({count})
                  </button>
                );
              })}
            </div>

            {/* Grade de Produtos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
              {filteredProducts.map((prod) => (
                <div
                  key={prod.id}
                  style={{
                    background: '#242424',
                    border: '1px solid #333',
                    borderRadius: '8px',
                    padding: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    borderLeft: '4px solid #F72585'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <strong style={{ fontSize: '0.96rem', color: '#FFFFFF' }}>{prod.name}</strong>
                      <span style={{ fontSize: '0.72rem', color: '#A0A0A0', background: '#1A1A1A', padding: '2px 5px', borderRadius: '4px' }}>
                        {prod.sku}
                      </span>
                    </div>

                    <p style={{ fontSize: '0.78rem', color: '#B0B0B0', margin: '6px 0 10px 0', minHeight: '32px' }}>
                      {prod.description}
                    </p>

                    {/* Aviso de Verificação de Nomenclatura */}
                    {prod.verificationPending && prod.verificationPending.length > 0 && (
                      <div style={{ marginBottom: '8px', padding: '4px 6px', background: 'rgba(234, 179, 8, 0.15)', border: '1px solid #EAB308', borderRadius: '4px', fontSize: '0.72rem', color: '#FDE047' }}>
                        ⚠️ {prod.internalNotes}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <span style={{ fontSize: '0.68rem', background: '#1A1A1A', color: '#FFAFCC', padding: '2px 6px', borderRadius: '4px' }}>
                        {prod.prepStation === 'BAR_DRINKS' ? 'Bar & Bebidas' : prod.prepStation === 'GRIDDLE_TAPIOCA' ? 'Chapa & Tapiocas' : 'Cozinha Quente'}
                      </span>
                      {prod.ncm && (
                        <span style={{ fontSize: '0.68rem', background: '#1A1A1A', color: '#86EFAC', padding: '2px 6px', borderRadius: '4px' }}>
                          NCM: {prod.ncm}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid #333' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#4ADE80' }}>
                      {formatBrlCents(prod.priceCents)}
                    </div>
                    <button
                      onClick={() => {
                        setTableCart(prev => {
                          const existing = prev.find(i => i.product.id === prod.id);
                          if (existing) {
                            return prev.map(i => i.product.id === prod.id ? { ...i, quantity: i.quantity + 1 } : i);
                          }
                          return [...prev, { product: prod, quantity: 1 }];
                        });
                        alert(`"${prod.name}" adicionado à comanda de simulação da Mesa ${selectedTableNumber}!`);
                      }}
                      style={{
                        background: '#F72585',
                        color: '#FFFFFF',
                        border: 'none',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      + Add à Mesa
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =================== ABA 3: MESAS & COMANDAS =================== */}
        {activeTab === 'MESAS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>Salão & Comandas Digitais</h2>
              <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                Selecione uma mesa para lançar pedidos, aplicar 10% de serviço e emitir a pré-conta de conferência.
              </p>
            </div>

            {/* Seletor de Mesas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: '8px' }}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((num) => {
                const isSelected = selectedTableNumber === num;
                return (
                  <button
                    key={num}
                    onClick={() => setSelectedTableNumber(num)}
                    style={{
                      padding: '12px 6px',
                      borderRadius: '8px',
                      background: isSelected ? '#F72585' : '#242424',
                      color: '#FFFFFF',
                      border: isSelected ? '2px solid #FFFFFF' : '1px solid #333',
                      textAlign: 'center',
                      cursor: 'pointer',
                      fontWeight: 700
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: isSelected ? '#FFF' : '#A0A0A0' }}>Mesa</div>
                    <div style={{ fontSize: '1.15rem' }}>{num}</div>
                  </button>
                );
              })}
            </div>

            {/* Extrato da Comanda da Mesa Selecionada */}
            <div style={{ background: '#242424', padding: '16px', borderRadius: '10px', border: '1px solid #333' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '1.05rem', margin: 0 }}>
                  Comanda da Mesa {selectedTableNumber}
                </h3>
                <span style={{ fontSize: '0.74rem', background: '#16A34A', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>
                  ABERTA
                </span>
              </div>

              {tableCart.length === 0 ? (
                <p style={{ color: '#A0A0A0', fontSize: '0.82rem' }}>
                  Nenhum produto adicionado à mesa. Acesse a aba <strong>Cardápio</strong> para incluir itens.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {tableCart.map((it, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px',
                        background: '#1A1A1A',
                        borderRadius: '6px'
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 600 }}>{it.product.name}</div>
                        <div style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
                          {it.quantity}x {formatBrlCents(it.product.priceCents)}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, color: '#4ADE80' }}>
                        {formatBrlCents(it.product.priceCents * it.quantity)}
                      </div>
                    </div>
                  ))}

                  {/* Totais com 10% */}
                  <div style={{ borderTop: '1px solid #333', marginTop: '10px', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.86rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#A0A0A0' }}>
                      <span>Subtotal Consumo:</span>
                      <span>{formatBrlCents(tableSubtotalCents)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#A0A0A0' }}>
                      <span>Taxa de Serviço (10%):</span>
                      <span>{formatBrlCents(tableServiceFeeCents)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, color: '#FFFFFF', marginTop: '4px' }}>
                      <span>Total da Conta:</span>
                      <span style={{ color: '#4ADE80' }}>{formatBrlCents(tableTotalCents)}</span>
                    </div>
                  </div>

                  {/* Ações da Mesa */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' }}>
                    <button
                      onClick={() => setShowPreContaModal(true)}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#7209B7',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      🧾 Emitir Pré-Conta
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab('FISCAL');
                        handleSimulateFiscal('NFCE');
                      }}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        background: '#F72585',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      ⚡ Simular NFC-e
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal de Simulação de Pré-conta ESC/POS */}
            {showPreContaModal && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(0,0,0,0.85)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '16px',
                  zIndex: 9999
                }}
              >
                <div style={{ background: '#FFFDE7', color: '#111', padding: '16px', borderRadius: '8px', maxWidth: '380px', width: '100%', fontFamily: 'monospace', fontSize: '0.82rem', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
                  <div style={{ textAlign: 'center', fontWeight: 'bold' }}>
                    ================================================<br/>
                    DECK 26 — HOTEL AUTO POSTO MILLA<br/>
                    CONFERÊNCIA DE CONTA (PRÉ-CONTA)<br/>
                    *** NÃO É DOCUMENTO FISCAL ***<br/>
                    ================================================
                  </div>
                  <div style={{ margin: '8px 0' }}>
                    Mesa: {selectedTableNumber}<br/>
                    Horário: {new Date().toLocaleTimeString()}
                  </div>
                  <div>------------------------------------------------</div>
                  {tableCart.map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{it.quantity}x {it.product.name.slice(0, 18)}</span>
                      <span>R$ {(it.product.priceCents * it.quantity / 100).toFixed(2)}</span>
                    </div>
                  ))}
                  <div>------------------------------------------------</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>SUBTOTAL:</span>
                    <span>R$ {(tableSubtotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>TAXA DE SERVIÇO (10%):</span>
                    <span>R$ {(tableServiceFeeCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '0.92rem' }}>
                    <span>TOTAL:</span>
                    <span>R$ {(tableTotalCents / 100).toFixed(2)}</span>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    ================================================<br/>
                    Aguarde o garçom para efetuar o pagamento.<br/>
                    ================================================
                  </div>
                  <button
                    onClick={() => setShowPreContaModal(false)}
                    style={{ width: '100%', marginTop: '14px', padding: '8px', background: '#111', color: '#FFF', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    Fechar Cupom de Conferência
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =================== ABA 4: HOTEL AUTO POSTO MILLA =================== */}
        {activeTab === 'HOTEL' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>Hotel Auto Posto Milla</h2>
                <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                  24 Apartamentos: 12 operacionais disponíveis + 12 em obras de ampliação.
                </p>
              </div>
            </div>

            {/* Aviso Dinâmico de Bloqueio de Obras */}
            {simulatedCheckinAlert && (
              <div style={{ padding: '10px 14px', background: '#78350F', border: '1px solid #CA8A04', borderRadius: '8px', color: '#FDE047', fontSize: '0.84rem' }}>
                {simulatedCheckinAlert}
              </div>
            )}

            {/* Filtro de Quartos */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setHotelFilter('ALL')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: hotelFilter === 'ALL' ? '#F72585' : '#242424',
                  color: '#FFFFFF',
                  border: '1px solid #333',
                  fontSize: '0.78rem',
                  fontWeight: hotelFilter === 'ALL' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Todos (24)
              </button>
              <button
                onClick={() => setHotelFilter('OPERACIONAL')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: hotelFilter === 'OPERACIONAL' ? '#F72585' : '#242424',
                  color: '#FFFFFF',
                  border: '1px solid #333',
                  fontSize: '0.78rem',
                  fontWeight: hotelFilter === 'OPERACIONAL' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Operacionais (12)
              </button>
              <button
                onClick={() => setHotelFilter('EM_CONSTRUCAO')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  background: hotelFilter === 'EM_CONSTRUCAO' ? '#F72585' : '#242424',
                  color: '#FFFFFF',
                  border: '1px solid #333',
                  fontSize: '0.78rem',
                  fontWeight: hotelFilter === 'EM_CONSTRUCAO' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Em Obras (12)
              </button>
            </div>

            {/* Grade dos 24 Apartamentos */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
              {DECK26_INITIAL_ROOMS_24
                .filter(r => hotelFilter === 'ALL' || r.commercialStatus === hotelFilter)
                .map((room) => {
                  const isUnderConstruction = room.commercialStatus === 'EM_CONSTRUCAO';
                  return (
                    <div
                      key={room.id}
                      style={{
                        background: '#242424',
                        border: '1px solid #333',
                        borderLeft: `4px solid ${isUnderConstruction ? '#EAB308' : '#4ADE80'}`,
                        borderRadius: '8px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '1.05rem' }}>Apto {room.number}</strong>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: isUnderConstruction ? '#78350F' : '#14532D',
                              color: isUnderConstruction ? '#FDE047' : '#86EFAC',
                              border: `1px solid ${isUnderConstruction ? '#CA8A04' : '#16A34A'}`
                            }}
                          >
                            {isUnderConstruction ? '🚧 EM OBRAS' : 'OPERACIONAL'}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.8rem', color: '#D0D0D0', marginTop: '4px', fontWeight: 600 }}>
                          {room.name}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#A0A0A0' }}>
                          {room.floorSector} • {room.bedConfiguration}
                        </div>

                        {isUnderConstruction && (
                          <div style={{ marginTop: '8px', padding: '6px', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '4px', fontSize: '0.74rem', color: '#FDE047' }}>
                            ⚠️ Unidade em expansão. Não compõe o denominador da taxa de ocupação.
                          </div>
                        )}
                      </div>

                      <div style={{ marginTop: '12px', paddingTop: '8px', borderTop: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#4ADE80' }}>
                          {formatBrlCents(room.dailyRateCents)} <span style={{ fontSize: '0.7rem', color: '#A0A0A0' }}>/noite</span>
                        </div>
                        <button
                          onClick={() => {
                            if (isUnderConstruction) {
                              setSimulatedCheckinAlert(`🚫 Bloqueio Estrito: Apartamento ${room.number} está em construção e não pode receber reservas ou check-in.`);
                            } else {
                              setSimulatedCheckinAlert(`✅ Simulação: Check-in realizado no Apto ${room.number}! Folio gerado com diária de ${formatBrlCents(room.dailyRateCents)}.`);
                            }
                          }}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '6px',
                            background: isUnderConstruction ? '#333' : '#F72585',
                            color: '#FFFFFF',
                            border: 'none',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer'
                          }}
                        >
                          {isUnderConstruction ? 'Testar Bloqueio' : 'Simular Check-In'}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* =================== ABA 5: DELIVERY PRÓPRIO =================== */}
        {activeTab === 'DELIVERY' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>Módulo de Delivery Próprio</h2>
              <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                Cálculo de rota, frete por quilometragem e despacho de pedidos sem comissões de terceiros.
              </p>
            </div>

            <div style={{ background: '#242424', padding: '16px', borderRadius: '10px', border: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: '#A0A0A0' }}>Endereço de Entrega do Cliente</label>
                <input
                  type="text"
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', background: '#1A1A1A', border: '1px solid #3A3A3A', color: '#FFF', marginTop: '4px', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: '#A0A0A0' }}>Distância Estimada (KM): {deliveryDistanceKm} km</label>
                <input
                  type="range"
                  min="0.5"
                  max="15"
                  step="0.5"
                  value={deliveryDistanceKm}
                  onChange={(e) => setDeliveryDistanceKm(parseFloat(e.target.value))}
                  style={{ width: '100%', marginTop: '6px' }}
                />
              </div>

              <div style={{ background: '#1C1C1C', padding: '12px', borderRadius: '8px', border: '1px solid #333' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#A0A0A0' }}>
                  <span>Taxa Base de Partida:</span>
                  <span>R$ 5,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', color: '#A0A0A0', marginTop: '4px' }}>
                  <span>Adicional por Distância ({deliveryDistanceKm} km x R$ 2,50):</span>
                  <span>{formatBrlCents(Math.round(deliveryDistanceKm * 250))}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem', fontWeight: 800, color: '#4ADE80', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #333' }}>
                  <span>Frete Delivery Próprio:</span>
                  <span>{formatBrlCents(deliveryFeeCents)}</span>
                </div>
              </div>

              <button
                onClick={() => alert(`Pedido delivery simulado para ${deliveryAddress}! Taxa calculada: ${formatBrlCents(deliveryFeeCents)}.`)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  background: '#F72585',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                🛵 Confirmar Pedido Delivery
              </button>
            </div>
          </div>
        )}

        {/* =================== ABA 6: GESTÃO FINANCEIRA & DRE =================== */}
        {activeTab === 'FINANCEIRO' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>DRE Gerencial & Fluxo de Caixa</h2>
              <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                Demonstração contábil-gerencial automatizada a partir das vendas do PDV e estadias do Hotel Milla.
              </p>
            </div>

            {/* DRE Simplificado */}
            <div style={{ background: '#242424', padding: '16px', borderRadius: '10px', border: '1px solid #333' }}>
              <h3 style={{ fontSize: '0.98rem', margin: '0 0 12px 0', color: '#FFFFFF' }}>DRE Operacional (Mês Corrente)</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.86rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>(+) RECEITA BRUTA OPERACIONAL</span>
                  <span style={{ fontWeight: 700, color: '#4ADE80' }}>R$ 145.500,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#F87171' }}>
                  <span>(-) Deduções / Cancelamentos</span>
                  <span>R$ 2.200,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #333', fontWeight: 700 }}>
                  <span>(=) RECEITA LÍQUIDA</span>
                  <span style={{ color: '#FFFFFF' }}>R$ 143.300,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#F87171' }}>
                  <span>(-) Custo Mercadorias Vendidas (CMV 38%)</span>
                  <span>R$ 54.454,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #333', fontWeight: 700, color: '#F72585' }}>
                  <span>(=) MARGEM DE CONTRIBUIÇÃO (62%)</span>
                  <span>R$ 88.846,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#F87171' }}>
                  <span>(-) Despesas Operacionais (Folha, Energia, Água)</span>
                  <span>R$ 46.000,00</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid #F72585', fontSize: '1.05rem', fontWeight: 800, color: '#4ADE80' }}>
                  <span>(=) LUCRO OPERACIONAL LÍQUIDO</span>
                  <span>R$ 42.846,00 (29.9%)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =================== ABA 7: MÓDULO FISCAL PREPARATÓRIO =================== */}
        {activeTab === 'FISCAL' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.2rem', margin: '0 0 2px 0' }}>Preparação Fiscal & Multi-Estabelecimento</h2>
              <p style={{ fontSize: '0.8rem', color: '#A0A0A0', margin: 0 }}>
                Separação jurídica obrigatória entre Restaurante (NFC-e Estadual) e Hotel (NFS-e Municipal).
              </p>
            </div>

            {/* Estabelecimentos Fiscais */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
              {DECK26_INITIAL_FISCAL_ESTABLISHMENTS.map((est) => (
                <div
                  key={est.id}
                  style={{
                    background: '#242424',
                    border: '1px solid #333',
                    borderLeft: `4px solid ${est.segment === 'RESTAURANT' ? '#F72585' : '#7209B7'}`,
                    padding: '12px',
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ fontSize: '0.72rem', color: '#A0A0A0', textTransform: 'uppercase' }}>
                    Segmento: {est.segment === 'RESTAURANT' ? 'Restaurante / Bar' : 'Hotelaria / PMS'}
                  </div>
                  <strong style={{ fontSize: '0.95rem', color: '#FFFFFF', display: 'block', margin: '4px 0' }}>
                    {est.nomeFantasia}
                  </strong>
                  <div style={{ fontSize: '0.78rem', color: '#D0D0D0' }}>CNPJ: {est.cnpj}</div>
                  <div style={{ fontSize: '0.74rem', color: '#A0A0A0', marginTop: '4px' }}>
                    Inscrição: {est.segment === 'RESTAURANT' ? `IE: ${est.inscricaoEstadual}` : `IM: ${est.inscricaoMunicipal}`}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#4ADE80', marginTop: '6px', fontWeight: 600 }}>
                    Documento: {est.segment === 'RESTAURANT' ? 'NFC-e (Mod 65) / NF-e (Mod 55)' : 'NFS-e (Municipal)'}
                  </div>
                </div>
              ))}
            </div>

            {/* Simulador de Emissão Fiscal */}
            <div style={{ background: '#242424', padding: '16px', borderRadius: '10px', border: '1px solid #333' }}>
              <h3 style={{ fontSize: '1rem', margin: '0 0 10px 0' }}>⚡ Simulação de Emissão Fiscal (Sem Validade Jurídica)</h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '0.76rem', color: '#A0A0A0' }}>CPF do Consumidor</label>
                  <input
                    type="text"
                    value={fiscalCustomerTaxId}
                    onChange={(e) => setFiscalCustomerTaxId(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', background: '#1A1A1A', border: '1px solid #3A3A3A', color: '#FFF', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.76rem', color: '#A0A0A0' }}>Nome do Cliente</label>
                  <input
                    type="text"
                    value={fiscalCustomerName}
                    onChange={(e) => setFiscalCustomerName(e.target.value)}
                    style={{ width: '100%', padding: '8px', borderRadius: '6px', background: '#1A1A1A', border: '1px solid #3A3A3A', color: '#FFF', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => handleSimulateFiscal('NFCE')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    background: '#F72585',
                    color: '#FFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer'
                  }}
                >
                  Simular NFC-e (Restaurante)
                </button>
                <button
                  onClick={() => handleSimulateFiscal('NFSE')}
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    background: '#7209B7',
                    color: '#FFF',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer'
                  }}
                >
                  Simular NFS-e (Diárias Hotel)
                </button>
              </div>

              {/* Resultado do Documento Simulado */}
              {simulatedFiscalDoc && (
                <div style={{ marginTop: '16px', padding: '14px', background: '#141414', border: '1px dashed #F72585', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.74rem', background: '#F72585', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>
                      {simulatedFiscalDoc.watermark}
                    </span>
                    <span style={{ fontSize: '0.74rem', color: '#4ADE80', fontWeight: 700 }}>
                      STATUS: {simulatedFiscalDoc.status}
                    </span>
                  </div>

                  <div style={{ marginTop: '10px', fontSize: '0.82rem', color: '#D0D0D0' }}>
                    <strong>Tipo:</strong> {simulatedFiscalDoc.documentType} • <strong>Número:</strong> #{simulatedFiscalDoc.number} • <strong>Série:</strong> {simulatedFiscalDoc.series}<br/>
                    <strong>CNPJ Emissor:</strong> {simulatedFiscalDoc.establishmentCnpj}<br/>
                    <strong>Chave de Acesso (44 dígitos):</strong><br/>
                    <span style={{ fontFamily: 'monospace', color: '#38BDF8', fontSize: '0.76rem', wordBreak: 'break-all' }}>
                      {simulatedFiscalDoc.accessKey}
                    </span>
                  </div>

                  <div style={{ marginTop: '10px', borderTop: '1px solid #333', paddingTop: '8px' }}>
                    <div style={{ fontSize: '0.78rem', color: '#A0A0A0' }}>Itens Discriminados:</div>
                    {simulatedFiscalDoc.itemsSummary.map((it, idx) => (
                      <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginTop: '4px' }}>
                        <span>{it.quantity}x {it.name} (NCM {it.ncm} / CSOSN {it.csosn})</span>
                        <span style={{ color: '#4ADE80', fontWeight: 700 }}>{formatBrlCents(it.totalCents)}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: '10px', borderTop: '1px solid #333', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                    <span>TOTAL DO DOCUMENTO:</span>
                    <span style={{ color: '#4ADE80', fontSize: '1.05rem' }}>{formatBrlCents(simulatedFiscalDoc.netTotalCents)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* =====================================================================
          5. BARRA DE NAVEGAÇÃO INFERIOR FIXA (MOBILE BOTTOM BAR)
         ===================================================================== */}
      <footer
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#111111',
          borderTop: '1px solid #2D2D2D',
          display: 'flex',
          justifyContent: 'space-around',
          padding: '6px 4px',
          zIndex: 900
        }}
      >
        {[
          { id: 'DASHBOARD', icon: '📊', label: 'Painel' },
          { id: 'CARDAPIO', icon: '📖', label: 'Cardápio' },
          { id: 'MESAS', icon: '🍽️', label: 'Mesas' },
          { id: 'HOTEL', icon: '🏨', label: 'Hotel' },
          { id: 'DELIVERY', icon: '🛵', label: 'Delivery' },
          { id: 'FINANCEIRO', icon: '💰', label: 'DRE' },
          { id: 'FISCAL', icon: '🧾', label: 'Fiscal' }
        ].map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as CommercialDemoTab)}
              style={{
                background: 'none',
                border: 'none',
                color: isActive ? '#F72585' : '#888888',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                fontSize: '0.68rem',
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                padding: '4px 6px'
              }}
            >
              <span style={{ fontSize: '1.15rem' }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </footer>
    </div>
  );
};
