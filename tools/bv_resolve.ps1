# Resolve bilibili BV metadata via yt-dlp (simulated, no download)
# Usage: pwsh -File tools\bv_resolve.ps1 -Out _resolve -Bvs BV1xxx,BV2yyy
param(
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][string]$Bvs
)
$ErrorActionPreference = 'Continue'
$dir = Join-Path 'E:\music player' $Out
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$ids = $Bvs.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
foreach ($bv in $ids) {
  $u = 'https://www.bilibili.com/video/' + $bv
  $f = Join-Path $dir ($bv + '.json')
  if ((Test-Path $f) -and (Get-Item $f).Length -gt 50) { Write-Output ('SKIP ' + $bv); continue }
  if (Test-Path $f) { Remove-Item $f -Force }
  $ok = $false
  for ($i = 1; $i -le 2 -and -not $ok; $i++) {
    if ($i -eq 2) {
      Start-Sleep -Seconds (Get-Random -Minimum 22 -Maximum 32)
      yt-dlp --cookies-from-browser edge --dump-single-json --no-warnings --socket-timeout 20 --retries 2 --sleep-requests 3 --no-playlist $u > $f 2> ($dir + '\' + $bv + '.err')
    } else {
      yt-dlp --dump-single-json --no-warnings --socket-timeout 20 --retries 2 --sleep-requests 3 --no-playlist $u > $f 2> ($dir + '\' + $bv + '.err')
    }
    if ($LASTEXITCODE -eq 0 -and (Test-Path $f) -and (Get-Item $f).Length -gt 50) { $ok = $true }
  }
  if ($ok) { Write-Output ('OK ' + $bv) }
  else { Write-Output ('FAIL ' + $bv + ' exit=' + $LASTEXITCODE) }
  Start-Sleep -Seconds (Get-Random -Minimum 3 -Maximum 6)
}
Write-Output 'RESOLVE_DONE'
