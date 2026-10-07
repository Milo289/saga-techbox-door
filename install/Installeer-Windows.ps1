# Saga Techbox Deur — slimme installatie voor Windows.
# Dubbelklik "Installeer-Windows.bat" (of voer dit bestand uit met PowerShell).
# Het herkent je pc, haalt de nieuwste versie van GitHub op en start de installatie.
# Optie:  -DryRun  = alleen laten zien wat het zou kiezen.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = 'Milo289/saga-techbox-door'
$arch = $env:PROCESSOR_ARCHITECTURE
$pattern = '*windows-setup.exe'   # werkt op x64 en op ARM (Windows draait het daar via emulatie)

Write-Host '━━━ Saga Techbox Deur installeren ━━━'
Write-Host "Ik zie: Windows-pc ($arch)"
Write-Host "Bestand: $pattern"
if ($DryRun) { exit 0 }

function Pause-Exit($msg) { Write-Host $msg; Read-Host 'Druk Enter om af te sluiten'; exit 1 }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host 'Voor het downloaden uit jouw privé-GitHub heb ik de gratis hulp "gh" nodig.'
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    $yn = Read-Host 'Nu installeren met winget? [j/N]'
    if ($yn -match '^[jJyY]') {
      winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
      $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    }
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Start-Process "https://github.com/$repo/releases/latest"
    Pause-Exit "Download het bestand dat eindigt op windows-setup.exe met de hand (de pagina is geopend)."
  }
}

gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Log eenmalig in bij GitHub (volg de vragen op het scherm):'
  gh auth login
  if ($LASTEXITCODE -ne 0) { Pause-Exit 'Inloggen mislukt.' }
}

$dest = Join-Path $env:USERPROFILE 'Downloads'
Write-Host ''
Write-Host "Downloaden naar $dest ..."
gh release download --repo $repo --pattern $pattern --dir $dest --clobber
if ($LASTEXITCODE -ne 0) { Pause-Exit 'Downloaden mislukte.' }
$file = Get-ChildItem -Path $dest -Filter 'Saga-Techbox-Deur-*-windows-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $file) { Pause-Exit 'Het gedownloade bestand is niet gevonden.' }
Write-Host "Klaar: $($file.FullName)"
Write-Host 'De installatie start nu. Staat er "Windows heeft uw pc beschermd"? Klik op Meer info en dan op Toch uitvoeren.'
Start-Process $file.FullName
Read-Host 'Druk Enter om dit venster te sluiten'
