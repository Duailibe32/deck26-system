# Política de Segurança e Controle de Acesso — DECK 26

## 1. Princípios de Segurança Adotados

1. **Zero Segredos no Código-Fonte**:
   - Nenhuma senha real de banco de dados, chave privada, certificado fiscal A1 (`.pfx`/`.p12`) ou token pessoal é armazenado no repositório Git.
   - Em produção (`NODE_ENV=production`), o servidor exige obrigatoriamente a variável de ambiente `DECK26_AUTH_SECRET`.
2. **Isolamento de Rede Local por Padrão**:
   - O servidor operacional local (`apps/local-server`) faz bind exclusivamente em `127.0.0.1` por padrão, evitando exposição acidental em redes públicas. O acesso LAN para os celulares dos garçons só é ativado quando `DECK26_ENABLE_LAN=true`.
3. **Autenticação e Controle de Acesso Baseado em Papéis (RBAC)**:
   - Operações sensíveis (aplicação de descontos, isenção de taxa de serviço, cancelamento de pedidos após início do preparo, estorno de pagamentos, sangria de caixa e reimpressão de tickets) exigem permissões específicas (`tabs:discount_or_void`, `cash:manage_shift`, `print:reprint`) restritas aos perfis autorizados (`OWNER`, `MANAGER`, `CASHIER`).
4. **Proteção Antifraude no Cardápio QR Code**:
   - Cada mesa possui um token HMAC não-previsível (`d26qr_mXX_...`), impedindo que terceiros adivinhem URLs sequenciais de outras mesas.
   - Todo cálculo de preço é feito estritamente no servidor a partir do catálogo oficial no SQLite; valores enviados pelo navegador do cliente são ignorados.
5. **Trilha de Auditoria Imutável (`audit_logs`)**:
   - Abertura/transferência/junção de mesas, descontos, estornos, cancelamentos e movimentações de caixa gravam registros de auditoria identificando operador, autorizador, horário e justificativa.

## 2. Permissões Hoteleiras (RBAC PMS — Hotel Auto Posto Milla)

Na Etapa 5, a matriz de RBAC foi expandida com o namespace `hotel:*`:

| Permissão | Finalidade | Perfis Autorizados |
| :--- | :--- | :--- |
| `hotel:manage_rooms` | Criar, editar e desativar apartamentos | `OWNER`, `MANAGER` |
| `hotel:manage_guests` | Cadastrar e editar fichas de hóspedes | `OWNER`, `MANAGER`, `RECEPTIONIST` |
| `hotel:manage_rates` | Configurar diárias e regras tarifárias | `OWNER`, `MANAGER` |
| `hotel:manage_reservations` | Criar, cancelar e reagendar reservas | `OWNER`, `MANAGER`, `RECEPTIONIST` |
| `hotel:checkin_checkout` | Realizar check-in e check-out | `OWNER`, `MANAGER`, `RECEPTIONIST` |
| `hotel:post_charges` | Lançar débitos (frigobar, serviços, restaurante) | `OWNER`, `MANAGER`, `RECEPTIONIST`, `CASHIER` |
| `hotel:housekeeping` | Atualizar status de governança/camareiras | `OWNER`, `MANAGER`, `RECEPTIONIST` |
| `hotel:maintenance` | Abrir e concluir chamados de manutenção | `OWNER`, `MANAGER`, `RECEPTIONIST` |
| `hotel:view_pii` | Visualizar documentos e contatos completos de hóspedes (LGPD) | `OWNER`, `MANAGER` |
| `hotel:reports` | Acessar métricas hoteleiras (ADR, RevPAR, ocupação) | `OWNER`, `MANAGER` |

## 3. Conformidade LGPD e Proteção de Dados de Hóspedes

1. **Princípio da Minimização**:
   - Coletam-se apenas os dados estritamente necessários para a segurança do estabelecimento e cumprimento de obrigações legais hoteleiras (Nome, Documento, Telefone e Placa do Veículo para o estacionamento do Auto Posto Milla).
