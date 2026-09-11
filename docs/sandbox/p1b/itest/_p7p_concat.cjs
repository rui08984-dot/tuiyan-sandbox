const fs = require("fs");
const dir = "E:/music player/docs/sandbox/p1b/itest/";
const body = ["_p7p_1.txt", "_p7p_2.txt"].map((p) => fs.readFileSync(dir + p, "utf8")).join("\n").replace(/\r\n/g, "\n");
fs.writeFileSync(dir + "_p7probe.mjs", body, "utf8");
console.log("probe concat OK chars=" + body.length);