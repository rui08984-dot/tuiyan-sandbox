# -*- coding: utf-8 -*-
"""用 GitHub API 独立复核 jevbest catalog 的 stars 元数据是否真实。"""
import json, subprocess, sys, time
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CAT = r"E:\music player\.scratch\jev-integration\_audit_raw\jevbest.com_catalog.json"
d = json.load(open(CAT, encoding="utf-8"))
projs = d["projects"]

# 取 star 最高的 15 条 + 起点文件 §6/§5 点名的关键仓库
by_star = sorted(projs, key=lambda p: -(p.get("stars") or 0))[:15]
KEY = ["TheoLeeCJ/SemIf", "vinnylarouge/jevlike", "TianyuCodings/NanoJev", "jaredpalmer/kev",
       "bespokelabsai/nimble", "featherless-ai/simple-jev", "ekzhang/openjev-sglang",
       "Mapika/decider", "daseinlabs/open-jev", "iammrduncan/typesafe-ai-benchmark",
       "Heman10x-NGU/Verdict-open-jev", "Yinsongxu/LLM2Jev", "zhengxuyu/litjev",
       "rorshopping/jev-on-a-laptop", "JoshuaSP/open-jev", "zhihz/openjev",
       "olanotolu/jevbetter", "shamazharikh/qwen-rlcd", "mizorewww/laya-mlx",
       "githubnext/localjev", "OmniJev/PlayJev", "typesafe-ai/skills",
       "github.com/OmniJev/awesome-jev-gallery"]

def catrow(slug):
    for p in projs:
        if slug.lower() in (p.get("url") or "").lower():
            return p
    return None

targets = {}
for p in by_star:
    u = p.get("url") or ""
    if "github.com" in u:
        slug = u.replace("https://github.com/", "").strip("/")
        targets[slug] = p
for k in KEY:
    p = catrow(k)
    if p:
        targets.setdefault(p["url"].replace("https://github.com/", "").strip("/"), p)
    else:
        targets.setdefault(k.replace("github.com/", ""), None)

print("=== GitHub API 复核 %d 个仓库 ===" % len(targets))
hdr = "%-46s %8s %8s %-10s %-22s %s" % ("repo", "cat_stars", "gh_stars", "license", "pushed_at", "http")
print(hdr); print("-" * 140)
mismatch = 0
for slug, p in sorted(targets.items()):
    r = subprocess.run(["curl", "-sS", "-m", "20", "-H", "Accept: application/vnd.github+json",
                        "https://api.github.com/repos/" + slug],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    code = "?"
    try:
        j = json.loads(r.stdout)
        code = str(j.get("message") or "OK")
        gh = j.get("stargazers_count")
        lic = (j.get("license") or {}).get("spdx_id") if j.get("license") else None
        pushed = (j.get("pushed_at") or "")[:10]
        cs = p.get("stars") if p else None
        flag = ""
        if cs is not None and gh is not None and abs(int(cs) - int(gh)) > 0:
            flag = "  <== MISMATCH"
            mismatch += 1
        print("%-46s %8s %8s %-10s %-22s %s%s" % (slug, cs, gh, lic or "-", pushed or "-", code, flag))
    except Exception as e:
        print("%-46s %8s %8s %-10s %-22s %s" % (slug, (p or {}).get("stars"), "-", "-", "-", "PARSE_FAIL " + str(e)[:30]))
print("\nMISMATCHES: %d" % mismatch)
