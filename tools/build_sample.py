# -*- coding: utf-8 -*-
"""单曲样片合成：16 TheLastBox × 深夜电台视觉框架 v1"""
import subprocess
from pathlib import Path

FF = r'C:/Users/crx/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-N-125365-g9a01c1cb6a-win64-gpl/bin/ffmpeg.exe'
MP = r'E:/music player'
BG = rf'{MP}/assets/bg_video/video_01_18757430.mp4'
AUDIO = r'E:/ace-step/output/新歌三首-0901/16_TheLastBox_响度版.wav'
OUT = rf'{MP}/out/样片_TheLastBox_EP01.mp4'
Path(rf'{MP}/out').mkdir(parents=True, exist_ok=True)

# ASS 字幕：框架三要素（开场大字 / 常驻角标 / 底部合规声明）
GEORGIA = r'C\:/Windows/Fonts/georgia.ttf'
MSYH = r'C\:/Windows/Fonts/msyh.ttc'
ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,Georgia,92,&H00F8F4EC,&H00000000,&H88000000,1,0,0,0,100,100,1,0,1,2.5,3,5,60,60,300,1
Style: SubT,Microsoft YaHei,40,&H00E8DCC8,&H00000000,&H88000000,0,0,0,0,100,100,2,0,1,1.5,2,5,60,60,190,1
Style: Badge,Georgia,30,&H00F8F4EC,&H00000000,&H64000000,1,0,0,0,100,100,3,0,1,1.5,1.5,9,40,40,40,1
Style: Decl,Microsoft YaHei,20,&H00C8C0B4,&H00000000,&H50000000,0,0,0,0,100,100,1,0,1,1,1,2,40,40,28,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.80,0:00:09.50,Title,,0,0,0,,{{\\fad(1200,1400)\\pos(960,420)}}The Last Box
Dialogue: 0,0:00:01.60,0:00:09.50,SubT,,0,0,0,,{{\\fad(1400,1400)\\pos(960,530)}}凌晨三点的心事 · 适合不开灯的房间
Dialogue: 0,0:00:03.00,0:17:56.00,Badge,,0,0,0,,{{\\alpha&H50&\\fad(1500,0)}}MIDNIGHT RADIO · EP.01
Dialogue: 0,0:00:03.00,0:17:56.00,Decl,,0,0,0,,{{\\alpha&H60&\\fad(1500,0)}}AI-generated music · original composition
"""
assp = Path(rf'{MP}/assets/sample_ep01.ass')
assp.write_text(ass, encoding='utf-8-sig')

cmd = [FF, '-y', '-stream_loop', '-1', '-i', BG, '-i', AUDIO,
       '-filter_complex', "[0:v]scale=1920:1080,setsar=1,ass=sample_ep01.ass[v]",
       '-map', '[v]', '-map', '1:a', '-shortest',
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
       '-c:a', 'aac', '-b:a', '192k', OUT]
r = subprocess.run(cmd, capture_output=True, text=True,
                   cwd=r'E:/music player/assets')  # cwd 相对路径绕开 filter 冒号转义
r = subprocess.run(cmd, capture_output=True, text=True)
print('ffmpeg exit:', r.returncode)
if r.returncode != 0:
    print(r.stderr[-800:])
else:
    import soundfile as sf
    print('输出:', OUT)
