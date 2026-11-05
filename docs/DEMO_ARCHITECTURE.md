# DECK 26 — ARQUITETURA DA DEMONSTRAÇÃO ONLINE COMERCIAL
## Especificação Técnica, Comparativo de Provedores Gratuitos e Modelo de Custo Zero ($0/mês)

**Documento:** `docs/DEMO_ARCHITECTURE.md`  
**Versão:** 1.0.0 (Etapa 7A)  
**Data:** 05/11/2026  
**Status:** Proposta de Engenharia Homologada (Aguardando Autorização Humana para Publicação em Nuvem)

---

## 1. OBJETIVO DA DEMONSTRAÇÃO ONLINE

Disponibilizar uma versão interativa de demonstração comercial do **DECK 26 — Hotel Auto Posto Milla**, acessível diretamente pelo navegador de smartphones (iOS e Android), tablets e computadores de potenciais clientes (proprietários de bares, restaurantes e hotéis).

### Princípios Inegociáveis:
1. **Custo Zero ($0,00):** Não contratar VPS paga, instâncias dedicadas ou serviços com cobrança automática sem autorização explícita do proprietário.
2. **Isolamento Absoluto:** A demonstração online não pode, sob nenhuma hipótese, se conectar ou interferir no banco de dados operacional local (`SQLite WAL`) instalado no computador Windows do estabelecimento.
3. **Dados Estritamente Simulados:** Não utilizar dados pessoais reais (LGPD), cartões de crédito reais ou chaves fiscais reais na nuvem pública.
4. **Resiliência / Standalone Fallback:** O frontend de demonstração foi concebido para funcionar tanto conectado a uma API em nuvem quanto em modo autônomo (*offline/standalone*), operando com catálogo de 93 itens e 24 apartamentos locais caso o servidor remoto esteja em hibernação (*cold-start*).

---

## 2. COMPARATIVO DE PROVEDORES DE HOSPEDAGEM (TIERS GRATUITOS)

Para atender à demonstração comercial sem custos, foram avaliadas as seguintes opções:

| Provedor | Componente | Plano Gratuito ($0) | Limitações do Plano Gratuito | Recomendação |
| :--- | :--- | :--- | :--- | :--- |
| **Vercel** | Frontend Web React (`apps/web`) | Gratuito Vitalício (Hobby Tier), 100 GB banda/mês, SSL automático, deploy via Git. | Uso comercial individual ou demonstração; sem SLA de suporte corporativo. | **RECOMENDADO para Frontend** |
| **Netlify** | Frontend Web React (`apps/web`) | Gratuito (Starter Tier), 100 GB banda/mês, SSL automático. | Limite de 300 minutos de build/mês. | Alternativa sólida |
| **Supabase** | Banco PostgreSQL Remoto | Gratuito (Free Tier), 500 MB armazenamento, 2 projetos, SSL integrado. | Pausa o banco após 7 dias de inatividade contínua. | **RECOMENDADO para Dados Demo** |
| **Render** | API Fastify (`apps/cloud-api`) | Gratuito (Web Service), 512 MB RAM. | Hibernação após 15 min de inatividade (*spin-up* leva ~45 a 50 segundos). | Aceitável com aviso de *cold-start* |
| **GitHub Pages** | Frontend Estático | Gratuito, integrado ao repositório GitHub. | Apenas assets estáticos, requer repositório público ou GitHub Pro/Enterprise. | Não prioritário (repo é PRIVATE) |

---

## 3. ARQUITETURA PROPOSTA (TOPOLOGIA SEPARADA)

```
                    DISPOSITIVO DO CLIENTE (Celular / Desktop)
                                       │
                                       ▼
                   ┌─────────────────────────────────────────┐
                   │       Vercel Global Edge Network        │
                   │           (Tier Gratuito $0)            │
                   │   apps/web (React 18 + Vite + TS)       │
                   └───────────────────┬─────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────┐             ┌───────────────────────────────┐
│     Modo Standalone Demo      │             │   Render / Supabase API Demo  │
│   (Zero Backend Dependency)   │             │   (Opcional para Sincronismo) │
│ - 93 Itens Oficiais Cardápio  │             │ - apps/cloud-api Fastify      │
│ - 24 Apartamentos Milla       │             │ - PostgreSQL Supabase Demo    │
│ - DRE e Balancete Simulados   │             │ - Banco Isolado da Nuvem      │
└───────────────────────────────┘             └───────────────────────────────┘
                                                              │
                                                        [ISOLAMENTO]
                                                       NENHUM CONTATO
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │   Computador Local Windows    │
                                              │   DECK 26 — Operação Real     │
                                              │   (SQLite 3 WAL Local)        │
                                              └───────────────────────────────┘
```

---

## 4. IMPACTO DA HIBERNAÇÃO (COLD START) E CONTRAMEDIDA

Nos provedores gratuitos de backend (como Render ou Railway Free), instâncias entram em modo de espera após 15 minutos sem requisições. Quando um cliente acessa o link, a primeira requisição pode demorar de 30 a 50 segundos para responder.

### Solução Arquitetural Implementada na Etapa 7A:
O `apps/web` foi construído com **Fallback Standalone Inteligente**:
1. O frontend carrega instantaneamente em menos de 1 segundo via CDN da Vercel.
2. Todos os 93 produtos do cardápio oficial, as 10 categorias e os 24 apartamentos são servidos imediatamente através dos contratos embutidos (`@deck26/contracts`).
3. O potencial cliente navega, abre mesas, lança pedidos, confere o DRE e simula emissão de NFC-e/NFS-e **sem esperar o backend acordar**.
4. Se o backend estiver ativo, ele sincroniza em segundo plano de forma silenciosa e não bloqueante.

---

## 5. CHECKLIST DE AUTORIZAÇÃO HUMANA (ANTES DE PUBLICAR LINK EXTERNO)

Antes de conectar a conta do usuário na Vercel ou Supabase:
- [ ] Confirmar que o repositório privado `Duailibe32/deck26-system` continuará privado.
- [ ] Criar conta gratuita no provedor sem cadastrar cartão de crédito de cobrança recorrente.
- [ ] Gerar token de deploy exclusivo para o app `web`.
- [ ] Garantir que o link público contenha a marca d'água permanente de demonstração.
- [ ] Não publicar credenciais SEFAZ ou chaves de produção.
