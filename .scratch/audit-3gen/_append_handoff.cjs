const fs = require("fs");
const target = "E:/music player/docs/sandbox/HANDOFF-2026-09-08.md";
const piece = fs.readFileSync("E:/music player/.scratch/audit-3gen/_handoff_errata.txt", "utf8");
const before = fs.readFileSync(target, "utf8");
if (before.includes("【勘误 2026-09-10")) { console.log("ALREADY_APPENDED"); process.exit(0); }
fs.appendFileSync(target, piece, "utf8");
const after = fs.readFileSync(target, "utf8");
console.log("LEN " + before.length + " -> " + after.length + "  appended=" + (after.length - before.length) + "  verify=" + after.includes("【勘误 2026-09-10"));