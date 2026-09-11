import sys, json, collections
import zstandard as zstd

path = sys.argv[1]
dctx = zstd.ZstdDecompressor()
with open(path, 'rb') as fh:
    text = dctx.stream_reader(fh).read().decode('utf-8', errors='replace')
lines = [l for l in text.split('\n') if l.strip()]

types = collections.Counter()
for l in lines:
    try:
        o = json.loads(l)
        t = o.get('type', o.get('event', '?'))
        types[t] += 1
    except Exception:
        types['PARSE_ERR'] += 1
print("TYPE COUNTS:", dict(types))

# print first 3 and last 3 lines compactly
def show(l, maxlen=400):
    try:
        o = json.loads(l)
        return json.dumps(o, ensure_ascii=False)[:maxlen]
    except Exception:
        return l[:maxlen]

print("\n=== FIRST 3 ===")
for l in lines[:3]: print(show(l))
print("\n=== LAST 3 ===")
for l in lines[-3:]: print(show(l))

# user messages
print("\n=== USER MESSAGES (first 200 chars) ===")
for i, l in enumerate(lines):
    try:
        o = json.loads(l)
    except Exception: continue
    t = o.get('type', o.get('event', '?'))
    if t in ('user', 'message.user', 'user_message'):
        msg = o.get('message', o)
        c = msg.get('content', '')
        if isinstance(c, list):
            c = ' '.join(str(x.get('text', '')) if isinstance(x, dict) else str(x) for x in c)
        print(f"[line {i}] {str(c)[:200]}")
