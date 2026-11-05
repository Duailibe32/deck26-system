> Atualização de 05/11/2026: antes da migração 0007_hardening, pare os processos que escrevem no banco e copie o SQLite em estado consistente (incluindo WAL/SHM se houver), ou use mecanismo de backup SQLite consistente. Ensaie restauração em caminho isolado e verifique integridade antes de retomar. Não copiar apenas o arquivo principal de um banco ativo. Esta revisão não executou restauração dos dados reais.

# DECK 26 — POLÍTICA DE BACKUP, RECUPERAÇÃO E CONTINGÊNCIA

Este documento descreve as diretrizes operacionais para geração de cópias de segurança atômicas, verificação de integridade e restauração do banco de dados SQLite com WAL (Write-Ahead Logging) do **DECK 26**.

---

## 1. MECANISMO DE BACKUP ATÔMICO COM WAL ATIVO

> [!CAUTION]
> **NUNCA COPIE DIRETAMENTE O ARQUIVO `.sqlite` ENQUANTO O SERVIDOR ESTIVER EM OPERAÇÃO.**
> Uma cópia simples (`copy` ou `cp`) durante escritas ativas pode gerar um arquivo corrompido ou inconsistente devido à desvinculação entre o arquivo principal e o log de escrita antecipada (`-wal` e `-shm`).

### 1.1. Procedimento Oficial: `VACUUM INTO`
O SQLite suporta nativamente o comando atômico `VACUUM INTO '<caminho>'`, que cria uma cópia completa, consistente e desfragmentada do banco sem interromper leituras ou escritas:

```sql
PRAGMA wal_checkpoint(PASSIVE);
VACUUM INTO 'C:/ProgramData/Deck26/backups/deck26-local-backup-20261105.sqlite';
```

### 1.2. Script Automatizado em Node.js (`backups/safe_backup.cjs`)
```javascript
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function performSafeBackup(dbSourcePath, backupDir) {
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = Date.now();
  const backupFile = path.join(backupDir, `deck26-backup-${timestamp}.sqlite`);

  const db = new DatabaseSync(dbSourcePath);
  try {
    db.exec(`VACUUM INTO '${backupFile.replace(/\\/g, '/')}'`);
    console.log(`Backup criado com sucesso: ${backupFile}`);

    // Verificação imediata de integridade da cópia gerada
    const backupDb = new DatabaseSync(backupFile);
    const integrity = backupDb.prepare('PRAGMA integrity_check').all();
    const fkCheck = backupDb.prepare('PRAGMA foreign_key_check').all();
    backupDb.close();

    if (integrity[0]?.integrity_check !== 'ok' || fkCheck.length > 0) {
      throw new Error('Falha na validação de integridade do backup gerado!');
    }
    console.log('Integridade do backup verificada: OK (0 violações FK)');
  } finally {
    db.close();
  }
}
```

---

## 2. POLÍTICA DE RETENÇÃO E AGENDAMENTO

1. **Snapshots Horários:** Executados a cada 2 horas durante o horário de expediente (06:00 às 00:00).
2. **Consolidação Diária:** Executada à 01:00 após o fechamento do caixa do restaurante e auditoria hoteleira da noite.
3. **Retenção:**
   - Snapshots horários: retidos por 7 dias.
   - Backups diários: retidos por 30 dias.
   - Backups mensais (último dia do mês): retidos por 5 anos (atendimento a exigências fiscais e contábeis).
4. **Armazenamento Secundário:**
   - Cópia espelhada automática em dispositivo físico secundário (pendrive criptografado BitLocker ou NAS local).
   - Sincronização cifrada de eventos para o repositório em nuvem.

---

## 3. RUNBOOK DE RECUPERAÇÃO EM CASO DE FALHA OU QUEDA DE ENERGIA

Em caso de falha catastrófica no computador local (pane de hardware, corrupção de sistema operacional ou queima de disco):

### Passo 1: Isolamento do Ambiente
1. Parar o serviço do Deck 26:
   ```powershell
   Stop-Process -Name "deck26-local-server" -Force -ErrorAction SilentlyContinue
   ```
2. Mover arquivos corrompidos para uma pasta de quarentena (nunca sobrescrever ou excluir diretamente).

### Passo 2: Seleção e Restauração do Backup
1. Identificar o backup mais recente que possui validação de integridade aprovada no diretório de backups.
2. Copiar o arquivo de backup para o diretório de dados oficial:
   ```powershell
   Copy-Item "C:\ProgramData\Deck26\backups\deck26-backup-<timestamp>.sqlite" "C:\ProgramData\Deck26\data\deck26-local.sqlite"
   ```

### Passo 3: Verificação Prévia de Integridade
Executar teste de integridade na cópia restaurada antes de liberar para o público:
```powershell
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('C:/ProgramData/Deck26/data/deck26-local.sqlite'); console.log(db.prepare('PRAGMA integrity_check').all()); console.log('FK Violations:', db.prepare('PRAGMA foreign_key_check').all().length); db.close();"
```

### Passo 4: Reconciliação com a Nuvem
1. Iniciar o servidor local.
2. O subsistema de sincronização (`syncInbox` / `syncOutbox`) reestabelece contato com o ledger de eventos da nuvem, baixando eventos pendentes que tenham ocorrido após o timestamp do backup restaurado.
3. Verificar a tela de Gestão Financeira e Extrato de Mesas/Quartos para confirmar consistência operacional.
