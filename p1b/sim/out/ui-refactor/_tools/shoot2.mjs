import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
const APP = "http://127.0.0.1:8791";
const OUT = "E:/music player/p1b/sim/out/ui-refactor";
const PAGES = [["live", "/#/" ], ["intake", "/#/intake"], ["manage", "/#/manage"], ["settings", "/#/settings"]];
const WIDTHS = [375, 768, 1024, 1440];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = [];
for (const item of PAGES) {
  const name = item[0], hash = item[1];
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(APP + hash, { waitUntil: "load", timeout: 15000 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const de = document.documentElement, b = document.body;
      const over = Math.max(de.scrollWidth - de.clientWidth, b ? b.scrollWidth - b.clientWidth : 0);
      const text = b ? b.innerText : "";
      let emoji = 0;
      for (const ch of text) { const cp = ch.codePointAt(0); if (cp >= 0x1f000 || ch === "\uFE0F") emoji++; }
      const h = (b.querySelector("h1,.page-title,h2") || {}).textContent || "";
      return { vw: de.clientWidth, over: over, emoji: emoji, h1: h.trim().slice(0, 40) };
    });
    const file = OUT + "/after-" + name + "-" + w + ".png";
    await page.screenshot({ path: file });
    const row = Object.assign({ file: "after-" + name + "-" + w + ".png" }, m);
    report.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await browser.close();
writeFileSync(OUT + "/after-pages-metrics.json", JSON.stringify(report, null, 1));
console.log("DONE " + report.length);