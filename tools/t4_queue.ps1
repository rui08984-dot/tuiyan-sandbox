# t4 queue: 4 captain-assigned items -> download x3 -> ffprobe dur gate -> asr_pipeline
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_t4_queue.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }
$items = @(
  @{ bv='BV1aTCkYnEFi'; up='王生诡秘录';     dur=0 },
  @{ bv='BV1kUNY6jEB7'; up='爱讲故事的劳伦斯'; dur=29 },
  @{ bv='BV1gG4y137x1'; up='爱讲故事的劳伦斯'; dur=16 },
  @{ bv='BV1Gq4y1N7nC'; up='爱讲故事的劳伦斯'; dur=0 }
)
$audioDir = 'E:\music player\素材库\对标视频-音频'
L ('QUEUE_START initial_cool=45s')
Start-Sleep -Seconds 45
foreach ($pass in 1..3) {
  $remaining = @()
  foreach ($it in $items) {
    $bv = $it.bv
    $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $audio) {
      $u = 'https://www.bilibili.com/video/' + $bv
      for ($i = 1; $i -le 3; $i++) {
        Start-Sleep -Seconds (Get-Random -Minimum 30 -Maximum 51)
        L ('DL_TRY ' + $bv + ' a' + $i)
        yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 25 --retries 3 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_t4_dl_raw.log' 2>&1
        $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($audio) { L ('DL_OK ' + $bv); break } else { L ('DL_FAIL ' + $bv + ' a' + $i) }
      }
    }
    if (-not $audio) { L ('NO_AUDIO ' + $bv); $remaining += $it; continue }
    $durMin = $it.dur
    if ($durMin -eq 0) {
      $sec = (& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $audio.FullName) -as [double]
      $durMin = [int][Math]::Round($sec / 60)
      L ('FFPROBE ' + $bv + ' sec=' + [int]$sec + ' durMin=' + $durMin)
    }
    if ($durMin -lt 1) { $durMin = 1 }
    $txtPath = 'E:\music player\素材库\对标视频-转写\' + $it.up + '\' + $it.up + '_' + $bv + '_' + $durMin + 'min_文稿.txt'
    if (Test-Path $txtPath) { L ('SKIP_TXT_EXISTS ' + $bv); continue }
    L ('ASR_START ' + $bv + ' up=' + $it.up + ' dur=' + $durMin)
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up $it.up -DurMin $durMin 2>&1
    $out | ForEach-Object { L ('ASR_OUT ' + $bv + ' ' + $_) }
    if (Test-Path $txtPath) { L ('DONE ' + $bv) } else { L ('ASR_FAIL ' + $bv); $remaining += $it }
    Start-Sleep -Seconds (Get-Random -Minimum 20 -Maximum 40)
  }
  if ($remaining.Count -eq 0) { L 'QUEUE_ALL_DONE'; break }
  $items = $remaining
  L ('PASS_END pass=' + $pass + ' remaining=' + $remaining.Count + ' cool=300s')
  Start-Sleep -Seconds 300
}
L 'QUEUE_EXIT'
