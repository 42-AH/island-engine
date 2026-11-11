param(
    [Parameter(Mandatory = $true)][string]$Root,
    [string]$Runtime
)
$ErrorActionPreference = 'Stop'
if (!$Runtime) { $Runtime = Join-Path $Root 'runtime/electron.exe' }
$resultFile = Join-Path $Root '.cache/setup/game-library.json'
New-Item -ItemType Directory -Force (Split-Path $resultFile -Parent) | Out-Null
# This is a handoff file, not the installed library. Never accept an older run's result.
if (Test-Path -LiteralPath $resultFile) { Remove-Item -LiteralPath $resultFile -Force }
$previousNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    # Windows PowerShell otherwise starts this GUI-subsystem executable without waiting.
    # The pipeline keeps setup attached until Electron's Node process exits.
    & $Runtime (Join-Path $Root 'tools/game-library.cjs') | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Game setup stopped. Open Start islandengine.cmd again to retry. Your downloaded files are kept.' }
    if (!(Test-Path -LiteralPath $resultFile)) { throw 'The game installer closed without reporting a game folder. Open Start islandengine.cmd again to retry.' }
    $library = (Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json).library
    if (!$library -or !(Test-Path -LiteralPath (Join-Path $library 'game/Shell.swf')) -or !(Test-Path -LiteralPath (Join-Path $library 'ruffle/ruffle.js'))) {
        throw 'The game installer returned an incomplete game folder. Open Start islandengine.cmd again to retry.'
    }
    return $library
} finally { $env:ELECTRON_RUN_AS_NODE = $previousNodeMode }
