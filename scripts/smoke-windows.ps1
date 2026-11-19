$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$packages = @(Get-ChildItem 'src-tauri/target/release/bundle/nsis' -Filter '*.exe')
if ($packages.Count -ne 1) { throw "Esperado um instalador NSIS. Encontrados $($packages.Count)." }
if (Get-Command oofem.exe -ErrorAction SilentlyContinue) { throw 'O runner já tem OOFEM no PATH.' }
Remove-Item Env:OOFEM_BIN -ErrorAction SilentlyContinue

$smoke = New-Item -ItemType Directory -Force "$PWD/package-smoke"
$install = Join-Path $env:RUNNER_TEMP "KStruct smoke $env:GITHUB_RUN_ID"
$report = Join-Path $smoke.FullName 'windows-nsis.json'
$firewallGroup = "KStruct package smoke $env:GITHUB_RUN_ID"

function Block-Outbound([string]$program) {
  $rule = @{
    DisplayName = 'KStruct offline: ' + [IO.Path]::GetFileName($program)
    Group = $firewallGroup
    Direction = 'Outbound'
    Action = 'Block'
    Program = $program
  }
  New-NetFirewallRule @rule | Out-Null
}

try {
  Block-Outbound $packages[0].FullName
  $setup = Start-Process -FilePath $packages[0].FullName -ArgumentList "/S /D=$install" -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "Instalação NSIS falhou ($($setup.ExitCode))." }
  $app = Join-Path $install 'k-struct.exe'
  $engine = Join-Path $install 'oofem/oofem.exe'
  if (!(Test-Path $app) -or !(Test-Path $engine)) { throw 'KStruct ou OOFEM não foi instalado no caminho solicitado.' }
  Block-Outbound $app
  Block-Outbound $engine
  $probe = Start-Process -FilePath $app -ArgumentList ('--check-oofem "{0}"' -f $report) -Wait -PassThru
  if ($probe.ExitCode -ne 0) {
    if (Test-Path $report) { Get-Content $report }
    throw "Autoteste do pacote Windows falhou ($($probe.ExitCode))."
  }
  node scripts/verify-desktop-engine.mjs $report
} finally {
  Get-NetFirewallRule -Group $firewallGroup -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
