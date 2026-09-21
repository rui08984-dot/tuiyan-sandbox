# -*- coding: utf-8 -*-
"""提取 HTML 中所有 <a href> 的绝对/相对链接及锚文本，用于判「是否给出可核原始出处」。"""
import sys, re, html
from collections import Counter

def main(path):
    raw = open(path, "rb").read().decode("utf-8", "replace")
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', raw, re.I | re.S):
        href = html.unescape(m.group(1))
        text = re.sub(r"<[^>]+>", "", m.group(2))
        text = html.unescape(re.sub(r"\s+", " ", text)).strip()
        out.append((href, text))
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ext = [(h, t) for h, t in out if h.startswith("http") and "openchamber.dev" not in h]
    print("=== TOTAL LINKS: %d ; EXTERNAL: %d ===" % (len(out), len(ext)))
    print("--- EXTERNAL (dedup) ---")
    seen = set()
    for h, t in ext:
        k = h.split("#")[0]
        if k in seen: continue
        seen.add(k)
        print("%-95s | %s" % (h[:95], t[:60]))
    print("--- HOST COUNTS ---")
    hosts = Counter(re.sub(r"^https?://", "", h).split("/")[0] for h, _ in out if h.startswith("http"))
    for hh, c in hosts.most_common(40):
        print("%4d  %s" % (c, hh))

if __name__ == "__main__":
    main(sys.argv[1])
