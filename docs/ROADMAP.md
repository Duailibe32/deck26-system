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

---

## Próximas Etapas Planejadas

- **Etapa 5 — Gestão Hoteleira Completa (Hotel Auto Posto Milla)**:
  - Reservas por período, check-in/check-out completo, lançamento de diárias, frigobar, governança/limpeza de quartos e transferência detalhada de comandas do restaurante para a conta do hóspede.
- **Etapa 6 — Delivery Próprio, Financeiro e Relatórios Gerenciais**:
  - Gestão de entregas, taxas por bairro/região, contas a pagar/receber, fluxo de caixa consolidado, DRE operacional e curva ABC de produtos.
- **Etapa 7 — Homologação de Hardware, Fiscal SEFAZ e Deploy em Produção**:
  - Integração com impressoras térmicas físicas ESC/POS, Certificado Digital A1 para NFC-e/NF-e e publicação na Hostinger VPS.
