[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$')]
  [string]$Hostname,
  [string]$CloudflaredPath = 'cloudflared',
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }),
  [switch]$SkipTokenPrompt
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function ConvertTo-Hashtable {
  param([object]$Value)

  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IDictionary]) {
    $table = @{}
    foreach ($key in $Value.Keys) {
      $table[$key] = ConvertTo-Hashtable $Value[$key]
    }
    return $table
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $table = @{}
    foreach ($property in $Value.PSObject.Properties) {
      $table[$property.Name] = ConvertTo-Hashtable $property.Value
    }
    return $table
  }
  if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
    return @($Value | ForEach-Object { ConvertTo-Hashtable $_ })
  }
  return $Value
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Parent,
    [Parameter(Mandatory = $true)][string]$Child
  )

  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $childFull = [System.IO.Path]::GetFullPath($Child)
  $prefix = $parentFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $childFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside ${parentFull}: $childFull"
  }
}

function Set-EnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $line = "$Name=$Value"
  $content = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { '' }
  $pattern = "(?m)^$([regex]::Escape($Name))=.*(?:\r?\n|$)"
  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, "$line`r`n")
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "$line`r`n"
  }
  Write-Utf8NoBom -Path $Path -Content $content
}

function Set-CredentialValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $quoted = $Value.Replace("'", "''")
  $line = "${Name}: '$quoted'"
  $content = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { '' }
  $pattern = "(?m)^\s*$([regex]::Escape($Name))\s*:.*(?:\r?\n|$)"
  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, "$line`r`n")
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "$line`r`n"
  }
  Write-Utf8NoBom -Path $Path -Content $content
}

$source = Split-Path -Parent $PSCommandPath
$profileDir = Join-Path $DshHome 'profiles\web'
$modulesDir = Join-Path $profileDir 'node_modules'
$packageName = 'dsh-cloudflare-tunnel'
$packageDir = Join-Path $modulesDir $packageName

foreach ($required in @('package.json', 'cordis.patch.yml', 'lib\index.js', 'lib\invariant.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $required))) {
    throw "The plug-in release is incomplete: missing $required under $source"
  }
}

New-Item -ItemType Directory -Force $profileDir, $modulesDir | Out-Null
Assert-ChildPath -Parent $modulesDir -Child $packageDir
if (Test-Path -LiteralPath $packageDir) {
  Remove-Item -LiteralPath $packageDir -Recurse -Force
}
New-Item -ItemType Directory -Force $packageDir | Out-Null
foreach ($item in @('lib', 'package.json', 'cordis.patch.yml', 'LICENSE')) {
  Copy-Item -LiteralPath (Join-Path $source $item) -Destination $packageDir -Recurse -Force
}

$profileManifestPath = Join-Path $profileDir 'package.json'
if (Test-Path -LiteralPath $profileManifestPath) {
  $profileManifest = ConvertTo-Hashtable (Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json)
} else {
  $profileManifest = @{
    name = 'dsh-profile-web'
    private = $true
    dependencies = @{}
    dsh = @{ profile = @{ bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app') } }
  }
}
if ($null -eq $profileManifest.dependencies) { $profileManifest.dependencies = @{} }
if ($null -eq $profileManifest.dsh) { $profileManifest.dsh = @{} }
if ($null -eq $profileManifest.dsh.profile) { $profileManifest.dsh.profile = @{} }
if ($null -eq $profileManifest.dsh.profile.bundles) {
  $profileManifest.dsh.profile.bundles = @('@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app')
}

if ($profileManifest.dependencies.ContainsKey($packageName)) {
  $profileManifest.dependencies.Remove($packageName)
}
$bundles = [System.Collections.Generic.List[string]]::new([string[]]@($profileManifest.dsh.profile.bundles))
if (-not $bundles.Contains($packageName)) { $bundles.Add($packageName) }
$profileManifest.dsh.profile.bundles = @($bundles)
Write-Utf8NoBom -Path $profileManifestPath -Content (($profileManifest | ConvertTo-Json -Depth 10) + "`n")

$workspacePath = Join-Path $profileDir 'pnpm-workspace.yaml'
if (-not (Test-Path -LiteralPath $workspacePath)) {
  Write-Utf8NoBom -Path $workspacePath -Content "packages:`r`n  - .`r`n`r`nnodeLinker: hoisted`r`nautoInstallPeers: false`r`n"
}

Set-EnvValue -Path (Join-Path $DshHome '.env') -Name 'CLOUDFLARE_TUNNEL_HOSTNAME' -Value $Hostname
Set-EnvValue -Path (Join-Path $DshHome '.env') -Name 'CLOUDFLARED_PATH' -Value $CloudflaredPath

if (-not $SkipTokenPrompt) {
  $secureToken = Read-Host 'Paste the Cloudflare Tunnel token' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'The Cloudflare Tunnel token cannot be empty.' }
    Set-CredentialValue -Path (Join-Path $DshHome '.credentials.yaml') -Name 'CLOUDFLARE_TUNNEL_TOKEN' -Value $token
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

Write-Host "Installed $packageName for the DSH Web profile at $profileDir"
Write-Host "Restart DeepSeek Harness, then open https://$Hostname"
if ($SkipTokenPrompt) {
  Write-Warning 'No token was written. Add CLOUDFLARE_TUNNEL_TOKEN to .credentials.yaml before restarting DeepSeek Harness.'
}
