import pymupdf
def segments(page, minw=0.5, maxw=1.0, clip=None):
    segs=[]
    for x in page.get_drawings():
        w=x.get('width') or 0
        if not (minw<=w<=maxw): continue
        for it in x['items']:
            if it[0]=='l':
                a,b=it[1],it[2]
                if clip and not (clip.contains(a) and clip.contains(b)): continue
                segs.append(((a.x,a.y),(b.x,b.y)))
    return segs
def chains(segs, tol=0.15):
    # greedy chaining by endpoint proximity
    import math
    segs=[s for s in segs if s[0]!=s[1]]
    used=[False]*len(segs); out=[]
    def key(p): return (round(p[0]/tol),round(p[1]/tol))
    idx={}
    for i,(a,b) in enumerate(segs):
        for p in (a,b):
            k=key(p)
            for dx in (-1,0,1):
                for dy in (-1,0,1):
                    idx.setdefault((k[0]+dx,k[1]+dy),[]).append(i)
    def near(p,q): return abs(p[0]-q[0])<=tol and abs(p[1]-q[1])<=tol
    for i in range(len(segs)):
        if used[i]: continue
        used[i]=True; pts=[segs[i][0],segs[i][1]]
        for end in (1,0):
            while True:
                p=pts[-1] if end else pts[0]
                found=None
                for j in idx.get(key(p),[]):
                    if used[j]: continue
                    a,b=segs[j]
                    if near(a,p): found=(j,b);break
                    if near(b,p): found=(j,a);break
                if not found: break
                used[found[0]]=True
                if end: pts.append(found[1])
                else: pts.insert(0,found[1])
        out.append(pts)
    return out
def words(page): return page.get_text("words")
