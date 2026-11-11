$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Select-Folder([string]$title) {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $title
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne 'OK') { throw 'Setup cancelled. Your islands have not been changed.' }
    $selectedPath = $dialog.SelectedPath
    $dialog.Dispose()
    return $selectedPath
}
try {
    $answer = [System.Windows.Forms.MessageBox]::Show("This sets up the source download. You'll choose your local game folder, Java 8 folder, FFDec folder, and javac.exe from JDK 11 or newer.`n`nSetup then downloads and verifies the Electron runtime. It does not download game files or change your islands.", 'Set up islandengine', 'OKCancel', 'Information')
    if ($answer -ne 'OK') { exit 0 }
    $libraryPath = Select-Folder 'Choose the game folder containing game\Shell.swf and ruffle\ruffle.js'
    if (!(Test-Path -LiteralPath (Join-Path $libraryPath 'game\Shell.swf')) -or !(Test-Path -LiteralPath (Join-Path $libraryPath 'ruffle\ruffle.js'))) { throw 'That game folder must contain both game\Shell.swf and ruffle\ruffle.js. Run setup again and choose the public game folder.' }
    $javaPath = Select-Folder 'Choose the Java 8 folder containing bin\java.exe'
    $ffdecPath = Select-Folder 'Choose the FFDec folder containing ffdec.jar, lib, and flashlib'
    $compilerDialog = New-Object System.Windows.Forms.OpenFileDialog
    $compilerDialog.Title = 'Choose javac.exe from a JDK 11 or newer bin folder'
    $compilerDialog.Filter = 'Java compiler (javac.exe)|javac.exe'
    if ($compilerDialog.ShowDialog() -ne 'OK') { throw 'Setup cancelled. Your islands have not been changed.' }
    $compilerPath = $compilerDialog.FileName
    $compilerDialog.Dispose()
    & (Join-Path $PSScriptRoot 'setup.ps1') -Library $libraryPath -JavaHome $javaPath -FFDec $ffdecPath -Javac $compilerPath
    [System.Windows.Forms.MessageBox]::Show('Setup finished. Open Start islandengine.cmd to begin.', 'islandengine', 'OK', 'Information') | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Setup could not finish', 'OK', 'Error') | Out-Null
    exit 1
}
