const fs = require("fs");
const dir = "E:/music player/docs/sandbox/p1b/itest/";
const base = fs.readFileSync(dir + "_p7p_1.txt", "utf8");
const tail = fs.readFileSync(dir + "_p7p_3.txt", "utf8");
const cut = base.indexOf("console.log('=== PROBE A");
const head = base.slice(0, cut);
const body = (head + tail).replace(/\r\n/g, "\n");
fs.writeFileSync(dir + "_p7probe2.mjs", body, "utf8");
console.log("probe2 concat OK chars=" + body.length);