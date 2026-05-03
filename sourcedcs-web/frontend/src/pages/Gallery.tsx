import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';
import type { GalleryItem } from '../types';

export default function Gallery() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [current, setCurrent] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editCaption, setEditCaption] = useState('');
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addCaption, setAddCaption] = useState('');
  const [addFile, setAddFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);

  const load = () => apiFetch<GalleryItem[]>('/api/gallery').then(items => { setItems(items); setCurrent(0); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function saveCaption() {
    if (editIdx === null) return;
    await apiFetch('/api/gallery', { method:'PUT', body: JSON.stringify({ idx: editIdx, caption: editCaption }) });
    setEditIdx(null); load();
  }
  async function deleteItem(idx: number) {
    if (!confirm('Delete this photo?')) return;
    await apiFetch(`/api/gallery/${idx}`, { method:'DELETE' }); load();
  }
  async function uploadPhoto() {
    if (!addFile) return;
    setLoading(true);
    try {
      const fd = new FormData(); fd.append('photo', addFile);
      const res = await apiFetch<{ src: string }>('/api/gallery/upload', { method:'POST', body: fd });
      await apiFetch('/api/gallery', { method:'PUT', body: JSON.stringify({ src: res.src, caption: addCaption }) });
      setAddOpen(false); setAddCaption(''); setAddFile(null); load();
    } finally { setLoading(false); }
  }
  const item = items[current];
  return (
    <div>
      <div style={{ background:'var(--bg2)', borderBottom:'1px solid var(--border)', padding:'32px 24px', textAlign:'center' }}>
        <div style={{ fontSize:10, letterSpacing:2, color:'var(--text-3)', marginBottom:8 }}>FLIGHT GALLERY</div>
        <h1 style={{ fontFamily:'Orbitron, monospace', fontSize:'clamp(20px, 3vw, 32px)', letterSpacing:4, marginBottom:8 }}>GALLERY</h1>
        <p style={{ fontSize:11, color:'var(--text-3)' }}>{items.length} SHOTS</p>
      </div>
      {isAdmin && (
        <div style={{ background:'var(--bg2)', borderBottom:'1px solid var(--border)', padding:'8px 24px', display:'flex', gap:12, alignItems:'center' }}>
          <span style={{ fontSize:10, letterSpacing:1.5, color:'var(--text-3)' }}>ADMIN</span>
          <button onClick={() => setEditMode(m => !m)} style={{ background: editMode ? 'var(--accent)' : 'transparent', color: editMode ? 'var(--text-inv)' : 'var(--text)', border:'1px solid var(--border-strong)', padding:'4px 12px', fontSize:10, cursor:'pointer' }}>{editMode ? 'EXIT EDIT' : 'EDIT MODE'}</button>
          <button onClick={() => setAddOpen(true)} style={{ background:'none', border:'1px solid var(--border-strong)', padding:'4px 12px', fontSize:10, cursor:'pointer', color:'var(--text)' }}>⊕ ADD PHOTO</button>
        </div>
      )}
      {items.length > 0 && item && (
        <div style={{ maxWidth:900, margin:'40px auto', padding:'0 24px' }}>
          <div style={{ position:'relative', background:'var(--bg2)', border:'1px solid var(--border)', aspectRatio:'16/9', overflow:'hidden', marginBottom:16 }}>
            <img src={item.src} alt={item.caption || ''} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            {item.caption && <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,.65)', padding:'8px 16px', fontSize:11, color:'#fff' }}>{item.caption}</div>}
            <button onClick={() => setCurrent(c => (c - 1 + items.length) % items.length)} style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', background:'rgba(0,0,0,.5)', color:'#fff', border:'none', padding:'8px 12px', fontSize:16, cursor:'pointer' }}>‹</button>
            <button onClick={() => setCurrent(c => (c + 1) % items.length)} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'rgba(0,0,0,.5)', color:'#fff', border:'none', padding:'8px 12px', fontSize:16, cursor:'pointer' }}>›</button>
            {editMode && (
              <div style={{ position:'absolute', top:8, right:8, display:'flex', gap:8 }}>
                <button onClick={() => { setEditIdx(current); setEditCaption(item.caption || ''); }} style={{ background:'rgba(0,0,0,.7)', color:'#fff', border:'none', padding:'4px 10px', fontSize:10, cursor:'pointer' }}>✎ CAPTION</button>
                <button onClick={() => deleteItem(current)} style={{ background:'rgba(180,0,0,.7)', color:'#fff', border:'none', padding:'4px 10px', fontSize:10, cursor:'pointer' }}>✕ DELETE</button>
              </div>
            )}
          </div>
          <div style={{ display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }}>
            {items.map((_, i) => <button key={i} onClick={() => setCurrent(i)} style={{ width:8, height:8, borderRadius:'50%', background: i === current ? 'var(--accent)' : 'var(--border-strong)', border:'none', cursor:'pointer', padding:0 }} />)}
          </div>
        </div>
      )}
      {editIdx !== null && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:24, width:400 }}>
            <div style={{ marginBottom:12, fontSize:12, letterSpacing:2 }}>EDIT CAPTION</div>
            <input value={editCaption} onChange={e => setEditCaption(e.target.value)} style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'8px 12px', fontSize:12, color:'var(--text)', fontFamily:'inherit', marginBottom:16 }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={saveCaption} style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'8px 20px', cursor:'pointer', fontSize:11 }}>SAVE</button>
              <button onClick={() => setEditIdx(null)} style={{ background:'none', border:'1px solid var(--border)', padding:'8px 16px', cursor:'pointer', fontSize:11, color:'var(--text)' }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
      {addOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:24, width:400 }}>
            <div style={{ marginBottom:16, fontSize:12, letterSpacing:2 }}>ADD PHOTO</div>
            <input type="file" accept="image/*" onChange={e => setAddFile(e.target.files?.[0] || null)} style={{ marginBottom:12, fontSize:11, color:'var(--text)' }} />
            <input placeholder="Caption (optional)" value={addCaption} onChange={e => setAddCaption(e.target.value)} style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'8px 12px', fontSize:12, color:'var(--text)', fontFamily:'inherit', marginBottom:16 }} />
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={uploadPhoto} disabled={!addFile || loading} style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'8px 20px', cursor:'pointer', fontSize:11, opacity: (!addFile || loading) ? 0.5 : 1 }}>{loading ? 'UPLOADING...' : 'UPLOAD'}</button>
              <button onClick={() => setAddOpen(false)} style={{ background:'none', border:'1px solid var(--border)', padding:'8px 16px', cursor:'pointer', fontSize:11, color:'var(--text)' }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
