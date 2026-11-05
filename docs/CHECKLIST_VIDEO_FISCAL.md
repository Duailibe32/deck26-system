# DECK 26 — Checklist de testes e roteiro de vídeo fiscal

Data da preparação: 05/11/2026. Este roteiro demonstra a base fiscal e o simulador local. Não demonstra emissão fiscal real ou homologação SEFAZ.

## Como abrir

Use o atalho **DECK 26 - Ensaio Fiscal**. O navegador abre http://127.0.0.1:4802. PIN exclusivo da apresentação: **536821**. A pasta `%USERPROFILE%\Deck26\EnsaioFiscal` é separada dos dados operacionais. Mantenha aberta a janela do lançador; ao terminar, confirme OK para desligar somente o ensaio.

## Vídeo sugerido: 5 a 8 minutos

- 0:00–0:45: identificação do ensaio e bloqueio de emissão real.
- 0:45–1:45: emitentes separados e revisão de produtos.
- 1:45–3:00: conferência integral da Mesa 20 no caixa, sem pagamento.
- 3:00–5:30: aprovação, rejeição, timeout com consulta e offline.
- 5:30–6:30: prévia térmica, histórico e próximos requisitos.

## Preparação antes da gravação

- [ ] Abrir o atalho DECK 26 - Ensaio Fiscal; usar somente o PIN de apresentação 536821.
- [ ] Confirmar a faixa roxa EN­SAIO PARA APRESENTAÇÃO e que a operação real está em outra janela.
- [ ] Usar dados de exemplo; não exibir CPF de cliente, certificado, senha ou CSC.

## Configuração e isolamento

- [ ] Abrir Fiscal e mostrar Emissão real bloqueada e a lista de pendências.
- [ ] Mostrar Restaurante · NFC-e e Hotel · NFS-e com cadastros separados.
- [ ] Salvar campos vazios ou dados disponíveis sem inventar CNPJ ou tributação; voltar à tela para conferir a persistência.
- [ ] Selecionar Produção futura e mostrar que isso NÃO habilita a transmissão. Não apresentar isso como homologação oficial.

## Produtos e conferência no caixa

- [ ] Buscar um produto e mostrar que os códigos fiscais iniciam vazios nesta preparação.
- [ ] Mostrar que os dados preenchidos são encaminhados para revisão, não aprovados automaticamente. Não inventar códigos para a gravação.
- [ ] Abrir Caixa / PDV e localizar a comanda da Mesa 20 na instalação de apresentação.
- [ ] Clicar Conferência fiscal · todos os itens, deixar CPF vazio e clicar Conferir todos os itens.
- [ ] Comparar quantidade, subtotal, serviço, desconto e total com a comanda. Mostrar que a conferência não recebe dinheiro nem encerra a mesa.
- [ ] Opcional: informar 11111111111 e demonstrar a rejeição do CPF inválido. Não usar CPF pessoal no vídeo.

## Cenários do simulador

- [ ] Em Fiscal → Ensaio para apresentação, executar Aprovação simulada e mostrar o total fixo de R$ 50,00.
- [ ] Mostrar o aviso NÃO É NOTA FISCAL, ausência de chave/protocolo/QR fiscal e nenhum envio à SEFAZ.
- [ ] Executar Rejeição simulada e mostrar a mensagem e o histórico.
- [ ] Executar Resposta desconhecida / timeout e mostrar o estado aguardando consulta.
- [ ] Clicar Consultar resposta simulada; conferir o mesmo identificador e duas etapas no histórico, sem novo ensaio.
- [ ] Executar Sem conexão / ensaio offline e explicar que não equivale à contingência fiscal válida.
- [ ] Voltar a um ensaio aprovado, cancelar o ensaio e mostrar o registro no histórico.

## Prévia, continuidade e conclusão

- [ ] Salvar a prévia HTML; abrir e conferir a identificação de ensaio e os itens completos.
- [ ] Atualizar a página, entrar novamente e conferir que o histórico permanece.
- [ ] Confirmar que caixa, recebimentos e documentos fiscais reais não foram criados pelos ensaios.
- [ ] Encerrar o vídeo explicando as pendências: A1, dados da empresa, tributação, assinatura/XSD, conexão real, eventos, contingência oficial e homologação.
- [ ] Fechar o navegador e confirmar OK na janela do lançador para desligar apenas o ensaio.

## O que ainda não está implementado

Upload/leitura de A1, cofre criptográfico de credenciais, assinatura XMLDSig, XML validado em XSD, SOAP/mTLS com SEFAZ, QR Code fiscal, DANFE oficial, autorização/cancelamento/inutilização reais, contingência válida e NFS-e. A numeração desta preparação é somente planejamento; ensaios não consomem números. Não há APIs fiscais comerciais ou novos custos por nota. Certificado e manutenção continuam sendo custos possíveis.

## Referências para a etapa real

- [Manuais oficiais da NF-e/NFC-e](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE%3D)
- [Notas técnicas oficiais](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D)

Os esquemas, notas técnicas, regras da UF e enquadramento contábil devem ser verificados novamente na implementação real. Não presumir dispensa por comida/dinheiro ou obrigatoriedade apenas por CPF/PIX/cartão.
