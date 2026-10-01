param(
    [string]$Address = '',
    [ValidateRange(1024, 65535)][int]$HttpPort = 18769,
    [ValidateRange(1024, 65535)][int]$HttpsPort = 18770,
    [switch]$TrustWindows
)
$ErrorActionPreference = 'Stop'
if ($HttpPort -eq $HttpsPort) { throw 'HTTP bootstrap and HTTPS must use different ports.' }
if (-not $Address) {
    $walletNetwork = Get-NetIPConfiguration | Where-Object {
        $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and $_.NetAdapter.HardwareInterface
    } | Select-Object -First 1
    if (-not $walletNetwork) { throw 'No connected physical IPv4 network was found. Specify -Address.' }
    $Address = [string]$walletNetwork.IPv4Address.IPAddress
}
if ([System.Net.IPAddress]::Parse($Address).AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    -not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue)) {
    throw 'Address must be an IPv4 address assigned to this computer.'
}
$walletPython = (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$walletEntry = Join-Path $PSScriptRoot 'windows-https.py'
$walletRelease = Join-Path $PSScriptRoot 'release'
$walletTls = Join-Path $walletRelease 'windows-tls'
New-Item -ItemType Directory -Path $walletTls -Force | Out-Null
# Only this Windows user and SYSTEM can read private keys. Public certificate downloads go through the host.
$walletAcl = [IO.Directory]::GetAccessControl($walletTls, [Security.AccessControl.AccessControlSections]::Access)
$walletAcl.SetAccessRuleProtection($true, $false)
$walletIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$walletSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
foreach ($walletPrincipal in @($walletIdentity, $walletSystem)) {
    $walletAccess = New-Object Security.AccessControl.FileSystemAccessRule(
        $walletPrincipal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $walletAcl.SetAccessRule($walletAccess)
}
[IO.Directory]::SetAccessControl($walletTls, $walletAcl)

$walletPrepared = & $walletPython $walletEntry prepare --address $Address --http-port $HttpPort --https-port $HttpsPort
if ($LASTEXITCODE -ne 0) { throw 'Wallet certificate or release preparation failed. No server was stopped.' }
$walletConfig = $walletPrepared | ConvertFrom-Json
$walletWorker = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sw.js') -Raw
$walletVersion = [regex]::Match($walletWorker, 'const VERSION\s*=\s*"([A-Za-z0-9.-]+)"').Groups[1].Value
$walletCertPath = Join-Path $walletTls 'public/wallet-ca.cer'
if ($TrustWindows -and -not (Test-Path -LiteralPath ('Cert:\CurrentUser\Root\' + $walletConfig.ca_thumbprint))) {
    Import-Certificate -FilePath $walletCertPath -CertStoreLocation Cert:\CurrentUser\Root | Out-Null
}

$walletMetadataPath = Join-Path $walletRelease 'windows-host.json'
$walletOld = $null
if (Test-Path -LiteralPath $walletMetadataPath) {
    $walletOld = Get-Content -LiteralPath $walletMetadataPath -Raw | ConvertFrom-Json
}
$walletListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @($HttpPort, $HttpsPort) -and $_.LocalAddress -in @($Address, '0.0.0.0', '::') })
if ($walletListeners.Count) {
    if (-not $walletOld) { throw 'A requested port is occupied by an untracked process.' }
    $walletProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$walletOld.pid)"
    $walletIsOurProcess = $walletProcess -and $walletProcess.ExecutablePath -eq $walletPython -and (
        ($walletProcess.CommandLine.Contains($walletEntry) -and $walletProcess.CommandLine -match '\bserve\b') -or
        ($walletProcess.CommandLine.Contains('-m http.server') -and $walletProcess.CommandLine.Contains($walletOld.site))
    )
    if (-not $walletIsOurProcess -or @($walletListeners | Where-Object { $_.OwningProcess -ne $walletOld.pid }).Count) {
        throw 'A requested port is occupied by another process. No process was stopped.'
    }
    if ($walletOld.mode -eq 'https' -and $walletOld.address -eq $Address -and
        $walletOld.http_port -eq $HttpPort -and $walletOld.https_port -eq $HttpsPort -and
        $walletOld.server_sha256 -eq $walletConfig.server_sha256 -and $walletOld.version -eq $walletVersion) {
        & $walletPython $walletEntry check
        if ($LASTEXITCODE -ne 0) { throw 'The recorded HTTPS server failed verification.' }
        Write-Output "Already running: $($walletConfig.https_url)"
        Write-Output "iPhone setup: $($walletConfig.setup_url)"
        exit 0
    }
    & (Join-Path $PSScriptRoot 'stop-windows.ps1')
}

$walletHostProcess = Start-Process -FilePath $walletPython -ArgumentList @(('"' + $walletEntry + '"'), 'serve') `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $walletRelease 'windows-https.stdout.log') `
    -RedirectStandardError (Join-Path $walletRelease 'windows-https.stderr.log')
try {
    $walletHealthy = $false
    for ($walletAttempt = 0; $walletAttempt -lt 20; $walletAttempt++) {
        if ($walletHostProcess.HasExited) { throw 'Wallet HTTPS host exited. Read release/windows-https.stderr.log.' }
        $walletCheck = & $walletPython $walletEntry check 2>$null
        if ($LASTEXITCODE -eq 0) { $walletHealthy = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $walletHealthy) { throw 'Wallet HTTPS verification did not pass.' }
    [pscustomobject]@{
        pid = $walletHostProcess.Id; mode = 'https'; address = $Address; port = $HttpsPort
        http_port = $HttpPort; https_port = $HttpsPort; url = $walletConfig.https_url
        setup_url = $walletConfig.setup_url; python = $walletPython; entry = $walletEntry
        site = (Join-Path $walletRelease "windows-site-$walletVersion"); version = $walletVersion
        server_sha256 = $walletConfig.server_sha256; ca_thumbprint = $walletConfig.ca_thumbprint
        startedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $walletMetadataPath -Encoding UTF8
} catch {
    if (-not $walletHostProcess.HasExited) { Stop-Process -Id $walletHostProcess.Id }
    throw
}
Write-Output $walletCheck
Write-Output "Running: $($walletConfig.https_url)"
Write-Output "iPhone setup: $($walletConfig.setup_url)"
Write-Output 'Install and trust the certificate on iPhone, then open HTTPS Wallet and wait for offline readiness.'
