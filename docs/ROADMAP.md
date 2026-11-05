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

- **Etapa 6.5 — Auditoria Geral, Correção de Falhas, Homologação Operacional e Preparação para Produção**:
  - Auditoria profunda em 13 fases abrangendo integridade referencial, concorrência, consistência contábil e segurança;
  - Resolução de flakiness de datas em testes automatizados (`new Date()` vs datas fixas);
  - Refatoração da query de DRE para isolamento estrito de diárias hoteleiras, garantindo que lançamentos de `PAYMENT` no folio não reduzam receita bruta e que `ROOM_CHARGE` não duplique faturamento;
  - Bloqueio de rotas financeiras via RBAC com `HTTP 403 Forbidden` para garçons e cozinha;
  - Modo estrito de autenticação ativado automaticamente em produção (`NODE_ENV === 'production'`);
  - 103 testes automatizados aprovados (100% de sucesso);
  - Criação dos documentos `AUDIT_STAGE_6_5.md`, `FINANCIAL_INVARIANTS.md`, `OPERATIONAL_ACCEPTANCE.md`, `PREPRODUCTION_CHECKLIST.md` e `BACKUP_AND_RECOVERY.md`.
- **Etapa 7A — Demonstração Online Comercial + Hotel (24 Apartamentos) + Cardápio Oficial (93 Produtos) + Preparação Fiscal Multi-CNPJ**:
  - **Hotel Auto Posto Milla (24 Apartamentos)**: 12 operacionais ativos (Aptos 101-112) e 12 em construção civil (Aptos 201-212) com commercialStatus `EM_CONSTRUCAO`; bloqueio estrito de reservas, check-ins e lançamento de diárias para quartos em obras; exclusão matemática dos quartos em obras do denominador de Taxa de Ocupação % e RevPAR; assistente modal desktop completo para edição gerencial de atributos, tarifas e transição de status;
  - **Cardápio Oficial DECK 26 (93 Produtos)**: Catálogo oficial com exatamente 93 produtos em 10 categorias estruturadas (Pratos Executivos: 11, Tapiocas: 7, Para Qualquer Hora: 7, Cuscuz Recheado: 7, Pastéis: 8, Lanches: 9, Petiscos: 21, Cafeteria: 7, Sucos 300ml: 9, Vitaminas 300ml: 7); SKUs padronizados, preços por canal, estações de preparo e metadados fiscais; pendência documental catalogada para `D26-CZ-005` ("Cuscuz de carne de sol sem catupiry");
  - **Demonstração Online Comercial (Mobile-First)**: Interface responsiva em `apps/web` com 7 módulos operacionais completos (Dashboard, Cardápio 93 itens com busca e filtros, Mesas & Salão, Hotel 24 apts, Delivery Próprio, DRE & Caixa e Simulador Fiscal); tarja persistente de dados fictícios sem risco de confusão operacional; modo de fallback autônomo com zero backend, garantindo funcionamento contínuo mesmo com servidor desligado;
  - **Preparação Fiscal Multi-Estabelecimento**: Segregação formal de estabelecimentos: Restaurante (CNPJ Matriz `12345678000190` - ICMS/NFC-e Mod 65) vs Hotel (CNPJ Filial `12345678000271` - ISS/NFS-e Municipal); distinção jurídica e funcional entre Comanda de Mesa, Pré-Conta conferencial (sem validade fiscal), Comprovante de Pagamento (máquina POS) e Documento Fiscal eletrônico; simulação de emissão com chave de acesso de 44 dígitos e tarja legal "SEM VALIDADE FISCAL - DEMO";
  - **Testes & Qualidade**: 16 novos testes automatizados (3 em contracts + 13 em stage7a), elevando a suíte total para **119 testes automatizados 100% aprovados**; typecheck e build completos em todos os 6 pacotes do monorepositório.

---

## Próximas Etapas Planejadas

- **Etapa 7B — Publicação da Demonstração na Nuvem (Vercel / Netlify)**:
  - Publicação do frontend `apps/web` no plano gratuito sem custos de servidor;
  - Disponibilização do link público e QR Code para apresentação comercial a clientes.
- **Etapa 8 — Homologação de Hardware, Fiscal SEFAZ e Deploy em Produção**:
  - Integração com impressoras térmicas físicas ESC/POS via Spooler Windows;
  - Emissão real de NFC-e (Mod 65) e NFS-e com Certificado Digital A1;
  - Implantação do servidor cloud em VPS com banco de dados PostgreSQL 16+.
