from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
import math, random, shutil, zipfile

ROOT = Path('/mnt/data/RHO_PHASE12_TEST_ASSETS')
ASSET_ROOT = ROOT / 'client/src/assets/map/tiles/phase12'
if ROOT.exists(): shutil.rmtree(ROOT)

paths = {
    'soil': ASSET_ROOT / 'nature/soil-warm/base',
    'grass': ASSET_ROOT / 'nature/grass-warm/base',
    'grass_masks': ASSET_ROOT / 'nature/grass-warm/coverage',
    'flagstone': ASSET_ROOT / 'pavement/flagstone-warm/base',
    'flagstone_topology': ASSET_ROOT / 'pavement/flagstone-warm/topology',
    'water': ASSET_ROOT / 'water/cool/base',
}
for p in paths.values(): p.mkdir(parents=True, exist_ok=True)

SIZE = 256
SS = 2

def hexrgb(s):
    s=s.lstrip('#'); return tuple(int(s[i:i+2],16) for i in (0,2,4))

P = {
 'shadow_plum':hexrgb('#43273D'),'shadow_wine':hexrgb('#522C3E'),
 'moss_dark':hexrgb('#506248'),'moss_mid':hexrgb('#6C8253'),
 'grass_base':hexrgb('#748752'),'grass_light':hexrgb('#869057'),'grass_sun':hexrgb('#A2A176'),
 'earth_dark':hexrgb('#71454B'),'earth_base':hexrgb('#926E52'),'earth_light':hexrgb('#B8986E'),
 'stone_shadow':hexrgb('#776E79'),'stone_mid':hexrgb('#959B9C'),'stone_light':hexrgb('#ABA4B0'),
 'warm_highlight':hexrgb('#BFB168'),'water_deep':hexrgb('#454E91'),'water_base':hexrgb('#515C99'),'water_lift':hexrgb('#6E627C')
}

def periodic_field(size, seed, components):
    rr=random.Random(seed)
    y,x=np.mgrid[0:size,0:size].astype(np.float32)
    x/=size; y/=size
    f=np.zeros((size,size),np.float32)
    for _ in range(components):
        kx=rr.randint(1,8); ky=rr.randint(1,8); ph=rr.random()*math.tau
        amp=rr.uniform(.35,1.0)/math.sqrt(kx*kx+ky*ky)
        f += amp*np.sin(math.tau*(kx*x+ky*y)+ph)
    f=(f-f.min())/max(1e-6,float(f.max()-f.min()))
    return f

def palette_image(field, stops):
    stops=[(float(t),np.array(c,np.float32)) for t,c in stops]
    out=np.zeros((*field.shape,3),np.float32)
    for i in range(len(stops)-1):
        t0,c0=stops[i]; t1,c1=stops[i+1]
        sel=(field>=t0)&(field<=(t1 if i==len(stops)-2 else np.nextafter(t1,t0)))
        local=np.clip((field-t0)/max(1e-6,t1-t0),0,1)
        out[sel]=c0*(1-local[sel,None])+c1*local[sel,None]
    out[field<stops[0][0]]=stops[0][1]; out[field>stops[-1][0]]=stops[-1][1]
    return Image.fromarray(np.uint8(np.clip(out,0,255)),'RGB')

def wrapped_ellipse(draw, box, fill):
    x0,y0,x1,y1=box
    for ox in (-SIZE,0,SIZE):
      for oy in (-SIZE,0,SIZE):
        draw.ellipse((x0+ox,y0+oy,x1+ox,y1+oy),fill=fill)

def wrapped_line(draw, pts, fill, width=1):
    for ox in (-SIZE,0,SIZE):
      for oy in (-SIZE,0,SIZE):
        draw.line([(x+ox,y+oy) for x,y in pts],fill=fill,width=width)

# Soil
f=.72*periodic_field(SIZE,101,18)+.28*periodic_field(SIZE,102,36)
soil=palette_image(np.clip(f,0,1),[(0,P['earth_dark']),(.42,P['earth_base']),(.78,P['earth_light']),(1,P['warm_highlight'])])
d=ImageDraw.Draw(soil,'RGBA'); rr=random.Random(103)
for _ in range(75):
    x,y=rr.uniform(0,SIZE),rr.uniform(0,SIZE); r=rr.uniform(.7,2.4)
    c=rr.choice([P['shadow_plum'],P['earth_light']])
    wrapped_ellipse(d,(x-r,y-r*.6,x+r,y+r*.6),(*c,rr.randint(30,75)))
soil=soil.filter(ImageFilter.GaussianBlur(.3)); soil.save(paths['soil']/ 'soil.png')

# Grass
f=.68*periodic_field(SIZE,201,15)+.32*periodic_field(SIZE,202,34)
grass=palette_image(np.clip(f,0,1),[(0,P['moss_dark']),(.32,P['moss_mid']),(.58,P['grass_base']),(.82,P['grass_light']),(1,P['grass_sun'])])
d=ImageDraw.Draw(grass,'RGBA'); rr=random.Random(203)
for _ in range(24):
    x,y=rr.uniform(0,SIZE),rr.uniform(0,SIZE); rx,ry=rr.uniform(7,20),rr.uniform(3,10)
    c=rr.choice([P['moss_dark'],P['grass_sun'],P['grass_light']]); wrapped_ellipse(d,(x-rx,y-ry,x+rx,y+ry),(*c,rr.randint(16,42)))
