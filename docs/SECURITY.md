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
