# DECK 26 — Sistema de Gestão Integrada (Bar, Restaurante e Hotel Auto Posto Milla)

Sistema comercial **Offline-First** e **Cloud-Synced** desenvolvido para o **Deck 26 / Hotel Auto Posto Milla**, preparado para execução e testes 100% locais no Windows 11 sem necessidade de contratar VPS ou domínio durante a fase de desenvolvimento.

---

## 1. Como Iniciar Todo o Sistema com Dois Cliques (Windows 11)

Para facilitar o seu uso no dia a dia, você tem **duas maneiras simples** de ligar todos os serviços de uma só vez:

### Opção A — Pelo Arquivo Inicializador Automático (`.bat`)
Basta dar **dois cliques** no arquivo:
- [`INICIAR-DECK26-DEV.bat`](file:///c:/Users/duail/OneDrive/Desktop/Duailibe%20Estudos%20IA/-%20Loja%20Web/INICIAR-DECK26-DEV.bat)

Ele verifica automaticamente o Node.js, as dependências, checa se as portas estão livres e inicia os 4 serviços locais simultaneamente.

### Opção B — Pelo Terminal (Comando Único)
Abra o terminal na pasta do projeto e digite:
```powershell
npm run dev:all
```

---

## 2. Endereços (URLs) para Abrir no seu Navegador

Assim que o sistema iniciar, abra o navegador (Chrome ou Edge) nos seguintes endereços:

1. **Programa Principal do Estabelecimento (Dashboard, Caixa/PDV, Mesas, Comandas, Hotel, Estoque, Impressoras)**:
   - `http://localhost:5173`
2. **Tela Exclusiva da Cozinha / Chapa (KDS)**:
   - `http://localhost:5173/?terminal=cozinha`
3. **Tela de Lançamento de Garçom**:
   - `http://localhost:5173/?terminal=garcom`
4. **Site Público (Cardápio Digital QR Code, Delivery, Hotel Milla e Painel Remoto do Proprietário)**:
   - `http://localhost:5174`
5. **Saúde dos Servidores (APIs)**:
   - Servidor Operacional Local (SQLite): `http://127.0.0.1:4000/api/health`
   - Simulador Local da VPS (SQLite): `http://127.0.0.1:4100/api/health`

---

## 3. PINs Operacionais de Teste (Autenticação Real no Backend)

No topo direito do Programa Principal (`http://localhost:5173`), clique no botão roxo **`🔐 Autenticar PIN`** para alternar entre os perfis reais validados no servidor:
- **Proprietário (Acesso Total)**: `2626`
- **Gerente Geral**: `1010`
- **Operador de Caixa / PDV**: `2020`
- **Garçom**: `3030`
- **Cozinha (KDS)**: `4040`
- **Recepção do Hotel Milla**: `5050`
- **Estoquista**: `6060`

---

## 4. Bancos de Dados Independentes e Persistentes

Os dados **não são perdidos** quando você fecha o terminal ou reinicia o Windows:
- **Banco do Estabelecimento Local**: salvo automaticamente em `data/deck26-local.sqlite`.
- **Banco da VPS Simulada**: salvo separadamente em `data/deck26-cloud-vps.sqlite`.
- Ambos estão protegidos no `.gitignore` para nunca expor dados comerciais no Git.

---

## 5. Comandos de Verificação e Testes Automatizados

```powershell
npm test          # Executa os 11 testes automatizados (Unidade + Integração)
npm run typecheck # Verifica os tipos TypeScript nos 6 pacotes
npm run build     # Gera os pacotes de produção do programa Windows e do Site Web
```
