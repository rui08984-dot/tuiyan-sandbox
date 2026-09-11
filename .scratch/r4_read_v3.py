import sys, json
import zstandard as zstd

path = sys.argv[1]
tail_n = int(sys.argv[2]) if len(sys.argv) > 2 else 0

dctx = zstd.ZstdDecompressor()
lines = []
with open(path, 'rb') as fh:
    reader = dctx.stream_reader(fh)
    text = reader.read().decode('utf-8', errors='replace')
lines = [l for l in text.split('\n') if l.strip()]
print(f"TOTAL_LINES={len(lines)}")

def brief(l):
    try:
        o = json.loads(l)
    except Exception:
        return ("RAW", l[:200])
    t = o.get('type', o.get('event', '?'))
    ts = o.get('timestamp', o.get('ts', ''))
    keys = list(o.keys())
    return (t, ts, keys)

if tail_n > 0:
    for l in lines[-tail_n:]:
        t, ts, keys = brief(l)[:3] if len(brief(l)) == 3 else brief(l)
        print(f"--- [{t}] {ts}")
        print(l[:600])
