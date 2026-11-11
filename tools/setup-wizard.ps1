$ErrorActionPreference = 'Stop'
try {
    Write-Host 'First run: downloading the tools islandengine needs.'
    Write-Host 'This can take a few minutes. Keep this window open.'
    & (Join-Path $PSScriptRoot 'setup.ps1')
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message
    Write-Host 'Setup stopped. Check your connection, then open Start islandengine.cmd again.'
    exit 1
}
