import sys, json, pymupdf
from PIL import Image, ImageDraw
pdf, data, outdir = sys.argv[1:4]
D=json.load(open(data))['charts']; d=pymupdf.open(pdf); S=2.0
def page(i):
    pm=d[i].get_pixmap(matrix=pymupdf.Matrix(S,S)); return Image.frombytes("RGB",(pm.width,pm.height),pm.samples).convert("RGB")
def P(ax,v): return ax['a']*v+ax['b']
def draw(img, pts, col, w=2):
    ImageDraw.Draw(img).line([(x*S,y*S) for x,y in pts], fill=col, width=w)
# B2-1
c=D['B2-1']; img=page(283)
for cv in c['curves']: draw(img,[(P(c['axes']['x'],tof),P(c['axes']['y'],t)) for t,tof in cv],(255,0,0))
img.save(f"{outdir}/ov_b21.png")
c=D['B2-2']; img=page(284)
draw(img,[(P(c['axes']['x'],g),P(c['axes']['y'],v)) for g,v in c['curve']],(255,0,0))
img.save(f"{outdir}/ov_b22.png")
c=D['B2-3']; A=c['axes']; pn=c['panels']; img=page(285)
for cv in pn['gw']['curves']: draw(img,[(P(A['x'],dd),P(A['gw'],t)) for t,dd in cv],(255,0,0))
cols={'cg':[('lines',(255,0,0))],'di':[('lines',(255,0,0))],'slope':[('up',(255,0,0)),('down',(0,160,255))],'wind':[('tail',(255,0,0)),('head',(0,160,255))]}
for k,lst in cols.items():
    for fam,col in lst:
        for ln in pn[k][fam]: draw(img,[(P(A['x'],dd),P(A[k],v)) for v,dd in ln],col)
img.save(f"{outdir}/ov_b23.png")
