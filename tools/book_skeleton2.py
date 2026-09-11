import re
SRC = r"E:\music player\skills\horror-teller\samples\道听途说_书全文.txt"
OUT = r"E:\music player\skills\horror-teller\samples\书稿骨架.md"
lines = open(SRC, encoding="utf-8").read().split("\n")
clean = [ln.rstrip() for ln in lines if not re.match(r"^\s*=====\s*\[第\d+页\]\s*=====$", ln)]
marks = []
for i, ln in enumerate(clean):
    s = ln.strip()
    if re.fullmatch(r"\d{1,2}", s) and int(s) <= 60:
        marks.append((int(s), i))
dedup = []
for num, i in marks:
    if dedup and i - dedup[-1][1] < 8 and num == dedup[-1][0]:
        continue
    dedup.append((num, i))
# 按重置回1分组成故事
stories = []
for num, i in dedup:
    if num == 1 or not stories:
        stories.append([])
    stories[-1].append((num, i))
out = ["# 书稿骨架 v2（按故事分组）", "", f"检出故事 {len(stories)} 个", ""]
for k, grp in enumerate(stories):
    start = grp[0][1]
    end = dedup[dedup.index(grp[-1]) + 1][1] if dedup.index(grp[-1]) + 1 < len(dedup) else len(clean)
    span = [x.strip() for x in clean[start + 1:end] if x.strip() and not re.fullmatch(r"\d{1,2}", x.strip())]
    chars = sum(len(x) for x in span)
    out.append(f"## 故事{k+1}（小节 {[n for n,_ in grp]}，约 {chars} 字）")
    out.append("**开场：** " + " / ".join(span[:12]))
    out.append("**收束：** " + " / ".join(span[-10:]))
    out.append("")
open(OUT, "w", encoding="utf-8").write("\n".join(out))
print("stories:", len(stories))
print("sizes:", [sum(len(x.strip()) for x in clean[g[0][1]+1:(dedup[dedup.index(g[-1])+1][1] if dedup.index(g[-1])+1 < len(dedup) else len(clean))]) for g in stories])
