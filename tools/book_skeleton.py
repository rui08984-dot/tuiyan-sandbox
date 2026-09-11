import re, os
SRC = r"E:\music player\skills\horror-teller\samples\道听途说_书全文.txt"
OUT = r"E:\music player\skills\horror-teller\samples\书稿骨架.md"
lines = open(SRC, encoding="utf-8").read().split("\n")
clean = [ln.rstrip() for ln in lines if not re.match(r"^\s*=====\s*\[第\d+页\]\s*=====$", ln)]
# 独立数字行：≤60 视为章节标记，>60 视为书页码
marks = []
for i, ln in enumerate(clean):
    s = ln.strip()
    if re.fullmatch(r"\d{1,2}", s) and int(s) <= 60:
        marks.append((int(s), i))
# 去重相邻（同章号可能因换页重复）
dedup = []
for num, i in marks:
    if dedup and i - dedup[-1][1] < 8 and num == dedup[-1][0]:
        continue
    dedup.append((num, i))
out = ["# 书稿骨架（程序化提取）", "", f"总行数 {len(clean)}，检出章节标记 {len(dedup)} 个", ""]
for k, (num, i) in enumerate(dedup):
    end = dedup[k + 1][1] if k + 1 < len(dedup) else len(clean)
    span = [x for x in clean[i + 1:end] if x.strip()]
    chars = sum(len(x.strip()) for x in span)
    head = [x.strip() for x in span[:10]]
    tail = [x.strip() for x in span[-8:]]
    out.append(f"## 章节 {num}（第{k+1}个单元，~{chars} 字）")
    out.append("**开头：**" + " / ".join(head))
    out.append("**结尾：**" + " / ".join(tail))
    out.append("")
open(OUT, "w", encoding="utf-8").write("\n".join(out))
print("sections:", len(dedup))
print("outline:", [num for num, _ in dedup])
