# DECK 26 — ESTRUTURA DOS 24 APARTAMENTOS (HOTEL AUTO POSTO MILLA)
## Mapeamento Operacional, Regras de Obras e Taxa de Ocupação

**Documento:** `docs/HOTEL_24_ROOMS.md`  
**Versão:** 1.0.0 (Etapa 7A)  
**Data:** 05/11/2026  
**Status:** Implementado e Coberto por 13 Testes Automatizados

---

## 1. VISÃO GERAL DA ESTRUTURA HOTELEIRA

O **Hotel Auto Posto Milla** possui uma capacidade planejada de **24 apartamentos**, distribuídos entre o pavimento térreo e o primeiro andar.

Na fase atual do empreendimento:
- **12 Apartamentos Operacionais (50%):** Prontos para ocupação imediata, com governança, frigobar e disponibilidade no motor de reservas.
- **12 Apartamentos Em Construção / Reforma (50%):** Unidades da ala nova em fase de obras civis e acabamento.

---

## 2. INVARIANTES DE ENGENHARIA PARA UNIDADES EM OBRAS (`EM_CONSTRUCAO`)

As unidades marcadas com o status comercial `EM_CONSTRUCAO` estão sujeitas a 4 travas arquiteturais rígidas no sistema:

1. **Bloqueio de Reserva Comercial:**
   O motor de reservas (`createHotelReservation`) rejeita categoricamente qualquer tentativa de reserva para quartos com `commercialStatus === 'EM_CONSTRUCAO'`, lançando exceção explícita com o motivo da reforma.

2. **Bloqueio de Check-in Operacional:**
   O fluxo de recepção (`checkInHotelStay`) impede check-in imediato ou abertura de estadia para quartos em obra.

3. **Bloqueio de Tarifação / Diárias:**
   Nenhum lançamento de diária automática ou encargo hoteleiro pode ser gerado para essas unidades.

4. **Exclusão Estrita do Denominador da Taxa de Ocupação:**
   A fórmula oficial da taxa de ocupação calcula apenas os quartos ativos e operacionais:
   $$\text{Taxa de Ocupação (\%)} = \left(\frac{\text{Quartos Ocupados}}{\text{Total de Quartos Operacionais}}\right) \times 100$$
   *Exemplo:* 3 quartos ocupados em relação aos 12 operacionais resultam em **25,0% de ocupação** (e não 12,5%, o que distorceria os relatórios contábeis e gerenciais).

---

## 3. MAPEAMENTO DETALHADO DOS 24 APARTAMENTOS

### Ala Operacional (12 Apartamentos Ativos)

| Número | Nome de Exibição | Andar / Setor | Categoria | Capacidade | Diária Padrão | Status Inicial |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| **101** | Standard Single 101 | Térreo | STANDARD_SINGLE | 1 hóspede | R$ 130,00 | Livre / Limpo |
| **102** | Standard Casal 102 | Térreo | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | Livre / Limpo |
| **103** | Standard Casal 103 | Térreo | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | Livre / Limpo |
| **104** | Luxo Casal 104 | Térreo | LUXO_CASAL | 2 hóspedes | R$ 220,00 | Livre / Limpo |
| **106** | Triplo Executivo 106 | Térreo | TRIPLO | 3 hóspedes | R$ 250,00 | Livre / Limpo |
| **107** | Familiar Superior 107 | Térreo | FAMILIAR | 4 hóspedes | R$ 280,00 | Livre / Limpo |
| **201** | Luxo Casal 201 | 1º Andar | LUXO_CASAL | 2 hóspedes | R$ 220,00 | Livre / Limpo |
| **202** | Luxo Casal 202 | 1º Andar | LUXO_CASAL | 2 hóspedes | R$ 220,00 | Livre / Limpo |
| **203** | Standard Duplo 203 | 1º Andar | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | Livre / Limpo |
| **204** | Standard Duplo 204 | 1º Andar | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | Livre / Limpo |
| **205** | Triplo Superior 205 | 1º Andar | TRIPLO | 3 hóspedes | R$ 250,00 | Livre / Limpo |
| **206** | Suíte Master 206 | 1º Andar | SUITE_MASTER | 2 hóspedes | R$ 320,00 | Livre / Limpo |

*Nota sobre o Quarto 105:* O apartamento 105 é reservado dinamicamente para testes de integração de novos cadastros de quartos pela recepção.

---

### Ala Nova em Construção (12 Apartamentos em Obras)

| Número | Nome de Exibição | Andar / Setor | Categoria Prevista | Capacidade | Diária Prevista | Status Comercial |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: |
| **108** | Novo Apto 108 (Em Obras) | Térreo (Ala Nova) | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | **EM_CONSTRUCAO** |
| **109** | Novo Apto 109 (Em Obras) | Térreo (Ala Nova) | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | **EM_CONSTRUCAO** |
| **110** | Novo Apto 110 (Em Obras) | Térreo (Ala Nova) | LUXO_CASAL | 2 hóspedes | R$ 220,00 | **EM_CONSTRUCAO** |
| **111** | Novo Apto 111 (Em Obras) | Térreo (Ala Nova) | LUXO_CASAL | 2 hóspedes | R$ 220,00 | **EM_CONSTRUCAO** |
| **112** | Novo Apto 112 (Em Obras) | Térreo (Ala Nova) | TRIPLO | 3 hóspedes | R$ 250,00 | **EM_CONSTRUCAO** |
| **113** | Novo Apto 113 (Em Obras) | Térreo (Ala Nova) | FAMILIAR | 4 hóspedes | R$ 280,00 | **EM_CONSTRUCAO** |
| **207** | Novo Apto 207 (Em Obras) | 1º Andar (Ala Nova) | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | **EM_CONSTRUCAO** |
| **208** | Novo Apto 208 (Em Obras) | 1º Andar (Ala Nova) | STANDARD_DOUBLE | 2 hóspedes | R$ 180,00 | **EM_CONSTRUCAO** |
| **209** | Novo Apto 209 (Em Obras) | 1º Andar (Ala Nova) | LUXO_CASAL | 2 hóspedes | R$ 220,00 | **EM_CONSTRUCAO** |
| **210** | Novo Apto 210 (Em Obras) | 1º Andar (Ala Nova) | LUXO_CASAL | 2 hóspedes | R$ 220,00 | **EM_CONSTRUCAO** |
| **211** | Novo Apto 211 (Em Obras) | 1º Andar (Ala Nova) | SUITE_MASTER | 2 hóspedes | R$ 320,00 | **EM_CONSTRUCAO** |
| **212** | Novo Apto 212 (Em Obras) | 1º Andar (Ala Nova) | TRIPLO | 3 hóspedes | R$ 250,00 | **EM_CONSTRUCAO** |

---

## 4. ASSISTENTE DE CUSTOMIZAÇÃO & TRANSIÇÃO DE OBRAS

Tanto no aplicativo desktop Windows (`apps/desktop`) quanto na API (`PUT /api/hotel/rooms/:id`), o gerente geral do hotel possui uma interface para:
- Atualizar o nome fantasia do apartamento.
- Anexar URLs de fotos do quarto.
- Alterar categoria, configuração de camas e diária padrão em centavos.
- **Alternar o Status Comercial:** Quando a obra de um quarto (ex: 108) é concluída, o status é alterado de `EM_CONSTRUCAO` para `OPERACIONAL`. Imediatamente, a contagem de quartos operacionais sobe para 13 e o quarto passa a receber reservas e check-ins normalmente.
