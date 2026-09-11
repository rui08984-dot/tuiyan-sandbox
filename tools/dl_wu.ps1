# re-download BV11e411d7yV with duration gate (format fallback ba -> 80 -> 112)
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_wu_redo.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }
$bv = 'BV11e411d7yV'
$audioDir = 'E:\music player\素材库\对标视频-音频'
$txtPath = 'E:\music player\素材库\对标视频-转写\王生诡秘录\王生诡秘录_BV11e411d7yV_37min_文稿.txt'
if (Test-Path $txtPath) { Remove-Item $txtPath -Force; L 'PARTIAL_TXT_DELETED' }
$u = 'https://www.bilibili.com/video/' + $bv
$formats = @('ba/b', '80/ba/b', '112/ba/b')
$ok = $false
foreach ($f in $formats) {
  Start-Sleep -Seconds (Get-Random -Minimum 25 -Maximum 40)
  L ('DL_TRY fmt=' + $f)
  yt-dlp -f $f -x --audio-format m4a --windows-filenames --socket-timeout 25 --retries 3 --sleep-requests 4 -o ($audioDir + '\%(id)s-%(title).50s.%(ext)s') $u >> 'E:\music player\_wu_redo_dl.log' 2>&1
  $audio = Get-ChildItem $audioDir -Filter ($bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $audio) { L 'DL_FAIL no_file'; continue }
  $dur = (& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $audio.FullName) -as [double]
  L ('DL_OK fmt=' + $f + ' dur_sec=' + [int]$dur)
  if ($dur -ge 1800) { $ok = $true; break }
  Remove-Item $audio.FullName -Force; L ('BAD_AUDIO dur=' + [int]$dur + ' removed, next format')
}
if (-not $ok) { L 'ALL_FORMATS_FAILED'; exit 3 }
L 'ASR_START'
$out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up '王生诡秘录' -DurMin 37 2>&1
$out | ForEach-Object { L ('ASR_OUT ' + $_) }
if (Test-Path $txtPath) { L 'REDO_DONE' } else { L 'REDO_FAIL' }
