import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const w of [375, 1440]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:8791" + "/#/", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const b = document.body;
    const err = b.innerText.includes("渲染异常兜底") || b.innerText.includes("出错了");
    return {
      textLen: (b.innerText || "").length,
      cards: b.querySelectorAll(".card,.panel,.content").length,
      btns: b.querySelectorAll("button").length,
      tabbar: b.querySelectorAll("[class*=tab]").length,
      sample: (b.innerText || "").replace(/\s+/g, " ").slice(0, 120),
      boundaryError: err
    };
  });
  console.log("live@" + w + " " + JSON.stringify(m));
  await ctx.close();
}
await browser.close();