# Saga Techbox Deur - slimme installatie voor Windows.
# Dubbelklik "Installeer-Windows.bat" (of voer dit bestand uit met PowerShell).
# Het herkent je pc, haalt de nieuwste versie van GitHub op (ook developer betas) en start de installatie.
# Opties:  -Stabiel = alleen gewone versies   -ZoekAlleen = alleen zoeken, niet downloaden   -DryRun = alleen laten zien wat het zou kiezen.
# (Dit bestand bevat bewust geen accenten of bijzondere tekens: Windows PowerShell leest die verkeerd.)
param([switch]$DryRun, [switch]$Stabiel, [switch]$ZoekAlleen)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'Milo289/saga-techbox-door'
$arch = $env:PROCESSOR_ARCHITECTURE
$pattern = '*windows-setup.exe'   # werkt op x64 en op ARM (Windows draait het daar via emulatie)

Write-Host '--- Saga Techbox Deur installeren ---'
Write-Host "Ik zie: Windows-pc ($arch)"
Write-Host "Bestand: $pattern"
if ($DryRun) { exit 0 }

function Pause-Exit($msg) { Write-Host $msg; Read-Host 'Druk Enter om af te sluiten'; exit 1 }

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
Write-Host ''
Write-Host 'Zoeken naar de nieuwste versie ...'
try {
  $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases?per_page=30" -Headers @{ 'User-Agent' = 'saga-installeer' }
} catch {
  Start-Process "https://github.com/$repo/releases"
  Pause-Exit 'Geen verbinding met GitHub. Download het bestand dat eindigt op windows-setup.exe met de hand (de pagina is geopend).'
}
$asset = $null; $tag = ''
foreach ($r in $rels) {
  if ($r.draft) { continue }
  if ($Stabiel -and $r.prerelease) { continue }
  $a = $r.assets | Where-Object { $_.name -like $pattern } | Select-Object -First 1
  if ($a) { $asset = $a; $tag = $r.tag_name; break }
}
if (-not $asset) {
  Start-Process "https://github.com/$repo/releases"
  Pause-Exit 'Ik vond geen Windows-bestand. Kies het zelf op de pagina die is geopend (het bestand eindigt op windows-setup.exe).'
}

if ($ZoekAlleen) { Write-Host "Gevonden: $($asset.browser_download_url)"; exit 0 }
$dest = Join-Path $env:USERPROFILE 'Downloads'
$file = Join-Path $dest $asset.name
Write-Host "Versie $tag - downloaden naar $dest ..."
try { Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file -UseBasicParsing }
catch { Pause-Exit "Downloaden mislukte: $($_.Exception.Message)" }
if (-not (Test-Path $file)) { Pause-Exit 'Het gedownloade bestand is niet gevonden.' }
Write-Host "Klaar: $file"
Write-Host 'De installatie start nu. Staat er "Windows heeft uw pc beschermd"? Klik op Meer info en dan op Toch uitvoeren.'
Start-Process $file
Read-Host 'Druk Enter om dit venster te sluiten'
