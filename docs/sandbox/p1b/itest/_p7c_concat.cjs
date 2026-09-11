const fs = require("fs");
const dir = "E:/music player/docs/sandbox/p1b/itest/";
const parts = ["_p7c_a1.txt", "_p7c_a2.txt", "_p7c_b.txt", "_p7c_c.txt", "_p7c_d.txt", "_p7c_e.txt"];
const body = parts.map((p) => fs.readFileSync(dir + p, "utf8")).join("\n").replace(/\r\n/g, "\n");
fs.writeFileSync(dir + "p7-drive.mjs", body, "utf8");
console.log("concat OK chars=" + body.length + " lines=" + body.split("\n").length);