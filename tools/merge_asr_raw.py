# merge asr_worker.py --dump-raw JSON outputs into one timestamped transcript
# usage: python merge_asr_raw.py <out_txt> <seg_json> [<seg_json> ...]
# each seg adds idx*600s offset (10-min segments, matching asr_pipeline.ps1)
import json, sys, glob, os

def main():
    out_txt = sys.argv[1]
    segs = sys.argv[2:]
    parts = []
    total_chars = 0
    total_sent = 0
    spk_all = set()
    for idx, p in enumerate(segs):
        data = json.load(open(p, encoding="utf-8"))
        result = data[0] if isinstance(data, list) else data
        info = result.get("sentence_info") or []
        offset = idx * 600
        lines = ["### [%02d:%02d 起，10 分钟段]" % divmod(offset, 60)]
        for seg in info:
            t = (seg.get("text") or seg.get("sentence") or "").strip()
            if not t:
                continue
            spk = seg.get("spk")
            spk_all.add(spk)
            total_sent += 1
            total_chars += len(t)
            mm, ss = divmod(offset + seg.get("start", 0) / 1000.0, 60)
            lines.append("[%02d:%02d] spk%s: %s" % (int(mm) // 60 if False else int(mm), int(ss), spk if spk is not None else "?", t))
        parts.append("\n".join(lines))
    open(out_txt, "w", encoding="utf-8").write("\n\n".join(parts))
    print("MERGED segments=%d sentences=%d chars=%d speakers=%s out=%s (%d bytes)" % (
        len(segs), total_sent, total_chars, sorted(str(s) for s in spk_all), out_txt, os.path.getsize(out_txt)))

if __name__ == "__main__":
    main()
