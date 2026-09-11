# Download bilibili audio for a list of BVs (phase-1 proven template)
# Usage: powershell -File tools\bv_download.ps1 -Bvs BV1xxx,BV2yyy
param(
  [Parameter(Mandatory=$true)][string]$Bvs
)
$ErrorActionPreference = 'Continue'
$audioDir = 'E:\music player\素材库\对标视频-音频'
$log = 'E:\music player\_dl_t3.txt'
$ids = $Bvs.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
Start-Sleep -Seconds 90
foreach ($bv in $ids) {
  $u = 'https://www.bilibili.com/video/' + $bv
  $done = $false
  for ($i = 1; $i -le 2 -and -not $done; $i++) {
    Start-Sleep -Seconds (Get-Random -Minimum 30 -Maximum 51)
    ('TRY ' + $bv + ' a' + $i) | Out-File $log -Append -Encoding utf8
    if ($i -eq 1) {
      yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> $log 2>&1
    } else {
      ('FALLBACK cookies edge ' + $bv) | Out-File $log -Append -Encoding utf8
      yt-dlp --cookies-from-browser edge -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> $log 2>&1
    }
    if ($LASTEXITCODE -eq 0 -or (Test-Path (Join-Path $audioDir ($bv + '-*.m4a')))) { ('OK ' + $bv) | Out-File $log -Append -Encoding utf8; Write-Output ('OK ' + $bv); $done = $true }
    else { ('FAIL ' + $bv + ' a' + $i) | Out-File $log -Append -Encoding utf8; Write-Output ('FAIL ' + $bv + ' a' + $i) }
  }
}
Write-Output 'DOWNLOAD_DONE'
