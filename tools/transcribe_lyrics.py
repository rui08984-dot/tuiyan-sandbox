# -*- coding: utf-8 -*-
"""歌词转写管线：faster-whisper large-v3 (CPU) 转写 → MiniMax-M3 概括大意+起名"""
import os, sys, json, time, urllib.request
from pathlib import Path

os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
KEY = os.environ.get('GMI_API_KEY')

SONGS = [
    (r'D:/audio-models/apollo-test/t2_slowbrew_restored.wav', 't2 Slow Brew State of Mind'),
    (r'D:/audio-models/apollo-test/t3_midnight_restored.wav', 't3 午夜镜像 Midnight Mirror'),
    (r'D:/audio-models/apollo-test/t5_no2_restored.wav', 't5 未命名'),
]
OUT = Path(r'E:/music player/lyrics_transcribed')
OUT.mkdir(parents=True, exist_ok=True)

def m3(prompt):
    body = {'model': 'MiniMaxAI/MiniMax-M3', 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': 800}
    req = urllib.request.Request('https://api.gmi-serving.com/v1/chat/completions',
        data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    proxy = urllib.request.ProxyHandler({'https': 'http://127.0.0.1:2080'})
    r = json.loads(urllib.request.build_opener(proxy).open(req, timeout=300).read())
    return r['choices'][0]['message']['content']

def main():
    from faster_whisper import WhisperModel
    print('装载 large-v3 (CPU int8)...', flush=True)
    m = WhisperModel('large-v3', device='cpu', compute_type='int8', cpu_threads=16)
    results = {}
    for wav, label in SONGS:
        p = Path(wav)
        if not p.exists():
            print(f'跳过（缺文件）: {label}')
            continue
        t0 = time.time()
        segs, info = m.transcribe(str(p), language=None, vad_filter=True, beam_size=5)
        lines = []
        for s in segs:
            lines.append(f'[{int(s.start)//60:02d}:{int(s.start)%60:02d}] {s.text.strip()}')
        text = '\n'.join(lines)
        (OUT / f'{p.stem}_转写.txt').write_text(text, encoding='utf-8')
        print(f'\n===== {label}（{time.time()-t0:.0f}s 转写完成，语言判定 {info.language}）=====', flush=True)
        print(text[:1500], flush=True)
        results[label] = text
    # M3 概括+起名
    print('\n===== MiniMax-M3 概括与起名 =====', flush=True)
    for label, text in results.items():
        try:
            r = m3(f'以下是某首歌的歌词转写（可能有少量识别错误）。请用中文两三句概括这首歌在讲什么，'
                   f'并起三个贴合意境的歌名（中英不限）。歌词：\n{text[:3000]}')
            print(f'\n--- {label} ---\n{r}', flush=True)
        except Exception as e:
            print(f'{label} M3 失败: {e}', flush=True)

if __name__ == '__main__':
    main()
