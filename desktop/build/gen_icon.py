"""生成 Wallet 桌面应用图标：build/appicon.png + build/windows/icon.ico"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 1024
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 深色圆角底
d.rounded_rectangle([32, 32, SIZE - 32, SIZE - 32], radius=200, fill=(15, 23, 42, 255))

# 钱包主体（蓝色圆角矩形）
wallet = [192, 320, 832, 784]
d.rounded_rectangle(wallet, radius=72, fill=(59, 130, 246, 255))

# 钱包上盖（更深一档，制造层次）
d.rounded_rectangle([192, 320, 832, 448], radius=64, fill=(37, 99, 235, 255))

# 右侧卡扣底座
d.rounded_rectangle([640, 500, 832, 656], radius=56, fill=(30, 58, 138, 255))
# 卡扣圆点
d.ellipse([688, 532, 784, 628], fill=(241, 245, 249, 255))

# 顶部露出的"纸币"
d.rounded_rectangle([288, 240, 736, 336], radius=48, fill=(245, 158, 11, 255))
d.rounded_rectangle([336, 288, 688, 384], radius=40, fill=(252, 211, 77, 255))

# ¥ 符号
font = None
for name in ("msyhbd.ttc", "arialbd.ttf", "arial.ttf"):
    p = os.path.join(r"C:\Windows\Fonts", name)
    if os.path.exists(p):
        try:
            font = ImageFont.truetype(p, 260)
            break
        except OSError:
            continue
if font is not None:
    d.text((412, 470), "¥", font=font, fill=(255, 255, 255, 255), anchor="mm")

img.save(os.path.join(OUT_DIR, "appicon.png"))

# 多尺寸 ico
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
img.save(os.path.join(OUT_DIR, "windows", "icon.ico"), sizes=ico_sizes)
print("icon generated: appicon.png + windows/icon.ico")
