import { writeFileSync, mkdirSync } from "node:fs";
const CDP = "http://127.0.0.1:9333";
const APP = "http://127.0.0.1:8791";
const OUT = "E:/music player/p1b/sim/out/ui-refactor";
const PAGES = [["live", "/#/" ], ["intake", "/#/intake"], ["manage", "/#/manage"], ["settings", "/#/settings"]];
const WIDTHS = [375, 768, 1024, 1440];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 30; i++) { try { await fetch(CDP + "/json/version"); break; } catch { await sleep(500); } }
const targets = await (await fetch(CDP + "/json/list")).json();
const page = targets.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pend = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify(Object.assign({ id, method }, { params: params || {} }))); });
const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.result.value;
mkdirSync(OUT, { recursive: true });
const probe = "(
  () => {
    const de = document.documentElement, b = document.body;
    const over = Math.max(de.scrollWidth - de.clientWidth, b ? b.scrollWidth - b.clientWidth : 0);
    const text = b ? b.innerText : "";
    let emoji = 0;
    for (const ch of text) { const cp = ch.codePointAt(0); if (cp >= 0x1f000 || ch === "\uFE0F") emoji++; }
    return { vw: de.clientWidth, over: over, emoji: emoji, h1: ((b.querySelector("h1,.page-title,h2") || {}).textContent || "").trim().slice(0, 40) };
  }
)()
const report = [];
for (const item of PAGES) {
  const name = item[0], hash = item[1];
  for (const w of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
    await send("Page.navigate", { url: APP + hash });
    await sleep(1400);
    const m = await evalJs(probe);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const file = OUT + "/after-" + name + "-" + w + ".png";
    writeFileSync(file, Buffer.from(shot.result.data, "base64"));
    const row = { file: "after-" + name + "-" + w + ".png", vw: m.vw, over: m.over, emoji: m.emoji, h1: m.h1 };
    report.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(OUT + "/after-pages-metrics.json", JSON.stringify(report, null, 1));
console.log("DONE " + report.length);
process.exit(0);