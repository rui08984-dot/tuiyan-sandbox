# -*- coding: utf-8 -*-
"""判据 A：跨站逐字重合检测。"内容农场"的硬判据＝不同域名下出现长逐字相同的句子。
方法：把每站正文切成句子，归一化（去标点/小写/压空白），找出现在 >=2 个站点的句子（长度>=45字符）。
"""
import os, re, sys, itertools
from collections import defaultdict
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

D = r"E:\music player\.scratch\jev-integration\_audit_raw"
SITES = {
    "jev-agent.com": "jev-agent.com_.txt",
    "jevapi.org":    "jevapi.org_.txt",
    "jevbest.com":   "jevbest.com_.txt",
    "jevusers.com":  "jevusers.com_.txt",
    "openchamber.dev":"openchamber.dev_blog_jev-typesafe-ai_.txt",
    "apimaster.ai":  "apimaster.ai_.txt",
    "foq.fr":        "foq.fr_.txt",
    "openjev.sh":    "openjev.sh_.txt",
    "openjev.com":   "openjev.com_.txt",
    "hermes-ai.net/jev": "hermes-ai.net_jev.txt",
    "typesafe.ai(VENDOR)":"typesafe.ai_.txt",
    "docs.typesafe.ai(VENDOR)":"docs.typesafe.ai_.txt",
}

def sentences(path):
    try:
        t = open(path, encoding="utf-8", errors="replace").read()
    except FileNotFoundError:
        return set()
    t = re.sub(r"^(TITLE|) *.*\n", "", t, count=1)
    out = set()
    for s in re.split(r"(?<=[.!?\u3002\uff01\uff1f])\s+|\n+", t):
        n = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff%$./]+", "", s).lower()
        if len(n) >= 45:
            out.add(n)
    return out

S = {k: sentences(os.path.join(D, v)) for k, v in SITES.items()}
inv = defaultdict(set)
for k, ss in S.items():
    for s in ss:
        inv[s].add(k)

shared = {s: ks for s, ks in inv.items() if len(ks) >= 2}
print("=== 逐字相同句子（>=2 站，>=45 归一化字符）：%d 条 ===" % len(shared))
pairs = defaultdict(int)
for s, ks in shared.items():
    for a, b in itertools.combinations(sorted(ks), 2):
        pairs[(a, b)] += 1
print("\n--- 站点对重合计数（前 25）---")
for (a, b), c in sorted(pairs.items(), key=lambda x: -x[1])[:25]:
    print("%4d  %-22s <-> %s" % (c, a, b))

print("\n--- 重合句子样本（按涉及站点数排序，前 18）---")
for s, ks in sorted(shared.items(), key=lambda x: -len(x[1]))[:18]:
    print("  [%d站] %s" % (len(ks), s[:150]))
    print("        %s" % " | ".join(sorted(ks)))
