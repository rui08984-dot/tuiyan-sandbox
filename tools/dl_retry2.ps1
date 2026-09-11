# Second-pass downloader: auto-targets missing BVs, skips busy ones, cookie fallback
$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'
$all = @('BV1eMUmYXEv5','BV1Jz421a7QZ','BV1UC411J7Pv','BV15tsTeNEZ8','BV19v4HekEdh','BV1MJ411d7Qq','BV1ZhEv6CEhB','BV1PYQ3YrEu5','BV1dmMe62E9X','BV143un6ZEjs','BV1hvcYzaEwp')
$audioDir = 'E:\music player\素材库\对标视频-音频'
$workDir  = 'E:\music player\tools\asr_work'
$log = 'E:\music player\_dl_retry2.txt'
$busy = (Get-ChildItem $workDir -Filter '*.m4a' -ErrorAction SilentlyContinue).Name -replace '\.m4a$',''
$missing = $all | Where-Object { -not (Test-Path (Join-Path $audioDir ($_ + '-*.m4a'))) -and ($busy -notcontains $_) }
('PASS2 missing: ' + ($missing -join ',')) | Out-File $log -Append -Encoding utf8
foreach ($bv in $missing) {
  $u = 'https://www.bilibili.com/video/' + $bv
  $done = $false
  for ($i = 1; $i -le 2 -and -not $done; $i++) {
    Start-Sleep -Seconds (Get-Random -Minimum 20 -Maximum 41)
    ('TRY ' + $bv + ' a' + $i) | Out-File $log -Append -Encoding utf8
    if ($i -eq 1) {
      yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 3 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> $log 2>&1
    } else {
      ('FALLBACK cookies edge ' + $bv) | Out-File $log -Append -Encoding utf8
      yt-dlp --cookies-from-browser edge -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 3 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> $log 2>&1
    }
    if ($LASTEXITCODE -eq 0 -or (Test-Path (Join-Path $audioDir ($bv + '-*.m4a')))) { ('OK ' + $bv) | Out-File $log -Append -Encoding utf8; $done = $true }
    else { ('FAIL ' + $bv + ' a' + $i) | Out-File $log -Append -Encoding utf8 }
  }
}
'PASS2_DONE' | Out-File $log -Append -Encoding utf8
