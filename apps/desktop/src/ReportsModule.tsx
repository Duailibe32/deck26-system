import React, { useState, useEffect } from 'react';
import {
  CostCenter,
  DreStatement,
  ExecutiveDashboardMetrics,
  formatBrlCents
} from '@deck26/contracts';

interface ReportsModuleProps {
  localApiBase: string;
  costCenters: CostCenter[];
  executiveMetrics?: ExecutiveDashboardMetrics;
  getAuthHeaders: () => Record<string, string>;
  notify: (msg: string) => void;
}

export const ReportsModule: React.FC<ReportsModuleProps> = ({
  localApiBase,
  costCenters,
  executiveMetrics,
  getAuthHeaders,
  notify
}) => {
  const [subTab, setSubTab] = useState<'DRE' | 'EXPORT_CSV' | 'METRICAS'>('DRE');
  const [costCenterFilter, setCostCenterFilter] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [dre, setDre] = useState<DreStatement | null>(null);
  const [loadingDre, setLoadingDre] = useState<boolean>(false);

  useEffect(() => {
    if (subTab === 'DRE') {
      loadDre();
    }
  }, [subTab, costCenterFilter, startDate, endDate]);

  async function loadDre() {
    setLoadingDre(true);
    try {
      const url = new URL(`${localApiBase}/api/finance/dre`);
      url.searchParams.set('startDate', startDate);
      url.searchParams.set('endDate', endDate);
      if (costCenterFilter !== 'ALL') {
        url.searchParams.set('costCenterId', costCenterFilter);
      }
      const res = await fetch(url.toString(), { headers: getAuthHeaders() });
      if (res.ok) {
        const json = await res.json();
        setDre(json);
      } else {
        notify('Erro ao carregar DRE');
      }
    } catch (err) {
      console.error('Erro ao carregar DRE:', err);
    } finally {
      setLoadingDre(false);
    }
  }

  function handleDownloadCsv(type: 'dre' | 'products' | 'payables' | 'receivables' | 'shifts') {
    const url = `${localApiBase}/api/finance/export/csv?type=${type}`;
    window.open(url, '_blank');
    notify(`Download do relatório '${type}.csv' iniciado com sanitização de fórmulas.`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* CABEÇALHO DO MÓDULO */}
      <div className="d26-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', color: '#F72585' }}>
            📈 Relatórios Comerciais & DRE Gerencial por Competência
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--d26-gray-400)' }}>
            Demonstrativo de Resultado do Exercício com cálculo por competência, exportação CSV blindada contra Formula Injection e KPIs executivos.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className={`d26-btn ${subTab === 'DRE' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('DRE')}
          >
            📋 DRE Gerencial
          </button>
          <button
            className={`d26-btn ${subTab === 'EXPORT_CSV' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('EXPORT_CSV')}
          >
            🛡 Exportação CSV Segura
          </button>
          <button
            className={`d26-btn ${subTab === 'METRICAS' ? 'd26-btn-primary' : 'd26-btn-secondary'}`}
            onClick={() => setSubTab('METRICAS')}
          >
            📊 Painel Executivo
          </button>
        </div>
      </div>

      {/* ABA: DRE GERENCIAL */}
      {subTab === 'DRE' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* BARRA DE FILTROS DO DRE */}
          <div className="d26-card" style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Data Inicial</label>
              <input
                type="date"
                className="d26-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Data Final</label>
              <input
                type="date"
                className="d26-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.74rem', color: 'var(--d26-gray-400)' }}>Centro de Custo</label>
              <select
                className="d26-select"
                value={costCenterFilter}
                onChange={(e) => setCostCenterFilter(e.target.value)}
              >
                <option value="ALL">Todos os Centros de Custo</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.name}
                  </option>
                ))}
              </select>
            </div>
            <button className="d26-btn d26-btn-secondary" style={{ marginTop: '16px' }} onClick={loadDre}>
              🔄 Recalcular DRE
            </button>
          </div>

          {loadingDre ? (
            <div className="d26-card" style={{ textAlign: 'center', padding: '24px' }}>
              Calculando DRE Gerencial por competência...
            </div>
          ) : !dre ? (
            <div className="d26-card" style={{ textAlign: 'center', padding: '24px', color: 'var(--d26-gray-400)' }}>
              Nenhum dado encontrado para o período selecionado.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* ESTRUTURA CONTÁBIL FORMAL DO DRE */}
              <div className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
                <h3 style={{ fontSize: '1.05rem', marginBottom: '14px', color: '#FFAFCC' }}>
                  Demonstração do Resultado do Exercício ({dre.periodStart} até {dre.periodEnd})
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.9rem' }}>
                  {/* RECEITA BRUTA */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--d26-black-900)' }}>
                    <span><strong>(+) RECEITA BRUTA OPERACIONAL</strong></span>
                    <strong style={{ color: '#10B981', fontSize: '1.05rem' }}>{formatBrlCents(dre.grossRevenueCents)}</strong>
                  </div>

                  {/* RECEITA POR CENTRO DE CUSTO */}
                  <div style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.82rem', color: 'var(--d26-gray-300)' }}>
                    {Object.entries(dre.revenueByCostCenter).map(([cc, val]) => (
                      <div key={cc} style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>• Centro de Custo {cc}:</span>
                        <span>{formatBrlCents(val)}</span>
                      </div>
                    ))}
                  </div>

                  {/* DEDUÇÕES */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--d26-black-900)' }}>
                    <span>(-) Deduções da Receita Bruta (Descontos Concedidos):</span>
                    <span style={{ color: '#FFAFCC' }}>- {formatBrlCents(dre.deductionsCents)}</span>
                  </div>

                  {/* RECEITA LÍQUIDA */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', background: 'var(--d26-black-900)', borderRadius: '6px', paddingInline: '10px' }}>
                    <span><strong>(=) RECEITA LÍQUIDA OPERACIONAL</strong></span>
                    <strong style={{ color: '#10B981' }}>{formatBrlCents(dre.netRevenueCents)}</strong>
                  </div>

                  {/* CUSTOS DIRETOS / CMV */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--d26-black-900)' }}>
                    <span>(-) Custos Diretos / CMV (Consumo de Insumos & Taxas de Entrega):</span>
                    <span style={{ color: '#EF4444' }}>- {formatBrlCents(dre.directCostsCents)}</span>
                  </div>

                  {/* LUCRO BRUTO */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', background: 'var(--d26-black-900)', borderRadius: '6px', paddingInline: '10px' }}>
                    <div>
                      <strong>(=) LUCRO BRUTO OPERACIONAL</strong>
                      <span style={{ fontSize: '0.75rem', color: '#FFAFCC', marginLeft: '8px' }}>
                        (Margem Bruta: {dre.grossMarginPercent.toFixed(1)}%)
                      </span>
                    </div>
                    <strong style={{ color: dre.grossProfitCents >= 0 ? '#10B981' : '#EF4444' }}>
                      {formatBrlCents(dre.grossProfitCents)}
                    </strong>
                  </div>

                  {/* DESPESAS OPERACIONAIS */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--d26-black-900)' }}>
                    <span>(-) Despesas Operacionais (Administrativas, Utilidades, Pessoal):</span>
                    <span style={{ color: '#EF4444' }}>- {formatBrlCents(dre.operationalExpensesCents)}</span>
                  </div>

                  {/* DESPESAS POR CATEGORIA */}
                  {Object.keys(dre.expensesByCategory).length > 0 && (
                    <div style={{ paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.82rem', color: 'var(--d26-gray-300)' }}>
                      {Object.entries(dre.expensesByCategory).map(([cat, val]) => (
                        <div key={cat} style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>• {cat}:</span>
                          <span>{formatBrlCents(val)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* RESULTADO LÍQUIDO FINAL */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 14px',
                      background: 'rgba(247, 37, 133, 0.12)',
                      border: '1px solid #F72585',
                      borderRadius: '8px',
                      marginTop: '8px'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: '#F72585' }}>
                        (=) RESULTADO LÍQUIDO DO EXERCÍCIO
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)' }}>
                        Margem Líquida: {dre.netMarginPercent.toFixed(1)}%
                      </div>
                    </div>
                    <div style={{ fontSize: '1.45rem', fontWeight: 900, color: dre.netProfitCents >= 0 ? '#10B981' : '#EF4444' }}>
                      {formatBrlCents(dre.netProfitCents)}
                    </div>
                  </div>
                </div>
              </div>

              {/* AUDITORIA DE INVARIANTES CONTÁBEIS */}
              <div className="d26-card" style={{ background: 'var(--d26-black-900)' }}>
                <h4 style={{ fontSize: '0.85rem', color: '#FFAFCC', marginBottom: '6px' }}>
                  🛡 Invariantes Contábeis Garantidas pelo Motor DECK 26:
                </h4>
                <ul style={{ fontSize: '0.78rem', color: 'var(--d26-gray-300)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <li>
                    <strong>Sem Duplicidade de Receita (ROOM_CHARGE):</strong> Comandas do restaurante transferidas para a conta do quarto são reconhecidas na competência da origem e não duplicam faturamento no check-out.
                  </li>
                  <li>
                    <strong>Ativo vs Despesa (Estoque & Kardex):</strong> Notas fiscais de compra entram como Ativo Circulante no estoque; o CMV é apropriado estritamente no consumo real por ficha técnica ou baixa de venda.
                  </li>
                  <li>
                    <strong>Custódia Operacional:</strong> Acertos de motoboys e transferências entre contas bancárias/cofres são movimentações de liquidez sem impacto no resultado econômico do DRE.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA: EXPORTAÇÃO CSV BLINDADA */}
      {subTab === 'EXPORT_CSV' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="d26-card">
            <h3 style={{ fontSize: '1.05rem', marginBottom: '8px', color: '#10B981' }}>
              🛡 Central de Exportações em CSV Protegidas contra Formula Injection
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--d26-gray-300)', marginBottom: '14px' }}>
              Todos os relatórios gerados pelo DECK 26 passam por sanitização estrita da função <code>sanitizeCsvCell()</code>: qualquer célula iniciando com <code>=</code>, <code>+</code>, <code>-</code>, <code>@</code>, <code>\t</code> ou <code>\r</code> é prefixada com apóstrofo (<code>'</code>) e delimitada com aspas duplas, neutralizando execução indevida no Excel e Calc.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
              <div className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
                <strong style={{ fontSize: '0.95rem' }}>DRE Gerencial Consolidado</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', margin: '6px 0 12px 0' }}>
                  Exporta a linha contábil completa do demonstrativo para análise contábil.
                </p>
                <button
                  className="d26-btn d26-btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => handleDownloadCsv('dre')}
                >
                  📥 Baixar DRE (.csv)
                </button>
              </div>

              <div className="d26-card" style={{ borderLeft: '4px solid #7209B7' }}>
                <strong style={{ fontSize: '0.95rem' }}>Vendas por Produto (Curva ABC)</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', margin: '6px 0 12px 0' }}>
                  Exporta quantidade vendida, receita total e margem de contribuição por item.
                </p>
                <button
                  className="d26-btn d26-btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => handleDownloadCsv('products')}
                >
                  📥 Baixar Vendas (.csv)
                </button>
              </div>

              <div className="d26-card" style={{ borderLeft: '4px solid #EF4444' }}>
                <strong style={{ fontSize: '0.95rem' }}>Relatório de Contas a Pagar</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', margin: '6px 0 12px 0' }}>
                  Exporta obrigações por fornecedor, centro de custo, vencimento e status.
                </p>
                <button
                  className="d26-btn d26-btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => handleDownloadCsv('payables')}
                >
                  📥 Baixar Contas a Pagar (.csv)
                </button>
              </div>

              <div className="d26-card" style={{ borderLeft: '4px solid #3B82F6' }}>
                <strong style={{ fontSize: '0.95rem' }}>Relatório de Contas a Receber</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--d26-gray-400)', margin: '6px 0 12px 0' }}>
                  Exporta recebíveis do hotel, eventos e títulos manuais com datas e saldos.
                </p>
                <button
                  className="d26-btn d26-btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => handleDownloadCsv('receivables')}
                >
                  📥 Baixar Contas a Receber (.csv)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ABA: PAINEL EXECUTIVO */}
      {subTab === 'METRICAS' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
          <div className="d26-card" style={{ borderLeft: '4px solid #10B981' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Vendas do PDV Hoje</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#10B981', marginTop: '4px' }}>
              {formatBrlCents(executiveMetrics?.todaySalesCents ?? 0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
              {executiveMetrics?.todayDeliveryOrdersCount ?? 0} pedido(s) delivery hoje
            </span>
          </div>

          <div className="d26-card" style={{ borderLeft: '4px solid #F72585' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Receita do Mês (Realizada)</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#F72585', marginTop: '4px' }}>
              {formatBrlCents(executiveMetrics?.monthRealizedRevenueCents ?? 0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Acumulado por competência</span>
          </div>

          <div className="d26-card" style={{ borderLeft: '4px solid #7209B7' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Despesas Realizadas no Mês</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#EF4444', marginTop: '4px' }}>
              {formatBrlCents(executiveMetrics?.monthRealizedExpensesCents ?? 0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>Títulos quitados</span>
          </div>

          <div className="d26-card" style={{ borderLeft: '4px solid #3B82F6' }}>
            <span style={{ fontSize: '0.76rem', color: 'var(--d26-gray-400)' }}>Resultado Estimado do Mês</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 900, color: (executiveMetrics?.monthEstimatedNetProfitCents ?? 0) >= 0 ? '#10B981' : '#EF4444', marginTop: '4px' }}>
              {formatBrlCents(executiveMetrics?.monthEstimatedNetProfitCents ?? 0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--d26-gray-400)' }}>
              Saldo em Tesouraria: {formatBrlCents(executiveMetrics?.treasuryTotalBalanceCents ?? 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
