# Prévia comercial da Etapa 7A

apps/web é uma demonstração independente em React. Não acessa SQLite, não autentica operadores e não emite documentos fiscais. O perfil Administrador demo é fictício.

O estado versionado deck26-demo-v3 é persistido em localStorage do próprio navegador. Reiniciar demonstração repõe somente esses dados fictícios. Busca e categorias organizam o catálogo de exemplo; cada mesa mantém seus itens e recebimentos. O fluxo permite pagamento parcial, recibo de exemplo, transferência para hospedagem, check-in/checkout e avanço de delivery sem conclusão duplicada.

Gráficos Recharts responsivos usam recebimentos de exemplo e ocupação simulada. A tabela de valores permite leitura sem depender do desenho do gráfico. A interface Windows usa o mesmo componente visual, mas consulta API autenticada e receita bruta da DRE; as definições financeiras são indicadas na tela.

Identidade: paleta fornecida pelo proprietário, Plus Jakarta Sans, superfícies neutras e logo original enquadrada visualmente a partir do arquivo fornecido. A fonte tem fallback; não há novas fotografias inventadas dos apartamentos ou pratos.

A 7B ainda precisa definir hospedagem e fluxos públicos reais; publicar o build desta prévia não cria reservas reais, pagamentos ou emissão fiscal.
