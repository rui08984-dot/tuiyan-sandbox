// QC 机械对账：replay vs truth vs slots.json（照 _qc_check.cjs 先例，2026-09-12）
const fs = require("fs");
const dir = "docs/sandbox/p0-replay/";
const replay = fs.readFileSync(dir + "replay-werewolf-pandakill-s1e6.md", "utf8");
const truth = fs.readFileSync(dir + "replay-werewolf-pandakill-s1e6.truth.md", "utf8");
const slots = JSON.parse(fs.readFileSync(dir + "replay-werewolf-pandakill-s1e6.slots.json", "utf8"));
const results = [];
const check = (name, pass, detail) => results.push((pass ? "PASS" : "FAIL") + " | " + name + " | " + detail);

// 1. E 编号连续性
const nums = [...replay.matchAll(/- E-(\d+):/g)].map(m => +m[1]);
const uniq = [...new Set(nums)];
const missing = []; for (let i = 1; i <= Math.max(...uniq); i++) if (!uniq.includes(i)) missing.push(i);
check("E编号连续", nums.length === uniq.length && missing.length === 0, uniq.length + "定义/" + nums.length + "引用 缺号=" + missing);

// 2. 头部无结果行
check("头部无结果行", !/^结果：/m.test(replay.split("## ")[0]), "QC修正②④口径");

// 3. 死亡集合三方对账（按死亡证据 E 行逐席位核对：E-9/11/22/23/29/31）
const truthDead = [2,4,11,7,3,8,9,1];
const setEq = (a, b) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
const deathEvidence = { 9:[2], 11:[4], 22:[11,7], 23:[3,8], 29:[9], 31:[1] };
let repDeadOk = true, repDeadDetail = [];
for (const [e, seats] of Object.entries(deathEvidence)) {
  const line = replay.split("\n").find(l => l.startsWith("- E-" + e + ":"));
  const ok = !!line && seats.every(s => line.includes(s + "号"));
  if (!ok) repDeadOk = false;
  repDeadDetail.push("E-" + e + "->" + seats.join("/") + ":" + (ok ? "ok" : "MISS"));
}
const slotDeaths = slots.streams.public.filter(r => r.action === "death").map(r => parseInt(r.actor));
check("死亡集合 replay=truth", repDeadOk, repDeadDetail.join(" "));
check("死亡集合 slots=truth", setEq(slotDeaths, truthDead), "slots=" + slotDeaths);

// 4. 昼2 唱票 4:2
const d2votes = slots.streams.public.filter(r => r.time.day === 2 && r.time.phase === "vote" && r.action === "vote");
const to12 = d2votes.filter(r => r.target === "12号").length, to9 = d2votes.filter(r => r.target === "9号").length;
check("昼2唱票4:2", to12 === 2 && to9 === 4 && replay.includes("4:2"), "12号票=" + to12 + " 9号票=" + to9);

// 5. 人数口径 truth vs 头部
const wolfOk = /3 普狼[\s\S]{0,40}白狼王 = 7/.test(truth) && /4 狼 \/ 12 人局/.test(truth);
const godOk = /4 神/.test(truth) && /4 民/.test(truth);
check("人数口径4-4-4", wolfOk && godOk && replay.includes("4 狼=3 普狼+1 白狼王／4 神=预女猎守／4 民"), "truth锚点+头部一致");

// 6. 座位绑定 12/12
const aliasN = Object.keys(slots.registry_aliases).length;
const rosterLine = replay.match(/^1 囚徒[\s\S]*?12 sol君$/m);
check("ID绑定12/12", aliasN === 12 && !!rosterLine, "slots别名=" + aliasN + " replay名单行=" + !!rosterLine);

// 7. 预言家宣称四席一致
const claimSeats = ["1号","6号","9号","12号"].every(s => replay.includes(s + "（") && (replay.includes("跳预言家")));
check("四预言家宣称", claimSeats && truth.includes("四预言家宣称混战"), "1/6/9/12 replay+truth对齐");

// 8. 终局结算一致
check("终局交牌好人胜", replay.includes("好人阵营胜利") && truth.includes("好人阵营获胜") && slots.streams.public.some(r => r.action === "surrender" && r.actor === "6号"), "replay E-34/truth锚点/slots surrender");

// 9. 12号夜2查验已降级（证据核错回填）
const demoted = slots.candidates_rejected.some(c => c.ref === "夜2验人" && c.record.actor === "12号" && (c.reason || []).includes("low_conf"));
check("12号夜2查验未考", demoted && truth.includes("未考"), "slots复核队列+truth标注");

console.log(results.join("\n"));
fs.writeFileSync(dir + "_qc_check_s1e6-out.txt", results.join("\n"), "utf8");
const fails = results.filter(r => r.startsWith("FAIL")).length;
console.log("SUMMARY " + (results.length - fails) + "/" + results.length + " pass" + (fails ? " FAILS=" + fails : ""));
