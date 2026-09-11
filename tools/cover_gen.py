# -*- coding: utf-8 -*-
"""封面生成器 v2（EP01 v6 加粗版布局固化 + 底图自适应配色）
用法：
  python cover_gen.py --bg <底图> --out <输出.png> [--title MIDNIGHT] [--ep "EP.02 — The Lighthouse"]
      [--word RADIO] [--tagline "守塔人 · 雾航 · 顺序播放"]
      [--tracks "01 The Lighthouse Keeper;02 ..."] [--highlight 1]
      [--zoom 1.0] [--offset-x 0.5] [--offset-y 0.5] [--mode auto|dark|light]
布局参数量自 E:/music player/out/封面_EP01_v6_加粗.png（1920x1080）。
自适应：底图平均亮度决定文字亮/暗色系；所有文字带柔和阴影，亮暗底图都可读。
字体纪律：歌单用 Playfair Regular（v6 原版字重），CJK 回退思源宋（衬线统一+含日文）。
"""
import argparse
from PIL import Image, ImageDraw, ImageFont

F_B = r"E:/music player/assets/fonts/PlayfairDisplay-Bold.ttf"
F_R = r"E:/music player/assets/fonts/PlayfairDisplay.ttf"
F_CN = r"E:/music player/assets/fonts/NotoSerifSC.ttf"   # CJK 回退：思源宋（衬线统一+含日文）
F_CN_TAG = r"E:/music player/assets/fonts/LXGWWenKai-Medium.ttf"  # 底部中文行
W, H = 1920, 1080  # 16:9 主封面；首页推荐 4:3 用 --width 1440 --height 1080 --no-list

DARK = dict(title=(242, 237, 227), ep=(200, 182, 150), tag=(242, 237, 227),
            on=(245, 242, 235), dim=(138, 130, 118), shadow=(0, 0, 0, 140))
LIGHT = dict(title=(26, 31, 46), ep=(94, 76, 52), tag=(26, 31, 46),
             on=(15, 18, 30), dim=(96, 92, 84), shadow=(255, 255, 255, 160))

def fit_cover(img, w, h, zoom=1.0, ox=0.5, oy=0.5):
    r = max(w / img.width, h / img.height) * zoom
    img = img.resize((int(img.width * r) + 1, int(img.height * r) + 1), Image.LANCZOS)
    x = int((img.width - w) * ox); y = int((img.height - h) * oy)
    return img.crop((x, y, x + w, y + h))

def mixed_text(layer, xy, text, font_lat, font_cjk, fill, shadow=None):
    """逐字符绘制：拉丁用 Playfair，CJK 回退思源宋；shadow=(dx,dy,rgba) 可选"""
    x, y = xy
    for ch in text:
        ft = font_lat if ord(ch) < 0x2E80 else font_cjk
        if shadow:
            dx, dy, rgba = shadow
            layer.text((x + dx, y + dy), ch, font=ft, fill=rgba)
        layer.text((x, y), ch, font=ft, fill=fill)
        x += layer.textlength(ch, font=ft)