for _ in range(100):
    x,y=rr.uniform(0,SIZE),rr.uniform(0,SIZE); L=rr.uniform(2,5); lean=rr.uniform(-1.5,1.5)
    c=rr.choice([P['moss_dark'],P['grass_light'],P['warm_highlight']]); wrapped_line(d,[(x,y+L/2),(x+lean,y-L/2)],(*c,rr.randint(40,72)),1)
grass=grass.filter(ImageFilter.GaussianBlur(.2)); grass.save(paths['grass']/ 'grass.png')

# Flagstone
flag=Image.new('RGB',(SIZE,SIZE),P['stone_mid']); d=ImageDraw.Draw(flag,'RGBA'); rr=random.Random(301)
row_h=32; widths=[48,56,44,60,52]
for row in range(SIZE//row_h):
    y0=row*row_h; y1=y0+row_h; x=0 if row%2==0 else -24; wi=0
    while x<SIZE:
        w=widths[(row+wi)%len(widths)]; tone=rr.choice([P['stone_mid'],P['stone_light'],(150,142,122),(158,151,126),(139,139,126)])
        for ox in (-SIZE,0,SIZE):
            d.rectangle((x+ox+2,y0+2,x+w+ox-2,y1-2),fill=(*tone,255))
            d.line((x+ox+5,y0+5,x+w+ox-6,y0+5),fill=(*P['warm_highlight'],42),width=2)
        x+=w; wi+=1
joint=(*P['shadow_plum'],150)
for y in range(0,SIZE+1,row_h): d.line((0,y,SIZE,y),fill=joint,width=3)
for row in range(SIZE//row_h):
    x=0 if row%2==0 else -24; wi=0
    while x<SIZE:
        d.line((x,row*row_h,x,(row+1)*row_h),fill=joint,width=3)
        x+=widths[(row+wi)%len(widths)]; wi+=1
flag=flag.filter(ImageFilter.GaussianBlur(.2)); flag.save(paths['flagstone']/ 'flagstone.png')

# Water
f=periodic_field(SIZE,401,14); y,x=np.mgrid[0:SIZE,0:SIZE].astype(np.float32); xx=x/SIZE; yy=y/SIZE
w=.5+.2*np.sin(math.tau*(3*xx+yy))+.12*np.sin(math.tau*(6*xx-2*yy)+.6)+.08*np.sin(math.tau*(2*xx+5*yy)+1.2)
w=(w-w.min())/(w.max()-w.min()); wf=np.clip(.55*w+.45*f,0,1)
water=palette_image(wf,[(0,P['water_deep']),(.48,P['water_base']),(.78,P['water_lift']),(1,P['stone_light'])])
d=ImageDraw.Draw(water,'RGBA'); rr=random.Random(402)
for _ in range(34):
    x0,y0=rr.uniform(0,SIZE),rr.uniform(0,SIZE); L=rr.uniform(7,18); c=rr.uniform(-2,2)
    wrapped_line(d,[(x0,y0),(x0+L*.5,y0+c),(x0+L,y0)],(*P['stone_light'],rr.randint(24,58)),1)
water=water.filter(ImageFilter.GaussianBlur(.3)); water.save(paths['water']/ 'water.png')

# Coverage masks
N,E,S,W=1,2,4,8

def smoothstep(a,b,x):
    t=np.clip((x-a)/np.maximum(1e-6,b-a),0,1); return t*t*(3-2*t)

def grass_mask(mask):
    n=SIZE*SS; yy,xx=np.mgrid[0:n,0:n].astype(np.float32); x=xx/(n-1); y=yy/(n-1)
    d_ne=(x-y+.5)/math.sqrt(2); d_se=(1.5-x-y)/math.sqrt(2); d_sw=(y-x+.5)/math.sqrt(2); d_nw=(x+y-.5)/math.sqrt(2)
    noise=(periodic_field(n,500+mask,10)-.5)*.028+(periodic_field(n,700+mask,7)-.5)*.018
    cov=np.ones((n,n),np.float32)
    for bit,dist in [(N,d_ne),(E,d_se),(S,d_sw),(W,d_nw)]:
        if mask & bit: continue
        th=.095+noise; cov=np.minimum(cov,smoothstep(th,th+.060,dist))
    if mask==15: cov.fill(1)
    return Image.fromarray(np.uint8(np.clip(cov*255,0,255)),'L').resize((SIZE,SIZE),Image.Resampling.LANCZOS)

for m in range(16): grass_mask(m).save(paths['grass_masks']/f'{m:02}.png')

# Flagstone topology overlays
pts={'top':(SIZE//2,0),'right':(SIZE-1,SIZE//2),'bottom':(SIZE//2,SIZE-1),'left':(0,SIZE//2)}
segments={N:(pts['top'],pts['right']),E:(pts['right'],pts['bottom']),S:(pts['bottom'],pts['left']),W:(pts['left'],pts['top'])}

def flag_overlay(mask):
    n=SIZE*SS; img=Image.new('RGBA',(n,n),(0,0,0,0)); d=ImageDraw.Draw(img,'RGBA')
    def sc(p): return (p[0]*SS,p[1]*SS)
    exposed=[bit for bit in (N,E,S,W) if not(mask&bit)]
    for bit in exposed:
        a,b=map(sc,segments[bit]); d.line([a,b],fill=(*P['shadow_plum'],145),width=7*SS); d.line([a,b],fill=(*P['earth_dark'],110),width=4*SS)
        mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2; d.line([a,(mx,my)],fill=(*P['warm_highlight'],42),width=SS)
    corners=[((W,N),pts['top']),((N,E),pts['right']),((E,S),pts['bottom']),((S,W),pts['left'])]
    for (b1,b2),p in corners:
        if b1 in exposed and b2 in exposed:
            x,y=sc(p); r=7*SS; d.ellipse((x-r,y-r,x+r,y+r),fill=(*P['shadow_wine'],110))
    return img.filter(ImageFilter.GaussianBlur(.55*SS)).resize((SIZE,SIZE),Image.Resampling.LANCZOS)

for m in range(16): flag_overlay(m).save(paths['flagstone_topology']/f'{m:02}.png')

# Preview sheet
sheet=Image.new('RGB',(1200,900),(24,24,32)); sd=ImageDraw.Draw(sheet)
items=[('Warm Soil',soil),('Warm Grass',grass),('Warm Flagstone',flag),('Cool Water',water)]
for i,(name,img) in enumerate(items):
    x=30+i*290; y=50; thumb=img.resize((64,64),Image.Resampling.BICUBIC)
    tiled=Image.new('RGB',(256,256))
    for ty in range(4):
      for tx in range(4): tiled.paste(thumb,(tx*64,ty*64))
    sheet.paste(tiled,(x,y)); sd.text((x,y+266),name,fill=(245,245,245)); sd.text((x,y+284),'4x4 repeated preview',fill=(170,170,180))
sd.text((30,15),'RHO Phase 12 test base textures',fill=(245,245,245))

sd.text((30,355),'Warm Grass coverage masks 00-15',fill=(245,245,245))
for m in range(16):
    row,col=divmod(m,8); x=30+col*72; y=385+row*96
    mask=Image.open(paths['grass_masks']/f'{m:02}.png').resize((64,64),Image.Resampling.BILINEAR)
    base=Image.new('RGB',(64,64),P['earth_base']); top=Image.new('RGB',(64,64),P['grass_base']); comp=Image.composite(top,base,mask)
    sheet.paste(comp,(x,y)); sd.text((x+22,y+66),f'{m:02}',fill=(230,230,235))

sd.text((630,355),'Warm Flagstone topology overlays 00-15',fill=(245,245,245))
base=flag.resize((64,64),Image.Resampling.BICUBIC).convert('RGBA')
for m in range(16):
    row,col=divmod(m,8); x=630+col*68; y=385+row*96
    ov=Image.open(paths['flagstone_topology']/f'{m:02}.png').resize((64,64),Image.Resampling.BILINEAR)
    comp=base.copy(); comp.alpha_composite(ov); sheet.paste(comp.convert('RGB'),(x,y)); sd.text((x+22,y+66),f'{m:02}',fill=(230,230,235))

preview=ROOT/'PHASE12_TEST_ASSETS_PREVIEW.png'; sheet.save(preview)

readme='''# RHO Phase 12 Test Assets\n\nThese are proof assets, not final production art.\n\nCopy the `client/` folder into the repository root.\n\n```text\nclient/src/assets/map/tiles/phase12/\n    nature/\n        soil-warm/base/soil.png\n        grass-warm/base/grass.png\n        grass-warm/coverage/00.png ... 15.png\n    pavement/\n        flagstone-warm/base/flagstone.png\n        flagstone-warm/topology/00.png ... 15.png\n    water/\n        cool/base/water.png\n```\n\nThe masks use decimal topology IDs with N=1, E=2, S=4, W=8.\n\nGrass masks: white = grass, black = soil underlay, grey = blend.\nFlagstone topology: transparent = base surface, visible pixels = exposed edge/corner treatment.\n\nThe goal is to test continuous UVs, topology selection, non-square grass coverage, one-mesh batching, and later water UV scrolling.\n'''
(ROOT/'README.md').write_text(readme,encoding='utf-8')

zip_path=Path('/mnt/data/RHO_PHASE12_TEST_ASSETS.zip')
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for p in ROOT.rglob('*'):
        if p.is_file(): z.write(p,p.relative_to(ROOT))

print('created',zip_path)
print('preview',preview)
print('png_count',len(list(ASSET_ROOT.rglob('*.png'))))
