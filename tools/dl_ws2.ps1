# substitute item: BV1jM4m117QH for Wang Sheng (Wu video is CDN-truncated server-side)
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_ws2.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }
$bv = 'BV1jM4m117QH'
$audioDir = 'E:\music player\素材库\对标视频-音频'
$txtPath = 'E:\music player\素材库\对标视频-转写\王生诡秘录\王生诡秘录_BV1jM4m117QH_24min_文稿.txt'
$u = 'https://www.bilibili.com/video/' + $bv
$done = $false
for ($i = 1; $i -le 3 -and -not $done; $i++) {
  Start-Sleep -Seconds (Get-Random -Minimum 25 -Maximum 41)
  L ('DL_TRY a' + $i)
  if ($i -le 2) {
    yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 25 --retries 3 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_ws2_dl.log' 2>&1
  } else {
    yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 25 --retries 3 --sleep-requests 4 --downloader-args 'ffmpeg:-loop 0' -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_ws2_dl.log' 2>&1
  }
  $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($audio) { L ('DL_OK dur_probe_start'); $done = $true } else { L ('DL_FAIL a' + $i) }
}
if (-not $done) { L 'ALL_DL_FAILED'; exit 3 }
L 'ASR_START'
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up '王生诡秘录' -DurMin 24 2>&1
$out | ForEach-Object { L ('ASR_OUT ' + $_) }
if (Test-Path $txtPath) { L 'SUB_DONE' } else { L 'SUB_FAIL' }
