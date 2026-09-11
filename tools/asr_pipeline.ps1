# ASR pipeline for one bilibili video: rename -> segment -> transcribe -> move -> verify
# Usage: pwsh -File tools\asr_pipeline.ps1 -Bv BV1xxx -Up <UP folder> -DurMin <minutes>
param(
  [Parameter(Mandatory=$true)][string]$Bv,
  [Parameter(Mandatory=$true)][string]$Up,
  [Parameter(Mandatory=$true)][int]$DurMin
)
$ErrorActionPreference = 'Continue'
$root     = 'E:\music player'
$audioDir = Join-Path $root '素材库\对标视频-音频'
$work     = Join-Path $root 'tools\asr_work'
$samples  = Join-Path $root 'skills\horror-teller\samples'
$transDir = Join-Path $root ('素材库\对标视频-转写\' + $Up)
$paiCha   = Join-Path $root '素材库\已用素材归档\待查'
$py       = 'D:\ailove\my-neuro\my-neuro\env\python.exe'
$transPy  = Join-Path $root 'tools\transcribe_v2.py'

# 1. locate downloaded m4a
$m4a = Get-ChildItem $audioDir -Filter ($Bv + '-*.m4a') -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $m4a) { Write-Output ('NO_AUDIO ' + $Bv); exit 2 }
$workM4a = Join-Path $work ($Bv + '.m4a')
Move-Item $m4a.FullName $workM4a -Force

# 2. clean old segs, then segment to 10-min 16k mono wavs (zero-padded for correct string sort)
Get-ChildItem $work -Filter (${Bv} + '_seg_*.wav') -ErrorAction SilentlyContinue | Remove-Item -Force
& ffmpeg -hide_banner -loglevel error -y -i $workM4a -f segment -segment_time 600 -ar 16000 -ac 1 -vn (Join-Path $work (${Bv} + '_seg_%02d.wav'))
if ($LASTEXITCODE -ne 0) {
  Write-Output ('FFMPEG_FAIL ' + $Bv)
  if (Test-Path $workM4a) { Move-Item $workM4a (Join-Path $paiCha ($Bv + '.m4a')) -Force; Write-Output ('MOVED_TO_PAICHA ' + $Bv) }
  exit 3
}
$segs = Get-ChildItem $work -Filter (${Bv} + '_seg_*.wav')
$segCount = $segs.Count
Write-Output ('SEGMENTS ' + $Bv + ' ' + $segCount)

# 3. transcribe (serial, FunASR CPU, deletes m4a on success via del_files)
$fname  = ($Up + '_' + $Bv + '_' + $DurMin + 'min_文稿.txt')
$outTxt = Join-Path $samples $fname
if (Test-Path $outTxt) { Remove-Item $outTxt -Force }
$t0 = Get-Date
& $py $transPy job $Bv $fname 0 $workM4a
$pyExit = $LASTEXITCODE
$elapsed = [int]((Get-Date) - $t0).TotalSeconds

# 4. verify + archive
if ($pyExit -eq 0 -and (Test-Path $outTxt) -and (Get-Item $outTxt).Length -gt 100) {
  Move-Item $outTxt (Join-Path $transDir $fname) -Force
  $chars = (Get-Content (Join-Path $transDir $fname) -Raw -Encoding UTF8).Length
  $m4aGone = -not (Test-Path $workM4a)
  $segsLeft = (Get-ChildItem $work -Filter (${Bv} + '_seg_*.wav')).Count
  Write-Output ('OK ' + $Bv + ' segs=' + $segCount + ' secs=' + $elapsed + ' chars=' + $chars + ' m4a_deleted=' + $m4aGone + ' segs_left=' + $segsLeft)
  exit 0
} else {
  if (Test-Path $workM4a) { Move-Item $workM4a (Join-Path $paiCha ($Bv + '.m4a')) -Force }
  Get-ChildItem $work -Filter (${Bv} + '_seg_*.wav') -ErrorAction SilentlyContinue | Remove-Item -Force
  Write-Output ('FAIL ' + $Bv + ' pyexit=' + $pyExit + ' elapsed=' + $elapsed + ' moved_to_paicha=true')
  exit 4
}
