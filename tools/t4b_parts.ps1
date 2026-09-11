# t4b: transcribe 3 downloaded parts of BV1Gq4y1N7nC (multi-page video, files named BV..._pN-title.m4a)
$ErrorActionPreference = 'Continue'
$log = 'E:\music player\_t4b.log'
function L($m) { ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $m) | Out-File $log -Append -Encoding utf8 }
$bv = 'BV1Gq4y1N7nC'
$up = '爱讲故事的劳伦斯'
$audioDir = 'E:\music player\素材库\对标视频-音频'
$transDir = 'E:\music player\素材库\对标视频-转写\' + $up
foreach ($pn in 1..3) {
  $src = Get-ChildItem $audioDir -Filter ($bv + '_p' + $pn + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $src) { L ('PART' + $pn + ' NO_SOURCE'); continue }
  $sec = (& ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $src.FullName) -as [double]
  $durMin = [Math]::Max(1, [int][Math]::Round($sec / 60))
  L ('PART' + $pn + ' src=' + $src.Name + ' sec=' + [int]$sec + ' durMin=' + $durMin)
  # rename to BV-prefix pattern so asr_pipeline can find it; other parts stay unmatched (_p2/_p3)
  $workName = Join-Path $audioDir ($bv + '-part' + $pn + '.m4a')
  Move-Item $src.FullName $workName -Force
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\music player\tools\asr_pipeline.ps1' -Bv $bv -Up $up -DurMin $durMin 2>&1
  $out | ForEach-Object { L ('ASR_OUT p' + $pn + ' ' + $_) }
  $plain = Join-Path $transDir ($up + '_' + $bv + '_' + $durMin + 'min_文稿.txt')
  $parted = Join-Path $transDir ($up + '_' + $bv + '_p' + $pn + '_' + $durMin + 'min_文稿.txt')
  if (Test-Path $plain) { Move-Item $plain $parted -Force; L ('PART' + $pn + ' TXT_OK ' + (Get-Item $parted).Length + 'B') }
  else { L ('PART' + $pn + ' TXT_MISSING') }
  Start-Sleep -Seconds 5
}
L 'T4B_EXIT'
