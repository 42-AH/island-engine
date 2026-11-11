# Offline checks. Downloads are replaced with local test bytes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$repo = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path $repo ('.cache/setup-tests/' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'tools') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'tools/setup.ps1') -Destination (Join-Path $fixture 'tools/setup.ps1')
$setup = Join-Path $fixture 'tools/setup.ps1'
$setupTestContext = @{ downloads=0; payload=(Join-Path $fixture 'payload.zip') }
function Invoke-WebRequest {
    param($Uri, $OutFile, $TimeoutSec, [switch]$UseBasicParsing)
    $setupTestContext.downloads++
    Copy-Item -LiteralPath $setupTestContext.payload -Destination $OutFile -Force
}
function Expect-Failure([scriptblock]$operation, [string]$message) {
    try { & $operation; throw 'Setup unexpectedly succeeded.' }
    catch { if ($_.Exception.Message -notlike "*$message*") { throw } }
}
function Write-Manifest([string]$hash) {
    @{java=@{id='test-java';name='Java';url='https://example.invalid/test.zip';sha256=$hash}} |
        ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $fixture 'tools/setup-downloads.json')
}
Write-Manifest ('0' * 64)
Expect-Failure { & $setup -Library (Join-Path $fixture 'missing') } 'That game folder must contain'
if ($setupTestContext.downloads -ne 0) { throw 'Invalid game folder triggered a download.' }
Write-Output 'PASS: invalid game folders stop before downloading'

[IO.File]::WriteAllText($setupTestContext.payload, 'incomplete download')
$settings = '{"library":"","customSetting":"keep me"}'
[IO.File]::WriteAllText((Join-Path $fixture 'local.json'), $settings)
Expect-Failure { & $setup } 'did not pass its checksum'
if (Test-Path -LiteralPath (Join-Path $fixture '.cache/setup/test-java.zip')) { throw 'Bad download was accepted.' }
if ([IO.File]::ReadAllText((Join-Path $fixture 'local.json')) -ne $settings) { throw 'Failed setup changed settings.' }
Write-Output 'PASS: bad downloads are rejected without changing settings'

$setupTestContext.payload = Join-Path $fixture 'traversal.zip'
$zip = [IO.Compression.ZipFile]::Open($setupTestContext.payload, [IO.Compression.ZipArchiveMode]::Create)
try { $null = $zip.CreateEntry('../escape.txt') } finally { $zip.Dispose() }
Write-Manifest (Get-FileHash -LiteralPath $setupTestContext.payload -Algorithm SHA256).Hash
Expect-Failure { & $setup } 'invalid file path'
Write-Output 'PASS: ZIP entries cannot escape their extraction folder'
