# t3p queue: 11 items -> download (plain x2 + edge fallback) -> asr_pipeline per BV
# Logs to _t3p_queue.log; idempotent per BV (skip if txt exists / audio exists)
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_t3p_queue.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }

$lily = 'E:\music player\素材库\对标视频-转写\狸狸垣上跑'
if (-not (Test-Path $lily)) { New-Item -ItemType Directory -Path $lily | Out-Null }

$items = @(
  @{ bv='BV1N14y1K7De'; up='阿茶诡话';       dur=65 },
  @{ bv='BV1RY41127Dj'; up='阿茶诡话';       dur=44 },
  @{ bv='BV1ye4y1p7sv'; up='阿茶诡话';       dur=35 },
  @{ bv='BV11e411d7yV'; up='王生诡秘录';     dur=37 },
  @{ bv='BV1iNhHz7EDo'; up='王生诡秘录';     dur=23 },
  @{ bv='BV1BX4y1C7ZZ'; up='王生诡秘录';     dur=31 },
  @{ bv='BV1NL4y1g7SD'; up='爱讲故事的劳伦斯'; dur=78 },
  @{ bv='BV1WD4y1g7sY'; up='爱讲故事的劳伦斯'; dur=62 },
  @{ bv='BV1ka4y1m7vf'; up='爱讲故事的劳伦斯'; dur=39 },
  @{ bv='BV1jXSdYUExx'; up='狸狸垣上跑';     dur=23 },
  @{ bv='BV15yEU6GEsx'; up='狸狸垣上跑';     dur=25 }
)
$audioDir = 'E:\music player\素材库\对标视频-音频'
L ('QUEUE_START initial_cool=90s')
Start-Sleep -Seconds 90
foreach ($pass in 1..3) {
  $remaining = @()
  foreach ($it in $items) {
    $bv = $it.bv
    $txtPath = 'E:\music player\素材库\对标视频-转写\' + $it.up + '\' + $it.up + '_' + $bv + '_' + $it.dur + 'min_文稿.txt'
    if (Test-Path $txtPath) { L ('SKIP_TXT_EXISTS ' + $bv); continue }
    $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $audio) {
      $u = 'https://www.bilibili.com/video/' + $bv
      for ($i = 1; $i -le 3; $i++) {
        Start-Sleep -Seconds (Get-Random -Minimum 30 -Maximum 51)
        L ('DL_TRY ' + $bv + ' a' + $i)
        if ($i -le 2) {
          yt-dlp -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_t3p_dl_raw.log' 2>&1
        } else {
          yt-dlp --cookies-from-browser edge -f 'ba/b' -x --audio-format m4a --windows-filenames --socket-timeout 20 --retries 2 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_t3p_dl_raw.log' 2>&1
        }
        $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($audio) { L ('DL_OK ' + $bv); break } else { L ('DL_FAIL ' + $bv + ' a' + $i) }
      }
    }
    if ($audio) {
      L ('ASR_START ' + $bv + ' up=' + $it.up + ' dur=' + $it.dur)
      $out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up $it.up -DurMin $it.dur 2>&1
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
