# p8-w3-run.ps1 v2 -- W3 闭环（chrome 归 drive 自己 spawn）：起服(8789) -> node p8-drive.mjs -> 停服收口。
$ErrorActionPreference = 'Continue'
$itest = 'E:\music player\docs\sandbox\p1b\itest'
$job = Start-Job -ScriptBlock {
  Set-Location 'E:\music player\p1b'
  $env:PORT = '8789'
  $env:P1B_LLM_MOCK = '1'
  $env:P1B_DB_PATH = 'E:\music player\docs\sandbox\p1b\itest\p8-w3.db'
  node src/server.js *> 'E:\music player\docs\sandbox\p1b\itest\p8-w3-server.txt'
}
$healthOk = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8789/api/health' -TimeoutSec 2
    if ($h.ok -eq $true) { $healthOk = $true; break }
  } catch { }
}
Write-Output ("HEALTH_OK=" + $healthOk + " mock=" + $h.llm_mock + " db=" + $h.db_path)
if ($healthOk) {
  Set-Location $itest
  node p8-drive.mjs $itest 2>&1 | Tee-Object -FilePath "$itest\p8-w3-drive-log.txt"
  Write-Output ("DRIVE_EXIT=" + $LASTEXITCODE)
} else {
  Write-Output 'SKIP drive (health not ready)'
}
Stop-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -Force -ErrorAction SilentlyContinue
Write-Output 'SERVER_STOPPED'
Start-Sleep -Milliseconds 800
# 收口兜底：扫杀残留的 p8-chrome-prof2 chrome（杀前验命令行标记）
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*p8-chrome-prof2*' -or $_.CommandLine -like '*remote-debugging-port=9224*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output ('CHROME_LEFTOVER_KILLED=' + $_.ProcessId) }
$p9 = netstat -ano | Select-String ':8789.*LISTENING'
$p24 = netstat -ano | Select-String ':9224.*LISTENING'
if ($p9) { Write-Output 'PORT 8789 STILL LISTENING'; $p9 } else { Write-Output 'PORT 8789: FREE' }
if ($p24) { Write-Output 'PORT 9224 STILL LISTENING'; $p24 } else { Write-Output 'PORT 9224: FREE' }
Write-Output 'W3-RUN DONE'
