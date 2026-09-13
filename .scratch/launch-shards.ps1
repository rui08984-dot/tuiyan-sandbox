$ErrorActionPreference = 'Continue'
$base = 'E:\music player'
$logdir = "$base\.scratch\forecast-debate\prereg-a"
$scriptPath = "$base\p1b\scripts\prereg-a-run.cjs"
for($s = 0; $s -lt 4; $s++){
  $state = "$logdir\run-state-full1-s$s.json"
  $out = "$logdir\s$s.out.log"
  $err = "$logdir\s$s.err.log"
  $argStr = "`"$scriptPath`" --limit=120 --tag=full1-s$s --run-prefix=preregA-full1- --max-calls=650 --max-cost=7 --shard=$s --shards=4 --state=`"$state`""
  $p = Start-Process -FilePath 'node' -ArgumentList $argStr -WorkingDirectory $base -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Write-Output ("shard$s PID=" + $p.Id)
}
Start-Sleep -Seconds 8
Write-Output '=== 8 秒后存活 ==='
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'shard=' } | ForEach-Object { Write-Output ("  PID=" + $_.ProcessId + " start=" + $_.CreationDate.ToString('HH:mm:ss')) }
Write-Output '=== err 检查 ==='
for($s = 0; $s -lt 4; $s++){
  $err = "$logdir\s$s.err.log"
  if((Test-Path $err) -and ((Get-Item $err).Length -gt 0)){ Write-Output ("  s$s ERR-NONEMPTY: " + ((Get-Content -LiteralPath $err -Encoding UTF8 | Select-Object -First 2) -join ' | ')) } else { Write-Output ("  s$s err-empty") }
}
