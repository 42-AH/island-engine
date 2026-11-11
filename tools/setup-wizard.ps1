$ErrorActionPreference = 'Stop'
try {
    Write-Host 'Setting up islandengine.'
    Write-Host 'First setup downloads about 6 GB of game files, plus the tools. Allow 15 GB of free space.'
    Write-Host 'Keep this window open. If the download stops, open Start islandengine.cmd again to continue.'
    & (Join-Path $PSScriptRoot 'setup.ps1')
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message
    Write-Host 'Setup stopped. The error above explains what failed. Open Start islandengine.cmd again to retry; completed downloads are kept.'
    exit 1
}
