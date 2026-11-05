# Checklist de aceitação — operação local DECK 26

Responsável: __________  Data: __________

Marque somente após verificar. Impressão virtual não homologa equipamento ou emissão fiscal. Os relatórios dependem de cadastros, custos e saldos reais conferidos.

## Preparação e dados próprios

- [ ] **Abrir o atalho operacional** — A janela informa Operação Local; não abre a demonstração nem o banco de testes.
- [ ] **Criar o responsável** — No PC, cadastrar nome e PIN próprio de 6 a 12 dígitos. PINs antigos de demonstração não dão acesso.
- [ ] **Revisar o cardápio importado** — Conferir os 93 produtos, categorias, preços, canais, modificadores e disponibilidade.
- [ ] **Revisar os apartamentos** — Conferir numeração, características, tarifas e os 12 quartos em obras; não reservar unidades indisponíveis.
- [ ] **Conferir base financeira vazia** — Sem vendas, hóspedes, pagamentos, contas ou saldos fictícios. Cadastrar somente dados reais e conciliados.
- [ ] **Cadastrar estoque inicial** — Contar o estoque e registrar entradas com motivo; produtos bloqueados por falta de estoque não podem ser vendidos.
- [ ] **Conferir custos e fichas técnicas** — Preencher custos e ingredientes reais antes de usar CMV, margem e lucro para decisões.
- [ ] **Configurar identificação** — Salvar nome, endereço, telefone e bobinas 58/80 mm na Administração.

## Operadores e acesso

- [ ] **Cadastrar perfis** — Criar operadores individuais de caixa, garçom, cozinha, recepção e gestão, com PINs próprios.
- [ ] **Recusar PIN incorreto** — Não liberar módulos, dados financeiros ou hóspedes antes de autenticar.
- [ ] **Testar permissões** — Garçom não acessa tesouraria, documentos pessoais, administração ou cadastros gerenciais.
- [ ] **Trocar e desativar acesso** — Alterar PIN/desativar um operador invalida a sessão anterior. Preservar pelo menos um proprietário ativo.
- [ ] **Sair e trocar operador** — Voltar ao login com PIN vazio e sem dados do operador anterior na interface.

## Rede local e celular

- [ ] **Conferir a rede** — PC e celulares na rede confiável do estabelecimento; não usar Wi-Fi de visitantes para dados operacionais.
- [ ] **Abrir o link do garçom** — No celular, abrir o endereço exibido na Administração, porta 4800 e terminal=garcom.
- [ ] **Entrar como garçom** — Usar o PIN individual; visualizar mesas e cardápio, com layout sem rolagem horizontal.
- [ ] **Sincronizar celular e PC** — Abrir uma mesa/lancar pedido no celular e conferir a atualização no PC em poucos segundos.
- [ ] **Confirmar servidor desligado** — Encerrar a operação local e confirmar que o celular perde conexão; reabrir pelo atalho e recuperar os dados.
- [ ] **Conferir interrupção de rede** — Não informar pedido confirmado se a resposta não chegar; reenviar com a mesma chave sem duplicar.

## Mesas, pedidos e cozinha

- [ ] **Abrir mesa livre** — Mesa verde muda para ocupada/amarela, com operador e quantidade de pessoas corretos.
- [ ] **Enviar itens e observações** — Produtos, quantidades, adicionais e observações chegam à mesa e à fila da cozinha.
- [ ] **Separar pedidos incrementais** — O segundo pedido da mesma mesa gera somente sua própria via de produção.
- [ ] **Avançar preparo** — Cozinha avança recebido, em preparo e pronto; o garçom confirma entrega sem refazer a baixa de estoque.
- [ ] **Aprovar pedido QR** — Cliente acessa o cardápio pelo QR/link da mesa; pedido aguarda aprovação quando essa política está ligada.
- [ ] **Solicitar conta** — Mesa fica vermelha; valores da pré-conta correspondem ao consumo, serviço e descontos autorizados.
- [ ] **Transferir e unir mesas** — Consumo acompanha a comanda correta e permanece auditado, sem duplicar pedidos ou recebimentos.
- [ ] **Cancelar por estágio** — Antes do preparo, estornar estoque; durante/depois do preparo, exigir autorização e motivo conforme a regra.

## Caixa e recebimentos

- [ ] **Abrir turno** — Informar troco inicial real, operador e conferir que não existe abertura duplicada.
- [ ] **Receber parcialmente** — Exemplo de conta conhecida: receber uma parcela e conferir o saldo restante exato em centavos.
- [ ] **Conferir dinheiro e troco** — Valor entregue, pagamento aplicado e troco devem conciliar com o caixa.
- [ ] **Registrar PIX/cartão manual** — Conferir a confirmação externa antes do registro. O sistema local não efetua cobrança bancária automática.
- [ ] **Finalizar e liberar mesa** — Após quitar, encerrar comanda e liberar a mesa, seguindo limpeza/atendimento.
- [ ] **Fazer sangria e suprimento** — Conferir caixa/cofre e motivos; transferência interna não é receita de venda.
- [ ] **Estornar pagamento** — Exigir autorização/motivo e conferir a reversão no saldo e na auditoria.
- [ ] **Fechar o caixa** — Conferir contado versus esperado, divergência justificada e comprovantes.

