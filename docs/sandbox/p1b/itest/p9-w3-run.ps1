$ErrorActionPreference = 'Stop'
$p1b = 'E:\music player\p1b'
$itest = 'E:\music player\docs\sandbox\p1b\itest'
$port = 8791
$base = "http://127.0.0.1:$port"
$dbPath = Join-Path $itest 'p9-run.db'
$outFile = Join-Path $itest 'p9-w3-e2e-out.txt'
$script:out = @()
function Log($m) { $line = ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m); $script:out += $line; Write-Output $line }

Log "STEP0 pre-clean orphans + fresh db + port check"
# kill orphan server from a previous timed-out run (only if cmdline matches node+server.js+8791 run)
$old = netstat -ano | Select-String ":$port\s.*LISTENING"
if ($old) {
  $opid = [int](($old -split '\s+')[-1])
  $oci = Get-CimInstance Win32_Process -Filter "ProcessId=$opid"
  Log "port busy pid=$opid cmdline=$($oci.CommandLine)"
  if ($oci.CommandLine -match 'node' -and $oci.CommandLine -match 'server\.js') { Stop-Process -Id $opid -Force; Log "killed orphan $opid"; Start-Sleep -Milliseconds 800 }
  else { Log "ABORT: port $port held by non-matching process"; $script:out | Out-File -Encoding utf8 $outFile; exit 2 }
}
if (Test-Path $dbPath) { Remove-Item $dbPath -Force; Log "removed stale p9-run.db" }
if (netstat -ano | Select-String ":$port\s.*LISTENING") { Log "ABORT: port still busy"; $script:out | Out-File -Encoding utf8 $outFile; exit 2 }
Log "port $port free, fresh db"

Log "STEP1 start server PORT=$port P1B_DB_PATH=p9-run.db P1B_LLM_MOCK=1"
$env:PORT = "$port"
$env:P1B_DB_PATH = $dbPath
$env:P1B_LLM_MOCK = '1'
$so = Join-Path $itest 'p9-w3-server-out.txt'
$se = Join-Path $itest 'p9-w3-server-err.txt'
$proc = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $p1b -PassThru -WindowStyle Hidden -RedirectStandardOutput $so -RedirectStandardError $se
Log "server pid=$($proc.Id)"

try {
  Log "STEP2 wait ready (max 30s)"
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try { $null = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 3; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw 'server not ready in 30s' }
  Log "server ready (waited $($i+1) x 0.5s)"

  Log "STEP3 POST cast x3 (numbers/time/random)"
  $r1 = Invoke-RestMethod -Method Post -Uri "$base/api/oracle/cast" -ContentType 'application/json' -Body '{"method":"numbers","params":{"n1":3,"n2":7}}'
  Log "cast numbers id=$($r1.id) a/b=$($r1.casting.numbers.a)/$($r1.casting.numbers.b) ben=$($r1.casting.benGua.fullName) dong=$($r1.casting.dongYao) tiyong=$($r1.casting.ti.trigram)/$($r1.casting.ti.wuXing)-$($r1.casting.yong.trigram)/$($r1.casting.yong.wuXing) verdict=$($r1.verdict) disclaimer=$($r1.disclaimer)"
  $r2 = Invoke-RestMethod -Method Post -Uri "$base/api/oracle/cast" -ContentType 'application/json' -Body '{"method":"time","params":{}}'
  Log "cast time id=$($r2.id) ben=$($r2.casting.benGua.fullName) derived_from=$($r2.casting.derived_from | ConvertTo-Json -Compress)"
  $r3 = Invoke-RestMethod -Method Post -Uri "$base/api/oracle/cast" -ContentType 'application/json' -Body '{"method":"random","params":{}}'
  Log "cast random id=$($r3.id) a/b=$($r3.casting.numbers.a)/$($r3.casting.numbers.b) ben=$($r3.casting.benGua.fullName)"

  Log "STEP4 GET readings back"
  $list = Invoke-RestMethod -Uri "$base/api/oracle/readings?limit=20&offset=0"
  Log "readings total=$($list.total) top3ids=$($list.items[0..2].id -join ',') top3methods=$($list.items[0..2].method -join ',')"
  $orderOk = ($list.total -eq 3) -and ($list.items[0].id -eq $r3.id) -and ($list.items[1].id -eq $r2.id) -and ($list.items[2].id -eq $r1.id)
  Log "order new-to-old check: $orderOk"
  $edge1 = Invoke-RestMethod -Uri "$base/api/oracle/readings?limit=1&offset=0"
  Log "pagination probe limit=1: total=$($edge1.total) items=$($edge1.items.Count)"

  Log "STEP5 verdict regression witness (create game + GET oracle)"
  $g = Invoke-RestMethod -Method Post -Uri "$base/api/games" -ContentType 'application/json' -Body '{"name":"P9-W3-witness","type":"werewolf","player_count":6}'
  $gid = $g.game.id
  Log "game created id=$gid"
  $o = Invoke-RestMethod -Uri "$base/api/games/$gid/oracle"
  Log "game oracle mode=$($o.mode) disclaimer=$($o.disclaimer) ben=$($o.casting.benGua.fullName) verdict_len=$($o.verdict.Length)"

  Log "STEP6 screenshots via headless Edge (3 routes)"
  $edge = @((Get-Command msedge -ErrorAction SilentlyContinue).Source, 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if (-not $edge) { Log "EDGE NOT FOUND - screenshots skipped" }
  else {
    Log "edge=$edge"
    $shots = @(
      @{ u = "$base/#/mystic"; f = 'p9-w3-mystic-page.png' },
      @{ u = "$base/#/";       f = 'p9-w3-live-page.png' },
      @{ u = "$base/#/manage"; f = 'p9-w3-manage-page.png' }
    )
    foreach ($s in $shots) {
      $p = Join-Path $itest $s.f
      $prof = Join-Path $env:TEMP ("p9-edge-prof-" + [System.IO.Path]::GetFileNameWithoutExtension($s.f))
      $args = @('--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',"--user-data-dir=$prof",'--virtual-time-budget=8000','--window-size=720,1600',"--screenshot=$p", $s.u)
      $null = Start-Process -FilePath $edge -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
      if (Test-Path $p) { Log "shot ok $($s.f) $((Get-Item $p).Length) bytes" } else { Log "shot FAIL $($s.f)" }
    }
  }
} finally {
  Log "STEP7 verify cmdline then kill"
  if ($proc -and -not $proc.HasExited) {
    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.Id)"
    Log "cmdline check: $($ci.CommandLine)"
    if ($ci.CommandLine -match 'node' -and $ci.CommandLine -match 'server\.js') {
      Stop-Process -Id $proc.Id -Force
      Log "killed pid=$($proc.Id)"
    } else { Log "CMDLINE MISMATCH - NOT KILLED, needs manual check" }
  } else { Log "process already exited" }
  Start-Sleep -Milliseconds 500
  if (netstat -ano | Select-String ":$port\s.*LISTENING") { Log "WARN: port $port still listening after kill" } else { Log "port $port released" }
}
Log "DONE"
$script:out | Out-File -Encoding utf8 $outFile
