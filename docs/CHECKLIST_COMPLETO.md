# DECK 26 — Funcionalidades integradas e roteiro de conferência

Atualização de 06/11/2026. Este roteiro reúne os pedidos de PDV, restaurante, estoque, hotel e delivery. Use uma instalação separada com dados fictícios para gravar o vídeo: confirmar pedidos, pagamentos, consumos e hospedagens na instalação operacional altera seus saldos reais.

## Onde encontrar

| Área | Caminho |
| --- | --- |
| Promoções, couvert, cozinha em papel e refeições internas | Caixa / PDV → Rotinas & café |
| Voucher de café | Caixa / PDV → Rotinas & café → Café do hóspede; no celular, botão ☕ Hóspede |
| Calendário, café, estacionamento e manutenção | Hotel & Quartos → respectivas subabas |
| Pernoite, day use, café incluso e veículo | Novo Check-in → Pacote, café e estacionamento |
| Compras, margens, produção, executivos e baldes | Estoque → Rotinas de compras, margens e produção |
| Empresas, limite de crédito e faturas | Hotel → Convênios; Financeiro → Rotinas de convênios e faturamento |
| Pedidos feitos pelo cliente e repetição | Pedidos → Rotinas de delivery pelo cliente |
| Bairros, taxas e pedido mínimo | Pedidos → Bairros & Taxas |
| Resumo para copiar no WhatsApp | Caixa / PDV → Turno |
| Vias da cozinha e do caixa | Impressoras |
| Link do garçom e link do cliente | Administração → Acesso e continuidade |

Proprietário e gerente podem abrir o modo completo. Menus e ações continuam sujeitos às permissões do cargo. Os 12 apartamentos operacionais seguem a numeração real do cadastro; a atualização não renumera nem libera unidades em construção.

## Preparação da instalação

- [ ] Abrir DECK 26 - Operacao Local e entrar com o PIN pessoal existente.
- [ ] Conferir que hóspedes, estoque, caixa e contas pertencem à instalação correta. A atualização não importa dados da demonstração para a operação.
- [ ] Criar um backup em Administração e guardar a cópia fora do notebook.
- [ ] Revisar preços dos produtos, canais de venda, tarifas, unidades de estoque e fichas técnicas. Produtos sem saldo podem ficar indisponíveis até o inventário.
- [ ] Cadastrar os funcionários com PINs individuais e conferir a visão de cada cargo.
- [ ] Configurar bairros, taxas e pedido mínimo para a entrega. Sem área cadastrada, o cliente ainda pode selecionar retirada.
- [ ] Cadastrar fornecedores, metas de margem, empresas e limites que realmente serão usados. Não foram inventados cadastros comerciais para sua operação.
- [ ] Revisar os horários em Rotinas & café → Couvert & cozinha. O couvert começa desativado; promoções só existem após cadastro.

## PDV e atendimento — mostrar no vídeo

- [ ] Entrar como caixa e como garçom; conferir a abertura na visão do cargo. Gerente pode alternar o modo completo.
- [ ] Abrir uma mesa livre para quatro pessoas usando os atalhos e depois conferir o teclado numérico para outra quantidade.
- [ ] Mostrar mesa livre verde, ocupada amarela e aguardando pagamento vermelha.
- [ ] Mostrar o tempo de mesa aberta e do último pedido. Mesa aberta por mais de dez minutos, sem pedido e sem consumo, deve alertar Aguardando 1º Pedido.
- [ ] Buscar produtos, usar favoritos e identificar cores, ícones e estação de preparo.
- [ ] Montar o pedido no cupom amarelo; aumentar, diminuir, remover e conferir preços e subtotais.
- [ ] Usar observações prontas e digitar uma observação adicional. Conferir que chegam à via da cozinha.
- [ ] Receber uma conta fictícia com teclado touch, somar cédulas e conferir o troco. Confirmar valor não registra o recebimento sozinho.
- [ ] Dividir uma conta por três e conferir que a soma mantém todos os centavos.
- [ ] Gerar o resumo no Turno e copiar o texto para revisão. Conferir restaurante/bar, delivery, hotel, couvert separado, recebimentos, dinheiro esperado, ocupação e estoque baixo.
- [ ] Como gerente, filtrar os Logs e conferir operador, horário e ação de pedidos, recebimentos e cancelamentos.

## Cozinha somente com impressora e comprovantes

- [ ] Selecionar Papel / impressora em Couvert & cozinha. O garçom deve conseguir confirmar a entrega sem depender de uma tela na cozinha.
- [ ] Enviar pedido pelo PDV ou garçom e conferir sua via na fila de Impressoras.
- [ ] Abrir Produção · cozinha: conferir mesa, quantidades, observações em destaque e somente os itens daquele pedido.
- [ ] Conferir os modelos de pré-conta, recibo de pagamento e fechamento, em bobinas de 58 e 80 mm.
- [ ] Simular uma via e conferir que o sistema não informa impressão física concluída. Uma segunda via deve exigir autorização e ter identificação própria.

