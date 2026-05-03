import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';
import type { Event } from '../types';

const STATUS_COLORS: Record<string, string> = { planned: 'var(--blue)', active: 'var(--green)', complete: 'var(--text-3)', cancelled: 'var(--red)' };

export default function Schedule() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editEvent, setEditEvent] = useState<Partial<Event>>({});
  const [isEdit, setIsEdit] = useState(false);

  const load = () => apiFetch<Event[]>('/api/events').then(setEvents).catch(() => {});
  useEffect(() => { load(); }, []);

  function openAdd() { setEditEvent({ type: 'OPERATION', status: 'planned' }); setIsEdit(false); setModalOpen(true); }
  function openEdit(ev: Event) { setEditEvent({ ...ev }); setIsEdit(true); setModalOpen(true); }

  async function saveEvent() {
    if (isEdit && editEvent.id) await apiFetch(`/api/events/${editEvent.id}`, { method:'PUT', body: JSON.stringify(editEvent) });
    else await apiFetch('/api/events', { method:'POST', body: JSON.stringify(editEvent) });
    setModalOpen(false); load();
  }
  async function deleteEvent(id: string) {
    if (!confirm('Delete this event?')) return;
    await apiFetch(`/api/events/${id}`, { method:'DELETE' }); load();
  }

  return (
    <div>
      <div style={{ background:'var(--bg2)', borderBottom:'1px solid var(--border)', padding:'48px 24px', textAlign:'center' }}>
        <div style={{ fontSize:10, letterSpacing:2, color:'var(--text-3)', marginBottom:8 }}>OPERATIONS SCHEDULE</div>
        <h1 style={{ fontFamily:'Orbitron, monospace', fontSize:'clamp(20px, 3vw, 36px)', letterSpacing:4, marginBottom:8 }}>SCHEDULE</h1>
      </div>
      {isAdmin && (
        <div style={{ maxWidth:1100, margin:'16px auto', padding:'0 24px', display:'flex', gap:12 }}>
          <button onClick={openAdd} style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'6px 16px', fontSize:10, letterSpacing:1.5, cursor:'pointer' }}>⊕ ADD EVENT</button>
          <button onClick={() => apiFetch('/api/discord-sync-events', { method:'POST' }).catch(() => {})} style={{ background:'none', border:'1px solid var(--border)', padding:'6px 16px', fontSize:10, cursor:'pointer', color:'var(--text)' }}>↻ SYNC DISCORD</button>
        </div>
      )}
      <div style={{ maxWidth:1100, margin:'0 auto', padding:'0 24px 64px', display:'flex', flexDirection:'column', gap:12 }}>
        {events.length === 0 ? <p style={{ color:'var(--text-3)' }}>No upcoming operations.</p> : events.map(ev => (
          <div key={ev.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:20, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16 }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:8 }}>
                <span style={{ fontSize:9, letterSpacing:2, color:'var(--text-3)', textTransform:'uppercase', border:'1px solid var(--border)', padding:'2px 6px' }}>{ev.type}</span>
                <span style={{ fontSize:9, letterSpacing:2, color: STATUS_COLORS[ev.status] || 'var(--text-3)', textTransform:'uppercase' }}>● {ev.status}</span>
              </div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>{ev.title}</div>
              <div style={{ fontSize:11, color:'var(--text-2)' }}>{ev.date}{ev.time ? ` · ${ev.time}Z` : ''}{ev.location ? ` · ${ev.location}` : ''}</div>
              {ev.description && <div style={{ fontSize:11, color:'var(--text-3)', lineHeight:1.6, marginTop:4 }}>{ev.description}</div>}
            </div>
            {isAdmin && (
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={() => openEdit(ev)} style={{ background:'none', border:'1px solid var(--border)', padding:'4px 10px', fontSize:9, cursor:'pointer', color:'var(--text)' }}>✎</button>
                <button onClick={() => deleteEvent(ev.id)} style={{ background:'none', border:'1px solid var(--red)', padding:'4px 10px', fontSize:9, cursor:'pointer', color:'var(--red)' }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {modalOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:16 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:24, width:'min(500px, 100%)', maxHeight:'90vh', overflow:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:20 }}>
              <span style={{ fontSize:12, letterSpacing:2 }}>{isEdit ? 'EDIT' : 'ADD'} EVENT</span>
              <button onClick={() => setModalOpen(false)} style={{ background:'none', border:'none', fontSize:16, cursor:'pointer', color:'var(--text)' }}>×</button>
            </div>
            {[{ label:'TITLE', key:'title', type:'text' },{ label:'DATE', key:'date', type:'date' },{ label:'TIME', key:'time', type:'text' },{ label:'LOCATION', key:'location', type:'text' },{ label:'TYPE', key:'type', type:'text' }].map(f => (
              <div key={f.key} style={{ marginBottom:12 }}>
                <label style={{ display:'block', fontSize:9, letterSpacing:1.5, color:'var(--text-3)', marginBottom:4 }}>{f.label}</label>
                <input type={f.type} value={(editEvent as Record<string,string>)[f.key] || ''} onChange={e => setEditEvent(d => ({ ...d, [f.key]: e.target.value }))} style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'6px 10px', fontSize:11, color:'var(--text)', fontFamily:'inherit' }} />
              </div>
            ))}
            <div style={{ marginBottom:12 }}>
              <label style={{ display:'block', fontSize:9, letterSpacing:1.5, color:'var(--text-3)', marginBottom:4 }}>STATUS</label>
              <select value={editEvent.status || 'planned'} onChange={e => setEditEvent(d => ({ ...d, status: e.target.value as Event['status'] }))} style={{ width:'100%', background:'var(--bg2)', border:'1px solid var(--border)', padding:'6px 10px', fontSize:11, color:'var(--text)', fontFamily:'inherit' }}>
                {['planned','active','complete','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:16 }}>
              <label style={{ display:'block', fontSize:9, letterSpacing:1.5, color:'var(--text-3)', marginBottom:4 }}>DESCRIPTION</label>
              <textarea value={editEvent.description || ''} onChange={e => setEditEvent(d => ({ ...d, description: e.target.value }))} rows={3} style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'6px 10px', fontSize:11, color:'var(--text)', fontFamily:'inherit', resize:'vertical' }} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={saveEvent} style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'8px 20px', fontSize:11, cursor:'pointer' }}>SAVE</button>
              <button onClick={() => setModalOpen(false)} style={{ background:'none', border:'1px solid var(--border)', padding:'8px 16px', fontSize:11, cursor:'pointer', color:'var(--text)' }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
