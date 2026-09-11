# -*- coding: utf-8 -*-
"""深夜电台 EP.01 · 歌单合成：8 首音频串联 + 8 条主题背景 + 歌名字幕层"""
import subprocess, json
from pathlib import Path

FF = r'C:/Users/crx/AppData/Local/Microsoft/WinGet/Packages/yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-N-125365-g9a01c1cb6a-win64-gpl/bin/ffmpeg.exe'
FP = FF.replace('ffmpeg.exe', 'ffprobe.exe')
MP = Path(r'E:/music player')
NEW = Path(r'E:/ace-step/output/新歌三首-0901')
APX = Path(r'D:/audio-models/apollo-test')
OUT = MP / 'out'
BGD = MP / 'assets/bg_video'
PLAY = MP / 'assets/ep01'
PLAY.mkdir(parents=True, exist_ok=True)

SONGS = [
    ('Slow Dance',         NEW / '21v4_SlowDance_返场_seed1037707474.wav',           BGD / '01_slowdance/video_01_6079699.mp4'),
    ('The Last Box',       NEW / '16_TheLastBox_响度版.wav',                          BGD / '02_lastbox/video_01_4458918.mp4'),
    ('Café Reverie',       APX / 't2_slowbrew_restored.wav',                          BGD / '03_cafereverie/video_01_33938656.mp4'),
    ('Bend The Blues',     NEW / '19_BendTheBlues_母带版.wav',                        BGD / '04_blues/video_02_39163897.mp4'),
    ('幻觉的荒野',          APX / 't3_midnight_restored.wav',                          BGD / '05_synthwave/video_01_11868207.mp4'),
    ('ハーフビート',        NEW / '20_ハーフビート_日语CityPop_seed4118293766.wav',     MP / 'assets/covers/candidates/d_蓝调时刻人物/photo_03_7983546.jpg'),
    ('Stand In The Light', NEW / '22v2_StandInTheLight_v3_Gospel_seed1907403168.wav', BGD / '07_gospel/video_01_1299698.mp4'),
    ('雪落时的温热',        APX / 't5_no2_restored.wav',                               BGD / '06_citypop/video_01_4814151.mp4'),
]

def run(cmd, cwd=None):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if r.returncode != 0:
        print('FAIL:', ' '.join(str(x) for x in cmd[:6]), '...')
        print(r.stderr[-500:])
        sys_exit = True
        raise SystemExit(1)
    return r

def dur_of(p):
    r = subprocess.run([FP, '-v', 'error', '-show_entries', 'format=duration',
                        '-of', 'json', str(p)], capture_output=True, text=True)
    return float(json.loads(r.stdout)['format']['duration'])

# 1) 实测每首时长
total, marks = 0, []
for name, wav, bg in SONGS:
    d = dur_of(wav)
    marks.append((name, total, d, bg))
    total += d
    print(f'{int(total//60):02d}:{int(total%60):02d}  {name}  ({d:.1f}s)', flush=True)
print(f'总时长 {total:.0f}s = {total/60:.1f} 分钟', flush=True)

# 2) 音频串联（filter_complex concat——demuxer 版会把 wav 拼出错误时长）
n = len(SONGS)
inputs = []
for _, w, _ in SONGS:
    inputs += ['-i', str(w)]
fc = ';'.join(f'[{i}:a]aresample=44100,aformat=channel_layouts=stereo[a{i}]' for i in range(n))
fc += ';' + ''.join(f'[a{i}]' for i in range(n)) + f'concat=n={n}:v=0:a=1[a]'
run([FF, '-y', *inputs, '-filter_complex', fc, '-map', '[a]',
     '-c:a', 'pcm_s16le', str(PLAY / 'playlist.wav')])
print('音频串联完成', flush=True)

# 3) 背景逐条 loop 展开到歌长（统一 1080p crf20，供 c copy 拼接）
seg_files = []
for i, (name, t0, d, bg) in enumerate(marks):
    seg = PLAY / f'bg_{i:02d}.mp4'
    if seg.exists() and seg.stat().st_size > 100000:
        seg_files.append(seg)
        print(f'背景段 {i+1}/8 复用已有', flush=True)
        continue
    is_img = str(bg).lower().endswith(('.jpg', '.jpeg', '.png'))
    if is_img:  # v3：静图背景 = Ken Burns 极缓推近（先超采样 1440p 再缩，避免糊）
        vf = ('scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,setsar=1,'
              "zoompan=z='min(1.0+0.00025*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=25")
        run([FF, '-y', '-loglevel', 'error', '-loop', '1', '-i', str(bg), '-t', f'{d:.3f}',
             '-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-an', str(seg)])
    else:
        run([FF, '-y', '-stream_loop', '-1', '-i', str(bg), '-t', f'{d:.3f}',
             '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-an', str(seg)])
    seg_files.append(seg)
    print(f'背景段 {i+1}/8 完成', flush=True)
