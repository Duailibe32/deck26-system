# DECK 26 — MATRIZ DE HOMOLOGAÇÃO E ACEITE OPERACIONAL (ETAPA 6.5)

Este documento apresenta a matriz completa de homologação do sistema **DECK 26 — Hotel Auto Posto Milla**, consolidando os testes automatizados, as simulações funcionais e a delimitação explícita dos testes que dependem de hardware físico na Etapa 7.

---

## 1. LEGENDA DE STATUS
- **APROVADO:** Validado via testes automatizados (Vitest) e testes funcionais em ambiente de desenvolvimento.
- **BLOQUEADO:** Depende de pré-requisito técnico anterior para ser validado.
- **DEPENDÊNCIA DE HARDWARE:** Requer equipamento físico (impressora térmica ESC/POS, balança, gaveta automática).
- **DEPENDÊNCIA EXTERNA:** Requer serviço externo ativo (SEFAZ em produção, credenciais bancárias de produção).
- **NÃO_EXECUTADO:** Cenário não executado por escopo ou restrição da etapa.

---

## 2. MATRIZ POR MÓDULO OPERACIONAL

### A. Restaurante e Bar (Salão e Balcão)
| ID | Cenário Operacional | Método | Resultado Esperado | Status | Evidência |
|:---|:---|:---:|:---|:---:|:---|
| **REST-01** | Abertura de mesa e ocupação física | Automatizado | Mesa transita para `OCUPADA`, cria comanda `TABLE` | **APROVADO** | `server.test.ts:740` |
| **REST-02** | Envio de pedido com ficha técnica e baixa de estoque | Automatizado | Itens baixam do Kardex com custo unitário real | **APROVADO** | `server.test.ts:810` |
| **REST-03** | Adição de itens adicionais com impressão incremental | Automatizado | Apenas itens novos geram tickets no spooler | **APROVADO** | `server.test.ts:1620` |
| **REST-04** | Transferência de mesa com preservação de comanda | Automatizado | Mesa de origem fica livre, destino ocupada | **APROVADO** | `server.test.ts:1750` |
| **REST-05** | Divisão de conta e pagamentos parciais múltiplos | Automatizado | Conta de R$ 101,99 quitada em 3 meios sem centavos fantasmas | **APROVADO** | `stage6_5_audit.test.ts:18` |
| **REST-06** | Fechamento de mesa e liberação de status físico | Automatizado | Mesa transita para `LIVRE` e comanda para `CLOSED` | **APROVADO** | `server.test.ts:1880` |

### B. Cozinha e KDS (Kitchen Display System)
| ID | Cenário Operacional | Método | Resultado Esperado | Status | Evidência |
|:---|:---|:---:|:---|:---:|:---|
| **KDS-01** | Distribuição de pedidos por estação (Cozinha Quente / Fria / Bar) | Automatizado | Itens roteados de acordo com `prepStation` | **APROVADO** | `server.test.ts:1530` |
| **KDS-02** | Transição de status (`RECEIVED` $\to$ `IN_PREPARATION` $\to$ `READY`) | Automatizado | Atualização atômica de status do item e pedido | **APROVADO** | `server.test.ts:1570` |
| **KDS-03** | Gestão de SLA visual e cronômetro de preparo | Interface | Exibição de alertas amarelos/vermelhos por tempo | **APROVADO** | `apps/desktop/src/KdsModule.tsx` |
| **KDS-04** | Spooler de impressão ESC/POS e estado `UNKNOWN_OUTCOME` | Automatizado | Bloqueia reenvio cego em queda de energia/rede | **APROVADO** | `server.test.ts:1675` |
| **KDS-05** | Impressão física em bobina térmica 80mm | Hardware Real | Corte de guilhotina e caracteres acentuados CP860 | **DEPENDÊNCIA DE HARDWARE** | Pendente Etapa 7 |

### C. Hotel Auto Posto Milla (PMS)
| ID | Cenário Operacional | Método | Resultado Esperado | Status | Evidência |
|:---|:---|:---:|:---|:---:|:---|
| **HOT-01** | Cadastro de quartos e comodidades completas | Automatizado | Quarto criado com tarifa, capacidade e comodidades | **APROVADO** | `hotel.test.ts:32` |
| **HOT-02** | Criação, cancelamento e reagendamento de reservas | Automatizado | Prevenção de conflito de datas `[in, out)` | **APROVADO** | `hotel.test.ts:180` |
| **HOT-03** | Check-in com ou sem reserva prévia (Walk-in) | Automatizado | Quarto fica `OCUPADO`, abre comanda `APTO-XXX` | **APROVADO** | `hotel.test.ts:270` |
| **HOT-04** | Bloqueio de check-in concorrente no mesmo quarto | Automatizado | Erro 400 rejeitando sobreposição | **APROVADO** | `hotel.test.ts:335` |
| **HOT-05** | Transferência de comanda de restaurante para quarto (`ROOM_CHARGE`) | Automatizado | Comanda fechada, débito inserido no folio | **APROVADO** | `hotel.test.ts:630` |
| **HOT-06** | Idempotência estrita em `ROOM_CHARGE` | Automatizado | Reenvio da transferência rejeitado sem duplicação | **APROVADO** | `stage6_5_audit.test.ts:230` |
| **HOT-07** | Consumo de frigobar e serviços adicionais (lavanderia) | Automatizado | Lançamento correto de débitos no folio | **APROVADO** | `hotel.test.ts:650` |
| **HOT-08** | Check-out com bloqueio de saldo pendente | Automatizado | Exige liquidação integral ou justificativa de auditoria | **APROVADO** | `hotel.test.ts:850` |
| **HOT-09** | Ciclo de Governança (`OCUPADO` $\to$ `SUJO` $\to$ `EM_LIMPEZA` $\to$ `LIMPO`) | Automatizado | Quarto desocupado fica sujo até liberação da camareira | **APROVADO** | `hotel.test.ts:920` |

