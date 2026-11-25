param(
  [string]$InstallDir = $(if ($env:REDLINIFY_HOME) { $env:REDLINIFY_HOME } else { Join-Path $HOME ".redlinify" }),
  [string]$RepoUrl = $(if ($env:REDLINIFY_REPO) { $env:REDLINIFY_REPO } else { "https://github.com/wltwror/Redlinify.git" }),
  [string]$Branch = $(if ($env:REDLINIFY_BRANCH) { $env:REDLINIFY_BRANCH } else { "main" }),
  [switch]$NoGlobalLink
)

$ErrorActionPreference = "Stop"

foreach ($cmd in @("git", "node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "'$cmd' is required. Install Git and Node.js >= 22.12.0 (https://nodejs.org) first."
  }
}

$nodeVerRaw = (& node -p "process.versions.node").Trim()
if ([version]$nodeVerRaw -lt [version]"22.12.0") {
  throw "Node.js >= 22.12.0 is required (found v$nodeVerRaw). Please upgrade Node.js first."
}

$gitDir = Join-Path $InstallDir ".git"
if (Test-Path $gitDir) {
  $status = (& git -C $InstallDir status --porcelain)
  if ($status) {
    throw "Existing clone at '$InstallDir' has uncommitted changes. Commit/stash them or set REDLINIFY_HOME to another path."
  }
  Write-Host "[redlinify] Updating existing Redlinify checkout at $InstallDir..."
  & git -C $InstallDir fetch --tags origin
  if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }
  & git -C $InstallDir pull --ff-only origin $Branch
  if ($LASTEXITCODE -ne 0) { throw "git pull --ff-only failed." }
} elseif (Test-Path $InstallDir) {
  $items = Get-ChildItem -Force -Path $InstallDir
  if ($items.Count -gt 0) {
    throw "Directory '$InstallDir' already exists and is not empty. Remove it or set REDLINIFY_HOME to another path."
  }
  Write-Host "[redlinify] Cloning Redlinify ($Branch) into $InstallDir..."
  & git clone --branch $Branch $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed." }
} else {
  $parent = Split-Path -Parent $InstallDir
  if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }
  Write-Host "[redlinify] Cloning Redlinify ($Branch) into $InstallDir..."
  & git clone --branch $Branch $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "git clone failed." }
}

$absInstallDir = (Resolve-Path $InstallDir).Path
$cliJs = Join-Path $absInstallDir "packages\server\dist\cli.js"

Push-Location $absInstallDir
try {
  Write-Host "[redlinify] Installing dependencies..."
  if (Test-Path (Join-Path $absInstallDir "package-lock.json")) {
    & npm ci
    if ($LASTEXITCODE -ne 0) {
      & npm install
      if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    }
  } else {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
  }

  Write-Host "[redlinify] Building @redlinify/shared, @redlinify/server, and @redlinify/ui..."
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

  $linkedGlobal = $false
  if (-not $NoGlobalLink) {
    try {
      & npm link -w @redlinify/server *> $null
      if ($LASTEXITCODE -eq 0 -and (Get-Command redlinify -ErrorAction SilentlyContinue)) {
        & redlinify --version *> $null
        if ($LASTEXITCODE -eq 0) {
          $linkedGlobal = $true
        }
      }
    } catch {
      $linkedGlobal = $false
    }
  }
} finally {
  Pop-Location
}

$installedVersion = (& node $cliJs --version).Trim()
Write-Host "[redlinify] Installed Redlinify v$installedVersion ($absInstallDir)."

if ($linkedGlobal) {
  Write-Host ""
  Write-Host "Add Redlinify to your MCP client config:"
  Write-Host ""
  Write-Host '{'
  Write-Host '  "mcpServers": {'
  Write-Host '    "redlinify": {'
  Write-Host '      "command": "redlinify",'
  Write-Host '      "args": ["mcp"]'
  Write-Host '    }'
  Write-Host '  }'
  Write-Host '}'
  Write-Host ""
  Write-Host "Keep Redlinify up to date anytime with: redlinify update"
} else {
  $escapedCliJs = $cliJs.Replace('\', '\\')
  Write-Host ""
  Write-Host "Global 'redlinify' link was skipped or is not on PATH."
  Write-Host "Add Redlinify to your MCP client config using Node directly:"
  Write-Host ""
  Write-Host '{'
  Write-Host '  "mcpServers": {'
  Write-Host '    "redlinify": {'
  Write-Host '      "command": "node",'
  Write-Host "      `"args`": [`"$escapedCliJs`", `"mcp`"]"
  Write-Host '    }'
  Write-Host '  }'
  Write-Host '}'
  Write-Host ""
  Write-Host "Keep Redlinify up to date anytime with: npm --prefix `"$absInstallDir`" run update"
}