for s in seg_files: run([FF, '-y', '-loglevel', 'error', '-i', str(s), '-c', 'copy', '-f', 'mpegts', str(s.with_suffix('.ts'))])
tslist = PLAY / 'bts.txt'
tslist = PLAY / 'bts.txt'
tslist.write_text('\n'.join(f"file '{s.with_suffix('.ts').as_posix()}'" for s in seg_files), encoding='utf-8')
run([FF, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', str(tslist), '-c', 'copy', str(PLAY / 'bg_full.ts')])
run([FF, '-y', '-loglevel', 'error', '-i', str(PLAY / 'bg_full.ts'), '-c', 'copy', '-movflags', '+faststart', str(PLAY / 'bg_full.mp4')])
print('背景拼接完成(ts 法)', flush=True)

# 4) ASS：开场栏目大字 + 每段进歌报幕 + 右上角歌名切换 + 底部合规声明
def ts(sec):
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f'{h}:{m:02d}:{s:05.2f}'

ev = []
# 开场：栏目名 + 说明（前 12 秒，压在第一首画面上）
ev.append(f'Dialogue: 1,{ts(0.5)},{ts(11.5)},BigTitle,,0,0,0,,{{\\fad(1000,1200)}}MIDNIGHT RADIO · EP.01')
ev.append(f'Dialogue: 1,{ts(1.5)},{ts(11.5)},Sub,,0,0,0,,{{\\fad(1200,1200)}}深夜电台 · 顺序播放 · 戴上耳机')
for i, (name, t0, d, bg) in enumerate(marks):
    if i > 0:  # v2：开场片头期间不报幕（歌名走 Corner 常驻）
        ev.append(f'Dialogue: 0,{ts(t0+0.5)},{ts(t0+5.5)},NowTitle,,0,0,0,,{{\\fad(700,700)}}{name}')
    ev.append(f'Dialogue: 0,{ts(t0)},{ts(t0+d-0.3)},Corner,,0,0,0,,{{\\fad(800,400)\\alpha&H40&}}{name}')
decl_end = ts(total - 0.5)
ev.append(f'Dialogue: 0,{ts(0)},{decl_end},Decl,,0,0,0,,{{\\alpha&H60&\\fad(1500,1500)}}AI-generated music · original composition')

ass = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: BigTitle,Georgia,96,&H00F8F4EC,&H00000000,&H88000000,1,0,0,0,100,100,2,0,1,2.5,3,5,60,60,300,1
Style: Sub,Microsoft YaHei,38,&H00E8DCC8,&H00000000,&H88000000,0,0,0,0,100,100,2,0,1,1.5,2,5,60,60,180,1
Style: NowTitle,Georgia,74,&H00F8F4EC,&H00000000,&H88000000,1,0,0,0,100,100,1,0,1,2.5,3,5,60,60,320,1
Style: Corner,Georgia,28,&H00F8F4EC,&H00000000,&H64000000,1,0,0,0,100,100,3,0,1,1.5,1.5,9,40,40,40,1
Style: Decl,Microsoft YaHei,20,&H00C8C0B4,&H00000000,&H50000000,0,0,0,0,100,100,1,0,1,1,1,2,40,40,28,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
""" + '\n'.join(ev) + '\n'
(PLAY / 'ep01.ass').write_text(ass, encoding='utf-8-sig')
print('ASS 生成完成', flush=True)

# 5) 终合成（cwd=PLAY 避 filter 冒号坑；ass 必须挂在视频链上）
FINAL = OUT / 'EP01_深夜电台_29min.mp4'
run([FF, '-y', '-i', str(PLAY / 'bg_full.mp4'), '-i', str(PLAY / 'playlist.wav'),
     '-filter_complex', '[0:v]ass=ep01.ass[v]', '-map', '[v]', '-map', '1:a', '-shortest',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k',
     str(FINAL)], cwd=str(PLAY))
print(f'✅ 成品: {FINAL}', flush=True)