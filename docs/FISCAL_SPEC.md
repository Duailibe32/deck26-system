# DECK 26 — ESPECIFICAÇÃO DO MÓDULO FISCAL PREPARATÓRIO
## Separação Estrutural, Multi-Estabelecimento, Tipos Documentais e Simulação SEFAZ

**Documento:** `docs/FISCAL_SPEC.md`  
**Versão:** 1.0.0 (Etapa 7A)  
**Data:** 05/11/2026  
**Status:** Implementado no Local-Server, Contratos e Demonstração Web

---

## 1. DISTINÇÃO JURÍDICA E OPERACIONAL DOS DOCUMENTOS

O DECK 26 estabelece uma divisão taxativa entre 4 conceitos que frequentemente são confundidos em sistemas PDV amadores:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HIERARQUIA DOCUMENTAL                          │
├─────────────────────────┬──────────────────────┬───────────────────────┤
│ Entidade                │ Natureza Jurídica    │ Finalidade Principal  │
├─────────────────────────┼──────────────────────┼───────────────────────┤
│ 1. Comanda (Tab)        │ Controle Interno     │ Agrupamento de itens  │
│ 2. Pré-Conta            │ Conferência de Mesa  │ Conferência pelo cliente│
│ 3. Comprovante Pagto    │ Recibo Financeiro    │ Comprovante de TEF/Pix│
│ 4. Documento Fiscal     │ Obrigação Tributária │ Transmissão SEFAZ/Pref│
└─────────────────────────┴──────────────────────┴───────────────────────┘
```

### 1.1 Comanda (`Tab`)
- **Definição:** Entidade transacional interna agregadora de consumo por mesa, balcão, quarto ou delivery.
- **Validade:** Exclusivamente operacional interna. Não é impressa como documento fiscal.

### 1.2 Pré-Conta (`PrintJob` / `TAB_BILL_PREVIEW`)
- **Definição:** Cupom emitido pela impressora do caixa ou bar a pedido do garçom para conferência prévia pelo cliente antes de efetuar o pagamento.
- **Invariante Visual:** Deve conter obrigatoriamente no cabeçalho e rodapé os dizeres em destaque:
  `*** CONFERÊNCIA DE CONTA - NÃO É DOCUMENTO FISCAL ***`

### 1.3 Comprovante de Pagamento (`PAYMENT_RECEIPT`)
- **Definição:** Recibo emitido após a transação financeira (via maquininha TEF, dinheiro ou Pix).
- **Validade:** Prova de quitação financeira perante o estabelecimento. Não quita o imposto perante o Estado ou Município.

### 1.4 Documento Fiscal (`FiscalDocumentRecord`)
- **Definição:** Documento eletrônico assinado com certificado digital A1 e transmitido aos servidores da SEFAZ (Secretaria da Fazenda Estadual) ou Prefeitura Municipal.
- **Tipos Suportados:**
  - `NFCE` (Modelo 65): Nota Fiscal de Consumidor Eletrônica para vendas no restaurante, bar e delivery.
  - `NFE` (Modelo 55): Nota Fiscal Eletrônica mercantil para operações B2B, transferências entre filiais e compras de fornecedores.
  - `NFSE`: Nota Fiscal de Serviços Eletrônica emitida para a Prefeitura de São Luís/MA referente às diárias de hospedagem do Hotel Milla.

---

## 2. MODELO MULTI-ESTABELECIMENTO (RESTAURANTE vs HOTEL)

Devido às regras tributárias brasileiras, o serviço hoteleiro (ISS Municipal) não pode ser emitido na mesma nota fiscal das refeições e bebidas do restaurante (ICMS Estadual).

O DECK 26 opera nativamente com **duas entidades fiscais separadas**:

### Estabelecimento 1 — DECK 26 RESTAURANTE & BAR
- **Razão Social:** `DECK 26 RESTAURANTE E EVENTOS LTDA`
- **CNPJ:** `12345678000190`
- **Inscrição Estadual:** `123456789`
- **CNAE Principal:** `5611-2/01` (Restaurantes e similares)
- **Regime Tributário:** `SIMPLES_NACIONAL`
- **Documentos Permitidos:** `NFCE` (Mod 65) e `NFE` (Mod 55)
- **Tributação Base:** ICMS (CSOSN 102/500), PIS (CST 49), COFINS (CST 49)

### Estabelecimento 2 — HOTEL AUTO POSTO MILLA
- **Razão Social:** `HOTEL AUTO POSTO MILLA LTDA`
- **CNPJ:** `12345678000271`
- **Inscrição Municipal:** `554433`
- **CNAE Principal:** `5510-8/01` (Hotéis e apart-hotéis)
- **Regime Tributário:** `SIMPLES_NACIONAL`
- **Documentos Permitidos:** `NFSE` (Nota Fiscal de Serviços Eletrônica)
- **Tributação Base:** ISS Municipal (Alíquota 5%)

---

## 3. PROIBIÇÃO DE BYPASS ARBITRÁRIO ("EMITIR OU NÃO EMITIR")

Conforme estipulado pelas regras tributárias e pela arquitetura da Etapa 7A:
- O sistema **NÃO implementa flags fraudulentas de sonegação fiscal** ou botões arbitrários de "não emitir fiscal" para fins de ocultação de receita.
- Todas as vendas registradas possuem rastreabilidade de auditoria imutável.
- Na fase atual de demonstração e homologação, todos os documentos são processados no ambiente `HOMOLOGACAO` ou `SIMULATED_DEMO`, exibindo de maneira clara e conspícua a marca d'água:
  `SEM VALIDADE FISCAL - DEMO`
- Toda chave de acesso gerada na simulação possui rigorosamente o formato oficial de **44 dígitos numéricos**, permitindo integração imediata com bibliotecas de transmissão SEFAZ (como ACBr ou plug-ins de mensageria) quando o certificado digital A1 for ativado pelo proprietário.
