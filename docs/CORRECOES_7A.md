# Correções da 7A

A primeira correção removeu o ciclo entre fiscal.ts e index.ts, isolando IsoDateTimeSchema em common.ts. A aplicação falhava em runtime mesmo com testes/build aprovados; npm test agora também inicializa ambas as APIs diretamente pelo Node.

A revisão foi ampliada por solicitação do proprietário para segurança, financeiro, PMS, visual e documentação. Consulte [relatório completo](REVISAO_PRE_7B.md), [validação](TESTING.md) e [prévia](DEMO_ARCHITECTURE.md). A prévia agora preserva suas simulações em localStorage, identificadas como fictícias.
