param(
    [string]$Address = '',
    [ValidateRange(1024, 65535)][int]$Port = 18769,
    [switch]$HttpOnly
)

$ErrorActionPreference = 'Stop'

if (-not $HttpOnly) {
    & (Join-Path $PSScriptRoot 'start-windows-https.ps1') -Address $Address -HttpPort $Port
    exit
}

if (-not $Address) {
    $walletNetworks = @(Get-NetIPConfiguration | Where-Object {
        $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' -and
        $_.NetAdapter.HardwareInterface
    })
    $walletNetwork = $walletNetworks | Select-Object -First 1
    if (-not $walletNetwork) { throw 'No connected physical IPv4 network was found. Specify -Address.' }
    $Address = [string]$walletNetwork.IPv4Address.IPAddress
}

$walletParsedAddress = [System.Net.IPAddress]::Parse($Address)
if ($walletParsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    -not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $Address -ErrorAction SilentlyContinue)) {
    throw 'Address must be an IPv4 address assigned to this computer.'
}

$walletPython = (Get-Command python -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$walletWorker = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sw.js') -Raw
$walletVersionMatch = [regex]::Match($walletWorker, 'const VERSION\s*=\s*"([A-Za-z0-9.-]+)"')
if (-not $walletVersionMatch.Success) { throw 'Cannot read the release version.' }
$walletVersion = $walletVersionMatch.Groups[1].Value
$walletReleaseRoot = Join-Path $PSScriptRoot 'release'
$walletArchive = Join-Path $walletReleaseRoot "wallet-ios-pwa-$walletVersion.zip"
$walletChecksumFile = [IO.Path]::ChangeExtension($walletArchive, '.sha256')
$walletExpectedChecksum = ((Get-Content -LiteralPath $walletChecksumFile -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $walletArchive -Algorithm SHA256).Hash -ne $walletExpectedChecksum) {
    throw 'Release checksum mismatch. Deployment stopped.'
}

# Publish the verified release only; tests, backups and the Git repository stay outside the web root.
$walletSite = Join-Path $walletReleaseRoot "windows-site-$walletVersion"
if (-not (Test-Path -LiteralPath $walletSite)) {
    Expand-Archive -LiteralPath $walletArchive -DestinationPath $walletSite
}
$walletManifest = Get-Content -LiteralPath (Join-Path $walletSite 'release-manifest.json') -Raw | ConvertFrom-Json
foreach ($walletEntry in $walletManifest.files.PSObject.Properties) {
    $walletAssetPath = [IO.Path]::GetFullPath((Join-Path $walletSite $walletEntry.Name))
    $walletSitePrefix = [IO.Path]::GetFullPath($walletSite).TrimEnd('\') + '\'
    if (-not $walletAssetPath.StartsWith($walletSitePrefix, [StringComparison]::OrdinalIgnoreCase) -or
        (Get-FileHash -LiteralPath $walletAssetPath -Algorithm SHA256).Hash -ne $walletEntry.Value.sha256) {
        throw "Published asset checksum mismatch: $($walletEntry.Name)"
    }
}

$walletMetadataPath = Join-Path $walletReleaseRoot 'windows-host.json'
$walletListeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -in @($Address, '0.0.0.0', '::') })
if ($walletListeners.Count) {
    if (Test-Path -LiteralPath $walletMetadataPath) {
        $walletExisting = Get-Content -LiteralPath $walletMetadataPath -Raw | ConvertFrom-Json
        $walletProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$walletExisting.pid)"
        if ($walletExisting.address -eq $Address -and $walletExisting.port -eq $Port -and
            $walletExisting.site -eq $walletSite -and $walletProcess -and
            $walletListeners.OwningProcess -contains $walletExisting.pid -and
            $walletProcess.ExecutablePath -eq $walletPython -and
            $walletProcess.CommandLine.Contains($walletSite)) {
            Write-Output "Already running: http://${Address}:$Port/"
            exit 0
        }
    }
    throw "Port $Port is already occupied. No existing process was stopped."
}

$walletHostProcess = Start-Process -FilePath $walletPython -ArgumentList @(
    '-m', 'http.server', [string]$Port, '--bind', $Address, '--directory', ('"' + $walletSite + '"')
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $walletReleaseRoot 'windows-host.stdout.log') `
    -RedirectStandardError (Join-Path $walletReleaseRoot 'windows-host.stderr.log')

try {
    $walletResponse = $null
    for ($walletAttempt = 0; $walletAttempt -lt 20; $walletAttempt++) {
        if ($walletHostProcess.HasExited) { throw 'The Windows web server exited before startup completed.' }
        try {
            $walletResponse = Invoke-WebRequest -Uri "http://${Address}:$Port/" -UseBasicParsing -TimeoutSec 2 -Proxy $null
            break
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $walletResponse -or $walletResponse.StatusCode -ne 200 -or
        -not $walletResponse.Content.Contains('Wallet')) { throw 'Windows web server did not pass its startup check.' }
    [pscustomobject]@{
        pid = $walletHostProcess.Id
        address = $Address
        port = $Port
        url = "http://${Address}:$Port/"
        site = $walletSite
        python = $walletPython
        version = $walletVersion
        startedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $walletMetadataPath -Encoding UTF8
} catch {
    if (-not $walletHostProcess.HasExited) { Stop-Process -Id $walletHostProcess.Id }
    throw
}

Write-Output "Running: http://${Address}:$Port/"
Write-Output "Process: $($walletHostProcess.Id); Release: $walletVersion"
Write-Output 'Open this address in Safari on a phone connected to the same local network.'
Write-Output 'This HTTP deployment provides online use. PWA offline caching requires HTTPS.'
