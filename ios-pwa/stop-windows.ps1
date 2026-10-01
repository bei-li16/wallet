$ErrorActionPreference = 'Stop'
$walletMetadataPath = Join-Path $PSScriptRoot 'release/windows-host.json'
if (-not (Test-Path -LiteralPath $walletMetadataPath)) { Write-Output 'No recorded Wallet server.'; exit 0 }
$walletHost = Get-Content -LiteralPath $walletMetadataPath -Raw | ConvertFrom-Json
$walletProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$walletHost.pid)"
if (-not $walletProcess) { Write-Output 'The recorded Wallet server has already stopped.'; exit 0 }
$walletIsWalletCommand = if ($walletHost.mode -eq 'https') {
    $walletProcess.CommandLine.Contains($walletHost.entry) -and $walletProcess.CommandLine -match '\bserve\b'
} else {
    $walletProcess.CommandLine.Contains($walletHost.site) -and $walletProcess.CommandLine.Contains('-m http.server')
}
if ($walletProcess.ExecutablePath -ne $walletHost.python -or -not $walletIsWalletCommand) {
    throw 'The recorded process no longer matches Wallet. No process was stopped.'
}
Stop-Process -Id $walletProcess.ProcessId
Write-Output "Stopped Wallet server: $($walletHost.url)"
