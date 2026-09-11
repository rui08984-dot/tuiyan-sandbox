# P1b-3 录入页联调脚本（后端 :8787 MOCK 模式）—— 真跑全链，响应摘录落 itest-log.md
# 宏卡构造 = 前端 confirm-flow.buildMacroCard 逐字同构（不走 LLM），经 /events/confirm 后端校验入库
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8787/api'
$log  = 'E:\music player\docs\sandbox\p1b\itest\itest-log.md'
Set-Content -Path $log -Value "# P1b-3 录入页集成实测 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  (backend :8787, P1B_LLM_MOCK=1)" -Encoding utf8

function Log($s) { Add-Content -Path $log -Value $s -Encoding utf8 }
function Show($name, $obj) {
  $j = $obj | ConvertTo-Json -Depth 10 -Compress
  if ($j.Length -gt 1600) { $j = $j.Substring(0, 1600) + '...(截断)' }
  Log ""
  Log "== $name =="
  Log $j
  Write-Output "OK  $name"
}
function Fail($name, $e) {
  $code = ''
  try { $code = [int]$e.Exception.Response.StatusCode } catch {}
  Log ""
  Log "== $name ==  HTTP $code"
  Log ("ERROR: " + $e.Exception.Message)
  Write-Output "ERR $name HTTP $code"
  return $code
}
function Post($path, $obj) { Invoke-RestMethod -Uri ($base + $path) -Method Post -ContentType 'application/json; charset=utf-8' -Body (($obj | ConvertTo-Json -Depth 10)) }
function Get2($path) { Invoke-RestMethod -Uri ($base + $path) -Method Get }

# 1) health
Show 'GET /api/health' (Get2 '/health')

# 2) 建局（8人局）
$created = Post '/games' @{ name = 'P1b3联调局'; type = 'werewolf'; player_count = 8 }
$gid = $created.game.id
Show "POST /games -> game.id=$gid (自动建席1..8)" $created

# 3) 宏1 跳身份：前端 buildMacroCard('claim_role', seat=2, role=预言家, day=1)
$card1 = @{ event = @{ day = 1; phase = 'day'; type = 'claim'; actor_seat = 2; raw_text = '2号跳预言家' }
  claims = @(@{ seat = 2; subject_seat = 2; predicate = 'claims_role'; object = '预言家' })
  actions = @(); extracted_by = 'macro' }
Show '宏1 跳身份卡（前端构造，未走LLM）' $card1
$conf1 = Post "/games/$gid/events/confirm" $card1
Show '宏1 confirm 入账 201' $conf1
$c1 = $conf1.claim_ids[0]

# 4) 宏2 查杀：seat=3 -> 5
$card2 = @{ event = @{ day = 1; phase = 'day'; type = 'claim'; actor_seat = 3; raw_text = '3号查杀5号' }
  claims = @(@{ seat = 3; subject_seat = 5; predicate = 'is_wolf'; object = '查杀' })
  actions = @(); extracted_by = 'macro' }
$conf2 = Post "/games/$gid/events/confirm" $card2
Show '宏2 查杀卡 confirm 入账' $conf2
$c2 = $conf2.claim_ids[0]

# 5) 宏3 金水：seat=1 -> 4
$card3 = @{ event = @{ day = 1; phase = 'day'; type = 'claim'; actor_seat = 1; raw_text = '1号给4号发金水' }
  claims = @(@{ seat = 1; subject_seat = 4; predicate = 'is_good'; object = '好人' })
  actions = @(); extracted_by = 'macro' }
$conf3 = Post "/games/$gid/events/confirm" $card3
Show '宏3 金水卡 confirm 入账' $conf3

# 6) 自由文本 AI 拆解（MOCK）→ confirm
$ext = Post "/games/$gid/events/extract" @{ text = '3号说自己是预言家，说5号是查杀'; day = 1; phase = 'day' }
Show 'POST /events/extract（meta.mode 应为 MOCK）' $ext
$extPayload = @{ event = $ext.event; claims = @($ext.claims | ForEach-Object { @{ seat = $_.seat; subject_seat = $_.subject_seat; predicate = $_.predicate; object = $_.object } }); actions = @(); extracted_by = 'llm' }
$conf4 = Post "/games/$gid/events/confirm" $extPayload
Show '自由文本卡 confirm 入账（与宏同一路径）' $conf4
$extClaims = $conf4.claim_ids

