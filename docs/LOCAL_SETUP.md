# Guia de Configuração e Execução Local (Windows 11) — DECK 26

## 1. Requisitos do Ambiente Local

- **Sistema Operacional**: Windows 11 (64-bit)
- **Memória RAM**: 8 GB mínimo (16 GB recomendado)
- **Node.js**: versão `22.5.0` ou superior (suporte nativo ao módulo `node:sqlite`)
- **npm**: versão `10.0.0` ou superior
- **Git**: versão `2.40+`
- *(Opcional para empacotamento nativo `.exe`)*: Rust (`cargo` / `rustc`), Microsoft Edge WebView2 e Microsoft C++ Build Tools para compilação do binário Tauri 2.

---

## 2. Instalação Inicial

```powershell
# 1. Clonar o repositório privado
git clone https://github.com/Duailibe32/deck26-system.git
cd deck26-system

# 2. Instalar todas as dependências do monorepositório
npm install

# 3. Criar arquivo de ambiente local a partir do modelo
Copy-Item .env.example .env
```

---

## 3. Executando Todos os Serviços Localmente

### Método 1: Duplo clique no arquivo `.bat`
Execute `INICIAR-DECK26-DEV.bat` na raiz do projeto. Ele valida o Node.js, verifica se as portas `4000`, `4100`, `5173` e `5174` estão livres e inicia os 4 serviços em paralelo.

### Método 2: Via Terminal
```powershell
npm run dev:all
```

---

## 4. Como Testar nos Celulares dos Garçons na Mesma Rede Wi-Fi

Por segurança, o servidor local inicia escutando apenas em `127.0.0.1` (loopback). Quando desejar conectar os celulares dos garçons e o tablet da cozinha na mesma rede Wi-Fi do estabelecimento:

1. No arquivo `.env`, defina:
   ```ini
   DECK26_ENABLE_LAN=true
   ```
2. Reinicie o servidor local (`npm run dev:all`).
3. Veja o endereço IPv4 local exibido no topo do painel Windows (ex.: `192.168.1.15`) e acesse nos celulares:
   - Garçom: `http://192.168.1.15:5173/?terminal=garcom`
   - Cozinha (KDS): `http://192.168.1.15:5173/?terminal=cozinha`
