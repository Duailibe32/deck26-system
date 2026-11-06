# DECK 26 — Conferência do PDV touch

Entrega de 06/11/2026. Faça a gravação com dados fictícios em uma instalação separada. A aparência de cupom é uma conferência do pedido; não é documento fiscal nem comprovação de impressão física.

## Acesso

Abra o atalho **DECK 26 - Operacao Local** e entre com seu PIN pessoal. No celular da mesma rede, use o endereço indicado em Administração com `/?terminal=garcom`. O PC precisa continuar ligado e com o servidor aberto. Não há alteração de PINs nem de cadastros nesta atualização.

## Roteiro para mostrar ao gerente

- [ ] Entrar como garçom e conferir a visão de mesas; entrar como caixa e conferir o PDV. Proprietário/gerente podem alternar entre modo simplificado e completo.
- [ ] Abrir **Mesas**, escolher uma mesa livre e selecionar quatro pessoas pelos atalhos.
- [ ] Digitar outro número no teclado grande, apagar um dígito, limpar e confirmar. Zero não permite abrir mesa.
- [ ] Abrir a mesa e localizar produtos usando busca e categorias. Os favoritos usam o histórico aceito dos últimos 90 dias; sem histórico, mostram acesso rápido ao catálogo.
- [ ] Mostrar as cinco famílias: carnes/terracota, cuscuz e tapiocas/dourado, petiscos/laranja, sucos/verde e cafeteria/caramelo. Os selos também indicam o nome da estação de preparo cadastrada.
- [ ] Adicionar produtos e observar o cupom amarelo sendo preenchido à direita.
- [ ] Aumentar, diminuir e remover itens no próprio cupom. Conferir quantidade, preço unitário, total de linha e subtotal.
- [ ] Usar observações prontas e digitar uma observação adicional. Conferir que opções obrigatórias do produto continuam sendo exigidas.
- [ ] Enviar o pedido e conferir sua presença na conta. O subtotal do rascunho não é o total final com serviço/descontos.
- [ ] Abrir **Receber**, escolher dinheiro e digitar o valor pelo teclado. A entrada é em centavos: `1 0 0 0` significa R$ 10,00.
- [ ] Alternar entre **Valor a receber** e **Dinheiro entregue**. Confirmar valor somente preenche o campo; **Confirmar recebimento** registra o pagamento.
- [ ] Somar cédulas ilustradas de R$ 10, R$ 20, R$ 50, R$ 100 e R$ 200. Conferir o contador de notas e limpar.
- [ ] Em uma conta fictícia de R$ 27,00, informar R$ 50,00 e conferir troco de R$ 23,00. Um valor insuficiente deve impedir a confirmação.
- [ ] Dividir um saldo por três e conferir a distribuição dos centavos, sem perder parte do total.
- [ ] Conferir PIX/crédito/débito. São registros internos; não cobram automaticamente no banco ou na maquininha.
- [ ] Encerrar a comanda quitada e conferir a mesa em limpeza; liberar após a higienização.
- [ ] Abrir o terminal do garçom no celular. Conferir cores, observações e o pedido em formato de cupom. No celular estreito, o cupom fica na aba **Pedido**; em tablet largo, aparece ao lado do cardápio.
- [ ] No QR de uma mesa aberta, chamar garçom ou pedir conta. Conferir o alerta vermelho e assumir o atendimento. Pedir conta não registra pagamento.
- [ ] Com uma hospedagem fictícia ativa, transferir um saldo de mesa ao apartamento mediante PIN autorizado. Conferir o lançamento único no extrato e a mesa em limpeza. A transferência segue a exigência de turno aberto do sistema.
- [ ] Como gerente/proprietário, abrir **Logs** e filtrar pedidos, cancelamentos, pagamentos e transferências. Conferir operador e horário.

## Evidências da validação

- 182 testes automatizados aprovados, incluindo os 169 anteriores.
- Verificação de tipos de todos os espaços de trabalho aprovada.
- Compilação Windows nativa aprovada.
- Navegador com base isolada: abertura para quatro pessoas; pedido de R$ 27,00; entrada touch de R$ 50,00; troco R$ 23,00 e saldo zerado.
- Terminal móvel conferido em largura de 390 px: selo de categoria, observação livre e cupom com controles de quantidade.
- Testes de API: chamado QR repetido sem duplicação/pagamento; auditoria protegida; transferência repetida produz um único lançamento, sem entrada de dinheiro fictícia.

## Limites desta entrega

Esta entrega conclui o PDV touch, as visões por função, o componente de auditoria, os chamados QR e a transferência visual confirmada. Não representa a conclusão dos pedidos adicionais de calendário de reservas, vouchers de café, convênios, promoções, produção interna, manutenção e delivery público pelo cliente. Esses recursos ainda precisam de implementação e validação próprias. A impressão física e o motor fiscal direto SEFAZ também permanecem pendentes.
