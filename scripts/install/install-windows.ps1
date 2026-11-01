# Compatible with Windows PowerShell 5.1 and PowerShell 7; no administrator rights needed.
[CmdletBinding()]
param(
    [string]$Vault,
    [string]$ConfigDir = '.obsidian',
    [string]$PackageDirectory,
    [switch]$Help
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if ($Help) {
    Write-Output 'install-windows.ps1 [-Vault C:\absolute\vault] [-ConfigDir .obsidian] [-PackageDirectory C:\downloads]'
    Write-Output 'Close Obsidian first. Existing installations are never overwritten. Without -Vault, drag the vault folder into the terminal and press Enter when prompted.'
    Write-Output '-PackageDirectory uses an offline release.json and tt-workbench.bundle.json.gz.'
    return
}
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This script requires Windows.' }
$MaxBytes = 64MB

function ConvertFrom-DroppedPath([string]$Value) {
    # Read-Host returns literal text. Do not evaluate a pasted PowerShell expression.
    $value = $Value.Trim()
    if (-not $value) { throw '没有输入路径，请重新运行并拖入一个知识库文件夹。' }
    if ($value -match '^&\s+[''"]') { $value = $value.Substring(1).TrimStart() }
    if ($value.StartsWith("'") -or $value.StartsWith('"')) {
        $quote = $value.Substring(0, 1)
        if ($value.Length -lt 2 -or -not $value.EndsWith($quote)) { throw '路径引号不完整，请重新拖入文件夹。' }
        $value = $value.Substring(1, $value.Length - 2)
        if ($quote -eq "'") { $value = $value.Replace("''", "'") }
        elseif (-not [IO.Directory]::Exists($value)) { $value = $value -replace '`([`"$])', '$1' }
    }
    return $value
}
if (-not $Vault) {
    Write-Host '请先退出 Obsidian。'
    $Vault = ConvertFrom-DroppedPath (Read-Host '请将知识库文件夹拖入此窗口（也可粘贴完整路径），然后按回车')
}

function Assert-RelativePath([string]$Name) {
    if (-not $Name -or $Name -match '[\\:*?"<>|\x00-\x1f\x7f]') { throw "Unsafe relative path: $Name" }
    foreach ($part in $Name.Split('/')) {
        if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)') { throw "Unsafe relative path: $Name" }
    }
}
function Get-ItemIfPresent([string]$Path) {
    # -LiteralPath preserves brackets and other wildcard characters in vault names.
    try { Get-Item -LiteralPath $Path -Force -ErrorAction Stop }
    catch [System.Management.Automation.ItemNotFoundException] { return $null }
}
function Assert-Directory([string]$Path) {
    if ($Path -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])' -or $Path -match '[\x00-\x1f]' -or $Path -match '(?:^|[\\/])\.{1,2}(?:[\\/]|$)') { throw "An absolute directory path is required: $Path" }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    $current = $root
    $parts = @('') + @($full.Substring($root.Length).Split(@([char]'\', [char]'/'), [StringSplitOptions]::RemoveEmptyEntries))
    foreach ($part in $parts) {
        if ($part) { $current = [IO.Path]::Combine($current, $part) }
        $item = Get-ItemIfPresent $current
        if (-not $item -or -not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Directory missing, linked or invalid: $current" }
    }
    if ($full -eq $root) { return $root }
    return $full.TrimEnd([char]'\', [char]'/')
}
function Assert-File([string]$Path, [long]$Limit) {
    $item = Get-ItemIfPresent $Path
    if (-not $item -or $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt $Limit) { throw "Missing, linked or oversized file: $Path" }
}
function Read-Json([string]$Path, [long]$Limit) {
    Assert-File $Path $Limit
    return (ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)))
}
function Save-Download([string]$Url, [string]$Path, [long]$Limit) {
    # HttpClient streams with a hard limit and follows GitHub's HTTPS asset redirects.
    $response = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    try {
        if (-not $response.IsSuccessStatusCode) { throw "Download failed (HTTP $([int]$response.StatusCode)): $Url" }
        if ($response.RequestMessage.RequestUri.Scheme -ne 'https') { throw 'Download redirected away from HTTPS.' }
        if ($response.Content.Headers.ContentLength -gt $Limit) { throw 'Download exceeds size limit.' }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
        try { Copy-Limited $inputStream $outputStream $Limit }
        finally { $inputStream.Dispose(); $outputStream.Dispose() }
    } finally { $response.Dispose() }
}
function Copy-Limited($InputStream, $OutputStream, [long]$Limit) {
    $buffer = New-Object byte[] 65536
    [long]$total = 0
    while (($count = $InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $total += $count
        if ($total -gt $Limit) { throw 'Package exceeds size limit.' }
        $OutputStream.Write($buffer, 0, $count)
    }
}
function Assert-Release($Release) {
    if ($Release -isnot [pscustomobject] -or $Release.schema -ne 1 -or $Release.id -cne 'tt-workbench' -or $Release.version -cnotmatch '^\d+\.\d+\.\d+$' -or $Release.files -isnot [pscustomobject]) { throw 'Invalid release manifest.' }
    $names = @($Release.files.PSObject.Properties.Name)
    if (-not $names.Count -or $names.Count -gt 10000) { throw 'Invalid file count.' }
    $paths = @{}
    foreach ($name in $names) {
        Assert-RelativePath $name
        if ($name -match '^(release\.json|data\.json|data|apps/workbench/data|\.system|\.workbench-runtime)(/|$)' -or $Release.files.$name -cnotmatch '^[a-f0-9]{64}$') { throw "Invalid release file: $name" }
        $parts = $name.Split('/')
        for ($i = 0; $i -lt $parts.Length; $i++) {
            $exact = $parts[0..$i] -join '/'
            $kind = if ($i -eq $parts.Length - 1) { 'file' } else { 'directory' }
            if ($paths.ContainsKey($exact) -and ($paths[$exact].Exact -cne $exact -or $paths[$exact].Kind -ne $kind -or $kind -eq 'file')) { throw "Conflicting package paths: $name" }
            $paths[$exact] = @{ Exact = $exact; Kind = $kind }
        }
    }
    foreach ($name in @('main.js', 'styles.css', 'manifest.json')) {
        if (-not ($names -ccontains $name)) { throw "Missing plugin entry: $name" }
    }
    return $names
}
function Assert-Hashes([string]$Root, $Release, $Names) {
    foreach ($name in $Names) {
        $file = Join-Path $Root $name
        $null = Assert-Directory ([IO.Path]::GetDirectoryName($file))
        Assert-File $file $MaxBytes
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Release.files.$name) { throw "SHA-256 mismatch: $name" }
    }
}

$Vault = Assert-Directory $Vault
$ConfigDir = $ConfigDir.Replace('\', '/')
Assert-RelativePath $ConfigDir
$configPath = Assert-Directory (Join-Path $Vault $ConfigDir)
if ($PackageDirectory) { $PackageDirectory = Assert-Directory $PackageDirectory }
$parent = Join-Path $configPath 'plugins'
$target = Join-Path $parent 'tt-workbench'
$legacy = Join-Path $parent 'tannt-workbench'
function Assert-Target {
    $null = Assert-Directory $configPath
    if (Get-ItemIfPresent $parent) { $null = Assert-Directory $parent }
    if (Get-ItemIfPresent $target) { throw 'tt-workbench already exists. Use the workbench version menu to update; nothing was overwritten.' }
    if (Get-ItemIfPresent $legacy) { throw 'tannt-workbench exists. Follow docs/workbench/updates.md migration instructions first.' }
}
Assert-Target
Write-Host "Close Obsidian before installing. Target: $target"
$null = [IO.Directory]::CreateDirectory($parent)
$lockPath = Join-Path $parent 'tt-workbench.install-lock'
# CreateNew coordinates with the existing Node installer without removing stale locks.
$lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$work = $null
$client = $null
$previousTls = [Net.ServicePointManager]::SecurityProtocol
try {
    Assert-Target
    $recovery = Join-Path $parent 'tt-workbench-recovery'
    if (Get-ItemIfPresent $recovery) { $null = Assert-Directory $recovery }
    $null = [IO.Directory]::CreateDirectory($recovery)
    $work = Join-Path $recovery ('command-' + [Guid]::NewGuid().ToString('N'))
    $null = [IO.Directory]::CreateDirectory($work)
    $releaseFile = Join-Path $work 'release.json'
    $bundleFile = Join-Path $work 'tt-workbench.bundle.json.gz'
    if ($PackageDirectory) {
        foreach ($name in @('release.json', 'tt-workbench.bundle.json.gz')) {
            $source = Join-Path $PackageDirectory $name
            Assert-File $source $(if ($name -eq 'release.json') { 2MB } else { $MaxBytes })
            [IO.File]::Copy($source, (Join-Path $work $name), $false)
        }
    } else {
        Add-Type -AssemblyName System.Net.Http
        [Net.ServicePointManager]::SecurityProtocol = $previousTls -bor [Net.SecurityProtocolType]::Tls12
        $client = New-Object Net.Http.HttpClient
        $client.Timeout = [TimeSpan]::FromSeconds(180)
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('tt-workbench-installer')
        $metadata = Join-Path $work 'github.json'
        Save-Download 'https://api.github.com/repos/cookaihq/tt-workbench/releases/latest' $metadata 2MB
        $github = Read-Json $metadata 2MB
        if ($github.draft -or $github.prerelease -or -not $github.assets) { throw 'No stable release is available.' }
        Write-Host "Downloading release $($github.tag_name) ..."
        foreach ($name in @('release.json', 'tt-workbench.bundle.json.gz')) {
            $assets = @($github.assets | Where-Object { $_.name -ceq $name })
            $limit = if ($name -eq 'release.json') { 2MB } else { $MaxBytes }
            if ($assets.Count -ne 1 -or $assets[0].size -le 0 -or $assets[0].size -gt $limit) { throw "Missing or invalid release asset: $name" }
            $asset = $assets[0]
            $expectedUrl = 'https://github.com/cookaihq/tt-workbench/releases/download/' + [Uri]::EscapeDataString($github.tag_name) + '/' + $name
            if ($asset.browser_download_url -cne $expectedUrl) { throw 'Unexpected release download URL.' }
            $file = Join-Path $work $name
            Save-Download $asset.browser_download_url $file $limit
            if ((Get-Item -LiteralPath $file).Length -ne $asset.size) { throw "Incomplete download: $name" }
        }
    }
    $release = Read-Json $releaseFile 2MB
    $names = @(Assert-Release $release)
    Add-Type -AssemblyName System.IO.Compression
    $compressed = [IO.File]::OpenRead($bundleFile)
    $gzip = New-Object IO.Compression.GZipStream($compressed, [IO.Compression.CompressionMode]::Decompress)
    $memory = New-Object IO.MemoryStream
    try {
        Copy-Limited $gzip $memory 96MB
        $bundle = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($memory.ToArray()))
    } finally { $memory.Dispose(); $gzip.Dispose(); $compressed.Dispose() }
    $bundleNames = @(Assert-Release $bundle.release)
    if ($bundle.release.version -cne $release.version -or $bundleNames.Count -ne $names.Count) { throw 'Release manifests differ.' }
    foreach ($name in $names) {
        if (-not ($bundleNames -ccontains $name) -or $bundle.release.files.$name -cne $release.files.$name) { throw 'Release manifests differ.' }
    }
    if ($bundle.files -isnot [pscustomobject]) { throw 'Package has no files.' }
    $fileNames = @($bundle.files.PSObject.Properties.Name)
    if ($fileNames.Count -ne $names.Count) { throw 'Package has missing or unlisted files.' }
    $stage = Join-Path $work 'plugin'
    $null = [IO.Directory]::CreateDirectory($stage)
    [long]$total = 0
    foreach ($name in $names) {
        if (-not ($fileNames -ccontains $name)) { throw "Missing package file: $name" }
        $encoded = $bundle.files.$name
        if ($encoded -isnot [string] -or $encoded -cnotmatch '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$') { throw "Invalid base64: $name" }
        $bytes = [Convert]::FromBase64String($encoded)
        $total += $bytes.Length
        if ($total -gt $MaxBytes) { throw 'Package exceeds size limit.' }
        $file = Join-Path $stage $name
        $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
        [IO.File]::WriteAllBytes($file, $bytes)
    }
    $manifest = Read-Json (Join-Path $stage 'manifest.json') $MaxBytes
    if ($manifest.id -cne $release.id -or $manifest.version -cne $release.version -or $manifest.minAppVersion -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Plugin metadata does not match release.' }
    [IO.File]::Copy($releaseFile, (Join-Path $stage 'release.json'), $false)
    Assert-Hashes $stage $release $names
    Assert-Target
    [IO.Directory]::Move($stage, $target)
    Assert-Hashes $target $release $names
    if ((Get-FileHash -LiteralPath (Join-Path $target 'release.json')).Hash -cne (Get-FileHash -LiteralPath $releaseFile).Hash) { throw 'Installed release manifest changed.' }
    Write-Output "Installed tt-workbench $($release.version)`nLocation: $target`nSHA-256 verified: $($names.Count) files. Requires Obsidian $($manifest.minAppVersion)+."
    Write-Output 'Reopen Obsidian, enable tt workbench in Settings > Community plugins, then open the workbench.'
} finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousTls
    if ($client) { $client.Dispose() }
    if ($work -and [IO.Directory]::Exists($work)) {
        try { [IO.Directory]::Delete($work, $true) } catch { Write-Warning "Could not remove installer workspace: $work" }
    }
    $lock.Dispose()
    try { [IO.File]::Delete($lockPath) } catch { Write-Warning "Could not remove installer lock: $lockPath" }
}
