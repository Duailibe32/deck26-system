# DECK 26 — CHECKLIST DE PRÉ-PRODUÇÃO E READINESS OPERACIONAL

Este documento reúne todas as especificações técnicas, requisitos de infraestrutura, topologia de rede, segurança e procedimentos de contingência necessários para a futura implantação em produção do sistema **DECK 26 — Hotel Auto Posto Milla**.

> [!IMPORTANT]
> **ESTA ETAPA NÃO É A IMPLANTAÇÃO EM PRODUÇÃO.**
> Nenhuma VPS foi contratada, nenhum domínio público foi apontado e nenhuma credencial fiscal/bancária real foi inserida nesta etapa.

---

## 1. REQUISITOS DE HARDWARE E SISTEMA OPERACIONAL

### 1.1. Servidor Local e Terminal Caixa Principal (PDV)
- **Sistema Operacional:** Windows 11 Pro 64-bit (ou Windows 10 Pro 22H2 64-bit).
- **Processador:** Intel Core i5 / AMD Ryzen 5 (4 núcleos / 8 threads ou superior).
- **Memória RAM:** 16 GB (mínimo recomendado para rodar Tauri 2 + Node.js + SQLite WAL com folga).
- **Armazenamento:** SSD NVMe de 256 GB ou superior (imprescindível para operações de I/O em banco SQLite WAL).
- **Nobreak (UPS):** Nobreak senoidal de no mínimo 1200 VA com autonomia mínima de 20 minutos para suportar quedas de energia e permitir encerramento seguro.

### 1.2. Dispositivos Móveis dos Garçons e Camareiras
- Tablets ou smartphones Android 11+ ou iOS 15+.
- Navegador moderno (Google Chrome ou Safari) com suporte a WebSockets/SSE e Service Workers.

---

## 2. TOPOLOGIA DE REDE E COMUNICAÇÃO LOCAL

1. **Roteador Wi-Fi Dedicado (Dual-Band Wi-Fi 6):**
   - Rede Wi-Fi exclusiva para a operação (`DECK26-OPERACIONAL`), isolada da rede de clientes (`DECK26-CLIENTES`).
   - Fixação de IP Estático no Servidor Local (ex.: `192.168.1.100/24`).
2. **Mapeamento de Portas Locais:**
   - `4000`: API REST e SSE do Servidor Local (`apps/local-server`).
   - `4100`: Simulador VPS / Cloud API (`apps/cloud-api`).
   - `9100`: Porta padrão de rede para impressoras térmicas ESC/POS (TCP Raw).
3. **Isolamento de Segurança:**
   - Proibição de abertura direta de portas (port forwarding) no roteador para o servidor local. A comunicação externa deve ocorrer exclusivamente através da saída para a VPS segura.

---

## 3. POLÍTICA DE SEGURANÇA E CREDENCIAIS

1. **Segredo de Assinatura de Sessões (`DECK26_AUTH_SECRET`):**
   - Em produção, é **obrigatória** a definição da variável de ambiente com chave aleatória de 64 caracteres hexadecimais:
     ```powershell
     [System.Environment]::SetEnvironmentVariable('DECK26_AUTH_SECRET', '<gerar_hash_sha256_aleatorio>', 'Machine')
     ```
   - O servidor local aborta a inicialização se executado em `NODE_ENV=production` sem esse segredo.
2. **Substituição de PINs de Desenvolvimento:**
   - Todos os colaboradores devem cadastrar PINs individuais de 4 a 6 dígitos na primeira inicialização.
   - Os PINs demonstrativos padrão (`1234`, `0000`, `9999`) devem ser substituídos imediatamente.
3. **Auditoria de Acesso:**
   - Todas as operações sensíveis (abertura/fechamento de caixa, sangria, suprimento, cancelamento de comanda, desconto acima de 10% e check-out com saldo em aberto) geram registro imutável em `audit_logs`.

---

## 4. PREPARAÇÃO DO INSTALADOR WINDOWS (TAURI 2)

### 4.1. Auditoria de Pré-Requisitos no Host de Build
- [x] Node.js 22 LTS instalado e verificado.
- [x] Rust 1.80+ e Cargo instalados.
- [x] Microsoft Visual Studio Build Tools 2022 (C++ x64/x86 build tools).
- [x] WebView2 Runtime presente nativamente no Windows 11.
- [ ] Certificado Digital de Código (Code Signing) para Windows (necessário na Etapa 7 para evitar avisos do SmartScreen).

### 4.2. Estrutura de Diretórios em Produção
- **Executável Principal:** `C:\Program Files\Deck26\Deck26.exe`
- **Banco de Dados Operacional:** `C:\ProgramData\Deck26\data\deck26-local.sqlite`
- **Logs Operacionais:** `C:\ProgramData\Deck26\logs\`
- **Backups Locais:** `C:\ProgramData\Deck26\backups\`

---

## 5. PENDÊNCIAS EXTERNAS E HARDWARE REAL (ETAPA 7)

| Item | Tipo | Descrição | Status para Etapa 6.5 |
|:---|:---:|:---|:---:|
| **Impressora Térmica 80mm** | Hardware | Instalação física das impressoras ESC/POS (Balcão, Cozinha, Bar) | **Aguardando Hardware** |
| **Certificado Digital A1** | Fiscal | Certificado e-CNPJ da empresa para emissão de NFC-e/NF-e | **Aguardando Fiscal** |
| **Credenciais SEFAZ MA** | Fiscal | Token CSC e credenciais de homologação/produção SEFAZ Maranhão | **Aguardando Fiscal** |
| **Credenciais de Adquirência** | Financeiro | Chaves de API do Stone/Cielo/Mercado Pago para TEF/PIX dinâmico | **Aguardando Contrato** |
| **Servidor VPS Nuvem** | Infraestrutura | Contratação de VPS Linux (Debian/Ubuntu) para sincronização remota | **Aguardando Etapa 7** |
