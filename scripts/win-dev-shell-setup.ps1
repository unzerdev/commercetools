<#
  win-dev-shell-setup.ps1

  WHY THIS EXISTS
  ---------------
  On Windows, `npm install` / `yarn install` in mc and mc-view can fail
  during the @commercetools/nimbus postinstall step with:

      'test' is not recognized as an internal or external command

  nimbus runs a postinstall `test -f ./dist/index.es.js && chakra typegen ... || true`.
  Both npm and yarn execute package scripts through cmd.exe on Windows, and cmd.exe
  has no `test` / `true` commands, so the whole install aborts. (It "works" from
  Git Bash only because Git's coreutils are on PATH there.)

  WHAT THIS SCRIPT DOES
  ---------------------
  Appends Git for Windows' `usr\bin` to the END of PATH, so `test` and `true`
  (which Windows lacks) resolve, while Windows `find` / `sort` still win because
  they appear earlier in PATH. It does NOT modify any project file, and does NOT
  copy the MSYS binaries (they depend on msys-2.0.dll and break when copied out).

  Not needed on WSL / Linux / Docker or when installing from Git Bash — those
  already have `test` / `true`.

  ---------------------------------------------------------------------------
  WINDOWS SETUP STEPS (PowerShell / cmd)
  ---------------------------------------------------------------------------
  Run ONCE to configure your machine permanently:

      powershell -ExecutionPolicy Bypass -File scripts\win-dev-shell-setup.ps1

  Then open a NEW terminal and install as usual:

      cd mc      ; npm install
      cd mc-view ; npm install

  Or do setup + install in one shot (repeat with the mc-view path):

      powershell -ExecutionPolicy Bypass -File scripts\win-dev-shell-setup.ps1 -Install mc

  Flags:
      -Install <path>   also run install in <path> right after setup
      -Yarn             use `yarn install` instead of `npm install` (with -Install)
      -SessionOnly      configure PATH for the current window only (no permanent change)
  ---------------------------------------------------------------------------
#>

param(
  # Optional: project path to run install in right after setup.
  [string]$Install,
  # Optional: use yarn instead of npm for -Install.
  [switch]$Yarn,
  # Optional: configure PATH for this session only (no permanent User PATH change).
  [switch]$SessionOnly
)

$ErrorActionPreference = 'Stop'

function Find-GitUsrBin {
  $candidates = @()
  $git = Get-Command git -ErrorAction SilentlyContinue
  if ($git) {
    # ...\Git\cmd\git.exe  ->  ...\Git
    $root = Split-Path (Split-Path $git.Source)
    $candidates += (Join-Path $root 'usr\bin')
  }
  $candidates += @(
    'C:\Program Files\Git\usr\bin',
    'C:\Program Files (x86)\Git\usr\bin',
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\usr\bin')
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'test.exe')) -and (Test-Path (Join-Path $c 'true.exe'))) {
      return $c
    }
  }
  return $null
}

Write-Host "== win-dev-shell-setup ==" -ForegroundColor Cyan

$usrBin = Find-GitUsrBin
if (-not $usrBin) {
  throw "Cannot find 'test.exe'/'true.exe' from Git for Windows. " +
        "Install Git for Windows (with Unix tools) or put git on PATH."
}
Write-Host "Git coreutils found: $usrBin" -ForegroundColor DarkGray

# 1) Append to CURRENT session PATH so install works right now.
#    Append (not prepend) => Windows find/sort stay ahead and win.
if (($env:Path -split ';') -notcontains $usrBin) {
  $env:Path = $env:Path.TrimEnd(';') + ';' + $usrBin
}

# 2) Persist to the END of User PATH (for future terminals) unless -SessionOnly.
if (-not $SessionOnly) {
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $usrBin) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $usrBin), 'User')
    Write-Host "User PATH updated (applies to new terminals)." -ForegroundColor Green
  } else {
    Write-Host "User PATH already contains $usrBin." -ForegroundColor DarkGray
  }
}

# 3) Verify cmd can now see test/true.
$probe = cmd /c "test -f `"$PSCommandPath`" && true && echo SHELL_OK" 2>&1
if ($LASTEXITCODE -eq 0 -and ($probe -match 'SHELL_OK')) {
  Write-Host "OK: 'test' and 'true' are available to cmd in this session." -ForegroundColor Green
} else {
  throw "Verification failed. Output: $probe"
}

# 4) Optionally run install now.
if ($Install) {
  if (-not (Test-Path (Join-Path $Install 'package.json'))) {
    throw "No package.json found in: $Install"
  }
  $tool = if ($Yarn) { 'yarn' } else { 'npm' }
  Write-Host "Running '$tool install' in: $Install" -ForegroundColor Cyan
  Push-Location $Install
  try {
    & $tool install
    if ($LASTEXITCODE -ne 0) { throw "'$tool install' exited with code $LASTEXITCODE." }
    Write-Host "Install finished successfully." -ForegroundColor Green
  } finally {
    Pop-Location
  }
} else {
  Write-Host "You can now run 'npm install' (or 'yarn install') in this window." -ForegroundColor Cyan
}
