# P1b-3 录入页集成实测 2026-09-08 15:16:01  (backend :8787, P1B_LLM_MOCK=1)

== GET /api/health ==
{"ok":true,"service":"p1b-web-workbench","db_path":"C:\\Users\\crx\\AppData\\Local\\Temp\\p1b-itest-p3.db","llm_mock":true,"engine":{"db_contract":"v1","reused_from":"p1a-terminal"}}

== POST /games -> game.id=1 (自动建席1..8) ==
{"game":{"id":1,"name":"P1b3联调局","type":"werewolf","game_type":"werewolf","player_count":8,"status":"active","created_at":"2026-09-08 07:16:01","current_day":0},"players":[{"id":1,"game_id":1,"seat":1,"name":"1号"},{"id":2,"game_id":1,"seat":2,"name":"2号"},{"id":3,"game_id":1,"seat":3,"name":"3号"},{"id":4,"game_id":1,"seat":4,"name":"4号"},{"id":5,"game_id":1,"seat":5,"name":"5号"},{"id":6,"game_id":1,"seat":6,"name":"6号"},{"id":7,"game_id":1,"seat":7,"name":"7号"},{"id":8,"game_id":1,"seat":8,"name":"8号"}]}

== 宏1 跳身份卡（前端构造，未走LLM） ==
{"claims":[{"predicate":"claims_role","object":"预言家","seat":2,"subject_seat":2}],"extracted_by":"macro","event":{"phase":"day","actor_seat":2,"raw_text":"2号跳预言家","day":1,"type":"claim"},"actions":[]}

== 宏1 confirm 入账 201 ==
{"ok":true,"event_id":1,"seq":1,"claim_ids":[1],"action_ids":[]}

== 宏2 查杀卡 confirm 入账 ==
{"ok":true,"event_id":2,"seq":2,"claim_ids":[2],"action_ids":[]}

== 宏3 金水卡 confirm 入账 ==
{"ok":true,"event_id":3,"seq":3,"claim_ids":[3],"action_ids":[]}

== POST /events/extract（meta.mode 应为 MOCK） ==
{"event":{"day":1,"phase":"day","type":"claim","actor_seat":3,"raw_text":"3号说自己是预言家，说5号是查杀"},"claims":[{"seat":3,"subject_seat":3,"predicate":"claims_role","object":"预言家"},{"seat":3,"subject_seat":5,"predicate":"is_wolf","object":"查杀"}],"actions":[],"warnings":[],"extracted_by":"llm","meta":{"source":"text","mode":"MOCK","attempts":1}}

== 自由文本卡 confirm 入账（与宏同一路径） ==
{"ok":true,"event_id":4,"seq":4,"claim_ids":[4,5],"action_ids":[]}

== GET state?uptoDay=1 概要 ==
{"claims":5,"current_day":1,"actions":0,"predicates":"claims_role,is_wolf,is_good,claims_role,is_wolf","events":4}

== 死亡入账后存活席位（前端顶部条口径，应为 1,2,3,4,6,7,8） ==
{"alive":"1,2,3,4,6,7,8","deaths":1}

== POST claims/1/edit -> object=女巫 ==
{"ok":true,"claim":{"id":1,"event_id":1,"seat":2,"subject_seat":2,"predicate":"claims_role","object":"女巫","extracted_by":"macro","confirmed_by_user":1,"retracted":0,"game_id":1}}

== POST claims/2/retract -> retracted ==
{"retracted":true,"state仍含该claim":false,"剩余claims":4}

== action edit(target 5->6)+retract ==
{"edit后":6,"retracted":true,"state仍含该action":false}

== 负例1 retracted 后 edit（应 409） ==  HTTP 409
ERROR: Response status code does not indicate success: 409 (Conflict).

== 负例2 席位99不在名单（应 400） ==  HTTP 400
ERROR: Response status code does not indicate success: 400 (Bad Request).

== 全链结束：game_id=1 跳身份c1 查杀c2(已撤回) 金水 c1/自由文本c4 5[0..1] ==