def spaced(layer, xy, text, font, fill, extra, shadow=None):
    x, y = xy
    for ch in text:
        if shadow:
            dx, dy, rgba = shadow
            layer.text((x + dx, y + dy), ch, font=font, fill=rgba)
        layer.text((x, y), ch, font=font, fill=fill)
        x += layer.textlength(ch, font=font) + extra

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bg', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--title', default='MIDNIGHT')
    ap.add_argument('--ep', default='EP.01 — Blue Hour')
    ap.add_argument('--word', default='RADIO')
    ap.add_argument('--tagline', default='爵士 · 福音 · City Pop · 顺序播放')
    ap.add_argument('--tracks', default='01 Slow Dance;02 The Last Box;03 Café Reverie;04 Bend The Blues;05 Wilderness;06 Half Beat;07 Stand In The Light;08 Warm Snow')
    ap.add_argument('--highlight', type=int, default=1)
    ap.add_argument('--zoom', type=float, default=1.0)
    ap.add_argument('--offset-x', type=float, default=0.5)
    ap.add_argument('--offset-y', type=float, default=0.5)
    ap.add_argument('--mode', default='auto', choices=['auto', 'dark', 'light'])
    ap.add_argument('--width', type=int, default=1920)
    ap.add_argument('--height', type=int, default=1080)
    ap.add_argument('--no-list', action='store_true', help='省略右侧歌单（4:3 首页卡片用）')
    ap.add_argument('--preset', default='classic', choices=['classic', 'modern', 'serif', 'handwrite'],
                    help='classic=Playfair经典衬线 / modern=得意黑斜体现代 / serif=思源宋东方文人 / handwrite=霞鹜文楷手写')
    a = ap.parse_args()

    bg = Image.open(a.bg).convert('RGB')
    W, H = a.width, a.height
    img = fit_cover(bg, W, H, a.zoom, a.offset_x, a.offset_y)
    lum = sum(img.resize((32, 18)).convert('L').getdata()) / (32 * 18)
    mode = a.mode if a.mode != 'auto' else ('dark' if lum < 110 else 'light')
    C = DARK if mode == 'dark' else LIGHT

    ov = Image.new('RGB', (W, H), (8, 14, 18) if mode == 'dark' else (235, 238, 242))
    img = Image.blend(img, ov, 0.30 if mode == 'dark' else 0.22)
    base = img.convert('RGBA')
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    sh = (2, 3, C['shadow'])

    # 字体预设：classic=v6 原版（Playfair Bold+Regular/文楷中文行/思源宋 CJK 回退）
    #           modern=得意黑斜体（标题+歌单全换，深夜霓虹感）
    #           serif=思源宋全套（东方文人气质）
    #           handwrite=霞鹜文楷全套（手写温度）
    FB = r"E:/music player/assets/fonts/SmileySans-Oblique.ttf"
    FS = r"E:/music player/assets/fonts/NotoSerifSC.ttf"
    FH = r"E:/music player/assets/fonts/LXGWWenKai-Medium.ttf"
    if a.preset == 'modern':
        f_title = ImageFont.truetype(FB, 150); f_ep = ImageFont.truetype(FB, 44)
        f_word = ImageFont.truetype(FB, 96); f_tr = ImageFont.truetype(FB, 28)
        f_tr_cjk = ImageFont.truetype(FB, 28)
    elif a.preset == 'serif':
        f_title = ImageFont.truetype(FS, 150); f_ep = ImageFont.truetype(FS, 42)
        f_word = ImageFont.truetype(FS, 96); f_tr = ImageFont.truetype(FS, 28)
        f_tr_cjk = ImageFont.truetype(FS, 28)
    elif a.preset == 'handwrite':
        f_title = ImageFont.truetype(FH, 140); f_ep = ImageFont.truetype(FH, 42)
        f_word = ImageFont.truetype(FH, 96); f_tr = ImageFont.truetype(FH, 28)
        f_tr_cjk = ImageFont.truetype(FH, 28)
    else:  # classic
        f_title = ImageFont.truetype(F_B, 150); f_ep = ImageFont.truetype(F_B, 42)
        f_word = ImageFont.truetype(F_B, 96); f_tr = ImageFont.truetype(F_R, 28)
        f_tr_cjk = ImageFont.truetype(F_CN, 28)
    f_cn = ImageFont.truetype(F_CN_TAG, 36)

    spaced(d, (95, 100), a.title, f_title, C['title'], 0, sh)
    mixed_text(d, (97, 308), a.ep, f_ep, ImageFont.truetype(F_CN, 40), C['ep'], sh)
    spaced(d, (95, 745), a.word, f_word, C['title'], 40, sh)
    if a.preset == 'modern': f_cn_use = ImageFont.truetype(FB, 36)
    elif a.preset == 'serif': f_cn_use = ImageFont.truetype(FS, 36)
    elif a.preset == 'handwrite': f_cn_use = ImageFont.truetype(FH, 36)
    else: f_cn_use = f_cn
    mixed_text(d, (95, 928), a.tagline, f_cn_use, ImageFont.truetype(F_CN_TAG, 36), C['tag'], sh)

    if not a.no_list:
        tracks = [x.strip() for x in a.tracks.split(';') if x.strip()]
        tx = int(W * 0.762)  # 右侧歌单起始 x（随宽度自适应）
        ty = 560
        for i, tr in enumerate(tracks, 1):
            color = C['on'] if i == a.highlight else C['dim']
            mixed_text(d, (tx, ty), tr, f_tr, f_tr_cjk, color, sh)
            ty += 47
    img = Image.alpha_composite(base, layer).convert('RGB')
    img.save(a.out)
    print(f'saved: {a.out} (mode={mode}, lum={lum:.0f})')

if __name__ == '__main__':
    main()
