import json
import zstandard as zstd
path = "C:/Users/crx/.dsh/sessions/--E-music~0020player--/b722d5da-64aa-443f-b6cb-8570df14b86e/session.v3.jsonl.zstd"
dctx = zstd.ZstdDecompressor()
with open(path, 'rb') as fh:
    text = dctx.stream_reader(fh).read().decode('utf-8', errors='replace')
lines = [l for l in text.split('\n') if l.strip()]
print(f"TOTAL={len(lines)}")
for l in lines[-6:]:
    o = json.loads(l)
    t = o.get('type','?'); ts = o.get('time',''); d = o.get('data',{})
    print(f"[{t}] {ts}: {json.dumps(d, ensure_ascii=False)[:500]}")
