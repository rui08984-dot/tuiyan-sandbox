# Retry downloads for missing bilibili audios, 3 attempts each, spaced to dodge 412
$ErrorActionPreference = 'Continue'
$env:PYTHONUTF8 = '1'
$bvs = @('BV1eMUmYXEv5','BV1Jz421a7QZ','BV1UC411J7Pv','BV15tsTeNEZ8','BV19v4HekEdh','BV1MJ411d7Qq','BV1ZhEv6CEhB','BV1PYQ3YrEu5')
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
$log = 'E:\music player\_dl_retry.txt'
foreach ($bv in $bvs) {
  $u = 'https://www.bilibili.com/video/' + $bv
  $ok = $false
  for ($i = 1; $i -le 3 -and -not $ok; $i++) {
    Start-Sleep -Seconds (Get-Random -Minimum 15 -Maximum 31)
    ('TRY ' + $bv + ' attempt ' + $i) | Out-File $log -Append -Encoding utf8
    cmd /c ('yt-dlp -f "ba/b" -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 3 --add-headers "User-Agent: ' + $ua + '" -o "E:\music player\素材库\对标视频-音频\%(id)s-%(title).50s.%(ext)s" ' + $u + ' >> ' + $log + ' 2>&1')
    if ($LASTEXITCODE -eq 0) { ('OK ' + $bv) | Out-File $log -Append -Encoding utf8; $ok = $true }
    else { ('FAIL ' + $bv + ' attempt ' + $i + ' code ' + $LASTEXITCODE) | Out-File $log -Append -Encoding utf8 }
  }
  Start-Sleep -Seconds 5
}
'RETRY_ROUND_DONE' | Out-File $log -Append -Encoding utf8
