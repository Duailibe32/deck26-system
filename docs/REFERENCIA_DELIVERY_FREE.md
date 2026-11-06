# Delivery-free como referência para o DECK 26

Análise de 06/11/2026 · leitura estática do repositório público, sem instalação ou execução do WordPress. Nenhum código, layout ou dependência do projeto foi incorporado ao DECK 26.

**Referência:** [eusougabrielgadelha/delivery-free](https://github.com/eusougabrielgadelha/delivery-free), apresentado como Delivery Hub. A versão examinada corresponde ao commit [aa748dd](https://github.com/eusougabrielgadelha/delivery-free/tree/aa748ddefc5c9e6c6959a57eae13fea13eb627ea).

> **Atualização:** as melhorias de agenda, painel, sugestões, CEP, acompanhamento e expedição foram implementadas posteriormente em código próprio. Veja [entrega e validação](MELHORIAS_DELIVERY_20261106.md). A comparação abaixo registra o estado anterior.

## O que vale observar

O projeto concentra o atendimento de delivery em um tema WordPress/PHP: cardápio, carrinho, adicionais, checkout, quadro de pedidos e comunicação com WhatsApp. O README descreve recursos que podem servir como referência de experiência de uso; essa descrição não foi tratada como comprovação de funcionamento. [Apresentação do projeto](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/README.md).

| Ideia | Benefício para o Deck 26 | Situação no Deck 26 e proposta |
| --- | --- | --- |
| **Pedidos em colunas, com tempo por etapa** | Facilita identificar o próximo pedido e atrasos. | Já existem estados e ações de avanço no delivery. Uma visualização Kanban e metas por etapa seriam evolução de interface, preservando as transições e permissões do servidor. |
| **Loja aberta, fechada ou pausada** | Evita receber pedidos quando a cozinha não consegue atender. | Há promoções e destaques por horário, mas isso não equivale ao fechamento da loja. Propor agenda de atendimento, exceções e pausa com aviso ao cliente e bloqueio no servidor. |
| **Sugestões no carrinho** | Permite oferecer bebida ou acompanhamento antes de finalizar. | Já há escolhas obrigatórias e observações. Sugestões opcionais podem ser acrescentadas, sempre com escolha explícita e preço/estoque conferidos pelo servidor. |
| **Endereço assistido por CEP** | Reduz digitação no celular. | Avaliar preenchimento como auxílio; manter edição manual e funcionamento quando o serviço de CEP estiver indisponível. Não deduzir taxa apenas do endereço sugerido. |
| **Acompanhamento em linha do tempo** | Esclarece se o pedido foi aceito, preparado ou saiu. | O cliente já acompanha a confirmação do pedido. Uma linha do tempo com etapas de produção e entrega seria melhoria adicional. |
| **Etiqueta de embalagem** | Ajuda a conferir sacola, itens e destinatário. | Já há modelos de cozinha e caixa em simulação. Um modelo de expedição pode complementar a fila, após definir o equipamento. |
| **Atalho para mensagem de WhatsApp** | Facilita comunicação durante o atendimento. | O Deck 26 já gera textos para copiar. Um atalho revisável pode ser considerado; não representa integração automática nem confirmação de envio. |

A implementação de horários e pausas pode ser observada em [inc/store-hours.php](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/inc/store-hours.php). O quadro administrativo está em [admin/pdv.php](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/admin/pdv.php). Esses arquivos foram lidos; não foram executados.

## Cuidados encontrados na leitura

### Identificação de cliente apenas por telefone

No código examinado, as rotas públicas de consulta de cliente e de pedidos por telefone usam permissão aberta. A consulta de cliente retorna nome e endereços salvos, sem comprovar que o solicitante controla o número. O próprio arquivo registra a ausência de OTP. A rota de detalhe do pedido só compara o telefone quando esse parâmetro é informado. Isso é uma evidência de risco no código, não uma exploração de um site em produção. [Fonte: inc/rest.php](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/inc/rest.php#L8).

Para o Deck 26, manter a consulta por telefone restrita aos operadores. Uma futura área do cliente precisará de autenticação que comprove a identidade ou de acesso limitado ao pedido por identificador secreto, sem liberar histórico e endereços só por conhecer o telefone.

### WhatsApp é um link, não um serviço de envio

O código monta uma URL `wa.me` com a mensagem; o navegador tenta abri-la após registrar o pedido. O usuário ainda depende do WhatsApp e da confirmação de envio. Portanto, esse mecanismo não comprova entrega da mensagem nem substitui a gravação do pedido na API. [Montagem da mensagem](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/inc/whatsapp.php) · [Checkout no navegador](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/assets/js/app.js#L419).

### Licença com restrições

O arquivo declara **PolyForm Noncommercial 1.0.0**, e também inclui um resumo em português sobre utilização em lojas próprias e serviços. Não é uma licença permissiva como MIT. As condições precisam ser esclarecidas antes de qualquer reutilização comercial de código ou ativos. Esta análise usa o projeto somente como referência de funcionalidades; não importa seu código nem transfere sua licença ao Deck 26. [Licença do projeto](https://github.com/eusougabrielgadelha/delivery-free/blob/aa748ddefc5c9e6c6959a57eae13fea13eb627ea/LICENSE).

## Ordem sugerida para uma próxima melhoria do delivery

1. **Disponibilidade da loja:** horários, exceções e pausa temporária, com validação no servidor.
2. **Painel de expedição:** colunas, contador de tempo e indicação clara de pedidos atrasados; ações autorizadas e auditadas.
3. **Experiência do cliente:** categorias mais fáceis de navegar, sugestões opcionais, endereço assistido e acompanhamento visual.
4. **Conferência da saída:** etiqueta de embalagem e revisão de taxa, endereço, itens e responsável.
5. **Relacionamento:** área do cliente somente com identificação segura; mensagens sempre separadas de pagamento e confirmação fiscal.

Essas são propostas, não funcionalidades implementadas nesta revisão documental. A arquitetura atual do Deck 26 continua TypeScript, React, Fastify, Tauri e SQLite; não foi instalado WordPress, nem houve alteração nos fluxos financeiros, no programa ou nos dados operacionais.
