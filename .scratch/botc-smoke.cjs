process.env.P1B_LLM_MOCK = "1";
(async () => {
  const { buildServer } = require("E:/music player/p1b/src/server");
  const app = await buildServer({ dbPath: ":memory:", llmMock: true, providersPath: require("os").tmpdir() + "/p1b-smoke-prov-" + Date.now() + ".json" });
  const j = (r) => r.json();
  // 1) botc 建局挂剧本
  let r = await app.inject({ method: "POST", url: "/api/games", payload: { name: "smoke TB", type: "botc", player_count: 7, script: "tb" } });
  console.log("create:", r.statusCode, "script=", j(r).game.script);
  const gid = j(r).game.id;
  // 2) 角色声称（中文→id）+ 对跳（两 seat 同洗衣妇）
  r = await app.inject({ method: "POST", url: "/api/games/" + gid + "/events/confirm", payload: {
    event: { day: 1, phase: "day", type: "claim", actor_seat: 2, raw_text: "2号跳洗衣妇" },
    claims: [{ seat: 2, subject_seat: 2, predicate: "claims_role", object: "洗衣妇" }],
    extracted_by: "user" } });
  console.log("confirm1:", r.statusCode, JSON.stringify(j(r)));
  r = await app.inject({ method: "POST", url: "/api/games/" + gid + "/events/confirm", payload: {
    event: { day: 1, phase: "day", type: "claim", actor_seat: 3, raw_text: "3号也跳洗衣妇" },
    claims: [{ seat: 3, subject_seat: 3, predicate: "claims_role", object: "Washerwoman" }],
    extracted_by: "user" } });
  console.log("confirm2:", r.statusCode);
  // 3) 阵营声称落 botc_claims
  r = await app.inject({ method: "POST", url: "/api/games/" + gid + "/events/confirm", payload: {
    event: { day: 1, phase: "day", type: "claim", actor_seat: 1, raw_text: "1号指认5号是恶魔" },
    claims: [{ seat: 1, subject_seat: 5, predicate: "is_demon", object: "" }],
    extracted_by: "user" } });
  console.log("confirm3:", r.statusCode, "botc_claim_ids=", JSON.stringify(j(r).botc_claim_ids));
  r = await app.inject({ method: "GET", url: "/api/games/" + gid + "/botc-claims" });
  console.log("botc-claims:", r.statusCode, j(r).claims.length, j(r).claims[0] && j(r).claims[0].predicate);
  // 4) state 里主表角色声称（object=washerwoman 归一）
  r = await app.inject({ method: "GET", url: "/api/games/" + gid + "/state" });
  const roleObjs = j(r).claims.filter(c => c.predicate === "claims_role").map(c => c.object);
  console.log("state role objects:", JSON.stringify(roleObjs));
  // 5) advise day1 → 对跳 + 多恶魔？(只有 1 个 is_demon，无多恶魔) → 预期 [对跳]
  r = await app.inject({ method: "POST", url: "/api/games/" + gid + "/day/1/advise" });
  console.log("advise:", r.statusCode, j(r).task_id ? "task ok" : JSON.stringify(j(r)));
  const tid = j(r).task_id;
  let card = null;
  for (let i = 0; i < 100; i++) {
    const tr = await app.inject({ method: "GET", url: "/api/tasks/" + tid });
    const b = j(tr);
    if (b.status !== "running") { card = b; break; }
    await new Promise(res => setTimeout(res, 25));
  }
  console.log("task status:", card.status, "| saved:", card.card && card.card.saved, "| save_error:", card.card && card.card.save_error);
  if (card.card) {
    console.log("meta:", JSON.stringify(card.card.meta));
    for (const c of card.card.contradictions) {
      console.log("- " + c.pair_id + " botc_only=" + !!c.botc_only + " under=" + c.underdetermination + " ie=" + (c.innocent_explanations || []).length + " | " + String(c.conflict_desc).slice(0, 50));
    }
    console.log("hypotheses:", card.card.hypotheses.length, "checkpoints:", card.card.checkpoints.length);
  }
  // 6) werewolf 局回归烟测（is_demon → 400）
  r = await app.inject({ method: "POST", url: "/api/games", payload: { name: "ww", type: "werewolf", player_count: 6 } });
  const wgid = j(r).game.id;
  r = await app.inject({ method: "POST", url: "/api/games/" + wgid + "/events/confirm", payload: {
    event: { day: 1, phase: "day", type: "claim", actor_seat: 1, raw_text: "x" },
    claims: [{ seat: 1, subject_seat: 2, predicate: "is_demon", object: "" }] } });
  console.log("werewolf is_demon:", r.statusCode, "(期望400)");
  await app.close();
})().catch(e => { console.error("SMOKE FAIL:", e && e.stack || e); process.exit(1); });
