"""Reproducible original app icons. Requires Pillow; not needed to run the app."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent
size = 1536
image = Image.new('RGB', (size, size))
pixels = image.load()
for y in range(size):
    for x in range(size):
        t = (x + y) / (size * 2)
        pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip((56, 85, 125), (103, 136, 178)))
d = ImageDraw.Draw(image)
def line(points):
    pts = [(round(x * 3), round(y * 3)) for x, y in points]
    d.line(pts, fill='white', width=20 * 3, joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x-30, y-30, x+30, y+30), fill='white')
# Deliberately keep the glyph within the maskable safe circle.
line([(356, 194), (165, 194)])
d.arc((135*3, 142*3, 187*3, 194*3), 90, 270, fill='white', width=60)
line([(161, 142), (336, 142), (336, 184)])
line([(135, 169), (135, 352), (356, 352), (356, 194)])
line([(356, 253), (288, 253), (288, 303), (356, 303)])
d.ellipse((311*3, 273*3, 321*3, 283*3), fill='white')
for name, width in [('icon-192.png', 192), ('icon-512.png', 512), ('maskable-512.png', 512), ('apple-touch-icon.png', 180)]:
    image.resize((width, width), Image.Resampling.LANCZOS).save(root / name)