2. **Proteção de Documentos Pessoais**:
   - Documentos e e-mails de hóspedes não são trafegados no cardápio digital público nem expostos em logs de console em ambiente de produção.
3. **Auditoria de Encerramento com Débito Pendente**:
   - O check-out com saldo em aberto gera um registro de auditoria com gravidade crítica no log de segurança (`audit_logs`), documentando o operador responsável e o saldo devedor perdoado ou negociado.

---

## 4. Permissões de Delivery & Gestão Financeira (RBAC — Etapa 6)

Na Etapa 6, a matriz de RBAC foi estendida com os namespaces `delivery:*` e `finance:*`:

| Permissão | Finalidade | Perfis Autorizados |
| :--- | :--- | :--- |
| `delivery:manage_orders` | Criar, alterar e cancelar pedidos de delivery | `OWNER`, `MANAGER`, `CASHIER` |
| `delivery:manage_couriers` | Cadastrar e gerenciar motoboys e regiões | `OWNER`, `MANAGER` |
| `delivery:settle` | Executar prestação de contas e acerto de entregadores | `OWNER`, `MANAGER`, `CASHIER` |
| `finance:view_overview` | Consultar painel executivo e saldos da tesouraria | `OWNER`, `MANAGER`, `CASHIER` |
| `finance:manage_receivables` | Consultar e liquidar contas a receber | `OWNER`, `MANAGER`, `CASHIER` |
| `finance:manage_payables` | Lançar e pagar obrigações/contas a pagar | `OWNER`, `MANAGER` |
| `finance:manage_accounts` | Gerenciar contas bancárias, cofres e caixas | `OWNER`, `MANAGER` |
| `finance:transfers` | Executar transferências internas de numerário | `OWNER`, `MANAGER` |
| `finance:reconcile` | Efetuar conciliação manual de contas | `OWNER`, `MANAGER` |
| `finance:view_dre` | Consultar DRE gerencial por competência | `OWNER`, `MANAGER` |
| `finance:manage_suppliers` | Cadastrar e gerenciar fornecedores | `OWNER`, `MANAGER`, `STOCK_CLERK` |
| `finance:export_reports` | Exportar relatórios gerenciais e contábeis em CSV | `OWNER`, `MANAGER` |

---

## 5. Mitigação de CSV Formula Injection (Excel / Calc)

O DECK 26 implementa proteção nativa contra ataques de injeção de fórmulas CSV (CWE-1236):
- Qualquer valor de célula iniciando com `=`, `+`, `-`, `@`, `\t` ou `\r` é automaticamente prefixado com apóstrofo (`'`) via `sanitizeCsvCell()`.
- Células contendo aspas, vírgulas ou quebras de linha são delimitadas e escapadas como `""`.
- Impede a execução de comandos DDE, chamadas de shell ou macros maliciosas quando operadores abrem relatórios no Microsoft Excel ou LibreOffice Calc.

---

## 6. Auditoria de Segurança e Modo Estrito (Etapa 6.5)

Na Etapa 6.5, foram consolidados os seguintes reforços de segurança:
1. **Ativação Automática de Modo Estrito de Autenticação:**
   - Em produção (`NODE_ENV=production`) ou quando `DECK26_STRICT_AUTH=true`, o servidor desativa qualquer fallback permissivo em loopback e exige tokens com assinatura HMAC-SHA256 válida.
2. **Auditoria de Endpoints Financeiros:**
   - As rotas executivas `/api/finance/dre`, `/api/finance/cash-flow/*` e `/api/finance/dashboard` foram protegidas com verificação obrigatória de `finance:view_dre`.
   - Perfis de garçom e cozinha recebem `HTTP 403 Forbidden` com log de auditoria ao tentar acessar dados da tesouraria.
3. **Análise de Dependências:**
   - O código de produção não utiliza pacotes vulneráveis conhecidos; os alertas do `npm audit` estão circunscritos a ferramentas de desenvolvimento/teste (`vitest`, `esbuild`) e já possuem restrições documentadas para a Etapa 7.
