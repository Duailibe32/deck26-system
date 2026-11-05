# Segurança e acesso

## Proteções implementadas na revisão da 7A

- APIs internas exigem sessão; health, login e rotas públicas específicas permanecem acessíveis conforme sua finalidade.
- Sessão HMAC expira em oito horas e consulta usuário ativo e perfil no banco a cada requisição. Alterar o perfil/desativar usuário invalida os privilégios antigos. Não há login automático como proprietário no Desktop.
- PIN usa scrypt com salt; credenciais legadas válidas são migradas ao autenticar. Login limita tentativas por IP. PINs demonstrativos não autenticam em produção.
- Estado e leituras financeiras respeitam permissões: dados pessoais, custos e tesouraria não são entregues indiscriminadamente a garçons/cozinha.
- CORS compara origens exatas. CORS não substitui autenticação ou firewall. Bind padrão das APIs é loopback; liberar LAN exige configuração consciente.
- Sincronização e visão do proprietário cloud exigem DECK26_SYNC_SECRET. Payloads têm checksum verificado e lote atômico; pedidos públicos são limitados por IP e validados contra o catálogo confiável.
- Trilha auditável impede UPDATE/DELETE pela aplicação. Um administrador com acesso ao SQLite ainda pode alterar o arquivo; restrinja permissões e mantenha backups externos protegidos.
- Tauri possui CSP explícita e a prévia web também restringe scripts. Fonte externa tem fallback local. Não há promessa de funcionamento da fonte online sem internet.

## Configuração

Use .env.example como modelo, mantenha .env fora do Git e gere segredos fortes distintos para AUTH, QR e sincronização. Em NODE_ENV=production, AUTH_SECRET é obrigatório; o simulador cloud exige SYNC_SECRET mesmo fora de produção, salvo fixtures explícitas. Use DECK26_BOOTSTRAP_PIN próprio (6 a 12 dígitos) uma vez e remova a variável. Não compartilhe o PIN do proprietário.

Em bases novas com DECK26_DEMO_MODE=false, não são criados usuários demonstrativos. Bases antigas não são apagadas nem automaticamente conciliadas. O bootstrap permite substituir o PIN legado padrão do proprietário; os demais operadores precisam de provisionamento e revisão de permissões antes de usar o ambiente real.

Não exponha servidores Vite ou API operacional na internet. A implantação exige HTTPS, firewall, origens autorizadas, política de backup/restauração, permissões do Windows e monitoramento. O segredo cloud atual atende a um estabelecimento; separação multiempresa e rotação/revogação central de sessões exigem desenho adicional.

## Validação

hardening.test.ts verifica leituras anônimas, autorização, PII, tokens expirados, usuário desativado, PINs, rate limit, auditoria e integridade da sincronização. Nenhum teste local equivale a pentest, certificação LGPD ou homologação fiscal. Consulte REVISAO_PRE_7B.md.
