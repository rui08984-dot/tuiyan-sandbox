// 用法: node oral_texture.cjs <out> <file1> <file2> ...
// 口语皮纹密度：语气词/垫字/对听众称呼 每千字率
const fs = require("fs");
const out = process.argv[2];
const files = process.argv.slice(3);
const outLines = [];
const p = (s) => { outLines.push(s); };
const markers = ["呢", "啊", "嘛", "吧", "啦", "你们", "您", "咱", "怎么说呢", "你别说", "是不是", "对吧"];
for (const fp of files) {
  const raw = fs.readFileSync(fp, "utf8");
  const name = fp.split("\\").pop();
  const n = raw.length;
  const counts = {};
  for (const m of markers) {
    let c = 0, idx = -1;
    while ((idx = raw.indexOf(m, idx + 1)) >= 0) c++;
    counts[m] = c;
  }
  const rate = (c) => (c / n * 1000).toFixed(1);
  p("=== " + name + " (chars=" + n + ")");
  p("  每千字: " + markers.map(m => m + "=" + counts[m] + "(" + rate(counts[m]) + ")").join(" "));
  p("");
}
fs.writeFileSync(out, outLines.join("\n"), "utf8");
console.log("WRITTEN " + out);
