import {parseMoney} from './desktopModels.js';
import React, { useState } from 'react';
import {
  DeliveryCourier,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliveryZone,
  PaymentMethod,
  formatBrlCents
} from '@deck26/contracts';

interface DeliveryModuleProps {
  localApiBase: string;
  deliveryOrders: DeliveryOrder[];
  deliveryCouriers: DeliveryCourier[];
  deliveryZones: DeliveryZone[];
  deliveryCustomers: Array<{
    id: string;
    name: string;
    phone: string;
    document?: string | null;
    addresses: Array<{
      id: string;
      street: string;
      number: string;
      neighborhood: string;
      city: string;
      deliveryZoneId?: string | null;
      isDefault: boolean;
    }>;
  }>;
  getAuthHeaders: () => Record<string, string>;
  refreshState: () => Promise<void>;
  notify: (msg: string) => void;
}

export const DeliveryModule: React.FC<DeliveryModuleProps> = ({
  localApiBase,
  deliveryOrders,
  deliveryCouriers,
  deliveryZones,
  deliveryCustomers,
  getAuthHeaders,
  refreshState,
  notify
}) => {
  const [subTab, setSubTab] = useState<'PEDIDOS' | 'DESPACHO' | 'ACERTO' | 'REGIOES' | 'CLIENTES'>('PEDIDOS');
  const [statusFilter, setStatusFilter] = useState<'ALL' | DeliveryOrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Despacho rápido
  const [dispatchCourierId, setDispatchCourierId] = useState<Record<string, string>>({});

  // Prestação de contas
  const [selectedCourierForSettlement, setSelectedCourierForSettlement] = useState<string>('');
  const [selectedOrderIdsForSettlement, setSelectedOrderIdsForSettlement] = useState<string[]>([]);
  const [settlementAccountId, setSettlementAccountId] = useState<string>('acc-caixa-geral');

  // Novo entregador
  const [newCourierName, setNewCourierName] = useState<string>('');
  const [newCourierPhone, setNewCourierPhone] = useState<string>('');
  const [newCourierPlate, setNewCourierPlate] = useState<string>('');
  const [newCourierFeeReais, setNewCourierFeeReais] = useState<string>('5,00');

  // Nova zona
  const [newZoneName, setNewZoneName] = useState<string>('');
  const [newZoneFeeReais, setNewZoneFeeReais] = useState<string>('7,00');
  const [newZoneMinTime, setNewZoneMinTime] = useState<number>(30);
  const [newZoneMinimumReais, setNewZoneMinimumReais] = useState<string>('0,00');

  const filteredOrders = deliveryOrders.filter((ord) => {
    if (statusFilter !== 'ALL' && ord.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchCustomer = ord.customerName.toLowerCase().includes(q);
      const matchPhone = ord.customerPhone.includes(q);
      const matchNum = String(ord.orderNumber).includes(q);
      if (!matchCustomer && !matchPhone && !matchNum) return false;
    }
    return true;
  });

  async function handleAdvanceStatus(orderId: string, status: DeliveryOrderStatus) {
    try {
      const res = await fetch(`${localApiBase}/api/delivery/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha ao atualizar pedido' }));
        notify(err.error ?? 'Erro ao atualizar');
        return;
      }
      await refreshState();
      notify(`Pedido #${orderId.slice(0, 8)} atualizado para '${status}'!`);
    } catch (err) {
      notify('Erro de comunicação com o servidor');
    }
  }

  async function handleDispatch(orderId: string) {
    const courierId = dispatchCourierId[orderId];
    if (!courierId) {
      notify('Selecione um motoboy para despachar o pedido.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/delivery/orders/${orderId}/dispatch`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ courierId })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha no despacho' }));
        notify(err.error ?? 'Erro no despacho');
        return;
      }
      await refreshState();
      notify(`Pedido #${orderId.slice(0, 8)} despachado para entrega!`);
    } catch (err) {
      notify('Erro de comunicação com o servidor');
    }
  }

  async function handleDeliver(orderId: string) {
    try {
      const res = await fetch(`${localApiBase}/api/delivery/orders/${orderId}/deliver`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({})
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha na confirmação de entrega' }));
        notify(err.error ?? 'Erro na entrega');
        return;
      }
      await refreshState();
      notify(`Pedido #${orderId.slice(0, 8)} marcado como ENTREGUE com sucesso!`);
    } catch (err) {
      notify('Erro de comunicação com o servidor');
    }
  }

  async function handleCancel(orderId: string) {
    if (!confirm('Deseja realmente cancelar este pedido delivery?')) return;
    try {
      const res = await fetch(`${localApiBase}/api/delivery/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ cancelReason: 'Cancelamento operacional solicitado no balcão' })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha ao cancelar' }));
        notify(err.error ?? 'Erro ao cancelar');
        return;
      }
      await refreshState();
      notify(`Pedido #${orderId.slice(0, 8)} cancelado.`);
    } catch (err) {
      notify('Erro de comunicação com o servidor');
    }
  }

  async function handleCreateCourier(e: React.FormEvent) {
    e.preventDefault();
    if (!newCourierName.trim() || !newCourierPhone.trim()) {
      notify('Preencha o nome e telefone do entregador.');
      return;
    }
    const feeCents = Math.round(parseFloat(newCourierFeeReais.replace(',', '.')) * 100);
    try {
      const res = await fetch(`${localApiBase}/api/delivery/couriers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newCourierName.trim(),
          phone: newCourierPhone.trim(),
          vehicleType: 'MOTO',
          vehiclePlate: newCourierPlate.trim() || undefined,
          feePerDeliveryCents: feeCents || 500,
          status: 'DISPONIVEL',
          active: true
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao cadastrar' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setNewCourierName('');
      setNewCourierPhone('');
      setNewCourierPlate('');
      await refreshState();
      notify('Entregador cadastrado com sucesso!');
    } catch (err) {
      notify('Erro ao cadastrar entregador');
    }
  }

  async function handleCreateZone(e: React.FormEvent) {
    e.preventDefault();
    if (!newZoneName.trim()) {
      notify('Informe o nome do bairro / região.');
      return;
    }
    const feeCents=parseMoney(newZoneFeeReais),minimumOrderCents=parseMoney(newZoneMinimumReais);if(feeCents===null||minimumOrderCents===null||newZoneMinTime<1){notify('Confira taxa, pedido mínimo e prazo da região.');return;}
    try {
      const res = await fetch(`${localApiBase}/api/delivery/zones`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newZoneName.trim(),
          feeCents,
          estimatedMinutes: newZoneMinTime || 40,
          minimumOrderCents,
          active: true
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao criar região' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setNewZoneName('');
      await refreshState();
      notify('Região de entrega cadastrada com sucesso!');
    } catch (err) {
      notify('Erro ao criar região');
    }
  }

  async function handleExecuteSettlement() {
    if (!selectedCourierForSettlement) {
      notify('Selecione um entregador.');
      return;
    }
    if (selectedOrderIdsForSettlement.length === 0) {
      notify('Selecione ao menos um pedido entregue para prestação de contas.');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/delivery/settlements`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          courierId: selectedCourierForSettlement,
          financialAccountId: settlementAccountId,
          deliveryOrderIds: selectedOrderIdsForSettlement
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha na prestação de contas' }));
        notify(err.error ?? 'Erro');
        return;
      }
      const data = await res.json();
      setSelectedOrderIdsForSettlement([]);
      await refreshState();
      notify(`Acerto concluído! Líquido depositado no caixa: ${formatBrlCents(data.settlement.netAmountSettledCents)}`);
    } catch (err) {
      notify('Erro ao processar prestação de contas');
    }
  }

  // Pedidos entregues do motoboy selecionado para prestação de contas
  const courierDeliveredOrders = selectedCourierForSettlement
    ? deliveryOrders.filter((o) => o.courierId === selectedCourierForSettlement && o.status === 'ENTREGUE')
    : [];

  const settlementCashTotal = courierDeliveredOrders
    .filter((o) => selectedOrderIdsForSettlement.includes(o.id) && o.paymentMethodDeclared === 'CASH')
    .reduce((sum, o) => sum + o.totalCents, 0);

  const settlementCourierFees = courierDeliveredOrders
    .filter((o) => selectedOrderIdsForSettlement.includes(o.id))
    .reduce((sum, o) => sum + o.courierFeeCents, 0);

  const settlementNetDue = settlementCashTotal - settlementCourierFees;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* CABEÇALHO DO MÓDULO */}
      <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', color: '#F72585' }}>
            🛵 Central de Delivery Próprio & Despacho — DECK 26
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)' }}>
            Gestão integrada de pedidos online/telefone, taxas por bairro, despacho de motoboys e prestação de contas no caixa.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`d26-btn ${subTab === 'PEDIDOS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('PEDIDOS')}
          >
            📋 Pedidos Ativos ({deliveryOrders.filter((o) => o.status !== 'ENTREGUE' && o.status !== 'CANCELADO').length})
          </button>
          <button
            className={`d26-btn ${subTab === 'DESPACHO' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('DESPACHO')}
          >
            🏍 Motoboys & Despacho ({deliveryCouriers.filter((c) => c.status === 'DISPONIVEL').length} livres)
          </button>
          <button
            className={`d26-btn ${subTab === 'ACERTO' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('ACERTO')}
          >
            💰 Prestação de Contas
          </button>
          <button
            className={`d26-btn ${subTab === 'REGIOES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('REGIOES')}
          >
            🗺 Bairros & Taxas ({deliveryZones.length})
          </button>
          <button
            className={`d26-btn ${subTab === 'CLIENTES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('CLIENTES')}
          >
            👥 Clientes ({deliveryCustomers.length})
          </button>
        </div>
      </div>

      {/* ABA: PEDIDOS */}
      {subTab === 'PEDIDOS' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* BARRA DE FILTROS */}
          <div className="d26-card" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="d26-input"
              style={{ width: '240px' }}
              placeholder="🔍 Buscar cliente, fone, #pedido..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {(['ALL', 'NOVO', 'CONFIRMADO', 'EM_PREPARO', 'PRONTO', 'SAIU_PARA_ENTREGA', 'ENTREGUE', 'CANCELADO'] as const).map((st) => (
                <button
                  key={st}
                  className={`d26-btn ${statusFilter === st ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                  style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === 'ALL' ? 'Todos' : st === 'SAIU_PARA_ENTREGA' ? 'Em Rota' : st}
                </button>
              ))}
            </div>
          </div>

          {/* LISTAGEM DE PEDIDOS EM CARDS */}
          {filteredOrders.length === 0 ? (
            <div className="d26-card" style={{ textAlign: 'center', color: 'var(--d26-gray-400)', padding: '24px' }}>
              Nenhum pedido delivery encontrado com os filtros selecionados.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '14px' }}>
              {filteredOrders.map((ord) => {
                const isFinal = ord.status === 'ENTREGUE' || ord.status === 'CANCELADO';
                return (
                  <div
                    key={ord.id}
                    className="d26-card"
                    style={{
                      borderLeft: `4px solid ${
                        ord.status === 'NOVO'
                          ? '#F72585'
                          : ord.status === 'CONFIRMADO'
                          ? '#7209B7'
                          : ord.status === 'EM_PREPARO'
                          ? '#F59E0B'
                          : ord.status === 'PRONTO'
                          ? '#10B981'
                          : ord.status === 'SAIU_PARA_ENTREGA'
                          ? '#3B82F6'
                          : ord.status === 'ENTREGUE'
                          ? '#059669'
                          : '#EF4444'
                      }`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#F72585' }}>
                        Pedido #{ord.orderNumber} ({ord.deliveryType})
                      </span>
                      <span className="d26-badge" style={{ fontSize: '0.72rem' }}>
                        {ord.status}
                      </span>
                    </div>

                    <div>
                      <strong style={{ fontSize: '0.95rem' }}>{ord.customerName}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                        📞 {ord.customerPhone} • Origem: <code>{ord.origin}</code>
                      </div>
                    </div>

                    {ord.deliveryAddress && (
                      <div style={{ fontSize: '0.78rem', background: 'var(--d26-black-900)', padding: '6px 8px', borderRadius: '6px' }}>
                        📍 {ord.deliveryAddress.street}, {ord.deliveryAddress.number}
                        {ord.deliveryAddress.neighborhood ? ` — ${ord.deliveryAddress.neighborhood}` : ''}
                        {ord.deliveryAddress.complement ? ` (${ord.deliveryAddress.complement})` : ''}
                      </div>
                    )}

                    <div style={{ fontSize: '0.8rem', borderTop: 'var(--d26-border-subtle)', paddingTop: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                        <span>Subtotal Itens:</span>
                        <span>{formatBrlCents(ord.itemsSubtotalCents)}</span>
                      </div>
                      {ord.notes && (
                        <div style={{ fontSize: '0.74rem', color: '#D8B4FE', marginTop: '2px' }}>
                          Obs: {ord.notes}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: 'var(--d26-border-subtle)', paddingTop: '6px', fontSize: '0.85rem' }}>
                      <div>
                        Taxa Entrega: <strong>{formatBrlCents(ord.deliveryFeeCents)}</strong>
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#F72585' }}>
                        Total: {formatBrlCents(ord.totalCents)}
                      </div>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: '#FFAFCC' }}>
                      Pagamento: <strong>{ord.paymentMethodDeclared}</strong>
                      {ord.changeForCents ? ` (Troco para ${formatBrlCents(ord.changeForCents)})` : ''}
                      {ord.courierName ? ` • Motoboy: ${ord.courierName}` : ''}
                    </div>

                    {/* BOTÕES DE AÇÃO POR STATUS */}
                    {!isFinal && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                        {ord.status === 'NOVO' && (
                          <button
                            className="d26-btn d26-btn-primary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.76rem' }}
                            onClick={() => handleAdvanceStatus(ord.id, 'CONFIRMADO')}
                          >
                            ✓ Confirmar Pedido
                          </button>
                        )}
                        {ord.status === 'CONFIRMADO' && (
                          <button
                            className="d26-btn d26-btn-primary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.76rem' }}
                            onClick={() => handleAdvanceStatus(ord.id, 'EM_PREPARO')}
                          >
                            🍳 Enviar Cozinha
                          </button>
                        )}
                        {ord.status === 'EM_PREPARO' && (
                          <button
                            className="d26-btn d26-btn-tertiary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.76rem' }}
                            onClick={() => handleAdvanceStatus(ord.id, 'PRONTO')}
                          >
                            🔔 Marcar PRONTO
                          </button>
                        )}
                        {ord.status === 'PRONTO' && (
                          <div style={{ display: 'flex', gap: '6px', width: '100%' }}>
                            <select
                              className="d26-select"
                              style={{ flex: 1, fontSize: '0.76rem', padding: '3px 6px' }}
                              value={dispatchCourierId[ord.id] || ''}
                              onChange={(e) => setDispatchCourierId({ ...dispatchCourierId, [ord.id]: e.target.value })}
                            >
                              <option value="">Selecione o Motoboy...</option>
                              {deliveryCouriers
                                .filter((c) => c.status === 'DISPONIVEL' || c.id === ord.courierId)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} ({formatBrlCents(c.feePerDeliveryCents)})
                                  </option>
                                ))}
                            </select>
                            <button
                              className="d26-btn d26-btn-primary"
                              style={{ padding: '4px 10px', fontSize: '0.76rem' }}
                              onClick={() => handleDispatch(ord.id)}
                            >
                              🚀 Despachar
                            </button>
                          </div>
                        )}
                        {ord.status === 'SAIU_PARA_ENTREGA' && (
                          <button
                            className="d26-btn d26-btn-tertiary"
                            style={{ flex: 1, padding: '4px 8px', fontSize: '0.76rem', background: '#059669' }}
                            onClick={() => handleDeliver(ord.id)}
                          >
                            📦 Confirmar Entrega
                          </button>
                        )}
                        <button
                          className="d26-btn d26-btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.76rem', color: '#EF4444' }}
                          onClick={() => handleCancel(ord.id)}
                        >
                          ✕ Cancelar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA: DESPACHO E MOTOBOYS */}
      {subTab === 'DESPACHO' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* LISTA DE ENTREGADORES */}
          <div className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#F72585' }}>
              🏍 Entregadores Cadastrados ({deliveryCouriers.length})
            </h3>
            {deliveryCouriers.length === 0 ? (
              <p style={{ color: 'var(--d26-gray-400)', fontSize: '0.85rem' }}>Nenhum motoboy cadastrado.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {deliveryCouriers.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      background: 'var(--d26-black-900)',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.9rem' }}>{c.name}</strong>
                      <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                        📞 {c.phone} • {c.vehicleType} {c.vehiclePlate ? `(${c.vehiclePlate})` : ''}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#FFAFCC' }}>
                        Taxa por Entrega: <strong>{formatBrlCents(c.feePerDeliveryCents)}</strong>
                      </div>
                    </div>
                    <span
                      className="d26-badge"
                      style={{
                        fontSize: '0.72rem',
                        background: c.status === 'DISPONIVEL' ? '#059669' : c.status === 'EM_ENTREGA' ? '#3B82F6' : '#EF4444'
                      }}
                    >
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* FORMULÁRIO DE NOVO ENTREGADOR */}
          <form onSubmit={handleCreateCourier} className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#F72585' }}>
              ➕ Cadastrar Novo Entregador
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Nome do Motoboy *</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Ex: Carlos Silva"
                  value={newCourierName}
                  onChange={(e) => setNewCourierName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Telefone / WhatsApp *</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="(98) 99123-4567"
                  value={newCourierPhone}
                  onChange={(e) => setNewCourierPhone(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Placa do Veículo</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Ex: XYZ-1234"
                  value={newCourierPlate}
                  onChange={(e) => setNewCourierPlate(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Taxa por Entrega (R$)</label>
                <input
                  type="text"
                  className="d26-input"
                  value={newCourierFeeReais}
                  onChange={(e) => setNewCourierFeeReais(e.target.value)}
                />
              </div>
              <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                Salvar Entregador
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ABA: PRESTAÇÃO DE CONTAS (ACERTO) */}
      {subTab === 'ACERTO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#F72585' }}>
              💰 Prestação de Contas & Quitação de Entregas (Transferência de Custódia)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)', marginBottom: '14px' }}>
              Liquide os valores recebidos em dinheiro pelos motoboys e pague as taxas de entrega devidas, gerando lançamento auditado na tesouraria.
            </p>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '16px' }}>
              <select
                className="d26-select"
                style={{ width: '250px' }}
                value={selectedCourierForSettlement}
                onChange={(e) => {
                  setSelectedCourierForSettlement(e.target.value);
                  setSelectedOrderIdsForSettlement([]);
                }}
              >
                <option value="">Selecione o Motoboy para Acerto...</option>
                {deliveryCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>

              <select
                className="d26-select"
                style={{ width: '220px' }}
                value={settlementAccountId}
                onChange={(e) => setSettlementAccountId(e.target.value)}
              >
                <option value="acc-caixa-geral">Conta: Caixa Geral (PDV)</option>
                <option value="acc-cofre-sede">Conta: Cofre da Sede</option>
                <option value="acc-banco-brasil">Conta: Banco do Brasil</option>
              </select>
            </div>

            {selectedCourierForSettlement && (
              <div>
                <h4 style={{ fontSize: '0.9rem', marginBottom: '8px' }}>
                  Entregas Realizadas com Saldo Pendente de Acerto ({courierDeliveredOrders.length}):
                </h4>
                {courierDeliveredOrders.length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-400)' }}>
                    Nenhuma entrega pendente de acerto para este entregador.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                    {courierDeliveredOrders.map((ord) => {
                      const isSelected = selectedOrderIdsForSettlement.includes(ord.id);
                      return (
                        <div
                          key={ord.id}
                          style={{
                            background: isSelected ? 'rgba(247, 37, 133, 0.12)' : 'var(--d26-black-900)',
                            border: isSelected ? '1px solid #F72585' : 'var(--d26-border-subtle)',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedOrderIdsForSettlement([...selectedOrderIdsForSettlement, ord.id]);
                                } else {
                                  setSelectedOrderIdsForSettlement(selectedOrderIdsForSettlement.filter((id) => id !== ord.id));
                                }
                              }}
                            />
                            <div>
                              <strong>Pedido #{ord.orderNumber}</strong> • {ord.customerName}
                              <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                                Forma: <code>{ord.paymentMethodDeclared}</code> • Valor Total: {formatBrlCents(ord.totalCents)}
                              </div>
                            </div>
                          </label>
                          <div style={{ textAlign: 'right', fontSize: '0.82rem' }}>
                            <div>Dinheiro na Mão: <strong>{ord.paymentMethodDeclared === 'CASH' ? formatBrlCents(ord.totalCents) : 'R$ 0,00'}</strong></div>
                            <div style={{ color: '#FFAFCC' }}>Taxa do Motoboy: {formatBrlCents(ord.courierFeeCents)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* RESUMO E BOTÃO DE QUITAÇÃO */}
                <div
                  style={{
                    background: 'var(--d26-black-900)',
                    padding: '14px 18px',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>Recebido em Dinheiro:</span>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>{formatBrlCents(settlementCashTotal)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>Taxas de Entrega:</span>
                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#FFAFCC' }}>- {formatBrlCents(settlementCourierFees)}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--d26-gray-400)' }}>Líquido a Depositar no Caixa:</span>
                      <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#10B981' }}>{formatBrlCents(settlementNetDue)}</div>
                    </div>
                  </div>
                  <button
                    className="d26-btn d26-btn-primary"
                    disabled={selectedOrderIdsForSettlement.length === 0}
                    onClick={handleExecuteSettlement}
                  >
                    ✓ Concluir Acerto & Registrar no Caixa
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA: BAIRROS E TAXAS */}
      {subTab === 'REGIOES' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          <div className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#F72585' }}>
              🗺 Regiões de Entrega ({deliveryZones.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {deliveryZones.map((z) => (
                <div
                  key={z.id}
                  style={{
                    background: 'var(--d26-black-900)',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '0.9rem' }}>{z.name}</strong>
                    <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                      Tempo estimado: {z.estimatedMinutes} min
                    </div>
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#F72585' }}>
                    {formatBrlCents(z.feeCents)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateZone} className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#F72585' }}>
              ➕ Nova Região de Entrega
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Nome da Região / Bairro *</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Ex: Bairro Laranjeiras"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  required
                />
              </div>
              <div>
                <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Taxa de Entrega (R$)</label>
                <input
                  type="text"
                  className="d26-input"
                  value={newZoneFeeReais}
                  onChange={(e) => setNewZoneFeeReais(e.target.value)}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Tempo base da região (min)</label>
                  <input
                    type="number"
                    className="d26-input"
                    value={newZoneMinTime}
                    onChange={(e) => setNewZoneMinTime(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Pedido mínimo (R$)</label>
                  <input
                    type="text"
                    className="d26-input"
                    value={newZoneMinimumReais}
                    onChange={(e) => setNewZoneMinimumReais(e.target.value)}
                  />
                </div>
              </div>
              <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                Salvar Região
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ABA: CLIENTES */}
      {subTab === 'CLIENTES' && (
        <div className="d26-card">
          <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#F72585' }}>
            👥 Base de Clientes de Delivery ({deliveryCustomers.length})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {deliveryCustomers.map((cust) => (
              <div
                key={cust.id}
                style={{
                  background: 'var(--d26-black-900)',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px'
                }}
              >
                <div>
                  <strong style={{ fontSize: '0.92rem' }}>{cust.name}</strong>
                  <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)' }}>
                    📞 {cust.phone} {cust.document ? `• Doc: ${cust.document}` : ''}
                  </div>
                  {cust.addresses.length > 0 && (
                    <div style={{ fontSize: '0.76rem', color: '#FFAFCC', marginTop: '4px' }}>
                      📍 {cust.addresses[0]?.street}, {cust.addresses[0]?.number} — {cust.addresses[0]?.neighborhood}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                  {cust.addresses.length} endereço(s) salvo(s)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