Ainda não há impressora instalada neste notebook. Os modelos e a fila são funcionais em simulação HTML/PDF; ligação USB/rede e teste físico dependem do equipamento. Não é preciso instalar TV ou KDS para usar o fluxo em papel.

## Promoções, executivos, baldes e consumo interno

- [ ] Cadastrar uma promoção com produto, dias e horário. Conferir o preço no PDV e no cardápio do cliente durante a vigência e o retorno após o horário final.
- [ ] Conferir que duas promoções simultâneas usam o maior desconto e não somam descontos em cascata. Horários seguem America/Fortaleza.
- [ ] Selecionar um executivo em Estoque → Combos e ativar ponto da carne, arroz, feijão e guarnição obrigatórios.
- [ ] Tentar lançar o executivo sem escolhas; depois concluir as escolhas no PDV e no cardápio do cliente.
- [ ] Cadastrar o produto balde/combo com seu preço fechado e vincular cinco unidades da cerveja na composição. Conferir venda de um combo e baixa de cinco unidades individuais.
- [ ] Configurar couvert com aviso ao cliente, valor, dias e horários. Abrir mesa de quatro pessoas durante a vigência e conferir quatro cobranças, separadas dos alimentos e da taxa de serviço.
- [ ] Conferir o aviso de couvert antes da abertura e no cardápio QR durante o horário configurado. Conferir o valor separado no resultado e no resumo para o músico.
- [ ] Registrar refeição de funcionário no centro Restaurante ou Hotel. Conferir baixa dos ingredientes, via de produção e ausência de venda ou recebimento fictício.

As fichas técnicas devem refletir os insumos reais. A configuração de executivo adiciona escolhas; quantidades e vínculos de ingredientes exigem revisão do cadastro. A configuração do balde substitui a receita ativa do produto escolhido: use um produto específico de combo. Ao unir e separar mesas, os couverts já lançados são conservados. No horário de couvert, abra cada mesa com a quantidade real de pessoas antes de unir; separação de couvert após pagamento exige conferência da conta.

## Compras, margens e porcionamento

- [ ] Vincular produtos aos fornecedores e baixar um saldo abaixo do mínimo em uma instalação de demonstração.
- [ ] Conferir a lista por fornecedor, unidade, saldo, mínimo e quantidade sugerida de reposição semanal.
- [ ] Copiar a cotação para WhatsApp e imprimir/salvar em PDF. O programa prepara o conteúdo, sem enviar mensagens.
- [ ] Definir a meta de margem de um produto. Registrar compra de ingrediente com custo maior e conferir o alerta e o novo preço sugerido.
- [ ] Conferir que o preço de venda não muda sozinho. Aplicar a sugestão apenas após revisão.
- [ ] Simular produção de 5 kg de matéria-prima para 20 porções de 220 g e 600 g de aparas aproveitáveis. Conferir massa total, estoque de entrada, saídas e custo.
- [ ] Informar peso divergente ou quantidade sem saldo e conferir o bloqueio integral do lote.
- [ ] Após falha de conexão, usar Reenviar operação original. Não deve haver segundo consumo de ingredientes nem segundo lote.

A reposição usa o consumo observado em 28 dias para estimar uma semana e acrescenta o estoque mínimo. Sem histórico, usa o mínimo. A margem é bruta de insumos: não representa lucro líquido, impostos ou despesas fixas. Na produção, informe gramas por unidade do cadastro; para produto em kg, uma unidade equivale a 1.000 g. Aparas aproveitáveis são saídas; perda é material não aproveitado.

## Hotel, café e estacionamento

- [ ] Abrir o calendário semanal e conferir barras de hospedagem, reserva, entrada/saída e bloqueios nas unidades operacionais.
- [ ] Clicar em um dia livre e conferir o início da reserva com quarto, datas e tarifa do cadastro preenchidos.
- [ ] Fazer check-in fictício por diária e por pernoite com valor informado manualmente.
- [ ] Fazer day use de 4 h ou 6 h e conferir valor único do pacote e saída calculada a partir da entrada.
- [ ] Conferir alerta da recepção 30 minutos antes do vencimento e após o vencimento. Não há multa automática sem lançamento autorizado.
- [ ] Marcar café incluso, quantidade de hóspedes e crédito por pessoa/dia. Não permitir quantidade acima da capacidade do apartamento.
- [ ] Informar placa e modelo do veículo; conferir os indicadores no mapa e na lista Café & pátio.
- [ ] Conferir a lista de cafés da manhã. No horário configurado, deve entrar uma única lista diária na fila de impressão da cozinha, com o servidor ligado.
- [ ] Pelo terminal do garçom, escolher apartamento/voucher, lançar o café e conferir Cortesia Hóspede: o crédito cobre o consumo até o limite; somente o excedente vai para o extrato.
- [ ] Tentar usar o mesmo voucher novamente. Deve ser bloqueado; reenviar a mesma operação confirmada apenas recupera seu resultado.
- [ ] Transferir consumo da mesa ao quarto mediante PIN autorizado, conferir o lançamento único e a mesa enviada à limpeza.
- [ ] Conferir extrato, recebimento e check-out, incluindo recusa de check-out com saldo pendente.
- [ ] Agendar manutenção com intervalo de 90 dias e período de bloqueio. Tentar reservar nesse período, depois concluir a manutenção e conferir reagendamento e liberação.

