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
