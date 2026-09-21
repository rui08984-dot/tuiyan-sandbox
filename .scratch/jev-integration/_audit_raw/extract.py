# -*- coding: utf-8 -*-
"""证据审计员：stdlib-only HTML -> 可见正文 抽取器。不装任何东西。
用法: py extract.py <in.html> [out.txt]
"""
import sys, re, html
from html.parser import HTMLParser

SKIP = {"script", "style", "noscript", "svg", "head", "template", "iframe"}
BLOCK = {"p","div","br","li","h1","h2","h3","h4","h5","h6","tr","td","th",
         "section","article","header","footer","nav","main","blockquote","pre","ul","ol","dt","dd"}

class T(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0
        self.title = ""
        self._intitle = False

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t in SKIP:
            self.skip += 1
        if t == "title":
            self._intitle = True
        if t in BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t in SKIP:
            self.skip = max(0, self.skip - 1)
        if t == "title":
            self._intitle = False
        if t in BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if self._intitle:
            self.title += data
        if self.skip:
            return
        self.out.append(data)

def clean(raw):
    p = T()
    p.feed(raw)
    txt = "".join(p.out)
    txt = html.unescape(txt)
    txt = txt.replace("\u00a0", " ")
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in txt.split("\n")]
    res = []
    for l in lines:
        if not l:
            if res and res[-1] != "":
                res.append("")
            continue
        res.append(l)
    return p.title.strip(), "\n".join(res).strip()

if __name__ == "__main__":
    src = sys.argv[1]
    with open(src, "rb") as f:
        raw = f.read().decode("utf-8", "replace")
    title, body = clean(raw)
    out = "TITLE: %s\n\n%s\n" % (title, body)
    if len(sys.argv) > 2:
        with open(sys.argv[2], "w", encoding="utf-8") as f:
            f.write(out)
        print("wrote %s  title=%r  chars=%d" % (sys.argv[2], title, len(body)))
    else:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        print(out)
