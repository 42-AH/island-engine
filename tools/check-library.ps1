$root = Split-Path $PSScriptRoot -Parent
try {
    $settings = Get-Content -LiteralPath (Join-Path $root 'local.json') -Raw -ErrorAction Stop | ConvertFrom-Json
    if (!$settings.library) { exit 1 }
    foreach ($file in @('game/Shell.swf','ruffle/ruffle.js')) {
        if (!(Test-Path -LiteralPath (Join-Path $settings.library $file))) { exit 1 }
    }
    exit 0
} catch { exit 1 }
