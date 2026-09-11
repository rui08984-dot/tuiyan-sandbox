import fitz, sys
SRC = r"C:\Users\crx\Desktop\道听途说 (何金银) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
OUT = r"E:\music player\skills\horror-teller\samples\道听途说_书全文.txt"
d = fitz.open(SRC)
total = 0
with open(OUT, "w", encoding="utf-8") as fo:
    for i, pg in enumerate(d):
        t = pg.get_text().strip()
        total += len(t)
        fo.write(f"\n===== [第{i+1}页] =====\n{t}\n")
print("DONE pages:", len(d), "chars:", total)
