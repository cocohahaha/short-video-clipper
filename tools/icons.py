"""Original geometric bookmark/download icon. Pillow is needed only to regenerate."""
from pathlib import Path
from PIL import Image, ImageDraw
root=Path(__file__).resolve().parent.parent/'icons'
for size in (16,32,48,128):
    k=4;s=size*k
    im=Image.new('RGBA',(s,s),(0,0,0,0));d=ImageDraw.Draw(im)
    def box(a):return tuple(int(v*s) for v in a)
    d.rounded_rectangle(box((.02,.02,.98,.98)),radius=int(s*.23),fill='#294f3c')
    d.polygon([(s*.30,s*.18),(s*.70,s*.18),(s*.70,s*.80),(s*.5,s*.67),(s*.30,s*.80)],fill='#eff5e8')
    d.line([(s*.5,s*.30),(s*.5,s*.53)],fill='#294f3c',width=max(2,int(s*.055)))
    d.line([(s*.40,s*.44),(s*.5,s*.54),(s*.60,s*.44)],fill='#294f3c',width=max(2,int(s*.055)))
    im.resize((size,size),Image.Resampling.LANCZOS).save(root/f'icon{size}.png')
print('4 PNG icons generated')
