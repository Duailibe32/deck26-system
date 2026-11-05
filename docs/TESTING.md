# Guia de Testes Automatizados — DECK 26

## 1. Como Executar os Testes

```powershell
# Executar todas as suítes de testes (modo CI/execução única)
npm test

# Executar verificação estrita do compilador TypeScript
npm run typecheck
```

---

## 2. Cobertura Atual (103 Testes Aprovados com 100% de Sucesso)

### `packages/contracts/src/contracts.test.ts` (5 testes de unidade)
- Cálculo exato de totais de comanda em centavos inteiros (sem erro de ponto flutuante).
- Aplicação da paleta oficial do Deck 26 (`#F72585`, `#111111`, `#7209B7`, `#1A1A1A`).
- Validação do catálogo oficial (23 itens do cardápio real + itens de teste isolados).
- Matriz de permissões RBAC por perfil (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `KITCHEN`, `RECEPTION`, `STOCK_CLERK`).
- Geração de tickets térmicos ESC/POS incrementais e cabeçalho de 2ª via.

### `apps/local-server/src/server.test.ts` (30 suítes de integração e ponta a ponta)
- **Etapas 2 e 3**:
  - Persistência independente em disco (Local vs Cloud VPS) e sobrevivência a reinicialização.
  - Pagamentos parciais múltiplos e bloqueio de pagamento acima do saldo devedor.
  - Impressão incremental exclusiva de novos itens por estação.
  - Sincronização bidirecional Local ↔ VPS com idempotência.
  - CRUD completo de categorias e produtos, bloqueio de SKU duplicado, exclusão lógica vs física, preços por canal, fichas técnicas versionadas, estoque Kardex com reversão e QR Code seguro por mesa.
- **Etapa 4 (34 cenários obrigatórios + Fluxo Operacional Completo de 20 passos)**:
  - Abertura de mesa, bloqueio de abertura concorrente duplicada (`HTTP 409`), transferência de mesa, junção e separação de mesas, transferência de itens entre comandas sem baixa duplicada de estoque.
  - Divisão de conta (valor livre, partes iguais, por itens consumidos e pagamento misto), desconto fixo/percentual/cortesia com validação de permissão, configuração de taxa de serviço, cálculo de troco em espécie e estorno autorizado de pagamento.
  - Fila KDS por estação, cálculo de SLA, notificações em tempo real para o garçom (`ORDER_READY`), cancelamento antes/durante/após preparo, proteção de impressão `UNKNOWN_OUTCOME`, reimpressão autorizada de 2ª via e ciclo completo de turno de caixa (abertura, sangria, suprimento e fechamento).

### `apps/local-server/src/hotel.test.ts` (36 testes — Módulo Hoteleiro PMS & E2E)
- **35 Testes Obrigatórios de PMS Hoteleiro**:
  - CRUD de Apartamentos e bloqueio de exclusão física com histórico de estadia (desativação lógica).
  - Triplo eixo de status independente (Ocupação, Governança e Manutenção).
  - Cadastro de hóspedes com LGPD, busca por CPF e minimização de dados.
  - Regra de diárias em centavos e proteção contra sobreposição de reservas `[inA, outA)` vs `[inB, outB)`.
  - Check-in guiado (walk-in e com reserva prévia), geração de comanda Folio `APTO-XXX` e débito da 1ª diária.
  - Razão contábil do Folio (débitos, créditos, sinal de reserva, totalizadores e saldo devedor exato).
  - Integração Restaurante -> Hotel com método `ROOM_CHARGE`, encerramento de mesa, sem duplicar saídas de estoque e sem faturamento duplicado no caixa.
  - Frigobar por apartamento (consumo automático, reposição e débito de estoque).
  - Serviços adicionais de hotelaria (lavanderia, cama extra, café da manhã extra).
  - Pagamentos parciais e mistos no Folio.
  - Check-out obrigatório com saldo zerado (bloqueio de saída com débito pendente).
  - Transição de status no check-out (quarto para `LIVRE` e governança para `SUJO`).
  - Ciclo de governança e camareiras (`SUJO` -> `EM_LIMPEZA` -> `INSPECAO_PENDENTE` -> `LIMPO`).
  - Gestão de manutenção predial com bloqueio e liberação de apartamentos.
  - Métricas hoteleiras em tempo real (Taxa de Ocupação %, ADR, RevPAR, Receitas e Saldos Pendentes).
  - RBAC hoteleiro (`hotel:*`) e eventos no outbox de sincronização offline.
- **Teste de Ponta a Ponta Operacional Hoteleiro (20 passos)**:
  - Ciclo completo e auditado: cadastro de hóspede -> reserva futura com sinal -> check-in com diária -> consumo de restaurante transferido via `ROOM_CHARGE` -> consumo de frigobar -> serviço de lavanderia -> auditoria de extrato do folio -> bloqueio de check-out por saldo pendente -> quitação total via PIX -> check-out bem-sucedido -> transição para `SUJO` -> limpeza aprovada -> chamado de manutenção com interdição -> resolução e liberação final do apartamento.

### `apps/local-server/src/stage6.test.ts` (24 testes — Delivery Próprio, Finanças, DRE e E2E)
- **1. Segurança, Formula Injection e RBAC**:
  - `sanitizeCsvCell` neutraliza injeções (`=`, `+`, `-`, `@`, `\t`, `\r`) com apóstrofo e aspas.
  - Validação estrita de permissões `delivery:*` e `finance:*` por perfil de usuário.
