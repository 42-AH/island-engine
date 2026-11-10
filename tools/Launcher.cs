using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

class Launcher
{
    [STAThread]
    static void Main()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        string runtime = Path.Combine(folder, "runtime", "electron.exe");
        if (!File.Exists(runtime))
        {
            MessageBox.Show("The desktop runtime is missing. See Source setup in README.md.", "islandengine");
            return;
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = runtime,
            Arguments = "\"" + folder.TrimEnd(Path.DirectorySeparatorChar) + "\"",
            WorkingDirectory = folder,
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
}