Pernoite usa o valor do pacote e o horário de saída acordado. Day use calcula 4 ou 6 horas. O café gera um voucher por hóspede por manhã da estadia; o crédito não utilizado não vira dinheiro nem saldo transferível. O resgate depende de hospedagem ativa e do horário de serviço configurado. O custo dos insumos do café é classificado no hotel.

## Empresas e transportadoras

- [ ] Cadastrar empresa, limite de crédito, ciclo quinzenal/mensal e vencimento.
- [ ] Transferir o jantar do hóspede para o quarto antes de consolidar o saldo da hospedagem.
- [ ] Informar quem assinou/conferiu a comanda e lançar o saldo no convênio. Conferir que o folio recebe o crédito de faturamento, sem entrada de dinheiro.
- [ ] Tentar ultrapassar o limite e conferir o bloqueio sem lançamento parcial.
- [ ] Gerar a fatura do período e conferir sua presença no Contas a Receber. Gerar novamente e conferir ausência de duplicação.
- [ ] Conferir que a fatura não conta a receita pela segunda vez. Ao receber o título pelo Financeiro, o limite utilizado deve diminuir.
- [ ] Conferir fechamento automático de períodos encerrados, inclusive após o PC voltar a ligar. O servidor precisa estar ligado para executar a rotina.

O nome de quem assinou registra a conferência da comanda em papel; não é assinatura digital. A emissão fiscal do restaurante e a do hotel continuam separadas da consolidação gerencial do convênio.

## Delivery e QR pelo próprio cliente

- [ ] Abrir o link do cliente com /?delivery=1 no celular da mesma rede do PC. Conferir layout, busca, categorias e destaques por horário, mantendo todas as categorias acessíveis.
- [ ] Escolher executivo e acompanhamentos ou produto simples com observação. Conferir o pedido antes do envio.
- [ ] Informar nome, telefone, entrega/retirada, área e endereço. Conferir taxa, pedido mínimo e total autorizado pelo servidor.
- [ ] Enviar o pedido. Na estação, conferir o aviso e abrir Pedidos dos clientes: antes da aceitação, não deve haver consumo de estoque, cobrança ou impressão de produção.
- [ ] Aceitar o pedido e conferir estoque, conta a receber e via da cozinha. No celular, conferir número e confirmação do pedido.
- [ ] Tentar aceitar sem saldo ou com preço alterado. Deve exigir conferência/reenvio, sem produzir lançamentos parciais.
- [ ] Reenviar o mesmo pedido após falha de conexão e conferir que não duplica.
- [ ] Consultar o último pedido por telefone na estação autorizada, repetir os itens, revisar preço/endereço e confirmar pela fila de pedidos.
- [ ] Com mais de 12 pedidos recebidos/em preparo, conferir a previsão maior. O prazo considera também a região de entrega.
- [ ] Pelo QR de uma mesa aberta, fazer pedido, chamar garçom e pedir conta com PIX/maquininha. Conferir aprovação e sinal vermelho na estação, sem pagamento automático.

Na rede local, o endereço é http://IP-DO-PC:4800/?delivery=1 para o cliente e http://IP-DO-PC:4800/?terminal=garcom para a equipe. Use os links atuais de Administração. O PC e o servidor precisam continuar ligados, na mesma rede e sem isolamento de clientes Wi-Fi. O link não foi publicado na internet. Histórico por telefone é restrito aos operadores autorizados; não é exposto ao cliente público.

## Evidências e limites

A entrega atual possui 227 testes automatizados, incluindo os 182 anteriores, além de verificação de tipos e compilação Windows. As conferências usam bancos temporários: promoção e expiração, escolhas obrigatórias, consumo de cinco unidades por combo, lote com balanço de massa e rollback, café e excedente, convênio sem receita/recebimento duplicado, migração persistente e permissões. A interface foi conferida no navegador, inclusive em largura de celular. O celular físico e a rede do estabelecimento precisam da sua conferência local.

Continuam fora da emissão operacional: certificado A1, XML/assinatura, transmissão direta à SEFAZ/prefeitura, DANFE/QR fiscal oficial e contingência fiscal oficial. Como combinado, essa etapa fiscal foi adiada até haver os dados e o certificado. Impressão física depende das impressoras; envio de WhatsApp e cobrança bancária não são automáticos. Os testes não equivalem a homologação fiscal ou de hardware.

Para as melhorias seguintes de delivery, consulte [CHECKLIST_DELIVERY.md](CHECKLIST_DELIVERY.md).
