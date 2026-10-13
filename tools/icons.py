"""Cut the toolbar/store icons from art/icon-master.png (a Codex-generated
frosted-glass tile, background removed). Pillow is needed only to regenerate."""
from pathlib import Path
from PIL import Image, ImageFilter
root = Path(__file__).resolve().parent.parent
master = Image.open(root / 'art' / 'icon-master.png').convert('RGBA')
# size -> tile size inside the square canvas (128 keeps Chrome's suggested padding)
for size, tile in ((16, 16), (32, 30), (48, 44), (128, 112)):
    art = master.resize((tile, tile), Image.Resampling.LANCZOS)
    if size <= 48:
        art = art.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset = (size - tile) // 2
    canvas.alpha_composite(art, (offset, offset))
    canvas.save(root / 'icons' / f'icon{size}.png', optimize=True)
print('4 PNG icons generated')
