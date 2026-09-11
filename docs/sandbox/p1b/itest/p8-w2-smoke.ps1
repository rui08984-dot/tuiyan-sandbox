# p8-w2-smoke.ps1 -- W2 前端冒烟闭环：起服(8788 独立端口) -> 探测 -> 杀（同 turn 闭环）。
# 铁律：不碰 8787（队长预览服务）；Stop-Job 收口；探测输出全部落 this stdout。
$ErrorActionPreference = 'Continue'
$job = Start-Job -ScriptBlock {
  Set-Location 'E:\music player\p1b'
  $env:PORT = '8788'
  $env:P1B_LLM_MOCK = '1'
  $env:P1B_DB_PATH = 'E:\music player\docs\sandbox\p1b\itest\p8-w2-smoke.db'
  node src/server.js *> 'E:\music player\docs\sandbox\p1b\itest\p8-w2-smoke-server.txt'
}
$ok = $false
$h = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8788/api/health' -TimeoutSec 2
    if ($h.ok -eq $true) { $ok = $true; break }
  } catch { }
}
try {
  if (-not $ok) { Write-Output 'SMOKE: health TIMEOUT'; exit 1 }
  Write-Output ('HEALTH ok=' + $h.ok + ' db=' + $h.db_path + ' mock=' + $h.llm_mock)
  $html = (Invoke-WebRequest -Uri 'http://127.0.0.1:8788/' -TimeoutSec 5).Content
  Write-Output ('INDEX has-new-js=' + ($html -match 'index-Bj1KFkPJ\.js') + ' has-new-css=' + ($html -match 'index-CsoskYLU\.css'))
  $body = '{"name":"p8-w2-smoke","type":"werewolf","player_count":7}'
  $g = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8788/api/games' -ContentType 'application/json' -Body $body
  Write-Output ('GAME id=' + $g.game.id)
  $o = Invoke-RestMethod -Uri ('http://127.0.0.1:8788/api/games/' + $g.game.id + '/oracle') -TimeoutSec 5
  Write-Output ('ORACLE mode=' + $o.mode + ' disclaimer=' + $o.disclaimer + ' ben=' + $o.casting.benGua.fullName + ' dong=' + $o.casting.dongYao)
  $v = $o.verdict
  if ($v.Length -gt 60) { $v = $v.Substring(0, 60) }
  Write-Output ('VERDICT sample=' + $v)
} finally {
  Stop-Job $job -ErrorAction SilentlyContinue
  Remove-Job $job -Force -ErrorAction SilentlyContinue
  Write-Output 'SMOKE: server stopped, job removed'
}
