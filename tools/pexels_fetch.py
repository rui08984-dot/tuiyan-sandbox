# -*- coding: utf-8 -*-
"""pexels_fetch — 电台封面/MV 背景素材工具（Pexels 免费商用库）
用法：
  pexels_fetch.py photo "blue hour city skyline" --n 4 --out <目录> [--orient landscape|portrait|square]
  pexels_fetch.py video "city night rain"      --n 3 --out <目录>
行为：按主题搜索 → 下载最优规格 → 打印下载清单（含摄影师署名，建议简介致谢）。
key 读同目录 pexels_key.txt。200 次/小时，日更足够。
"""
import sys, json, argparse, urllib.request, urllib.parse
from pathlib import Path

KEY_FILE = Path(__file__).parent / 'pexels_key.txt'
UA = {'Authorization': KEY_FILE.read_text(encoding='utf-8').strip(),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

def api(url):
    req = urllib.request.Request(url, headers=UA)
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def dl(url, path):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
        f.write(r.read())

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['photo', 'video'])
    ap.add_argument('query')
    ap.add_argument('--n', type=int, default=4)
    ap.add_argument('--out', default='.')
    ap.add_argument('--pick', type=int, default=0, help='只下载第 N 条候选（0=全部）')
    ap.add_argument('--orient', default='landscape', choices=['landscape', 'portrait', 'square'])
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    q = urllib.parse.quote(a.query)

    if a.kind == 'photo':
        url = f'https://api.pexels.com/v1/search?query={q}&per_page={a.n}&orientation={a.orient}'
        data = api(url)
        for i, p in enumerate(data.get('photos', []), 1):
            src = p['src']['original']
            ext = '.jpg'
            f = out / f'photo_{i:02d}_{p["id"]}{ext}'
            dl(src, str(f))
            print(f"[{i}] {f.name}  {p['width']}x{p['height']}  by {p['photographer']}")
            print(f"    主色 {p.get('avg_color','?')}  页面 {p['url']}")
    else:
        url = f'https://api.pexels.com/videos/search?query={q}&per_page={a.n}&orientation=landscape'
        data = api(url)
        for i, v in enumerate(data.get('videos', []), 1):
            if a.pick and i != a.pick:
                continue
            files = [f for f in v['video_files'] if f.get('width') and f['width'] >= 1920 and f['file_type'] == 'video/mp4']
            files.sort(key=lambda x: x['width'], reverse=True)
            if not files:
                files = sorted(v['video_files'], key=lambda x: (x.get('width') or 0), reverse=True)[:1]
            best = files[0]
            f = out / f'video_{i:02d}_{v["id"]}.mp4'
            dl(best['link'], str(f))
            print(f"[{i}] {f.name}  {best['width']}x{best['height']}  {v['duration']}s  by {v['user']['name']}")

if __name__ == '__main__':
    main()
