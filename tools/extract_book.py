import sys, os
from pypdf import PdfReader

SRC = r"C:\Users\crx\Desktop\道听途说 (何金银) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
OUT = r"E:\music player\skills\horror-teller\samples\道听途说_书全文.txt"

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    r = PdfReader(SRC)
    n = len(r.pages)
    print("pages:", n, flush=True)
    if mode == "probe":
        for i in range(min(5, n)):
            t = (r.pages[i].extract_text() or "").strip()
            print(f"--- p{i+1} ({len(t)} chars) ---")
            print(t[:180].replace("\n", " "))
    else:
        total = 0
        with open(OUT, "w", encoding="utf-8") as f:
            for i, pg in enumerate(r.pages):
                try:
                    t = pg.extract_text() or ""
                except Exception:
                    t = ""
                total += len(t)
                f.write(f"\n===== [第{i+1}页] =====\n{t}\n")
                if (i + 1) % 50 == 0:
                    print(f"page {i+1}/{n} done, chars={total}", flush=True)
        print("DONE total_chars:", total, "avg/page:", total // max(n, 1), flush=True)

if __name__ == "__main__":
    main()
