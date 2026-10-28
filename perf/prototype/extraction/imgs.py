import pymupdf, sys, json, io, base64
from PIL import Image
d=pymupdf.open(sys.argv[1]); out={}
clips={'B2-1':(283,(60,108,560,702)),'B2-2':(284,(58,262,560,595)),'B2-3':(285,(62,120,560,712))}
for k,(i,c) in clips.items():
    S=2.0
    pm=d[i].get_pixmap(matrix=pymupdf.Matrix(S,S),clip=pymupdf.Rect(*c),colorspace=pymupdf.csGRAY)
    im=Image.frombytes("L",(pm.width,pm.height),pm.samples)
    im=im.quantize(colors=16)
    b=io.BytesIO(); im.save(b,format="PNG",optimize=True)
    out[k]={'clip':c,'png':base64.b64encode(b.getvalue()).decode()}
    print(k,pm.width,pm.height,len(b.getvalue())//1024,"KB")
json.dump(out,open(sys.argv[2],'w'))
