# t6 queue: Dengken 4 episodes -> download -> asr_pipeline
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_t6_queue.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }
$items = @(
  @{ bv='BV1KM4y1N7mM'; dur=12 },
  @{ bv='BV1mP4y157rK'; dur=13 },
  @{ bv='BV1ga411V7Hj'; dur=18 },
  @{ bv='BV12B4y1g759'; dur=27 }
)
$up = '邓肯'
$audioDir = 'E:\music player\素材库\对标视频-音频'
L ('QUEUE_START initial_cool=120s')
Start-Sleep -Seconds 120
foreach ($pass in 1..3) {
  $remaining = @()
  foreach ($it in $items) {
    $bv = $it.bv
    $txtPath = 'E:\music player\素材库\对标视频-转写\' + $up + '\' + $up + '_' + $bv + '_' + $it.dur + 'min_文稿.txt'
    if (Test-Path $txtPath) { L ('SKIP_TXT_EXISTS ' + $bv); continue }
    $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $audio) {
      $u = 'https://www.bilibili.com/video/' + $bv
      for ($i = 1; $i -le 2; $i++) {
        Start-Sleep -Seconds (Get-Random -Minimum 30 -Maximum 51)
        L ('DL_TRY ' + $bv + ' a' + $i)
        if ($i -eq 1) {
          yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_t6_dl_raw.log' 2>&1
        } else {
          yt-dlp --cookies-from-browser edge -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_t6_dl_raw.log' 2>&1
        }
        $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($audio) { L ('DL_OK ' + $bv); break } else { L ('DL_FAIL ' + $bv + ' a' + $i) }
      }
    }
    if ($audio) {
      L ('ASR_START ' + $bv)
      $out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up $up -DurMin $it.dur 2>&1
      $out | ForEach-Object { L ('ASR_OUT ' + $bv + ' ' + $_) }
      if (Test-Path $txtPath) { L ('DONE ' + $bv) } else { L ('ASR_FAIL ' + $bv); $remaining += $it }
    } else {
      L ('NO_AUDIO ' + $bv)
      $remaining += $it
    }
    Start-Sleep -Seconds (Get-Random -Minimum 20 -Maximum 40)
  }
  if ($remaining.Count -eq 0) { L 'QUEUE_ALL_DONE'; break }
  $items = $remaining
  L ('PASS_END pass=' + $pass + ' remaining=' + $remaining.Count + ' cool=300s')
  Start-Sleep -Seconds 300
}
L 'QUEUE_EXIT'
