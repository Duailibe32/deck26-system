import React, { useState, useEffect } from 'react';
import {
  AccountsPayable,
  AccountsReceivable,
  CashFlowProjectedSummary,
  CashFlowRealizedSummary,
  CostCenter,
  FinancialAccount,
  FinancialCategory,
  FinancialTransaction,
  FinancialTransfer,
  PaymentMethod,
  PurchaseInvoice,
  Supplier,
  formatBrlCents
} from '@deck26/contracts';

interface FinanceModuleProps {
  localApiBase: string;
  financialAccounts: FinancialAccount[];
  costCenters: CostCenter[];
  financialCategories: FinancialCategory[];
  suppliers: Supplier[];
  accountsPayable: AccountsPayable[];
  accountsReceivable: AccountsReceivable[];
  getAuthHeaders: () => Record<string, string>;
  refreshState: () => Promise<void>;
  notify: (msg: string) => void;
}

export const FinanceModule: React.FC<FinanceModuleProps> = ({
  localApiBase,
  financialAccounts,
  costCenters,
  financialCategories,
  suppliers,
  accountsPayable,
  accountsReceivable,
  getAuthHeaders,
  refreshState,
  notify
}) => {
  const [subTab, setSubTab] = useState<'VISAO_GERAL' | 'PAGAR' | 'RECEBER' | 'TESOURARIA' | 'FLUXO' | 'FORNECEDORES'>('VISAO_GERAL');

  // Filtros Contas a Pagar
  const [payableFilterStatus, setPayableFilterStatus] = useState<'ALL' | 'PENDING' | 'PAID'>('ALL');
  const [payableSearch, setPayableSearch] = useState<string>('');
  const [payAccountMap, setPayAccountMap] = useState<Record<string, string>>({});
  const [payMethodMap, setPayMethodMap] = useState<Record<string, PaymentMethod>>({});

  // Nova Conta a Pagar Avulsa
  const [showNewApModal, setShowNewApModal] = useState<boolean>(false);
  const [newApDescription, setNewApDescription] = useState<string>('');
  const [newApAmountReais, setNewApAmountReais] = useState<string>('150,00');
  const [newApDueDate, setNewApDueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newApCostCenterId, setNewApCostCenterId] = useState<string>('REST');
  const [newApCategoryId, setNewApCategoryId] = useState<string>('cat-desp-utilidades');
  const [newApSupplierId, setNewApSupplierId] = useState<string>('');

  // Nova Conta a Receber Avulsa
  const [showNewArModal, setShowNewArModal] = useState<boolean>(false);
  const [newArDescription, setNewArDescription] = useState<string>('');
  const [newArAmountReais, setNewArAmountReais] = useState<string>('200,00');
  const [newArDueDate, setNewArDueDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [newArCostCenterId, setNewArCostCenterId] = useState<string>('REST');
  const [newArCategoryId, setNewArCategoryId] = useState<string>('cat-rec-outras');

  // Transferência Interna
  const [transferFromAccountId, setTransferFromAccountId] = useState<string>('acc-caixa-geral');
  const [transferToAccountId, setTransferToAccountId] = useState<string>('acc-cofre-sede');
  const [transferAmountReais, setTransferAmountReais] = useState<string>('100,00');
  const [transferReason, setTransferReason] = useState<string>('Sangria de fechamento para cofre');

  // Conciliação de Conta
  const [reconcileAccountId, setReconcileAccountId] = useState<string>('acc-caixa-geral');
  const [reconcileBalanceReais, setReconcileBalanceReais] = useState<string>('');
  const [reconcileNotes, setReconcileNotes] = useState<string>('Conferência diária de saldos físicos');

  // Fornecedores & Compras
  const [newSupName, setNewSupName] = useState<string>('');
  const [newSupDoc, setNewSupDoc] = useState<string>('');
  const [newSupPhone, setNewSupPhone] = useState<string>('');
  const [newSupCategory, setNewSupCategory] = useState<string>('Alimentos e Bebidas');

  // Compra com Nota Fiscal
  const [purchaseInvoiceNumber, setPurchaseInvoiceNumber] = useState<string>('');
  const [purchaseSupplierId, setPurchaseSupplierId] = useState<string>('');
  const [purchaseCostCenterId, setPurchaseCostCenterId] = useState<string>('REST');
  const [purchaseDueDate, setPurchaseDueDate] = useState<string>(() => new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10));
  const [purchaseProductId, setPurchaseProductId] = useState<string>('prd-caldo-macaxeira');
  const [purchaseQty, setPurchaseQty] = useState<number>(50);
  const [purchaseUnitCostReais, setPurchaseUnitCostReais] = useState<string>('4,00');

  // Fluxo de Caixa
  const [cashFlowPeriod, setCashFlowPeriod] = useState<{ start: string; end: string }>({
    start: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    end: new Date().toISOString().slice(0, 10)
  });
  const [realizedFlow, setRealizedFlow] = useState<CashFlowRealizedSummary | null>(null);
  const [projectedFlow, setProjectedFlow] = useState<CashFlowProjectedSummary | null>(null);
  const [flowLoading, setFlowLoading] = useState<boolean>(false);

  // Transações recentes
  const [recentTransactions, setRecentTransactions] = useState<FinancialTransaction[]>([]);

  useEffect(() => {
    if (subTab === 'FLUXO') {
      loadCashFlow();
    } else if (subTab === 'TESOURARIA') {
      loadRecentTransactions();
    }
  }, [subTab, cashFlowPeriod]);

  async function loadCashFlow() {
    setFlowLoading(true);
    try {
      const pReal = fetch(`${localApiBase}/api/finance/cash-flow/realized?startDate=${cashFlowPeriod.start}&endDate=${cashFlowPeriod.end}`, {
        headers: getAuthHeaders()
      }).then((r) => r.json());

      const pProj = fetch(`${localApiBase}/api/finance/cash-flow/projected?startDate=${cashFlowPeriod.start}&daysAhead=30`, {
        headers: getAuthHeaders()
      }).then((r) => r.json());

      const [rData, pData] = await Promise.all([pReal, pProj]);
      setRealizedFlow(rData);
      setProjectedFlow(pData);
    } catch (err) {
      console.error('Erro ao carregar fluxo:', err);
    } finally {
      setFlowLoading(false);
    }
  }

  async function loadRecentTransactions() {
    try {
      const res = await fetch(`${localApiBase}/api/finance/transactions?limit=25`, { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        setRecentTransactions(json);
      }
    } catch (err) {
      console.error('Erro ao carregar transações:', err);
    }
  }

  async function handlePayPayable(id: string) {
    const accountId = payAccountMap[id] || 'acc-caixa-geral';
    const paymentMethod = payMethodMap[id] || 'PIX';
    try {
      const res = await fetch(`${localApiBase}/api/finance/payables/${id}/pay`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ financialAccountId: accountId, paymentMethod })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao liquidar conta' }));
        notify(err.error ?? 'Erro');
        return;
      }
      await refreshState();
      notify('Conta a pagar quitada com sucesso!');
    } catch (err) {
      notify('Erro de conexão ao pagar');
    }
  }

  async function handlePayReceivable(id: string) {
    try {
      const res = await fetch(`${localApiBase}/api/finance/receivables/${id}/pay`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          financialAccountId: 'acc-caixa-geral',
          paymentMethod: 'PIX'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao liquidar recebível' }));
        notify(err.error ?? 'Erro');
        return;
      }
      await refreshState();
      notify('Recebível baixado e creditado no Caixa Geral!');
    } catch (err) {
      notify('Erro de conexão ao baixar recebível');
    }
  }

  async function handleCreateAp(e: React.FormEvent) {
    e.preventDefault();
    if (!newApDescription.trim()) {
      notify('Informe a descrição da despesa');
      return;
    }
    const cents = Math.round(parseFloat(newApAmountReais.replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) {
      notify('Informe um valor válido em R$');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/payables`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          description: newApDescription.trim(),
          origin: 'MANUAL',
          supplierId: newApSupplierId || undefined,
          costCenterId: newApCostCenterId,
          categoryId: newApCategoryId,
          totalAmountCents: cents,
          accrualDate: new Date().toISOString().slice(0, 10),
          dueDate: newApDueDate,
          status: 'PENDING'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao criar conta a pagar' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setNewApDescription('');
      setShowNewApModal(false);
      await refreshState();
      notify('Conta a pagar lançada com sucesso!');
    } catch (err) {
      notify('Erro ao lançar conta a pagar');
    }
  }

  async function handleCreateAr(e: React.FormEvent) {
    e.preventDefault();
    if (!newArDescription.trim()) {
      notify('Informe a descrição do recebível');
      return;
    }
    const cents = Math.round(parseFloat(newArAmountReais.replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) {
      notify('Informe um valor válido em R$');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/receivables`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          description: newArDescription.trim(),
          origin: 'MANUAL',
          costCenterId: newArCostCenterId,
          categoryId: newArCategoryId,
          totalAmountCents: cents,
          accrualDate: new Date().toISOString().slice(0, 10),
          dueDate: newArDueDate,
          status: 'PENDING'
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao criar recebível' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setNewArDescription('');
      setShowNewArModal(false);
      await refreshState();
      notify('Conta a receber lançada com sucesso!');
    } catch (err) {
      notify('Erro ao lançar recebível');
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (transferFromAccountId === transferToAccountId) {
      notify('A conta de origem não pode ser a mesma de destino.');
      return;
    }
    const cents = Math.round(parseFloat(transferAmountReais.replace(',', '.')) * 100);
    if (isNaN(cents) || cents <= 0) {
      notify('Informe um valor válido em R$');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/transfers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          fromAccountId: transferFromAccountId,
          toAccountId: transferToAccountId,
          amountCents: cents,
          reason: transferReason
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao realizar transferência' }));
        notify(err.error ?? 'Erro');
        return;
      }
      await refreshState();
      await loadRecentTransactions();
      notify(`Transferência interna de ${formatBrlCents(cents)} concluída com sucesso!`);
    } catch (err) {
      notify('Erro ao transferir');
    }
  }

  async function handleReconcile(e: React.FormEvent) {
    e.preventDefault();
    const balanceCents = Math.round(parseFloat(reconcileBalanceReais.replace(',', '.')) * 100);
    if (isNaN(balanceCents)) {
      notify('Informe o saldo conferido');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/reconcile`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          financialAccountId: reconcileAccountId,
          statementBalanceCents: balanceCents,
          notes: reconcileNotes
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro na conciliação' }));
        notify(err.error ?? 'Erro');
        return;
      }
      const data = await res.json();
      await refreshState();
      notify(`Conciliação registrada! Diferença apurada: ${formatBrlCents(data.reconciliation.discrepancyCents)}`);
    } catch (err) {
      notify('Erro ao conciliar');
    }
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!newSupName.trim() || !newSupDoc.trim()) {
      notify('Preencha Razão Social e CNPJ/CPF');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/suppliers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: newSupName.trim(),
          document: newSupDoc.trim(),
          phone: newSupPhone.trim(),
          category: newSupCategory
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao salvar fornecedor' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setNewSupName('');
      setNewSupDoc('');
      setNewSupPhone('');
      await refreshState();
      notify('Fornecedor cadastrado com sucesso!');
    } catch (err) {
      notify('Erro ao cadastrar fornecedor');
    }
  }

  async function handleCreatePurchase(e: React.FormEvent) {
    e.preventDefault();
    if (!purchaseInvoiceNumber.trim()) {
      notify('Informe o número da NF');
      return;
    }
    if (!purchaseSupplierId) {
      notify('Selecione um fornecedor');
      return;
    }
    const unitCost = Math.round(parseFloat(purchaseUnitCostReais.replace(',', '.')) * 100);
    if (isNaN(unitCost) || unitCost <= 0) {
      notify('Informe o custo unitário válido');
      return;
    }
    try {
      const res = await fetch(`${localApiBase}/api/finance/purchases`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          invoiceNumber: purchaseInvoiceNumber.trim(),
          supplierId: purchaseSupplierId,
          costCenterId: purchaseCostCenterId,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: purchaseDueDate,
          items: [{
            productId: purchaseProductId,
            quantity: purchaseQty,
            unitCostCents: unitCost
          }]
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro ao registrar compra' }));
        notify(err.error ?? 'Erro');
        return;
      }
      setPurchaseInvoiceNumber('');
      await refreshState();
      notify('Compra faturada! Entrada registrada no Kardex e título criado no Contas a Pagar.');
    } catch (err) {
      notify('Erro ao registrar compra');
    }
  }

  const totalTreasuryBalanceCents = financialAccounts.reduce((sum, a) => sum + (a.active ? a.currentBalanceCents : 0), 0);
  const pendingPayablesTotalCents = accountsPayable.filter((p) => p.status === 'PENDING').reduce((sum, p) => sum + p.totalAmountCents, 0);
  const pendingReceivablesTotalCents = accountsReceivable.filter((r) => r.status === 'PENDING').reduce((sum, r) => sum + r.totalAmountCents, 0);

  const filteredPayables = accountsPayable.filter((p) => {
    if (payableFilterStatus !== 'ALL' && p.status !== payableFilterStatus) return false;
    if (payableSearch.trim()) {
      const q = payableSearch.toLowerCase();
      if (!p.description.toLowerCase().includes(q) && !(p.supplierName && p.supplierName.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* CABEÇALHO FINANCEIRO */}
      <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', color: '#7209B7' }}>
            💼 Gestão Financeira Integrada & Tesouraria — DECK 26 / Hotel Milla
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)' }}>
            Contas a Pagar, Contas a Receber, Tesouraria multi-contas, conciliação e fluxo de caixa por competência e regime de caixa.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`d26-btn ${subTab === 'VISAO_GERAL' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('VISAO_GERAL')}
          >
            📊 Visão Geral
          </button>
          <button
            className={`d26-btn ${subTab === 'PAGAR' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('PAGAR')}
          >
            📉 A Pagar ({accountsPayable.filter((p) => p.status === 'PENDING').length})
          </button>
          <button
            className={`d26-btn ${subTab === 'RECEBER' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('RECEBER')}
          >
            📈 A Receber ({accountsReceivable.filter((r) => r.status === 'PENDING').length})
          </button>
          <button
            className={`d26-btn ${subTab === 'TESOURARIA' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('TESOURARIA')}
          >
            🏦 Tesouraria & Contas ({financialAccounts.length})
          </button>
          <button
            className={`d26-btn ${subTab === 'FLUXO' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('FLUXO')}
          >
            🌊 Fluxo de Caixa
          </button>
          <button
            className={`d26-btn ${subTab === 'FORNECEDORES' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('FORNECEDORES')}
          >
            🚛 Fornecedores & Compras
          </button>
        </div>
      </div>

      {/* ABA: VISÃO GERAL */}
      {subTab === 'VISAO_GERAL' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* CARDS INDICADORES */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
            <div className="d26-card" style={{ borderLeft: '4px solid #10B981' }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Saldo em Tesouraria (Total)</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#10B981', marginTop: '4px' }}>
                {formatBrlCents(totalTreasuryBalanceCents)}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>{financialAccounts.length} contas cadastradas</span>
            </div>

            <div className="d26-card" style={{ borderLeft: '4px solid #EF4444' }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Contas a Pagar Pendentes</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#EF4444', marginTop: '4px' }}>
                {formatBrlCents(pendingPayablesTotalCents)}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                {accountsPayable.filter((p) => p.status === 'PENDING').length} títulos pendentes
              </span>
            </div>

            <div className="d26-card" style={{ borderLeft: '4px solid #3B82F6' }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Contas a Receber Pendentes</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#3B82F6', marginTop: '4px' }}>
                {formatBrlCents(pendingReceivablesTotalCents)}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
                {accountsReceivable.filter((r) => r.status === 'PENDING').length} títulos pendentes
              </span>
            </div>

            <div className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
              <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Capital de Giro Disponível</span>
              <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#F72585', marginTop: '4px' }}>
                {formatBrlCents(totalTreasuryBalanceCents + pendingReceivablesTotalCents - pendingPayablesTotalCents)}
              </div>
              <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Saldo Líquido Projetado</span>
            </div>
          </div>

          {/* GRID DE CONTAS FINANCEIRAS COM SALDOS */}
          <div className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '12px', color: '#7209B7' }}>
              🏦 Posição das Contas Financeiras & Caixas em Tempo Real
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px' }}>
              {financialAccounts.map((acc) => (
                <div
                  key={acc.id}
                  style={{
                    background: 'var(--d26-black-900)',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.88rem' }}>{acc.name}</strong>
                    <span className="d26-badge" style={{ fontSize: '0.7rem' }}>
                      {acc.type}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>
                    {acc.bankName ? `${acc.bankName} • Conta: ${acc.accountNumber}` : acc.pixKey ? `PIX: ${acc.pixKey}` : 'Caixa Físico'}
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 900, color: acc.currentBalanceCents >= 0 ? '#10B981' : '#EF4444', marginTop: '4px' }}>
                    {formatBrlCents(acc.currentBalanceCents)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ABA: CONTAS A PAGAR */}
      {subTab === 'PAGAR' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="d26-input"
                style={{ width: '220px' }}
                placeholder="🔍 Buscar fornecedor, título..."
                value={payableSearch}
                onChange={(e) => setPayableSearch(e.target.value)}
              />
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['ALL', 'PENDING', 'PAID'] as const).map((st) => (
                  <button
                    key={st}
                    className={`d26-btn ${payableFilterStatus === st ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
                    style={{ padding: '4px 10px', fontSize: '0.74rem' }}
                    onClick={() => setPayableFilterStatus(st)}
                  >
                    {st === 'ALL' ? 'Todos' : st === 'PENDING' ? 'Pendentes' : 'Pagos'}
                  </button>
                ))}
              </div>
            </div>
            <button className="d26-btn d26-btn-primary" onClick={() => setShowNewApModal(!showNewApModal)}>
              ➕ Nova Conta a Pagar Avulsa
            </button>
          </div>

          {/* MODAL / FORM DE NOVA CONTA A PAGAR */}
          {showNewApModal && (
            <form onSubmit={handleCreateAp} className="d26-card" style={{ borderLeft: '4px solid #EF4444' }}>
              <h3 style={{ fontSize: '0.98rem', marginBottom: '10px', color: '#EF4444' }}>
                ➕ Lançar Despesa / Conta a Pagar Manual
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Descrição *</label>
                  <input
                    type="text"
                    className="d26-input"
                    placeholder="Ex: Conta de Energia CEMAR"
                    value={newApDescription}
                    onChange={(e) => setNewApDescription(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Valor (R$) *</label>
                  <input
                    type="text"
                    className="d26-input"
                    value={newApAmountReais}
                    onChange={(e) => setNewApAmountReais(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Vencimento *</label>
                  <input
                    type="date"
                    className="d26-input"
                    value={newApDueDate}
                    onChange={(e) => setNewApDueDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Centro de Custo</label>
                  <select
                    className="d26-select"
                    value={newApCostCenterId}
                    onChange={(e) => setNewApCostCenterId(e.target.value)}
                  >
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Categoria</label>
                  <select
                    className="d26-select"
                    value={newApCategoryId}
                    onChange={(e) => setNewApCategoryId(e.target.value)}
                  >
                    {financialCategories.filter((fc) => fc.type === 'EXPENSE_OP').map((fc) => (
                      <option key={fc.id} value={fc.id}>
                        {fc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Fornecedor (Opcional)</label>
                  <select
                    className="d26-select"
                    value={newApSupplierId}
                    onChange={(e) => setNewApSupplierId(e.target.value)}
                  >
                    <option value="">Nenhum fornecedor vinculado</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="submit" className="d26-btn d26-btn-primary">
                  Salvar Título
                </button>
                <button type="button" className="d26-btn d26-btn-secondary" onClick={() => setShowNewApModal(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          {/* TABELA DE CONTAS A PAGAR */}
          <div className="d26-card">
            <table className="d26-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Descrição / Fornecedor</th>
                  <th>Centro de Custo</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Conta Débito / Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayables.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--d26-gray-400)' }}>
                      Nenhuma conta a pagar encontrada.
                    </td>
                  </tr>
                ) : (
                  filteredPayables.map((p) => {
                    const isPending = p.status === 'PENDING';
                    return (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.description}</strong>
                          {p.supplierName && (
                            <div style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>
                              Fornecedor: {p.supplierName}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="d26-badge" style={{ fontSize: '0.7rem' }}>
                            {p.costCenterId}
                          </span>
                        </td>
                        <td>{p.dueDate}</td>
                        <td style={{ fontWeight: 800, color: '#EF4444' }}>{formatBrlCents(p.totalAmountCents)}</td>
                        <td>
                          <span
                            className="d26-badge"
                            style={{
                              fontSize: '0.7rem',
                              background: p.status === 'PAID' ? '#059669' : p.status === 'PENDING' ? '#EF4444' : '#6B7280'
                            }}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td>
                          {isPending ? (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <select
                                className="d26-select"
                                style={{ fontSize: '0.74rem', padding: '2px 4px', width: '130px' }}
                                value={payAccountMap[p.id] || 'acc-caixa-geral'}
                                onChange={(e) => setPayAccountMap({ ...payAccountMap, [p.id]: e.target.value })}
                              >
                                {financialAccounts.filter((a) => a.active).map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="d26-btn d26-btn-primary"
                                style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                                onClick={() => handlePayPayable(p.id)}
                              >
                                Pagar
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.76rem', color: '#10B981' }}>
                              Pago (Atualizado: {p.updatedAt.slice(0, 10)})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA: CONTAS A RECEBER */}
      {subTab === 'RECEBER' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <h3 style={{ fontSize: '1rem', color: '#3B82F6' }}>
              📈 Títulos a Receber (Salão, Hóspedes & Outras Receitas)
            </h3>
            <button className="d26-btn d26-btn-primary" onClick={() => setShowNewArModal(!showNewArModal)}>
              ➕ Novo Recebível Avulso
            </button>
          </div>

          {showNewArModal && (
            <form onSubmit={handleCreateAr} className="d26-card" style={{ borderLeft: '4px solid #3B82F6' }}>
              <h3 style={{ fontSize: '0.98rem', marginBottom: '10px', color: '#3B82F6' }}>
                ➕ Lançar Recebível Avulso
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Descrição *</label>
                  <input
                    type="text"
                    className="d26-input"
                    placeholder="Ex: Aluguel de Espaço Deck"
                    value={newArDescription}
                    onChange={(e) => setNewArDescription(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Valor (R$) *</label>
                  <input
                    type="text"
                    className="d26-input"
                    value={newArAmountReais}
                    onChange={(e) => setNewArAmountReais(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Vencimento *</label>
                  <input
                    type="date"
                    className="d26-input"
                    value={newArDueDate}
                    onChange={(e) => setNewArDueDate(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Centro de Custo</label>
                  <select
                    className="d26-select"
                    value={newArCostCenterId}
                    onChange={(e) => setNewArCostCenterId(e.target.value)}
                  >
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button type="submit" className="d26-btn d26-btn-primary">
                  Salvar Recebível
                </button>
                <button type="button" className="d26-btn d26-btn-secondary" onClick={() => setShowNewArModal(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <div className="d26-card">
            <table className="d26-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Descrição / Origem</th>
                  <th>Centro de Custo</th>
                  <th>Vencimento</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {accountsReceivable.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--d26-gray-400)' }}>
                      Nenhum recebível pendente.
                    </td>
                  </tr>
                ) : (
                  accountsReceivable.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.description}</strong>
                        <div style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>
                          Origem: <code>{r.origin}</code>
                        </div>
                      </td>
                      <td>
                        <span className="d26-badge" style={{ fontSize: '0.7rem' }}>
                          {r.costCenterId}
                        </span>
                      </td>
                      <td>{r.dueDate}</td>
                      <td style={{ fontWeight: 800, color: '#3B82F6' }}>{formatBrlCents(r.totalAmountCents)}</td>
                      <td>
                        <span
                          className="d26-badge"
                          style={{
                            fontSize: '0.7rem',
                            background: r.status === 'PAID' ? '#059669' : '#3B82F6'
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td>
                        {r.status === 'PENDING' ? (
                          <button
                            className="d26-btn d26-btn-primary"
                            style={{ padding: '3px 8px', fontSize: '0.74rem' }}
                            onClick={() => handlePayReceivable(r.id)}
                          >
                            Baixar no Caixa
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.76rem', color: '#10B981' }}>Recebido</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ABA: TESOURARIA, TRANSFERÊNCIAS & CONCILIAÇÃO */}
      {subTab === 'TESOURARIA' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* FORMULÁRIO DE TRANSFERÊNCIA INTERNA (SANGRIA / SUPRIMENTO) */}
          <form onSubmit={handleTransfer} className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#7209B7' }}>
              🔄 Transferência Interna (Sangria / Suprimento / Depósito)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', marginBottom: '12px' }}>
              Movimentação de custódia entre contas sem alteração de receita contábil no DRE.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Conta Origem *</label>
                <select
                  className="d26-select"
                  value={transferFromAccountId}
                  onChange={(e) => setTransferFromAccountId(e.target.value)}
                >
                  {financialAccounts.filter((a) => a.active).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatBrlCents(a.currentBalanceCents)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Conta Destino *</label>
                <select
                  className="d26-select"
                  value={transferToAccountId}
                  onChange={(e) => setTransferToAccountId(e.target.value)}
                >
                  {financialAccounts.filter((a) => a.active).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatBrlCents(a.currentBalanceCents)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Valor da Transferência (R$) *</label>
                <input
                  type="text"
                  className="d26-input"
                  value={transferAmountReais}
                  onChange={(e) => setTransferAmountReais(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Motivo / Justificativa</label>
                <input
                  type="text"
                  className="d26-input"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                Executar Transferência
              </button>
            </div>
          </form>

          {/* FORMULÁRIO DE CONCILIAÇÃO BANCÁRIA / CAIXA */}
          <form onSubmit={handleReconcile} className="d26-card">
            <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#10B981' }}>
              ⚖ Conciliação de Saldos (Auditoria de Caixa & Extrato)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', marginBottom: '12px' }}>
              Compare o saldo do sistema com o extrato bancário ou contagem física de cédulas.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Conta a Conciliar *</label>
                <select
                  className="d26-select"
                  value={reconcileAccountId}
                  onChange={(e) => setReconcileAccountId(e.target.value)}
                >
                  {financialAccounts.filter((a) => a.active).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} (Sistema: {formatBrlCents(a.currentBalanceCents)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Saldo Real Conferido (R$) *</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Ex: 1250,50"
                  value={reconcileBalanceReais}
                  onChange={(e) => setReconcileBalanceReais(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Notas da Auditoria</label>
                <input
                  type="text"
                  className="d26-input"
                  value={reconcileNotes}
                  onChange={(e) => setReconcileNotes(e.target.value)}
                />
              </div>

              <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                Salvar Conciliação
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ABA: FLUXO DE CAIXA */}
      {subTab === 'FLUXO' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="d26-card" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Data Inicial</label>
              <input
                type="date"
                className="d26-input"
                value={cashFlowPeriod.start}
                onChange={(e) => setCashFlowPeriod({ ...cashFlowPeriod, start: e.target.value })}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Data Final</label>
              <input
                type="date"
                className="d26-input"
                value={cashFlowPeriod.end}
                onChange={(e) => setCashFlowPeriod({ ...cashFlowPeriod, end: e.target.value })}
              />
            </div>
            <button className="d26-btn d26-btn-secondary" style={{ marginTop: '16px' }} onClick={loadCashFlow}>
              🔄 Atualizar Fluxo
            </button>
          </div>

          {flowLoading ? (
            <div className="d26-card" style={{ textAlign: 'center', padding: '24px' }}>
              Carregando fluxo de caixa...
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {/* FLUXO REALIZADO */}
              <div className="d26-card" style={{ borderLeft: '4px solid #10B981' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#10B981' }}>
                  💵 Fluxo de Caixa Realizado (Regime de Caixa)
                </h3>
                {realizedFlow && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>(+) Total Entradas:</span>
                      <strong style={{ color: '#10B981' }}>{formatBrlCents(realizedFlow.totalInflowsCents)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>(-) Total Saídas:</span>
                      <strong style={{ color: '#EF4444' }}>{formatBrlCents(realizedFlow.totalOutflowsCents)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: 'var(--d26-border-subtle)', paddingTop: '6px' }}>
                      <span>(=) Saldo Operacional do Período:</span>
                      <strong style={{ fontSize: '1.1rem', color: realizedFlow.netCashFlowCents >= 0 ? '#10B981' : '#EF4444' }}>
                        {formatBrlCents(realizedFlow.netCashFlowCents)}
                      </strong>
                    </div>

                    <h4 style={{ fontSize: '0.82rem', marginTop: '10px', color: 'var(--d26-gray-300)' }}>
                      Entradas por Meio de Pagamento:
                    </h4>
                    {Object.entries(realizedFlow.inflowsByPaymentMethod).map(([method, cents]) => (
                      <div key={method} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                        <span>{method}:</span>
                        <span>{formatBrlCents(cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* FLUXO PREVISTO (PROJETADO) */}
              <div className="d26-card" style={{ borderLeft: '4px solid #3B82F6' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#3B82F6' }}>
                  📅 Fluxo Previsto (Projeção por Vencimento - 30 Dias)
                </h3>
                {projectedFlow && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Saldo Atual em Contas:</span>
                      <strong>{formatBrlCents(projectedFlow.currentBalanceCents)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>(+) Recebimentos Previstos:</span>
                      <strong style={{ color: '#10B981' }}>{formatBrlCents(projectedFlow.projectedReceivablesCents)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>(-) Pagamentos Previstos:</span>
                      <strong style={{ color: '#EF4444' }}>{formatBrlCents(projectedFlow.projectedPayablesCents)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: 'var(--d26-border-subtle)', paddingTop: '6px' }}>
                      <span>(=) Saldo Final Projetado:</span>
                      <strong style={{ fontSize: '1.1rem', color: projectedFlow.projectedFinalBalanceCents >= 0 ? '#10B981' : '#EF4444' }}>
                        {formatBrlCents(projectedFlow.projectedFinalBalanceCents)}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA: FORNECEDORES & COMPRAS */}
      {subTab === 'FORNECEDORES' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
          {/* REGISTRO DE COMPRA COM ENTRADA NO ESTOQUE */}
          <form onSubmit={handleCreatePurchase} className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#F72585' }}>
              📦 Entrada de Nota Fiscal de Compra (Kardex & Financeiro)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', marginBottom: '12px' }}>
              Lança o estoque como Ativo Circulante no Kardex e cria a obrigação no Contas a Pagar (sem despesa imediata no DRE).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Número da Nota Fiscal (NF) *</label>
                <input
                  type="text"
                  className="d26-input"
                  placeholder="Ex: NF-5849"
                  value={purchaseInvoiceNumber}
                  onChange={(e) => setPurchaseInvoiceNumber(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Fornecedor *</label>
                <select
                  className="d26-select"
                  value={purchaseSupplierId}
                  onChange={(e) => setPurchaseSupplierId(e.target.value)}
                  required
                >
                  <option value="">Selecione o Fornecedor...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.document})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Centro de Custo</label>
                  <select
                    className="d26-select"
                    value={purchaseCostCenterId}
                    onChange={(e) => setPurchaseCostCenterId(e.target.value)}
                  >
                    {costCenters.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Vencimento do Boleto</label>
                  <input
                    type="date"
                    className="d26-input"
                    value={purchaseDueDate}
                    onChange={(e) => setPurchaseDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Produto / Insumo</label>
                  <select
                    className="d26-select"
                    value={purchaseProductId}
                    onChange={(e) => setPurchaseProductId(e.target.value)}
                  >
                    <option value="prd-caldo-macaxeira">Caldo de Macaxeira</option>
                    <option value="prd-cerveja-lata">Cerveja Lata</option>
                    <option value="prd-picanha-chapa">Picanha na Chapa</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Qtd</label>
                  <input
                    type="number"
                    className="d26-input"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Custo Unit (R$)</label>
                  <input
                    type="text"
                    className="d26-input"
                    value={purchaseUnitCostReais}
                    onChange={(e) => setPurchaseUnitCostReais(e.target.value)}
                  />
                </div>
              </div>

              <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                📥 Registrar Compra & Entrada no Estoque
              </button>
            </div>
          </form>

          {/* CADASTRO DE FORNECEDORES */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <form onSubmit={handleCreateSupplier} className="d26-card">
              <h3 style={{ fontSize: '1rem', marginBottom: '10px', color: '#7209B7' }}>
                ➕ Cadastrar Novo Fornecedor
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Razão Social / Nome *</label>
                  <input
                    type="text"
                    className="d26-input"
                    placeholder="Ex: Distribuidora de Alimentos Silva"
                    value={newSupName}
                    onChange={(e) => setNewSupName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>CNPJ / CPF *</label>
                  <input
                    type="text"
                    className="d26-input"
                    placeholder="00.000.000/0001-00"
                    value={newSupDoc}
                    onChange={(e) => setNewSupDoc(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Telefone</label>
                  <input
                    type="text"
                    className="d26-input"
                    placeholder="(98) 98888-7777"
                    value={newSupPhone}
                    onChange={(e) => setNewSupPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Categoria de Fornecimento</label>
                  <input
                    type="text"
                    className="d26-input"
                    value={newSupCategory}
                    onChange={(e) => setNewSupCategory(e.target.value)}
                  />
                </div>
                <button type="submit" className="d26-btn d26-btn-primary" style={{ marginTop: '6px' }}>
                  Salvar Fornecedor
                </button>
              </div>
            </form>

            <div className="d26-card">
              <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', color: '#FFAFCC' }}>
                Fornecedores Cadastrados ({suppliers.length}):
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {suppliers.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      background: 'var(--d26-black-900)',
                      padding: '8px 10px',
                      borderRadius: '6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem'
                    }}
                  >
                    <div>
                      <strong>{s.name}</strong> • Doc: {s.document}
                    </div>
                    <span style={{ color: 'var(--d26-gray-400)' }}>{s.category}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
