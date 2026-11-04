# Roadmap do Projeto — DECK 26

## Etapas Concluídas

- **Etapa 1 — Fundação Arquitetural e Identidade Visual**:
  - Monorepositório TypeScript, paleta oficial Rosa/Preto/Roxo (`#F72585`, `#111111`, `#7209B7`), contratos compartilhados e separação de entidades operacionais.
- **Etapa 2 — Ambiente Local Windows 11, Persistência Dual e Validação**:
  - Persistência independente em disco (`deck26-local.sqlite` e `deck26-cloud-vps.sqlite`), pagamentos parciais, impressão incremental, autenticação por PIN HMAC e script inicializador `.bat`.
- **Etapa 3 — Cadastro Inteligente de Produtos, Cardápio Digital, Estoque e Integração Comercial**:
  - Catálogo único integrado aos 6 canais comerciais, preços diferenciados por canal, fichas técnicas versionadas, estoque Kardex com reversão auditável e QR Code criptográfico por mesa.
- **Etapa 4 — Operação Profissional de Mesas, Comandas, Garçons, Cozinha e Caixa**:
  - Gestão visual de mesas (estado físico × financeiro), proteção transacional de concorrência, transferência e junção/separação de mesas, transferência de itens entre comandas, divisão de contas, descontos, taxa de serviço, KDS com SLA e SSE em tempo real, cancelamento por estágio, recuperação de impressão térmica e turno de caixa completo.
- **Etapa 4.5 — Publicação Profissional no GitHub Privado e Documentação Técnica**:
  - Auditoria completa de segurança, documentação técnica (`README.md` + `docs/*`), pipeline CI GitHub Actions e backup em repositório privado `deck26-system`.
- **Etapa 5 — Gestão Hoteleira Completa (Hotel Auto Posto Milla)**:
  - Sistema PMS completo: cadastro de apartamentos com triplo status independente (Ocupação, Governança e Manutenção), fichas de hóspedes LGPD, reservas multi-diárias com proteção de sobreposição `[in, out)`, check-in guiado com abertura de Folio e lançamento da 1ª diária, extrato de conta auditável, transferência de consumo do restaurante Deck 26 via `ROOM_CHARGE` sem dupla baixa de estoque e sem faturamento antecipado no caixa, frigobar por quarto, serviços adicionais, check-out com exigência de saldo zerado, painel de camareiras, chamados de manutenção e métricas hoteleiras ADR, RevPAR e Ocupação %.
- **Etapa 6 — Delivery Próprio, Gestão Financeira Integrada, DRE Gerencial por Competência e Relatórios**:
  - Central de delivery próprio, zonas e taxas fixas por bairro sem APIs de mapas pagas, gestão e despacho de motoboys, prestação de contas com custódia no caixa;
  - Plano de contas gerencial, centros de custo (`REST`, `BAR`, `DELIV`, `HOTEL`, `ADMIN`), tesouraria multi-contas (caixas, cofres, bancos, carteiras), contas a pagar e receber operacionais;
  - Registro de notas fiscais de compra com entrada de estoque no Kardex (ativo circulante) e geração de obrigação no Contas a Pagar;
  - Demonstrativo do Resultado do Exercício (DRE) gerencial por competência com invariantes contábeis estritas (sem duplicidade em `ROOM_CHARGE`, CMV por consumo real);
  - Fluxo de caixa realizado (regime de caixa) e previsto (projeção diária por vencimento);
  - Central de exportação de relatórios em CSV protegida contra CSV Formula Injection (`sanitizeCsvCell`);
  - 95 testes automatizados aprovados (incluindo teste E2E integrado de 28 passos).

---

## Próximas Etapas Planejadas

- **Etapa 7 — Homologação de Hardware, Fiscal SEFAZ e Deploy em Produção**:
  - Integração com impressoras térmicas físicas ESC/POS, Certificado Digital A1 para NFC-e/NF-e e publicação na Hostinger VPS com PostgreSQL 16.
