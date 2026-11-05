# Validação da preparação fiscal — 05/11/2026

## Escopo entregue

Preparação de emitentes separados, revisão de produtos, conferência integral de comandas no PDV e ensaios persistentes com transporte simulado. Não há motor de autorização SEFAZ real nesta entrega. A1/cofre de credenciais, XMLDSig, XML/XSD, SOAP/mTLS, QR/DANFE oficiais, eventos e contingência oficial permanecem pendentes. Selecionar produção não habilita transmissão.

## Evidências

- 163 testes passaram em 10 arquivos, preservando os 150 testes da base anterior e adicionando 13 casos fiscais.
- Teste de runtime: APIs iniciadas, 24 quartos e integridade referencial OK.
- Typecheck de todos os módulos: aprovado.
- Build de todos os módulos: aprovado.
- Executável Windows operacional compilado e instalado pelo processo local.
- npm audit --audit-level=moderate: zero vulnerabilidades reportadas nas dependências npm.
- Fluxo no navegador conferido: login de apresentação, painel fiscal, aprovação simulada, timeout seguido de consulta mantendo o mesmo identificador e conferência da Mesa 20 (subtotal R$ 25,00, serviço R$ 2,50, total R$ 27,50, recebido R$ 0,00).
- Ensaios usam exemplo fixo de R$ 50,00 e tabela própria; não criam pagamentos, documentos fiscais oficiais ou trabalhos de impressão física.
- Instalação de apresentação: loopback 127.0.0.1:4802 e banco próprio em %USERPROFILE%/Deck26/EnsaioFiscal. Não abre firewall nem usa o banco operacional.
- [Validação principal no GitHub aprovada](https://github.com/Duailibe32/deck26-system/actions/runs/42039945939).
- [Compilação Windows no GitHub](https://github.com/Duailibe32/deck26-system/actions/runs/42039945860): acompanhar o resultado no link. A compilação local já foi concluída.

Não foram feitos emissão/homologação SEFAZ, teste com A1 ou teste de impressão física. Não houve conferência de abertura em celular físico nesta etapa fiscal.

## Alerta Rust rastreado, sem participação no alvo Windows

O GitHub apontou o [alerta Dependabot 20](https://github.com/Duailibe32/deck26-system/security/dependabot/20), de severidade moderada, em glib 0.18.5, registrado no Cargo.lock. O primeiro ramo corrigido informado pelo alerta é 0.20.0. O alerta não foi dispensado nem marcado como resolvido.

Verificação local:

```powershell
cargo tree --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --offline --target x86_64-pc-windows-msvc -i glib
```

Resultado: nenhuma dependência glib no alvo Windows. Os metadados instalados de Tauri 2.12.5 condicionam gtk 0.18 a Linux/BSD. A tentativa de listar a árvore Linux offline não foi concluída por ausência do pacote atk no cache; não houve compilação Linux.

Esse alerta não é coberto por npm audit e não autoriza declarar todo o projeto livre de vulnerabilidades. A versão nativa Linux não deve ser liberada sem reavaliar e corrigir a cadeia GTK/glib. Não substituir isoladamente o ramo glib por versão incompatível nem editar Cargo.lock manualmente para esconder o alerta.

## Teste e apresentação

Use o [checklist de 25 verificações e roteiro de vídeo](CHECKLIST_VIDEO_FISCAL.md) ou o [checklist interativo](CHECKLIST_VIDEO_FISCAL.html). PIN 536821 é exclusivo de apresentação e não deve ser usado na operação real.
