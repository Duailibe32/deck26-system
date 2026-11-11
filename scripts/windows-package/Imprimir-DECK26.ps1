$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$mode = $request.mode
$name = [string]$request.printer
$title = [string]$request.title

function Respond($State, $Message, $JobId) {
  @{ state=$State; message=$Message; jobId=$JobId } | ConvertTo-Json -Compress
}

try {
  $printer = Get-Printer -ErrorAction Stop | Where-Object Name -eq $name | Select-Object -First 1
  if (!$printer) { throw 'Fila do Windows nao encontrada.' }
  $printerStatus = [string]$printer.PrinterStatus
  $problem = $printerStatus -match 'Paused|Paper|Offline|Error|DoorOpen|NotAvailable|UserIntervention|NoToner'
  if ($mode -eq 'inspect') {
    $job = Get-PrintJob -PrinterName $printer.Name -ErrorAction Stop |
      Where-Object { $_.ID -eq $request.spoolId -and $_.DocumentName -eq $title } | Select-Object -First 1
    if (!$job) { Respond 'UNKNOWN' 'A via saiu da fila do Windows. Confira se o papel foi impresso.'; exit }
    $jobStatus = [string]$job.JobStatus
    if ($jobStatus -match 'Deleting|Deleted') {
      Respond 'UNKNOWN' 'A via esta sendo removida da fila do Windows. Confira o papel.'
    } elseif ($jobStatus -match 'Error|Offline|PaperOut|Blocked|UserIntervention|Paused' -or $problem) {
      Respond 'WAITING' "Windows: $printerStatus / $jobStatus. Corrija a impressora e aguarde a mesma via."
    } elseif ($jobStatus -match 'Printed|Completed') {
      Respond 'PRINTED'
    } else {
      Respond 'WAITING'
    }
    exit
  }
  if ($mode -ne 'submit') { throw 'Acao desconhecida.' }
  if ($problem) { Respond 'REJECTED' "Impressora indisponivel: $printerStatus."; exit }
  $bytes = [Convert]::FromBase64String([string]$request.bytes)
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class Deck26WindowsQueue {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Document {
        public string Title, Output, Type;
    }
    [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    private static extern int StartDocPrinter(IntPtr handle, int level, ref Document document);
    [DllImport("winspool.drv", SetLastError=true)]
    private static extern bool WritePrinter(IntPtr handle, byte[] bytes, int length, out int written);
    [DllImport("winspool.drv", SetLastError=true)]
    private static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv")]
    private static extern bool AbortPrinter(IntPtr handle);
    [DllImport("winspool.drv")]
    private static extern bool ClosePrinter(IntPtr handle);
    public static int Submit(string printer, string title, byte[] bytes) {
        IntPtr handle;
        if (!OpenPrinter(printer, out handle, IntPtr.Zero)) return 0;
        try {
            var document = new Document { Title=title, Type="RAW" };
            var jobId = StartDocPrinter(handle, 1, ref document);
            if (jobId <= 0) return 0;
            int written;
            if (!WritePrinter(handle, bytes, bytes.Length, out written) || written != bytes.Length || !EndDocPrinter(handle)) {
                AbortPrinter(handle);
                return -1;
            }
            return jobId;
        } finally { ClosePrinter(handle); }
    }
}
'@
} catch {
  if ($mode -eq 'submit') { Respond 'REJECTED' $_.Exception.Message }
  else { Respond 'WAITING' $_.Exception.Message }
  exit
}

try {
  $jobId = [Deck26WindowsQueue]::Submit($name, $title, $bytes)
  if ($jobId -gt 0) { Respond 'ACCEPTED' $null $jobId }
  elseif ($jobId -eq 0) { Respond 'REJECTED' 'O Windows recusou a via antes do envio.' }
  else { Respond 'UNKNOWN' 'O envio foi interrompido depois que o Windows abriu a via.' }
} catch {
  Respond 'UNKNOWN' 'O Windows nao confirmou o resultado do envio.'
}
