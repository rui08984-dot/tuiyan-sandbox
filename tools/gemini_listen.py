# -*- coding: utf-8 -*-
"""Gemini 听歌识词：wav → mp3 → GMI Gemini → 歌词转写+大意+起名"""
import sys, os, json, base64, subprocess, urllib.request
from pathlib import Path

FF = r'C:/Users/crx/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-N-125365-g9a01c1cb6a-win64-gpl/bin/ffmpeg.exe'
KEY = os.environ.get('GMI_API_KEY') or Path(r'C:/Users/crx/.gmi_key').read_text().strip()

def listen(wav_path, name):
    mp3 = Path(wav_path).with_suffix('.mp3')
    if not mp3.exists():
        subprocess.run([FF, '-y', '-i', wav_path, '-b:a', '128k', str(mp3)],
                       capture_output=True, check=True)
    b64 = base64.b64encode(mp3.read_bytes()).decode()
    body = {
        'model': 'google/gemini-3.7-flash',
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text':
             '这是一首 AI 生成的歌（可能是英文或中文演唱）。请：1) 尽量逐句转写你听到的歌词（原文语言）；'
             '2) 用中文两三句话说明这首歌在讲什么；3) 起三个贴合意境的歌名（中英不限）。'
             '如果某些句子听不清就标注[听不清]，不要编造。'},
            {'type': 'input_audio', 'input_audio': {'data': b64, 'format': 'mp3'}}]}],
        'max_tokens': 2000,
    }
    req = urllib.request.Request(
        'https://api.gmi-serving.com/v1/chat/completions',
        data=json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'})
    proxy = urllib.request.ProxyHandler({'https': 'http://127.0.0.1:2080', 'http': 'http://127.0.0.1:2080'})
    opener = urllib.request.build_opener(proxy)
    r = json.loads(opener.open(req, timeout=300).read())
    return r['choices'][0]['message']['content']

if __name__ == '__main__':
    for wav, label in [
        (r'D:/audio-models/apollo-test/t2_slowbrew_restored.wav', 't2 Slow Brew'),
        (r'D:/audio-models/apollo-test/t3_midnight_restored.wav', 't3 午夜镜像'),
        (r'D:/audio-models/apollo-test/t5_no2_restored.wav', 't5'),
    ]:
        print(f'\n{"="*20} {label} {"="*20}')
        try:
            print(listen(wav, label))
        except Exception as e:
            print('失败:', e)