# 7) 事件流核验：state?uptoDay=1 —— 4 事件 / 4 声称，最新在上由前端排序
$st = Get2 "/games/$gid/state?uptoDay=1"
$summary = @{ events = $st.events.Count; claims = $st.claims.Count; actions = $st.actions.Count
  predicates = ($st.claims | ForEach-Object { $_.predicate }) -join ',' ; current_day = $st.game.current_day }
Show "GET state?uptoDay=1 概要" $summary

# 8) 死亡事件入账 → 存活名单推导（5号出局）
$cardD = @{ event = @{ day = 1; phase = 'night'; type = 'death'; actor_seat = 5; raw_text = '5号夜晚出局' }
  claims = @(); actions = @(); extracted_by = 'user' }
Post "/games/$gid/events/confirm" $cardD | Out-Null
$st2 = Get2 "/games/$gid/state?uptoDay=1"
$alive = ($st2.players | Where-Object { $_.seat -notin @($st2.events | Where-Object type -eq 'death' | ForEach-Object { $_.actor_seat }) } | ForEach-Object { $_.seat }) -join ','
Show "死亡入账后存活席位（前端顶部条口径，应为 1,2,3,4,6,7,8）" @{ alive = $alive; deaths = @($st2.events | Where-Object type -eq 'death').Count }

# 9) claims edit：改跳身份那条 object -> 女巫
$ed = Post "/games/$gid/claims/$c1/edit" @{ object = '女巫' }
Show "POST claims/$c1/edit -> object=女巫" $ed

# 10) claims retract：撤回报查杀 → state 不可见
$rt = Post "/games/$gid/claims/$c2/retract" @{}
$st3 = Get2 "/games/$gid/state?uptoDay=1"
$stillThere = $st3.claims | Where-Object { $_.id -eq $c2 }
Show "POST claims/$c2/retract -> retracted" @{ retracted = $rt.retracted; state仍含该claim = [bool]$stillThere; 剩余claims = $st3.claims.Count }

# 11) actions 同构：vote 事件 → edit target 5->6 → retract → 不可见
$cardV = @{ event = @{ day = 1; phase = 'dusk'; type = 'vote'; actor_seat = 4; raw_text = '4号投5号' }
  claims = @(); actions = @(@{ seat = 4; action = 'vote'; target_seat = 5 }); extracted_by = 'user' }
$confV = Post "/games/$gid/events/confirm" $cardV
$a1 = $confV.action_ids[0]
$edA = Post "/games/$gid/actions/$a1/edit" @{ target_seat = 6 }
$rtA = Post "/games/$gid/actions/$a1/retract" @{}
$st4 = Get2 "/games/$gid/state?uptoDay=1"
Show "action edit(target 5->6)+retract" @{ edit后 = $edA.action.target_seat; retracted = $rtA.retracted; state仍含该action = [bool]($st4.actions | Where-Object { $_.id -eq $a1 }) }

# 12) 账本纪律负例：retracted 后 edit -> 409；非法席位卡 -> 400
try { Post "/games/$gid/claims/$c2/edit" @{ object = '改不动' } | Out-Null; Log '负例1 FAIL：未拦截'; Write-Output 'NEG-1 FAIL' }
catch { $code = Fail '负例1 retracted 后 edit（应 409）' $_; if ($code -eq 409) { Write-Output 'NEG-1 OK 409' } }
try { Post "/games/$gid/events/confirm" @{ event = @{ day = 1; phase = 'day'; type = 'claim'; actor_seat = 1; raw_text = 'x' }; claims = @(@{ seat = 1; subject_seat = 99; predicate = 'said'; object = 'x' }) } | Out-Null; Log '负例2 FAIL：未拦截'; Write-Output 'NEG-2 FAIL' }
catch { $code = Fail '负例2 席位99不在名单（应 400）' $_; if ($code -eq 400) { Write-Output 'NEG-2 OK 400' } }

Log ""
Log "== 全链结束：game_id=$gid 跳身份c$c1 查杀c$c2(已撤回) 金水 c1/自由文本c$extClaims[0..1] =="
Write-Output "ALL DONE game_id=$gid"
