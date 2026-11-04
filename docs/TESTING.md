# Guia de Testes Automatizados — DECK 26

## 1. Como Executar os Testes

```powershell
# Executar todas as suítes de testes (modo CI/execução única)
npm test

# Executar verificação estrita do compilador TypeScript
npm run typecheck
```

---

## 2. Cobertura Atual (71 Testes Aprovados com 100% de Sucesso)

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

### `apps/local-server/src/hotel.test.ts` (36 testes — Módulo Hoteleiro PMS & E2E)
- **35 Testes Obrigatórios de PMS Hoteleiro**:
  - CRUD de Apartamentos e bloqueio de exclusão física com histórico de estadia (desativação lógica).
  - Triplo eixo de status independente (Ocupação, Governança e Manutenção).
  - Cadastro de hóspedes com LGPD, busca por CPF e minimização de dados.
  - Regra de diárias em centavos e proteção contra sobreposição de reservas `[inA, outA)` vs `[inB, outB)`.
  - Check-in guiado (walk-in e com reserva prévia), geração de comanda Folio `APTO-XXX` e débito da 1ª diária.
  - Razão contábil do Folio (débitos, créditos, sinal de reserva, totalizadores e saldo devedor exato).
  - Integração Restaurante -> Hotel com método `ROOM_CHARGE`, encerramento de mesa, sem duplicar saídas de estoque e sem faturamento duplicado no caixa.
  - Frigobar por apartamento (consumo automático, reposição e débito de estoque).
  - Serviços adicionais de hotelaria (lavanderia, cama extra, café da manhã extra).
  - Pagamentos parciais e mistos no Folio.
  - Check-out obrigatório com saldo zerado (bloqueio de saída com débito pendente).
  - Transição de status no check-out (quarto para `LIVRE` e governança para `SUJO`).
  - Ciclo de governança e camareiras (`SUJO` -> `EM_LIMPEZA` -> `INSPECAO_PENDENTE` -> `LIMPO`).
  - Gestão de manutenção predial com bloqueio e liberação de apartamentos.
  - Métricas hoteleiras em tempo real (Taxa de Ocupação %, ADR, RevPAR, Receitas e Saldos Pendentes).
  - RBAC hoteleiro (`hotel:*`) e eventos no outbox de sincronização offline.
- **Teste de Ponta a Ponta Operacional Hoteleiro (20 passos)**:
  - Ciclo completo e auditado: cadastro de hóspede -> reserva futura com sinal -> check-in com diária -> consumo de restaurante transferido via `ROOM_CHARGE` -> consumo de frigobar -> serviço de lavanderia -> auditoria de extrato do folio -> bloqueio de check-out por saldo pendente -> quitação total via PIX -> check-out bem-sucedido -> transição para `SUJO` -> limpeza aprovada -> chamado de manutenção com interdição -> resolução e liberação final do apartamento.