- **2. Motor de Delivery Próprio & Zonas de Entrega**:
  - Taxas fixas por bairro e tempo estimado sem chamadas a APIs pagas.
  - Recálculo seguro no servidor de itens, taxas e descontos.
  - Ciclo de status (`NOVO` -> `CONFIRMADO` -> `EM_PREPARO` -> `PRONTO` -> `SAIU_PARA_ENTREGA` -> `ENTREGUE`).
  - Cancelamento operacional com estorno de estoque no Kardex.
- **3. Despacho & Prestação de Contas (Liquidação de Motoboys)**:
  - Vinculação de entregador com trava de disponibilidade e cálculo de taxa por entrega.
  - Liquidação de pedidos em dinheiro com transferência auditada de custódia para o Caixa Geral.
- **4. Gestão Financeira Integrada & Tesouraria Multi-Contas**:
  - Plano de contas gerencial (`REVENUE`, `DEDUCTION`, `COST_DIRECT`, `EXPENSE_OP`, `FINANCIAL_RESULT`).
  - Centros de custo (`REST`, `BAR`, `DELIV`, `HOTEL`, `ADMIN`) e contas financeiras.
  - Contas a pagar e receber com liquidação multi-meio e crédito/débito em contas.
  - Registro de compras com Nota Fiscal: entrada no estoque Kardex e geração de obrigação no Contas a Pagar.
  - Transferências internas entre contas (sangrias, suprimentos, depósitos).
  - Conciliação manual de contas com apuração de divergências.
- **5. DRE Gerencial por Competência & Invariantes Contábeis**:
  - Invariante 1: Transferência de comanda para quarto (`ROOM_CHARGE`) não duplica receita.
  - Invariante 2: Compra de estoque entra como ativo circulante no Kardex e não gera despesa operacional imediata no DRE; CMV ocorre exclusivamente no consumo real por ficha técnica ou venda.
  - Invariante 3: Prestação de contas de motoboys e transferências entre contas são movimentações de custódia e não alteram o DRE.
  - Fluxo de caixa realizado (entradas/saídas por meio de pagamento) e previsto (projeção diária por vencimento).
  - Exportações CSV seguras de DRE, Vendas, Contas a Pagar e Contas a Receber.
- **6. Teste Ponta a Ponta Operacional Integrado (28 Passos)**:
  - Jornada completa do estabelecimento: abertura de turno de caixa -> cadastro de fornecedor de alimentos -> compra faturada de 100 caldos com entrada no Kardex -> abertura de mesa no salão com pedido de 2 caldos -> avanço na cozinha -> cadastro de cliente delivery -> pedido delivery em dinheiro -> avanço e despacho com motoboy -> entrega e recebimento do dinheiro -> prestação de contas com custódia no caixa -> check-in de hóspede no Hotel Milla -> transferência de comanda do salão para o folio do quarto (`ROOM_CHARGE`) -> serviço de lavanderia no quarto -> check-out com quitação total via PIX -> pagamento de fatura do fornecedor com débito em conta bancária -> sangria do caixa para o cofre -> conciliação de caixa -> apuração final do DRE gerencial com validação de receita bruta, CMV, lucro bruto, despesas operacionais e lucro líquido -> validação do fluxo de caixa realizado -> verificação do painel executivo -> exportação do DRE em CSV sanitizado -> fechamento do turno de caixa com conferência cega.


### `apps/local-server/src/stage6_5_audit.test.ts` (8 testes — Auditoria Geral, Invariantes e Homologação)
- **1. Rigor Matemático e Centavos Inteiros:**
  - Pagamento fracionado em 3 parcelas (PIX, Dinheiro, Débito) liquidando conta de R$ 101,99 com saldo restante exatamente R$ 0,00 (0 centavos perdidos/fantasmas).
  - Idempotência estrita em pagamentos: reenvio com mesma chave idempotente retorna transação idêntica sem duplicar cobrança nem inflar recebimentos.
- **2. Invariantes Contábeis do Caixa e DRE:**
  - Suprimento de caixa gera saldo na gaveta física sem constar como receita bruta na DRE.
  - Sangria de caixa retira saldo da gaveta física sem constar como despesa operacional na DRE.
  - Transferência interna entre contas (ex.: Caixa Geral -> Conta PIX) debita e credita contas do ativo sem impactar faturamento nem lucro líquido.
  - Invariante Crítica do `ROOM_CHARGE`: transferência de comanda de restaurante para o folio hoteleiro reconhece a receita no restaurante por competência, preserva integralmente o valor real das diárias hoteleiras no quarto e rejeita tentativas repetidas de transferência.
- **3. Delivery Próprio e Custódia Transitória:**
  - Prestação de contas do entregador (acerto de dinheiro) transfere custódia da carteira do motoboy para a gaveta do caixa sem registrar uma segunda venda na DRE.
- **4. Segurança e Autorização Granular RBAC:**
  - Garçom e Cozinha recebem `HTTP 403 Forbidden` com log de auditoria ao tentar criar contas bancárias, acessar DRE gerencial ou liquidar acertos de motoboys.
  - Gestão de Contas Bancárias: Proprietário/Gerente pode renomear e desativar contas sem apagar o histórico de transações ou violar integridade referencial.
