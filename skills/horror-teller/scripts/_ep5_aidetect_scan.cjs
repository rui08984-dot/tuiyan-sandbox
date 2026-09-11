const fs = require("fs");
const t = fs.readFileSync(process.argv[2], "utf8");
const n = t.length;
const cnt = (re) => (t.match(re) || []).length;
const groups = {
  "比喻词(像/似/宛如/仿佛/如同)": /[像]|似的|宛如|仿佛|如同/g,
  "极端词(非常/极其/十分/无比/顿时/瞬间)": /非常|极其|十分|无比|顿时|瞬间/g,
  "AI转折词(然而/与此同时/不仅如此/值得一提)": /然而|与此同时|不仅如此|值得一提/g,
  "情绪词(震惊/心头一震/头皮发麻/不寒而栗)": /震惊|心头一震|头皮发麻|不寒而栗/g,
  "排比(不是..而是)": /不是[^。]{1,12}而是/g,
  "省略号误用(...)": /\.\.\./g,
  "英文引号": /[""''\u201C\u201D]/g,
  "句号当顿号(三连短句)": /[\u4e00-\u9fa5]{1,4}。[\u4e00-\u9fa5]{1,4}。[\u4e00-\u9fa5]{1,4}。/g,
};
console.log("chars=" + n);
for (const [k, re] of Object.entries(groups)) {
  const c = cnt(re);
  console.log(k + ": " + c + " (" + (c / n * 1000).toFixed(1) + "/千字)");
}
// 连续同句式抽查：连续3+句以同一字开头
const sents = t.split(/[。！？]+/).map(s => s.trim()).filter(Boolean);
let run = 1, worst = 1, worstS = "";
for (let i = 1; i < sents.length; i++) {
  if (sents[i][0] === sents[i-1][0]) { run++; if (run > worst) { worst = run; worstS = sents[i-run+1].slice(0, 12); } }
  else run = 1;
}
console.log("最长连续同字开头句: " + worst + " (" + worstS + "…)");
// 重复短语抽查（5字以上重复>=2次，粗筛）
const freq = {};
const grams = t.match(/[\u4e00-\u9fa5]{5,8}/g) || [];
for (const g of grams) freq[g] = (freq[g] || 0) + 1;
const top = Object.entries(freq).filter(([k, v]) => v >= 3).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log("重复5-8字串(>=3次): " + JSON.stringify(top));
