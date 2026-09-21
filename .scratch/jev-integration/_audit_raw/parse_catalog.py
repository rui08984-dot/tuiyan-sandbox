# -*- coding: utf-8 -*-
"""解析 jevbest catalog.json：看 schema，导出项目清单。"""
import json, sys, io
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

d = json.load(open(r"E:\music player\.scratch\jev-integration\_audit_raw\jevbest.com_catalog.json", encoding="utf-8"))
print("TOP KEYS:", list(d.keys()))
print("stats:", json.dumps(d.get("stats"), ensure_ascii=False))
print("updated:", d.get("updated"), "| license:", d.get("license"), "| repo:", d.get("repository"))
projs = d.get("projects") or []
print("\n>>> projects len=%d" % len(projs))
if projs:
    print("    keys of [0]:", list(projs[0].keys()))
    print("    sample[0]:", json.dumps(projs[0], ensure_ascii=False)[:1400])

# dump all projects as tsv
out = io.open(r"E:\music player\.scratch\jev-integration\_audit_raw\catalog_projects.tsv", "w", encoding="utf-8", newline="\n")
out.write("name\turl\trepo\tstars\tlang\tcategory\tdesc\n")
n = 0
for p in projs:
    def g(*ks):
        for k in ks:
            if k in p and p[k] is not None:
                return str(p[k]).replace("\t", " ").replace("\n", " ")
        return ""
    out.write("\t".join([g("name", "title"), g("url", "html_url", "link"), g("repository", "repo", "full_name"),
                         g("stars", "stargazers", "star_count"), g("language", "lang"),
                         g("category", "categoryName"), g("description", "desc")[:220]]) + "\n")
    n += 1
out.close()
print("\nwrote catalog_projects.tsv  rows=%d" % n)
