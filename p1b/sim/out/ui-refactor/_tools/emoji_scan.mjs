import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const root = "E:/music player/p1b/web/src";
const targets = process.argv.slice(2).length ? process.argv.slice(2) : null;
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(e.name)) yield p;
  }
}
// 符号区：U+2000-U+2BFF、U+FE0F、U+1F000-U+1FAFF、U+2700-U+27BF（含在2000-2BFF外补扫）、U+2E00-U+32FF、U+1F1E6-U+1F1FF
const RE = /[\u2000-\u2BFF\u2E00-\u32FF\uFE0F\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]/gu;
const kind = (cp) => {
  if (cp >= 0x1f000) return "EMOJI-BLOCK";          // 真 emoji 嫌疑
  if (cp === 0xfe0f) return "VS16";
  if (cp >= 0x2190 && cp <= 0x21ff) return "arrow";   // →←↻ 合法
  if (cp >= 0x25a0 && cp <= 0x25ff) return "geom";    // ▸▶●○ 合法
  if (cp >= 0x2b00 && cp <= 0x2bff) return "arrow2";  // ⬆⬇ 需甄别
  if (cp >= 0x2700 && cp <= 0x27bf) return "dingbat"; // ✅✂ 需甄别
  if (cp >= 0x2600 && cp <= 0x26ff) return "misc-sym"; // ☀⚡ 需甄别
  if (cp >= 0x2000 && cp <= 0x206f) return "punct";
  return "other";
};
for (const f of walk(root)) {
  if (targets && !targets.some(t => f.includes(t))) continue;
  const lines = readFileSync(f, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      const ch = m[0], cp = ch.codePointAt(0);
      console.log(kind(cp) + "\t" + "U+" + cp.toString(16).toUpperCase().padStart(4, "0") + "\t[" + ch + "]\t" + f.replace(root + "/", "") + ":" + (i + 1) + "\t" + line.trim().slice(0, 110));
    }
  });
}
