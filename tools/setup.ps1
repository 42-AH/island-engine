param(
    [Parameter(Mandatory=$true)][string]$Library,
    [Parameter(Mandatory=$true)][string]$JavaHome,
    [Parameter(Mandatory=$true)][string]$FFDec,
    [Parameter(Mandatory=$true)][string]$Javac
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (!(Test-Path (Join-Path $Library 'game/Shell.swf'))) { throw 'The library must contain game/Shell.swf.' }
if (!(Test-Path (Join-Path $Library 'ruffle/ruffle.js'))) { throw 'The library must contain ruffle/ruffle.js.' }
$vendor = Join-Path $root 'tools/vendor'
New-Item -ItemType Directory -Force $vendor, (Join-Path $vendor 'compiler'), (Join-Path $vendor 'jre') | Out-Null
Copy-Item (Join-Path $JavaHome '*') (Join-Path $vendor 'jre') -Recurse -Force
Copy-Item (Join-Path $FFDec 'ffdec.jar') $vendor -Force
Copy-Item (Join-Path $FFDec 'lib') $vendor -Recurse -Force
Copy-Item (Join-Path $FFDec 'flashlib') $vendor -Recurse -Force
$jar = Join-Path $vendor 'ffdec.jar'
& $Javac --release 8 -cp "$jar;$(Join-Path $vendor 'lib/*')" -d (Join-Path $vendor 'compiler') (Join-Path $root 'tools/AppendAs3Classes.java')
if ($LASTEXITCODE -ne 0) { throw 'Could not compile the ActionScript build helper.' }
$version = '45.2.3'
$cache = Join-Path $root '.cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$zip = Join-Path $cache 'electron.zip'
Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$version/electron-v$version-win32-x64.zip" -OutFile $zip
$checks = Join-Path $cache 'SHASUMS256.txt'
Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$version/SHASUMS256.txt" -OutFile $checks
$line = Get-Content $checks | Where-Object { $_ -match "\*electron-v$version-win32-x64.zip$" }
if (!$line -or ($line -split '\s+')[0] -ne (Get-FileHash $zip -Algorithm SHA256).Hash) { throw 'Electron checksum did not match.' }
Expand-Archive $zip (Join-Path $root 'runtime') -Force
$settings = @{library=(Resolve-Path $Library).Path; java='tools/vendor/jre/bin/java.exe'; ffdec='tools/vendor/ffdec.jar'} | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $root 'local.json'), $settings)
Write-Host 'Open Start islandengine.cmd.'
