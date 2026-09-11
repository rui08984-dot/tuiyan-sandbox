const fs = require("fs");
const lines = fs.readFileSync("C:/Users/crx/.dsh/sessions/--E-music~0020player--/4efb26ee-6a91-4367-b218-5aedcfe875d0/session.jsonl", "utf8").split("\n").filter(l => l.trim());
const typeCount = {};
let assistantSample = null, textSample = null;
for (const l of lines) {
  let o; try { o = JSON.parse(l); } catch { typeCount["PARSE_FAIL"] = (typeCount["PARSE_FAIL"]||0)+1; continue; }
  typeCount[o.type] = (typeCount[o.type]||0)+1;
  if (!assistantSample && l.includes("assistant")) assistantSample = l.slice(0, 400);
  if (!textSample && l.includes('"text"')) textSample = l.slice(0, 300);
}
console.log("type 分布:", JSON.stringify(typeCount));
console.log("\n首个含 assistant 的行样例:\n", assistantSample);
console.log("\n首个含 text 的行样例:\n", textSample);
