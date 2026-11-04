# Guia de Testes Automatizados — DECK 26

## 1. Como Executar os Testes

```powershell
# Executar todas as suítes de testes (modo CI/execução única)
npm test

# Executar verificação estrita do compilador TypeScript
npm run typecheck
```

---

## 2. Cobertura Atual (35 Suítes Aprovadas)

### `packages/contracts/src/contracts.test.ts` (5 testes de unidade)
- Cálculo exato de totais de comanda em centavos inteiros (sem erro de ponto flutuante).
- Aplicação da paleta oficial do Deck 26 (`#F72585`, `#111111`, `#7209B7`, `#1A1A1A`).
- Validação do catálogo oficial (23 itens do cardápio real + itens de teste isolados).
- Matriz de permissões RBAC por perfil (`OWNER`, `MANAGER`, `CASHIER`, `WAITER`, `KITCHEN`, `RECEPTION`, `STOCK_CLERK`).
- Geração de tickets térmicos ESC/POS incrementais e cabeçalho de 2ª via.

### `apps/local-server/src/server.test.ts` (30 suítes de integração e ponta a ponta)
- **Etapas 2 e 3**:
  - Persistência independente em disco (Local vs Cloud VPS) e sobrevivência a reinicialização.
  - Pagamentos parciais múltiplos e bloqueio de pagamento acima do saldo devedor.
  - Impressão incremental exclusiva de novos itens por estação.
  - Sincronização bidirecional Local ↔ VPS com idempotência.
  - CRUD completo de categorias e produtos, bloqueio de SKU duplicado, exclusão lógica vs física, preços por canal, fichas técnicas versionadas, estoque Kardex com reversão e QR Code seguro por mesa.
- **Etapa 4 (34 cenários obrigatórios + Fluxo Operacional Completo de 20 passos)**:
  - Abertura de mesa, bloqueio de abertura concorrente duplicada (`HTTP 409`), transferência de mesa, junção e separação de mesas, transferência de itens entre comandas sem baixa duplicada de estoque.
  - Divisão de conta (valor livre, partes iguais, por itens consumidos e pagamento misto), desconto fixo/percentual/cortesia com validação de permissão, configuração de taxa de serviço, cálculo de troco em espécie e estorno autorizado de pagamento.
  - Fila KDS por estação, cálculo de SLA, notificações em tempo real para o garçom (`ORDER_READY`), cancelamento antes/durante/após preparo, proteção de impressão `UNKNOWN_OUTCOME`, reimpressão autorizada de 2ª via e ciclo completo de turno de caixa (abertura, sangria, suprimento e fechamento).
