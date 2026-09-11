// 用法: node structure_metrics.cjs <outFile> <file1> [file2...]
// 结构指标：段长/句长分布、爆发性(std/mean)、段尾标点形态、对话行占比、连续同构段
const fs = require("fs");
const out = process.argv[2];
const files = process.argv.slice(3);
const outLines = [];
const p = (s) => { outLines.push(s); };
function stats(arr) {
  if (!arr.length) return { n: 0, mean: 0, std: 0, med: 0, p90: 0, max: 0 };
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  const mean = a.reduce((s, v) => s + v, 0) / n;
  const variance = a.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  return { n, mean, std: Math.sqrt(variance), med: a[Math.floor(n / 2)], p90: a[Math.floor(n * 0.9)], max: a[n - 1] };
}
const fmt = (o, burst) => "n=" + o.n + " mean=" + o.mean.toFixed(1) + " std=" + o.std.toFixed(1) + (burst !== undefined ? " burst=" + burst.toFixed(2) : "") + " med=" + o.med + " p90=" + o.p90 + " max=" + o.max;
for (const fp of files) {
  const raw = fs.readFileSync(fp, "utf8");
  const name = fp.split("\\").pop();
  // 过滤非正文行：标题/分隔/标注表行/时间戳段标
  const bodyLines = raw.split(/\r?\n/).filter(l => {
    const t = l.trim();
    if (!t) return false;
    if (/^(#|=====|---|\||\*\*\*)/.test(t)) return false;
    if (/^\[|^【(证据|标注|制作|节拍|泵|时间)/.test(t)) return false;
    return true;
  });
  // 段 = 连续非空行合并
  const paras = [];
  let cur = [];
  for (const l of bodyLines) {
    if (l.trim()) cur.push(l.trim());
    else if (cur.length) { paras.push(cur.join("")); cur = []; }
  }
  if (cur.length) paras.push(cur.join(""));
  const paraLens = paras.map(s => s.length);
  // 句：按中英文句末标点切
  const allText = paras.join("");
  const sents = allText.split(/[。！？!?]+/).map(s => s.trim()).filter(s => s.length > 0);
  const sentLens = sents.map(s => s.replace(/[，、；：：「」『』""（）()——…]/g, "").length);
  const ps = stats(paraLens);
  const ss = stats(sentLens);
  const paraBurst = ps.mean ? ps.std / ps.mean : 0;
  const sentBurst = ss.mean ? ss.std / ss.mean : 0;
  // 段尾形态分布
  const tails = {};
  for (const pa of paras) {
    const t = pa.slice(-1);
    const k = /[。…」』]/.test(t) ? "陈述/引语收" : (/？/.test(pa.slice(-3)) ? "问句收" : (/！/.test(pa.slice(-3)) ? "叹句收" : "其他"));
    tails[k] = (tails[k] || 0) + 1;
  }
  // 对话行占比
  const dialogParas = paras.filter(s => /[「"]/.test(s)).length;
  // 相邻段长差 < 25% 的连续同构段计数（段落长度均匀性=模板感信号）
  let uniformRuns = 0;
  for (let i = 1; i < paraLens.length; i++) {
    if (Math.abs(paraLens[i] - paraLens[i - 1]) < Math.max(paraLens[i], paraLens[i - 1]) * 0.25) uniformRuns++;
  }
  const uniformRate = paraLens.length > 1 ? uniformRuns / (paraLens.length - 1) : 0;
  const shortRatio = sentLens.filter(l => l <= 8).length / sentLens.length;
  const longRatio = sentLens.filter(l => l >= 30).length / sentLens.length;
  p("=== " + name);
  p("  段: " + fmt(ps, paraBurst));
  p("  句: " + fmt(ss, sentBurst) + " | 短句(<=8字)=" + (shortRatio * 100).toFixed(0) + "% 长句(>=30字)=" + (longRatio * 100).toFixed(0) + "%");
  p("  段尾: " + JSON.stringify(tails) + " | 对话段占比=" + (dialogParas / paras.length * 100).toFixed(0) + "% | 相邻段长近同构率=" + (uniformRate * 100).toFixed(0) + "%");
  p("  总字数(含标点)=" + allText.length + " 段数=" + paras.length + " 句数=" + sents.length);
  p("");
}
fs.writeFileSync(out, outLines.join("\n"), "utf8");
console.log("WRITTEN " + out);