## Impressoras virtuais — sem equipamento

- [ ] **Abrir os quatro modelos** — Conferir produção, pré-conta, recibo de pagamento e fechamento de exemplo; nenhum modelo movimenta financeiro.
- [ ] **Conferir a via da cozinha** — Exibir mesa, itens novos, quantidades, adicionais, observações, horário e identificação; não incluir pedidos antigos.
- [ ] **Conferir a via do caixa** — Pré-conta e recibo se distinguem; pagamento parcial e saldo restante correspondem ao banco.
- [ ] **Verificar simulação automática** — Depois do pedido/recebimento, existir HTML em impressoes-simuladas com identificação da via virtual.
- [ ] **Simular bobinas 58 e 80 mm** — Conferir quebras de texto, nomes longos, acentos, totais e tamanho físico na prévia/Salvar como PDF.
- [ ] **Autorizar segunda via** — Marcar cópia adicional e operador; repetir o mesmo comando não gera uma terceira impressão por acidente.
- [ ] **Não confundir com papel físico** — Status via simulada não equivale a PRINTED em equipamento e não gera documento fiscal.

## Hotel e recepção

- [ ] **Cadastrar hóspede/reserva** — Conferir dados necessários e acesso por perfil; não expor documentos ao garçom.
- [ ] **Validar disponibilidade** — Recusar sobreposição, obras, manutenção, bloqueio ou quarto sujo.
- [ ] **Fazer check-in** — Diárias e período corretos; ocupação atualizada sem incluir quartos em obras no denominador operacional.
- [ ] **Transferir restaurante ao quarto** — Consumo aparece no folio; não receber duas vezes nem duplicar receita.
- [ ] **Lançar minibar/serviços** — Consumo e estoque coerentes; reposição de minibar não vira venda.
- [ ] **Receber e fazer checkout** — Recebimento atualiza tesouraria; dívida só permite override gerencial justificado e auditado.
- [ ] **Conferir governança** — Após saída, quarto fica para limpeza; liberar somente após conclusão e inspeção aplicáveis.

## Delivery

- [ ] **Cadastrar zona e entregador** — Usar taxas, clientes, endereços e operadores corretos.
- [ ] **Despachar e entregar** — Avançar pedido uma só vez; não permitir entrega/cancelamento indevido de pedido encerrado.
- [ ] **Conferir custódia em dinheiro** — Enquanto com o entregador, o valor está na carteira de custódia, não no caixa físico.
- [ ] **Acertar entregador** — Transferir valores e separar remuneração; repetir acerto deve ser recusado sem novo movimento.

## Financeiro, estoque e relatórios

- [ ] **Registrar compra/entrada** — Nota, fornecedor, estoque, custo e obrigação a pagar devem se relacionar.
- [ ] **Liquidar pagar/receber** — Conferir valor parcial/final, conta financeira, método e saldo restante.
- [ ] **Conferir transferências** — Saída e entrada compensam; patrimônio consolidado não cresce por transferência entre contas.
- [ ] **Conferir fluxo por período** — Saldo inicial + entradas - saídas = saldo final; datas históricas não usam o saldo corrente.
- [ ] **Conferir DRE e centros de custo** — Receita/custos/despesas coerentes; hotel/restaurante/delivery sem duplicação. Dias dos relatórios atuais usam UTC.
- [ ] **Conferir gráficos** — Volume diário e ocupação correspondem às bases; dias sem venda aparecem zerados.

## Continuidade e liberação

- [ ] **Criar backup consistente** — Usar Administração; localizar o arquivo, conferir tamanho e guardar cópia em local separado.
- [ ] **Ensaiar restauração em cópia** — Abrir um backup em ambiente isolado e conferir integridade e amostras; nunca sobrescrever o banco ativo.
- [ ] **Fechar/reabrir o programa** — Dados e credenciais permanecem; a base de testes continua separada da operacional.
- [ ] **Validar horários e fechamento** — Conferir relógio do PC, datas de movimento e relatórios antes de fechar o primeiro turno.
- [ ] **Homologar impressoras físicas depois** — Quando os equipamentos existirem: driver/USB ou rede, corte, papel, offline, retomada e segunda via.
- [ ] **Homologar emissão fiscal antes do uso fiscal** — Configurar certificado, UF/município e fornecedor com contabilidade. Esta instalação não emite NFC-e/NFS-e autorizadas.
- [ ] **Aprovar a operação assistida** — Resolver itens com falha antes de atender clientes sem acompanhamento; registrar responsável e data.
