const fs = require("fs");
const raw = JSON.parse(fs.readFileSync("E:/music player/docs/sandbox/botc-adapt/data/roles-zh.json", "utf8"));
const q = (id) => raw.find(r => r.id === id);
for (const id of ["washerwoman","librarian","seer","imp","poisoner","butler","soldier","mayor","drunk","spy","scarlet_woman","baron","puzzlemaster","gambler","vortox","beggar","barista","bureaucrat","harlot","butler2","gunslinger","mephit"]) {
  const r = q(id);
  if (r) console.log(id, "|", r.name_zh, "|", r.name_en, "|", r.team, "|", JSON.stringify(r.editions), "|", (r.unique_note||"").slice(0,3));
  else console.log(id, "| NOT FOUND");
}
console.log("--- tb travelers ---");
console.log(raw.filter(r=>r.team==="traveler" && r.editions.includes("tb")).map(r=>r.id+"/"+r.name_zh+"/"+r.unique_note.slice(0,3)).join(", "));
console.log("--- tb roles full list ---");
console.log(raw.filter(r=>r.editions.includes("tb")).map(r=>r.id+"("+r.name_zh+","+r.team+")").join(", "));
console.log("--- bmr-only sample (in bmr not tb, non-traveler) ---");
console.log(raw.filter(r=>r.editions.includes("bmr") && !r.editions.includes("tb") && r.team!=="traveler").map(r=>r.id+"("+r.name_zh+")").slice(0,8).join(", "));
console.log("--- test count baseline ---");
