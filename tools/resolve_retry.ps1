# t3p resolve retry: plain yt-dlp (Edge locked), wide spacing, 2 rounds
param([string]$Bvs, [string]$Out = '_resolve3')
$ErrorActionPreference = 'Continue'
$dir = 'E:\music player\' + $Out
$ids = $Bvs.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
foreach ($round in 1..2) {
  $remaining = @()
  foreach ($bv in $ids) {
    $f = Join-Path $dir ($bv + '.json')
    if ((Test-Path $f) -and (Get-Item $f).Length -gt 50) { Write-Output ('SKIP ' + $bv); continue }
    $u = 'https://www.bilibili.com/video/' + $bv
    Start-Sleep -Seconds (Get-Random -Minimum 8 -Maximum 16)
    yt-dlp --dump-single-json --no-warnings --socket-timeout 25 --retries 3 --sleep-requests 4 --no-playlist $u > $f 2> (Join-Path $dir ($bv + '.err2'))
    if ($LASTEXITCODE -eq 0 -and (Test-Path $f) -and (Get-Item $f).Length -gt 50) { Write-Output ('OK ' + $bv) }
    else { Remove-Item $f -Force -ErrorAction SilentlyContinue; Write-Output ('FAIL ' + $bv + ' exit=' + $LASTEXITCODE); $remaining += $bv }
  }
  if ($remaining.Count -eq 0) { Write-Output 'RETRY_ALL_DONE'; break }
  $ids = $remaining
  if ($round -eq 1) { Write-Output 'ROUND1_END cool=60s'; Start-Sleep -Seconds 60 }
}
Write-Output 'RETRY_EXIT'
