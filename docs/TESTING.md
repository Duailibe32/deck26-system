# Testes e validação

> Atualização de 06/11/2026: 241 testes aprovados, checagem de tipos, smoke das APIs e compilação Windows. Veja [estoque, fotos e atendimento](MELHORIAS_ESTOQUE_CARDAPIO_20261106.md). Os números de revisões anteriores abaixo são históricos.

Execute na raiz: npm ci, npm run typecheck, npm test, npm run build e npm audit --audit-level=moderate.

Em 05/11/2026: 140 testes em oito arquivos aprovados, além de scripts/smoke-runtime.mjs, que importa e inicia as duas APIs pelo Node e verifica integridade referencial. O smoke existe porque o ciclo de importação fiscal passava pelo Vitest e impedia a inicialização real.

A suíte usa memória e diretórios temporários descartáveis; não apontar testes para bancos operacionais. Fixtures de demonstração e permissividade de autenticação são opções explícitas dos testes; o acesso permissivo sem cabeçalho só existe para loopback no modo isolado. Tokens inválidos continuam recusados.

apps/local-server/src/hardening.test.ts verifica acesso, PII, validade de sessão, login, produção sem fixtures, idempotência, movimentos financeiros, estornos, custódia, caixa, fluxo histórico, rollback PMS, DRE, auditoria e cloud. O dashboard é testado com receita de entrega real na API, repetição sem duplicação, sete dias incluindo zeros e controle de acesso.

apps/web/src/demo.test.ts verifica estados independentes das mesas, recebimentos parciais, transferência ao quarto, quartos indisponíveis e conclusão única de entrega fictícia.

Confira também no navegador: carregamento sem erros, busca, navegação, botões, modais com teclado, gráficos em largura desktop e celular, tabela de valores, mapa de mesas e autenticidade das legendas. Capturas estão em docs/images.

A CI usa Node 22.13 no Linux, instalação pelo lockfile, auditoria de dependências, tipos, testes e build. A compilação frontend não constrói um instalador Tauri nem homologa dispositivos ou emissão fiscal. Consulte REVISAO_PRE_7B.md para limites operacionais.
