# DECK 26 — INVARIANTES FINANCEIRAS E DIRETRIZES CONTÁBEIS

Este documento estabelece as leis matemáticas, contábeis e transacionais que regem todas as operações financeiras do ecossistema integrado **DECK 26 — Hotel Auto Posto Milla**.

---

## 1. PRINCÍPIO DA FONTE ÚNICA DA VERDADE (SINGLE SOURCE OF TRUTH)

Cada evento econômico no sistema DECK 26 possui uma única origem geradora rastreável, impedindo dupla contagem:
1. **Consumo de Salão/Balcão:** A fonte da receita é a Comanda (`tabs`), gerada pelos itens de pedidos (`orders` + `order_items`).
2. **Hospedagem e Diárias:** A fonte da receita são os lançamentos operacionais de quarto (`hotel_folio_entries` com `entry_type = 'ROOM_RATE'`).
3. **Delivery Próprio:** A fonte da receita é o pedido de delivery (`delivery_orders`), discriminando itens e taxa de entrega.
4. **Liquidação Financeira (Caixa / Banco):** Os pagamentos (`payments` ou `financial_transactions`) são quitações de obrigações/direitos creditórios gerados pelas fontes acima, e não novos fatos geradores de receita.

---

## 2. ARITMÉTICA EM CENTAVOS INTEIROS (ZERO GHOST CENTS)

1. **Proibição de Ponto Flutuante:** É terminantemente vedado o armazenamento de valores monetários em tipos IEEE 754 float/double em bancos de dados ou contratos. Todos os valores são tratados como `INTEGER` de centavos (`amount_cents`).
2. **Propriedade da Aditividade Estrita:**
   $$\text{Saldo Restante} = \text{Total Devido} - \sum \text{Pagamentos Confirmados}$$
3. **Exemplo Homologado:**
   - Total da conta: R$ 101,99 ($10.199\text{ c}$)
   - Parcela 1 (PIX): R$ 40,00 ($4.000\text{ c}$) $\to$ Saldo: $6.199\text{ c}$
   - Parcela 2 (Dinheiro): R$ 30,50 ($3.050\text{ c}$) $\to$ Saldo: $3.149\text{ c}$
   - Parcela 3 (Débito): R$ 31,49 ($3.149\text{ c}$) $\to$ Saldo: $0\text{ c}$
   - Erro permitido: **$0,00$ centavos**.

---

## 3. INVARIANTES DO TURNO DE CAIXA FÍSICO (PDV)

1. **Sangria NÃO é Despesa:**
   - Sangria é uma transferência física de numerário da gaveta operacional para o cofre ou conta bancária.
   - Impacta o saldo físico da gaveta: $\text{Saldo}_{\text{novo}} = \text{Saldo}_{\text{anterior}} - \text{Valor}$.
   - **Efeito na DRE:** Zero. Não pode ser classificada como despesa operacional.
2. **Suprimento NÃO é Receita:**
   - Suprimento é o aporte de fundos de troco na gaveta.
   - Impacta o saldo físico da gaveta: $\text{Saldo}_{\text{novo}} = \text{Saldo}_{\text{anterior}} + \text{Valor}$.
   - **Efeito na DRE:** Zero. Não pode ser classificada como receita bruta.
3. **Transferência Entre Contas Financeiras:**
   - Movimentação entre Contas do Ativo Circulante (ex.: Caixa Geral $\to$ Banco do Brasil).
   - Débito em uma conta, crédito em outra de igual valor.
   - **Efeito na DRE:** Zero.

---

## 4. REGIME DE COMPETÊNCIA (DRE) VS. REGIME DE CAIXA (FLUXO DE CAIXA)

| Conceito | Regime de Competência (DRE Gerencial) | Regime de Caixa (Fluxo de Caixa Realizado) |
|:---|:---|:---|
| **Fato Gerador** | Ocorrência da entrega da refeição ou disponibilização da diária hoteleira | Entrada ou saída efetiva de dinheiro ou compensação bancária |
| **Venda a Prazo** | Reconhecida integralmente como Receita Bruta na data da venda | Reconhecida somente nas datas de liquidação das parcelas |
| **Compra de Insumos** | Apenas o que for consumido nas vendas entra como CMV (Kardex). Compras vão para o Ativo (Estoque). | Saída de caixa integral na data do pagamento ao fornecedor |
| **Adiantamento de Reserva** | Passivo (Adiantamento de Clientes). Não é receita até o check-in. | Entrada de caixa imediata na conta bancária ou PIX |

---

## 5. INVARIANTE DO `ROOM_CHARGE` (TRANSFERÊNCIA DE COMANDA PARA FOLIO)

Quando um hóspede do Hotel Auto Posto Milla consome no Restaurante/Bar Deck 26 e transfere a conta para o apartamento:
1. **Na Comanda do Restaurante:**
   - É registrado um pagamento com o método `ROOM_CHARGE`.
   - A comanda é encerrada (`status = 'CLOSED'`).
   - A Receita Bruta de Restaurante/Bar é reconhecida pela competência do encerramento da comanda.
2. **No Folio da Hospedagem:**
   - É inserida uma entrada de débito (`source_reference_type = 'TAB'`, `source_reference_id = tab.id`).
   - O saldo do quarto aumenta pelo valor exato da comanda transferida.
3. **Na DRE Gerencial:**
   - A diária do hotel (`ROOM_RATE`) permanece inalterada.
   - O lançamento de `ROOM_CHARGE` no folio é **excluído** da soma de receita hoteleira (`source_reference_type != 'TAB'`).
   - A receita é atribuída ao Centro de Custo do Restaurante/Bar.
   - **Garantia:** Não há redução da diária de hotel e não há duplicação da receita de restaurante.
4. **Idempotência de Transferência:**
   - Uma comanda já transferida ou já encerrada não pode ser transferida novamente.
   - O sistema valida a existência prévia de `source_reference_id = tab.id` e rejeita a operação com erro explícito.

---

## 6. INVARIANTE DE CUSTÓDIA DO DELIVERY PRÓPRIO

1. **Dinheiro Arrecadado pelo Entregador:**
   - Quando um motoboy entrega um pedido pago em dinheiro, o valor recebido fica sob **custódia transitória** na carteira do entregador (`COURIER_WALLET`).
2. **Prestação de Contas (Acerto):**
   - Ao retornar ao estabelecimento, o entregador repassa o dinheiro ao Caixa Geral (`CASH_DRAWER`).
   - O sistema gera um `DeliverySettlement` (`status = 'SETTLED'`).
   - O saldo da carteira do motoboy é liquidado e o saldo do caixa é creditado.
   - **Garantia:** O repasse ao caixa **NÃO** gera uma segunda receita de venda na DRE. A receita do pedido foi reconhecida na entrega e o acerto é meramente uma transferência de custódia física de numerário.

---

## 7. CUSTO DAS MERCADORIAS VENDIDAS (CMV) BASEADO EM KARDEX

1. **Fórmula do CMV:**
   $$\text{CMV} = \sum_{\text{movimentos}} |\text{quantity\_delta}| \times \text{unit\_cost\_cents}$$
   Onde os movimentos pertencem a `SALE_DEDUCTION` ou `RECIPE_CONSUMPTION`.
2. **Isolamento de Compras:** Compras de mercadorias (`PURCHASE_ENTRY` via notas fiscais) alimentam o estoque e a conta de Fornecedores a Pagar. Compras não são CMV até que a mercadoria seja efetivamente consumida ou vendida.
