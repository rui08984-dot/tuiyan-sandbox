import sys, json
import zstandard as zstd

path = sys.argv[1]
mode = sys.argv[2] if len(sys.argv) > 2 else 'all'
dctx = zstd.ZstdDecompressor()
with open(path, 'rb') as fh:
    text = dctx.stream_reader(fh).read().decode('utf-8', errors='replace')
lines = [l for l in text.split('\n') if l.strip()]

def get_content(o):
    d = o.get('data', {})
    m = d.get('message', d)
    c = m.get('content', m.get('text', ''))
    if isinstance(c, list):
        parts = []
        for x in c:
            if isinstance(x, dict):
                if 'text' in x: parts.append(x['text'])
                elif x.get('type') == 'tool_use': parts.append(f"[tool_use:{x.get('name')}] {json.dumps(x.get('input',{}),ensure_ascii=False)[:300]}")
                elif x.get('type') == 'tool_result':
                    rc = x.get('content','')
                    if isinstance(rc, list): rc = ' '.join(str(y.get('text',''))[:150] if isinstance(y,dict) else str(y)[:150] for y in rc)
                    parts.append(f"[tool_result] {str(rc)[:200]}")
                else: parts.append(json.dumps(x, ensure_ascii=False)[:100])
            else: parts.append(str(x))
        return ' '.join(parts)
    return str(c)

if mode == 'timeline':
    for i, l in enumerate(lines):
        try: o = json.loads(l)
        except: continue
        t = o.get('type','?')
        ts = o.get('time','')
        d = o.get('data',{})
        if t == 'user/message':
            print(f"#{i} [{t}] {ts}: {get_content(o)[:500]}")
        elif t == 'assistant/message':
            print(f"#{i} [{t}] {ts}: {get_content(o)[:400]}")
        elif t == 'tool/call':
            print(f"#{i} [{t}] {ts}: {d.get('name','?')} args={json.dumps(d.get('arguments',d.get('input',{})),ensure_ascii=False)[:250]}")
        elif t == 'tool/result':
            print(f"#{i} [{t}] {ts}: {str(d)[:200]}")
        elif t == 'subagent/catalog':
            print(f"#{i} [{t}] {ts}: {json.dumps(d, ensure_ascii=False)[:300]}")
        elif t in ('turn/start','turn/end'):
            print(f"#{i} [{t}] {ts}: {json.dumps(d.get('reason', d), ensure_ascii=False)[:120]}")
        elif t == 'system/message':
            print(f"#{i} [{t}] {ts}: {str(d)[:300]}")
elif mode == 'full':
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    for i, l in enumerate(lines[start:], start):
        try: o = json.loads(l)
        except: print(f"#{i} RAW: {l[:200]}"); continue
        t = o.get('type','?'); ts = o.get('time','')
        print(f"#{i} [{t}] {ts}: {get_content(o)[:700] if t in ('user/message','assistant/message') else json.dumps(o.get('data',{}),ensure_ascii=False)[:400]}")
