const fs = require("fs");
const dir = "E:/music player/docs/sandbox/p1b/itest/";
function patch(file, from, to) {
  const p = dir + file;
  let s = fs.readFileSync(p, "utf8");
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log("SKIP " + file + " hit=" + n); process.exitCode = 1; return; }
  fs.writeFileSync(p, s.replace(from, to), "utf8");
  console.log("PATCHED " + file);
}
const MARK = "__EOG__";
// fix1: 宏出卡后轮询等卡（异步渲染，500ms 定额会踩空）
patch("_p7c_c.txt",
  "  await click(btn('出确认卡'));\n  await sleep(500);\n  const okCard = await evaljs(\"!!\" + q('.confirm-sheet'));",
  "  await click(btn('出确认卡'));\n  const okCard = await waitSel('.confirm-sheet', 8000);",
);
// fix2: S11b 建局后切局兜底再断言
patch("_p7c_e.txt",
  "check('S11b BOTC 局现场（血染钟楼·5人）', await waitText('血染钟楼', 8000));",
  "await ensureOnGame('P7血染回归');\ncheck('S11b BOTC 局现场（切局兜底后）', (await pageText()).indexOf('血染钟楼') >= 0 && (await pageText()).indexOf('5人') >= 0);",
);
// fix3: ensureOnGame 助手加进 a2
const a2 = dir + "_p7c_a2.txt";
let s2 = fs.readFileSync(a2, "utf8");
if (s2.indexOf("async function ensureOnGame") < 0) {
  s2 += [
    "async function ensureOnGame(name) {"
    , "  await nav(\u0027#/\u0027);"
    , "  await sleep(800);"
    , "  if ((await pageText()).indexOf(name) >= 0) return \u0027already\u0027;"
    , "  await evaljs(\"(()=>{const b=\" + btn(\u0027\u5207\u6362/\u5efa\u5c40\u0027) + \";if(b)b.click();return !!b})()\");"
    , "  await sleep(700);"
    , "  await evaljs(\"(()=>{const b=\" + btn(name) + \";if(b)b.click();return !!b})()\");"
    , "  await sleep(1600);"
    , "  return (await pageText()).indexOf(name) >= 0 ? \u0027switched\u0027 : \u0027fail\u0027;"
    , "}"
  ].join("\n") + "\n";
  fs.writeFileSync(a2, s2, "utf8");
  console.log("PATCHED _p7c_a2.txt (ensureOnGame)");
} else { console.log("SKIP a2"); }