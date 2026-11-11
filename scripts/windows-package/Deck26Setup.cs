using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class Deck26Setup
{
    private static string Quote(string value)
    {
        return "\"" + Regex.Replace(value, "(\\\\*)\"|(\\\\+)$",
            match => match.Groups[1].Success ? match.Groups[1].Value + match.Groups[1].Value + "\\\"" : match.Value + match.Value) + "\"";
    }

    [STAThread]
    private static int Main(string[] args)
    {
        var directory = Path.Combine(Path.GetTempPath(), "deck26-setup-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(directory);
            var archive = Path.Combine(directory, "pacote.zip");
            using (var data = Assembly.GetExecutingAssembly().GetManifestResourceStream("Deck26.package.zip"))
            using (var file = File.Create(archive))
            {
                if (data == null) throw new InvalidDataException("O pacote do DECK 26 está ausente.");
                data.CopyTo(file);
            }
            ZipFile.ExtractToDirectory(archive, directory);
            var wizard = Directory.GetFiles(directory, "Assistente-DECK26.ps1", SearchOption.AllDirectories);
            if (wizard.Length != 1) throw new InvalidDataException("O assistente do DECK 26 está ausente.");
            var powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
            var arguments = "-NoProfile -ExecutionPolicy Bypass -STA -File " + Quote(wizard[0]);
            foreach (var value in args) arguments += " " + Quote(value);
            using (var process = Process.Start(new ProcessStartInfo(powershell, arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true
            }))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Instalador DECK 26", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
