# -*- coding: utf-8 -*-
"""证据充分性审判员 · 只读抽查探针（零写库、零安装、零网络外部请求）
A 本机推理栈现状（onnxruntime / torch / transformers）
B 账本 predictions 的输入侧可用性（题面是否存在、语言、长度分布）—— 这是阶段1/2 都没测的一格
C e2-combo-precheck 读数件关键字段（cohort_rows / 引擎对 / rho）
D 负结果账本里最贴近「文本读取型概率源」的条目原文
所有读取：sqlite mode=ro；json 只读。"""
import json, sqlite3, sys, os, importlib.util
from pathlib import Path

ROOT = Path(r"E:\music player")
print("py =", sys.version.split()[0])
print()
print("== A. 本机推理栈（只测量） ==")
for m in ["torch", "onnxruntime", "transformers", "numpy", "safetensors", "tokenizers", "huggingface_hub"]:
    try:
        found = importlib.util.find_spec(m) is not None
    except Exception as e:
        found = "ERR:%s" % e
    print("  %-16s spec_found=%s" % (m, found))
try:
    import onnxruntime as ort
    print("  onnxruntime %s providers=%s" % (ort.__version__, ort.get_available_providers()))
except Exception as e:
    print("  onnxruntime import FAILED:", e)
try:
    import transformers as tf
    print("  transformers %s is_torch_available=%s" % (tf.__version__, tf.utils.is_torch_available()))
except Exception as e:
    print("  transformers import FAILED:", e)

print()
print("== B. 账本输入侧可用性（sqlite mode=ro） ==")
db = ROOT / "p1a-terminal" / "data" / "p1a.db"
print("  db exists =", db.exists(), "size =", db.stat().st_size if db.exists() else None)
uri = db.resolve().as_uri() + "?mode=ro"
con = sqlite3.connect(uri, uri=True)
cur = con.cursor()
cols = [r[1] for r in cur.execute("PRAGMA table_info(predictions)")]
print("  predictions columns =", cols)
def q(sql, args=()):
    try:
        return list(cur.execute(sql, args))
    except Exception as e:
        return [("ERR", str(e))]
print("  total rows =", q("SELECT COUNT(*) FROM predictions")[0])
print("  by g2_regime =", q("SELECT g2_regime, COUNT(*) FROM predictions GROUP BY g2_regime"))
print("  by layer (R4) =", q("SELECT layer, COUNT(*) FROM predictions WHERE g2_regime='R4' GROUP BY layer"))
# 题面字段候选：statement / text / question ...
cand = [c for c in cols if any(k in c.lower() for k in ("statement", "question", "text", "prompt", "title"))]
print("  statement-like columns =", cand)
for c in cand:
    r = q("SELECT COUNT(*) FROM predictions WHERE g2_regime='R4' AND %s IS NOT NULL AND TRIM(%s)<>''" % (c, c))[0]
    print("    non-empty %s (R4) = %s" % (c, r))
# 抽样看内容与长度（这是本次唯一没被人测过的一格）
for c in cand:
    rows = q("SELECT id, layer, LENGTH(%s), SUBSTR(%s,1,160) FROM predictions WHERE g2_regime='R4' AND %s IS NOT NULL AND TRIM(%s)<>'' LIMIT 4" % (c, c, c, c))
    print("    --- sample %s ---" % c)
    for r in rows:
        print("      ", r)
    st = q("SELECT COUNT(*), MIN(LENGTH(%s)), AVG(LENGTH(%s)), MAX(LENGTH(%s)) FROM predictions WHERE g2_regime='R4' AND %s IS NOT NULL AND TRIM(%s)<>''" % (c, c, c, c, c))
    print("      len stats(n,min,avg,max) =", st)
# 分域口径：game_type / domain 字段
gt = [c for c in cols if "game" in c.lower() or "domain" in c.lower() or "kind" in c.lower()]
print("  domain-like columns =", gt)

print()
print("== C. e2-combo-precheck 读数件关键字段 ==")
p = ROOT / "p1b" / "sim" / "out" / "e2-combo-precheck-20260920.json"
if not p.exists():
    print("  MISSING:", p)
else:
    d = json.loads(p.read_text(encoding="utf-8"))
    print("  top keys =", list(d.keys()))
    hits = []
    def walk(o, path=""):
        if isinstance(o, dict):
            for k, v in o.items():
                walk(v, path + "/" + str(k))
        elif isinstance(o, list):
            if o and not isinstance(o[0], (dict, list)):
                hits.append((path, o))
            else:
                for i, v in enumerate(o[:6]):
                    walk(v, path + "[%d]" % i)
        else:
            low = path.lower()
            if any(k in low for k in ("rho", "cohort", "population", "kill", "identical")):
                hits.append((path, o))
    walk(d)
    for path, v in hits[:60]:
        print("   ", path, "=", v)

print()
print("== D. 负结果账本：最贴近「文本读取型概率源」的条目原文 ==")
led = ROOT / "p1b" / "sim" / "out" / "negative-results-ledger-20260920.json"
if not led.exists():
    print("  MISSING:", led)
else:
    L = json.loads(led.read_text(encoding="utf-8"))
    byid = {}
    def collect(o):
        if isinstance(o, dict):
            if "id" in o and isinstance(o.get("id"), str):
                byid[o["id"]] = o
            for v in o.values():
                collect(v)
        elif isinstance(o, list):
            for v in o:
                collect(v)
    collect(L)
    print("  ids =", sorted(byid.keys()))
    for i in ["H1", "H2", "H7", "H8", "D1", "D4"]:
        e = byid.get(i)
        if e:
            s = json.dumps(e, ensure_ascii=False)
            print("  --- %s ---" % i)
            print("     ", s[:700])
con.close()
