# p8-w3-live.ps1 -- W3 真实 LLM 判词抽验（1 次）：8790 独立端口 + 真实模式（不设 P1B_LLM_MOCK）
# + 独立 db p8-w3-live.db + 默认 providers（p1a-terminal/config/providers.json，key 不出服务端）。
# 预期：mode=live（LLM 断语）；provider 不可达/失败 → mode=mock_fallback + llm_error（三态设计的验证点）。两者都如实记录。
$ErrorActionPreference = 'Continue'
$job = Start-Job -ScriptBlock {
  Set-Location 'E:\music player\p1b'
  $env:PORT = '8790'
  Remove-Item Env:\P1B_LLM_MOCK -ErrorAction SilentlyContinue
  $env:P1B_DB_PATH = 'E:\music player\docs\sandbox\p1b\itest\p8-w3-live.db'
  node src/server.js *> 'E:\music player\docs\sandbox\p1b\itest\p8-w3-live-server.txt'
}
$healthOk = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 2
    if ($h.ok -eq $true) { $healthOk = $true; break }
  } catch { }
}
Write-Output ("HEALTH_OK=" + $healthOk + " llm_mock=" + $h.llm_mock)
if ($healthOk) {
  $body = '{"name":"p8-live-probe","type":"werewolf","player_count":6}'
  $g = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8790/api/games' -ContentType 'application/json' -Body $body -TimeoutSec 10
  Write-Output ('GAME id=' + $g.game.id)
  try {
    $o = Invoke-RestMethod -Uri ('http://127.0.0.1:8790/api/games/' + $g.game.id + '/oracle') -TimeoutSec 75
    $v = $o.verdict
    if ($v.Length -gt 150) { $v = $v.Substring(0, 150) }
    Write-Output ('ORACLE mode=' + $o.mode + ' disclaimer=' + $o.disclaimer + ' ben=' + $o.casting.benGua.fullName)
    Write-Output ('VERDICT: ' + $v)
    if ($o.llm_error) { Write-Output ('LLM_ERROR: ' + $o.llm_error) }
  } catch {
    Write-Output ('ORACLE_REQ_ERR=' + $_.Exception.Message)
  }
} else {
  Write-Output 'SKIP (health not ready)'
}
Stop-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -Force -ErrorAction SilentlyContinue
Write-Output 'SERVER_STOPPED'
Start-Sleep -Milliseconds 800
$p = netstat -ano | Select-String ':8790.*LISTENING'
if ($p) { Write-Output 'PORT 8790 STILL LISTENING'; $p } else { Write-Output 'PORT 8790: FREE' }
Write-Output 'LIVE-PROBE DONE'
