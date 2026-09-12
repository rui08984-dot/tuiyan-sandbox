// PandaKill S1E6 第二局档案机械对账留痕（M2 续录 QC，2026-09-12；零 db 写入）
// 用法：node docs/sandbox/p0-replay/_qc_check_s1e6p2.cjs  → 结果落 _qc_check_s1e6p2-out.txt
const fs = require("fs"), path = require("path");
const DIR = __dirname;
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");
const replay = read("replay-werewolf-pandakill-s1e6p2.md");
const truth = read("replay-werewolf-pandakill-s1e6p2.truth.md");
const slots = JSON.parse(read("replay-werewolf-pandakill-s1e6p2.slots.json"));
const L = [];
const chk = (name, ok, detail) => L.push(`${ok ? "PASS" : "FAIL"} | ${name} | ${detail}`);

// 1. E 编号连续性
const evs = [...replay.matchAll(/^- E-(\d+):/gm)].map(m => +m[1]);
const seqOk = evs.length === 42 && evs.every((v, i) => v === i + 1);
chk("E-编号连续无跳号", seqOk, `${evs.length} 定义 / E-1..E-${evs[evs.length - 1]} / 唯一 ${new Set(evs).size}`);

// 2. 头部无结果行（首个 '## ' 前）
const head = replay.split(/\n## /)[0];
chk("头部无「结果/胜负/胜利」行", !/胜利|胜负|结果：/.test(head), `头部 ${head.length} 字符`);

// 3. 死亡集合 replay=truth（slots public death 记录 vs 预期相位）
const dpub = slots.streams.public.filter(r => r.action === "death")
  .map(r => `${r.actor}@d${r.time.day}${r.time.phase === "vote" ? "-vote" : ""}`);
const expDeaths = ["9号@d1", "11号@d1", "7号@d1", "4号@d2", "5号@d2", "3号@d2-vote", "6号@d3"];
chk("死亡集合 slots=预期相位", JSON.stringify([...dpub].sort()) === JSON.stringify([...expDeaths].sort()), dpub.join(","));

// 4. replay 死亡关键行
const keyLines = ["带走 11号", "三号玩家成为警长", "昨天晚上死亡的是四号和五号", "法官宣布 3号 出局", "六号玩家成为警长", "昨天晚上死亡的是六号玩家", "狼人阵营胜利"];
const missLines = keyLines.filter(k => !replay.includes(k));
chk("replay 关键事件行齐全", missLines.length === 0, missLines.length ? "缺:" + missLines.join("/") : keyLines.length + " 行全中");
// 5. 警选逐票对账（slots day1 vote/abstain）
const d1v = slots.streams.public.filter(r => r.time.day === 1 && (r.action === "vote" || r.action === "abstain"));
const d1to7 = d1v.filter(r => r.action === "vote" && r.target === "7号").map(r => r.actor).sort().join(",");
const d1ab = d1v.filter(r => r.action === "abstain").map(r => r.actor).join(",");
chk("警选逐票 3/5/6/11→7号+4号弃票", d1to7 === "11号,3号,5号,6号" && d1ab === "4号" && d1v.length === 5, `votes=${d1to7} abstain=${d1ab} n=${d1v.length}`);

// 6. 昼2 唱票 4:3 对账（slots day2 vote）
const d2v = slots.streams.public.filter(r => r.time.day === 2 && r.time.phase === "vote" && r.action === "vote");
const to10 = d2v.filter(r => r.target === "10号").map(r => r.actor).sort().join(",");
const to3 = d2v.filter(r => r.target === "3号").map(r => r.actor).sort().join(",");
chk("昼2 唱票 3/6/12→10号，1/2/8/10→3号（4:3）", to10 === "12号,3号,6号" && to3 === "10号,1号,2号,8号", `→10号:${to10} →3号:${to3}`);

// 7. replay E-37 唱票原文对账
const e37 = replay.split("- E-37:")[1].split("\n")[0];
chk("E-37 唱票原文含双票堆", e37.includes("三号六号十二号投给十号") && e37.includes("其余所有玩家投给三号") && e37.includes("4:3"), e37.slice(0, 60) + "…");

// 8. 终局结算对账：存活推演 12→{1,2,8,10,12} 神职全灭
const dead = new Set(["9号", "11号", "7号", "4号", "5号", "3号", "6号"]);
const alive = Array.from({ length: 12 }, (_, i) => `${i + 1}号`).filter(s => !dead.has(s));
const gods = ["4号", "6号", "7号", "11号"].every(g => dead.has(g));
chk("终局存活推演+屠边结算", JSON.stringify(alive) === JSON.stringify(["1号", "2号", "8号", "10号", "12号"]) && gods && truth.includes("狼人阵营获胜"), `alive=${alive.join(",")} godsDead=${gods}`);

// 9. slots 验收判据
const v = slots.validation;
chk("slots 通过率≥90%", v.pass_rate >= 0.9, `${(v.pass_rate * 100).toFixed(2)}% (${v.formal}/${v.total_extracted})`);
chk("slots 时序活性违例=0", v.liveness_violations === 0, `violations=${v.liveness_violations}`);
const lowConf = [...slots.streams.public, ...slots.streams.truth].filter(r => r.confidence < 0.6).length;
chk("正式流低置信=0（候选全入复核队列）", lowConf === 0 && slots.candidates_rejected.length === 2 && slots.candidates_rejected.every(c => c.record.confidence < 0.6), `formal低置信=${lowConf} 复核队列=${slots.candidates_rejected.length}`);

// 10. 12号伪验不入真相层
chk("12号伪验不入 truth 流", !slots.streams.truth.some(r => r.actor === "12号") && truth.includes("伪验"), `truth 中 12号 记录=0`);

const ok = L.every(x => x.startsWith("PASS"));
const out = `# _qc_check_s1e6p2 ${new Date().toISOString()}\n` + L.join("\n") + `\n${ok ? "ALL PASS " + L.length + "/" + L.length : "HAS FAIL"}\n`;
fs.writeFileSync(path.join(DIR, "_qc_check_s1e6p2-out.txt"), out, "utf8");
console.log(out);
