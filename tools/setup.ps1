param([string]$Library, [string]$JavaHome, [string]$FFDec, [string]$Javac)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.cache/setup'
New-Item -ItemType Directory -Force $cache | Out-Null
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'setup-downloads.json') -Raw | ConvertFrom-Json
$stagingFolders = New-Object 'System.Collections.Generic.List[string]'

function Get-Package($package) {
    $archive = Join-Path $cache ($package.id + '.zip')
    if (!(Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.sha256) {
        Write-Host "Downloading $($package.name)..."
        $partial = $archive + '.part'
        Invoke-WebRequest -UseBasicParsing -Uri $package.url -OutFile $partial -TimeoutSec 600
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $package.sha256) {
            throw "$($package.name) download did not pass its checksum. Run setup again to retry."
        }
        Move-Item -LiteralPath $partial -Destination $archive -Force
    }
    $destination = Join-Path ([IO.Path]::GetTempPath()) ('islandengine-' + [Guid]::NewGuid().ToString('N'))
    $stagingFolders.Add($destination)
    $prefix = [IO.Path]::GetFullPath($destination) + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $destination $entry.FullName))
            if (!$target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'The download contains an invalid file path.' }
        }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination)
    return $destination
}
function Test-Library([string]$folder) {
    return $folder -and (Test-Path -LiteralPath (Join-Path $folder 'game/Shell.swf')) -and (Test-Path -LiteralPath (Join-Path $folder 'ruffle/ruffle.js'))
}
$settings = @{}
$settingsFile = Join-Path $root 'local.json'
if (Test-Path -LiteralPath $settingsFile) {
    $existing = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $settings[$property.Name] = $property.Value }
}
if ($Library -and !(Test-Library $Library)) { throw 'That game folder must contain game/Shell.swf and ruffle/ruffle.js.' }
if (!$Library) {
    foreach ($candidate in @($settings.library, (Join-Path $root 'library'), (Join-Path $root 'public'), (Join-Path (Split-Path $root -Parent) 'public'))) {
        if (Test-Library $candidate) { $Library = $candidate; break }
    }
}
if ($Library) { $settings.library = (Resolve-Path -LiteralPath $Library).Path }
else { $settings.library = '' }
if (!$JavaHome) {
    $unpacked = Get-Package $manifest.java
    $JavaHome = (Get-ChildItem -LiteralPath $unpacked -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/javac.exe') } | Select-Object -First 1).FullName
}
if (!$Javac) { $Javac = Join-Path $JavaHome 'bin/javac.exe' }
if (!$FFDec) { $FFDec = Get-Package $manifest.ffdec }
if (!(Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe')) -or !(Test-Path -LiteralPath $Javac)) { throw 'Java is missing java.exe or javac.exe. Run setup again.' }
foreach ($required in @('ffdec.jar','lib','flashlib')) {
    if (!(Test-Path -LiteralPath (Join-Path $FFDec $required))) { throw "FFDec is missing $required. Run setup again." }
}
$electron = Get-Package $manifest.electron
if (!(Test-Path -LiteralPath (Join-Path $electron 'electron.exe'))) { throw 'The Electron download is incomplete.' }
Write-Host 'Setting up the editor...'
$vendor = Join-Path $root 'tools/vendor'
New-Item -ItemType Directory -Force $vendor, (Join-Path $vendor 'compiler'), (Join-Path $vendor 'jre') | Out-Null
if ([IO.Path]::GetFullPath($JavaHome).TrimEnd('\') -ne [IO.Path]::GetFullPath((Join-Path $vendor 'jre')).TrimEnd('\')) {
    Copy-Item (Join-Path $JavaHome '*') (Join-Path $vendor 'jre') -Recurse -Force
}
if ([IO.Path]::GetFullPath($FFDec).TrimEnd('\') -ne [IO.Path]::GetFullPath($vendor).TrimEnd('\')) {
    foreach ($part in @('ffdec.jar','lib','flashlib')) { Copy-Item -LiteralPath (Join-Path $FFDec $part) -Destination $vendor -Recurse -Force }
}
$jar = Join-Path $vendor 'ffdec.jar'
& $Javac -source 8 -target 8 -cp "$jar;$(Join-Path $vendor 'lib/*')" -d (Join-Path $vendor 'compiler') (Join-Path $root 'tools/AppendAs3Classes.java') (Join-Path $root 'tools/AppendAs2Scripts.java')
if ($LASTEXITCODE -ne 0) { throw 'Could not set up the build tools.' }
New-Item -ItemType Directory -Force (Join-Path $root 'runtime') | Out-Null
Copy-Item (Join-Path $electron '*') (Join-Path $root 'runtime') -Recurse -Force
$settings.java = 'tools/vendor/jre/bin/java.exe'
$settings.ffdec = 'tools/vendor/ffdec.jar'
if (!$Library) {
    $Library = & (Join-Path $PSScriptRoot 'setup-game-library.ps1') -Root $root
    $settings.library = $Library
}
[IO.File]::WriteAllText($settingsFile, ($settings | ConvertTo-Json -Depth 20))
Write-Host 'Ready.'
foreach ($folder in $stagingFolders) {
    $resolved = [IO.Path]::GetFullPath($folder)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notmatch '^islandengine-[a-f0-9]{32}$') { throw 'Invalid setup temporary folder.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
