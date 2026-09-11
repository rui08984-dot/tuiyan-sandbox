# -*- coding: utf-8 -*-
"""候选预览工具：按位置搜候选，只下载预览图（快），用户确认后再下正片视频。
用法：pexels_preview.py <位置名> "<搜索词>" [候选数]
输出：E:/music player/assets/candidates/<位置名>/p1.jpg p2.jpg... + 清单
"""
import sys, json, urllib.request, urllib.parse
from pathlib import Path

KEY = (Path(__file__).parent / 'pexels_key.txt').read_text(encoding='utf-8').strip()
HDR = {'Authorization': KEY, 'User-Agent': 'Mozilla/5.0'}
OUTROOT = Path(r'E:/music player/assets/candidates')

pos, query = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 3
out = OUTROOT / pos
out.mkdir(parents=True, exist_ok=True)

url = f'https://api.pexels.com/videos/search?query={urllib.parse.quote(query)}&per_page={n}&orientation=landscape'
data = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=HDR), timeout=30).read())

lines = []
for i, v in enumerate(data.get('videos', []), 1):
    jpg = out / f'c{i}_preview.jpg'
    req = urllib.request.Request(v['image'], headers={'User-Agent': 'Mozilla/5.0'})
    jpg.write_bytes(urllib.request.urlopen(req, timeout=30).read())
    files = sorted(v['video_files'], key=lambda x: (x.get('width') or 0), reverse=True)
    best = files[0] if files else {}
    lines.append(f"c{i}  {best.get('width')}x{best.get('height')}  {v['duration']}s  by {v['user']['name']}")
    lines.append(f"    主题: {v.get('url','')}")
(OUTROOT / f'候选清单_{pos}.txt').write_text('\n'.join(lines), encoding='utf-8')
print(f'{pos}: {n} 张候选预览已存 {out}')
print('\n'.join(lines))
