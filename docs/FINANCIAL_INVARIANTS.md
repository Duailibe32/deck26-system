# Invariantes financeiras

## Valores e origem

Valores monetários são centavos inteiros. Pagamentos e lançamentos críticos exigem inteiros positivos seguros, salvo créditos do folio, representados como valores negativos com tipo coerente. Receber dinheiro não cria uma segunda venda.

- Receita de restaurante/bar: comanda encerrada, origem dos itens e estação de preparo.
- Receita de delivery: pedido entregue, incluindo taxa; confirmação repetida não gera nova entrada.
- Receita de hotel: lançamentos do folio; consumo transferido da comanda não é contado duas vezes. Pagamentos são quitações, não receita adicional.
- Centros de custo e filtros abrangem receita, custos e despesas. O antigo rateio fixo 70/30 foi removido; custos mistos de pedidos seguem o valor proporcional dos itens por origem.

## Tesouraria e custódia

Pagamento confirmado de restaurante e pagamento direto do folio geram movimento e atualizam a conta na mesma transação. Estorno do pagamento reverte o movimento de origem. Valores em espécie do folio também entram na conferência do turno.

Dinheiro entregue ao motoboy pertence à carteira de custódia, não ao caixa físico. O acerto transfere a custódia para a conta escolhida e registra a remuneração como despesa. IDs duplicados, outro entregador, pedido não entregue e acerto repetido são recusados sem efeito financeiro.

Sangria é transferência ao cofre. Suprimento é entrada de capital, não venda. Cartões são direcionados a uma conta bancária simplificada; recebíveis da adquirente, taxas e chargebacks devem ser conciliados com documentação específica.

## Atomicidade e idempotência

Recebimentos, estornos, folio, checkout, transferências, acertos e operações compostas usam transações com savepoints. Reutilizar uma chave de pagamento com dados divergentes é recusado; reutilizar a mesma chave e mesmos dados devolve o registro original.

Checkout com saldo exige gerente/proprietário ativo e justificativa auditada. Sem override válido, nenhuma etapa deve persistir. A suíte força falha intermediária e confirma rollback.

## Fluxo histórico

Saldo inicial vem do capital das contas existente no início do período e de movimentos anteriores; saldo final inclui movimentos até o fim. Capital de contas criadas depois do início aparece como aporte. A equação exigida é saldo inicial + entradas - saídas = saldo final. Consultas históricas não usam o saldo corrente como saldo passado.

A DRE e o dashboard diário usam os dias UTC da persistência atual. O dashboard mostra receita bruta, com dias sem vendas zerados, e não equivale a recebimentos de caixa ou extrato bancário.

## Histórico existente

As correções valem para novas operações. Movimentos antigos ausentes ou duplicados não são inferidos nem reparados automaticamente. Faça backup, compare caixa/banco/entregadores com extratos e documente os ajustes sob responsabilidade financeira. Os testes não constituem homologação contábil.