### D. Delivery Próprio
| ID | Cenário Operacional | Método | Resultado Esperado | Status | Evidência |
|:---|:---|:---:|:---|:---:|:---|
| **DEL-01** | Cadastro de regiões, bairros e taxas de entrega | Automatizado | Taxas e tempos estimados cadastrados | **APROVADO** | `stage6.test.ts:135` |
| **DEL-02** | Cadastro de entregadores e status operacional | Automatizado | Motoboys gerenciados com `DISPONIVEL` / `OCUPADO` | **APROVADO** | `stage6.test.ts:210` |
| **DEL-03** | Criação de pedido delivery com validação de preços | Automatizado | Cálculo do subtotal, taxa de entrega e troco | **APROVADO** | `stage6.test.ts:310` |
| **DEL-04** | Despacho de pedido e atribuição de motoboy | Automatizado | Pedido transita para `SAIU_PARA_ENTREGA` | **APROVADO** | `stage6.test.ts:350` |
| **DEL-05** | Confirmação de entrega e baixa em contas a receber | Automatizado | Pedido transita para `ENTREGUE` | **APROVADO** | `stage6.test.ts:370` |
| **DEL-06** | Prestação de contas e acerto financeiro do entregador | Automatizado | Repasse ao caixa sem duplicar receita de venda | **APROVADO** | `stage6_5_audit.test.ts:300` |
| **DEL-07** | Checkout público pelo portal web | Simulação / API | Pedido aceito e encaminhado ao servidor local | **APROVADO** | `apps/web/src/App.tsx` |

### E. Gestão Financeira, Caixa e DRE Gerencial
| ID | Cenário Operacional | Método | Resultado Esperado | Status | Evidência |
|:---|:---|:---:|:---|:---:|:---|
| **FIN-01** | Abertura de turno de caixa com conferência de saldo | Automatizado | Turno registrado com data e operador | **APROVADO** | `stage6.test.ts:480` |
| **FIN-02** | Movimentação de suprimento e sangria | Automatizado | Invariante: sem impacto na receita e despesa da DRE | **APROVADO** | `stage6_5_audit.test.ts:150` |
| **FIN-03** | Transferência entre contas bancárias | Automatizado | Débito e crédito mútuos sem impacto no faturamento | **APROVADO** | `stage6_5_audit.test.ts:190` |
| **FIN-04** | DRE Gerencial por competência com segregação de centros | Automatizado | Hotel, Restaurante, Bar e Delivery perfeitamente isolados | **APROVADO** | `stage6.test.ts:600` |
| **FIN-05** | Fluxo de Caixa Realizado e Projetado para 30 dias | Automatizado | Entradas e saídas agrupadas por conta e categoria | **APROVADO** | `stage6.test.ts:660` |
| **FIN-06** | Conciliação bancária física com ajuste facultativo | Automatizado | Diferença apurada e classificada como `BALANCED` | **APROVADO** | `stage6.test.ts:710` |
| **FIN-07** | Exportação de relatórios em CSV sanitizado | Automatizado | Proteção completa contra injeção de fórmulas CSV | **APROVADO** | `stage6.test.ts:740` |
| **FIN-08** | Integração bancária OFX / API Pix Banco Real | Integração Real | Sincronização automática com extrato bancário | **DEPENDÊNCIA EXTERNA** | Pendente Etapa 7 |

---

## 3. RESUMO ESTATÍSTICO DE HOMOLOGAÇÃO
- **Total de Cenários Avaliados:** 32 cenários operacionais.
- **Aprovados (Automatizados / Lógica):** 30 cenários (93,75%).
- **Dependência de Hardware Físico:** 1 cenário (Impressora térmica real com guilhotina e corte de papel).
- **Dependência de Integração Externa:** 1 cenário (API bancária com credenciais de produção).
- **Reprovados ou Bloqueados:** **0 cenários**.
