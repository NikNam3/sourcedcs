import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useConfig } from '../contexts/ConfigContext';
import { apiFetch } from '../api';
import type { Squadron, RosterEntry, Event, GalleryItem } from '../types';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize:10, letterSpacing:2, textTransform:'uppercase', color:'var(--text-3)', marginBottom:8 }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontFamily:'Orbitron, monospace', fontWeight:900, fontSize:'clamp(18px, 3vw, 28px)', letterSpacing:3, textTransform:'uppercase', marginBottom:12 }}>{children}</h2>;
}

export default function Home() {
  const { user, hasRole, isAdmin, isSkillAdmin, login } = useAuth();
  const config = useConfig();
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [squadrons, setSquadrons] = useState<Squadron[]>([]);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [rosterTab, setRosterTab] = useState('');
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyData, setApplyData] = useState({ callsign: '', timezone: '', wing: '', message: '' });
  const [applyStatus, setApplyStatus] = useState('');

  const userName = user?.name?.toUpperCase() || 'USER';

  useEffect(() => {
    apiFetch<GalleryItem[]>('/api/gallery').then(items => {
      const shuffled = [...items].sort(() => Math.random() - 0.5).slice(0, 2);
      setGallery(shuffled);
    }).catch(() => {});
    apiFetch<Squadron[]>('/api/squadrons').then(setSquadrons).catch(() => {});
    apiFetch<RosterEntry[]>('/api/roster').then(r => { setRoster(r); }).catch(() => {});
    apiFetch<Event[]>('/api/events').then(evs => setEvents(evs.slice(0, 4))).catch(() => {});
  }, []);

  useEffect(() => {
    if (squadrons.length > 0) setRosterTab(squadrons[0].id);
  }, [squadrons]);

  const filteredRoster = rosterTab ? roster.filter(r => r.squadronId === rosterTab) : roster;

  async function submitApply() {
    try {
      await apiFetch('/api/apply', { method: 'POST', body: JSON.stringify(applyData) });
      setApplyStatus('APPLICATION SUBMITTED — WE WILL BE IN TOUCH ON DISCORD');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error';
      setApplyStatus('ERROR: ' + msg);
    }
  }

  const statusColors: Record<string, string> = { planned: 'var(--blue)', active: 'var(--green)', complete: 'var(--text-3)', cancelled: 'var(--red)' };

  return (
    <>
      {/* HERO */}
      <section style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 24px 64px', textAlign:'center', borderBottom:'1px solid var(--border)' }}>
        <img src="/sourcelogobg.png" alt="SOURCE" style={{ width:80, height:80, borderRadius:12, marginBottom:24 }} />
        <h1 style={{ fontFamily:'Orbitron, monospace', fontWeight:900, fontSize:'clamp(24px, 5vw, 48px)', letterSpacing:6, color:'var(--text)', marginBottom:12, lineHeight:1.1 }}>SOURCEDCS</h1>
        <p style={{ fontSize:10, letterSpacing:3, color:'var(--text-3)', textTransform:'uppercase', marginBottom:24 }}>VIRTUAL AVIATION SQUADRON · DCS WORLD</p>
        <div style={{ width:40, height:1, background:'var(--border-strong)', margin:'0 auto 24px' }} />
        <p style={{ maxWidth:600, color:'var(--text-2)', lineHeight:1.8, marginBottom:32 }}>
          SOURCE is a group of aviation enthusiasts who want to do things properly. We are a community of sim pilots who hang out daily, share the passion, but lock in and fly organized, professional operations.
        </p>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center', marginBottom:40 }}>
          <a href="#join" style={{ display:'flex', alignItems:'center', gap:8, background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'10px 20px', fontSize:11, letterSpacing:2, textTransform:'uppercase', cursor:'pointer', textDecoration:'none' }}>⊕ JOIN THE SQUADRON</a>
          {hasRole ? (
            <button onClick={() => document.getElementById('memberPortal')?.scrollIntoView({ behavior:'smooth' })}
              style={{ background:'none', border:'1px solid var(--border-strong)', padding:'10px 20px', fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--text)', cursor:'pointer' }}>
              → MEMBER HUB
            </button>
          ) : (
            <button onClick={login}
              style={{ background:'none', border:'1px solid var(--border-strong)', padding:'10px 20px', fontSize:11, letterSpacing:2, textTransform:'uppercase', color:'var(--text)', cursor:'pointer' }}>
              → MEMBER LOGIN
            </button>
          )}
        </div>
        {/* Gallery preview */}
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', justifyContent:'center', marginBottom:16 }}>
          {gallery.length === 0 ? (
            <>
              {['shot-01.svg','shot-02.svg'].map((s,i) => (
                <Link key={i} to="/gallery" style={{ display:'block', width:280, height:160, overflow:'hidden', border:'1px solid var(--border)', background:'var(--bg2)' }}>
                  <img src={`/gallery/${s}`} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                </Link>
              ))}
            </>
          ) : gallery.map((item, i) => (
            <Link key={i} to="/gallery" style={{ display:'block', width:280, height:160, overflow:'hidden', border:'1px solid var(--border)', background:'var(--bg2)', position:'relative' }}>
              <img src={item.src} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
              {item.caption && <div style={{ position:'absolute', bottom:0, left:0, right:0, background:'rgba(0,0,0,.6)', fontSize:10, padding:'4px 8px', color:'#fff' }}>{item.caption}</div>}
            </Link>
          ))}
        </div>
        <Link to="/gallery" style={{ fontSize:10, letterSpacing:2, color:'var(--text-3)', textTransform:'uppercase' }}>■ FLIGHT GALLERY — VIEW ALL SHOTS →</Link>
      </section>

      {/* MEMBER PORTAL */}
      {hasRole && (
        <section id="memberPortal" style={{ borderBottom:'1px solid var(--border)', padding:'48px 24px' }}>
          <div style={{ maxWidth:1100, margin:'0 auto' }}>
            <SectionLabel>MEMBER HUB</SectionLabel>
            <p style={{ fontSize:13, letterSpacing:2, marginBottom:24, color:'var(--text)' }}>WELCOME BACK, {userName}</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:12, marginBottom:24 }}>
              {[
                { icon:'≡', title:'WIKI', desc:'SOPs, procedures, airframe guides', href: config.wikiUrl, external: true },
                { icon:'⊑', title:'ATO BRIEF', desc:'Load & present mission briefings', href: config.atoUrl, external: true },
                { icon:'◎', title:'OLYMPUS', desc:'Real-time DCS ground control station', href: config.olympusUrl, external: true },
                { icon:'◉', title:'ASACS LINK', desc:'Live GCI datalink picture', href: config.asacsUrl, external: true },
                { icon:'⊞', title:'SCHEDULE', desc:'Upcoming ops & training sorties', href: '/schedule', external: false },
                { icon:'⎕', title:'FLIGHT PLAN', desc:'Submit DD Form 1801 ICAO IFR', href: '/flightplan', external: false },
                { icon:'▣', title:'GALLERY', desc:'Flight operation screenshots', href: '/gallery', external: false },
                { icon:'△', title:'TRAINING', desc:'Pilot qualifications & skill tree', href: '/skills', external: false },
                ...(isSkillAdmin ? [{ icon:'✎', title:'TRAINING ADMIN', desc:'Grade pilots & manage skill records', href: '/skills-admin', external: false }] : []),
                { icon:'⊕', title:'DISCORD', desc:'Squadron comms & coordination', href: config.discordUrl, external: true },
              ].filter(t => t.href).map((tool, i) => (
                tool.external ? (
                  <a key={i} href={tool.href} target="_blank" rel="noopener noreferrer"
                    style={{ display:'flex', flexDirection:'column', gap:4, padding:16, background:'var(--bg-card)', border:'1px solid var(--border)', textDecoration:'none' }}>
                    <div style={{ fontSize:20, color:'var(--text-3)' }}>{tool.icon}</div>
                    <div style={{ fontSize:12, letterSpacing:1.5, fontWeight:600 }}>{tool.title}</div>
                    <div style={{ fontSize:10, color:'var(--text-3)', lineHeight:1.5 }}>{tool.desc}</div>
                    <div style={{ marginTop:'auto', fontSize:11, color:'var(--text-3)' }}>→</div>
                  </a>
                ) : (
                  <Link key={i} to={tool.href!}
                    style={{ display:'flex', flexDirection:'column', gap:4, padding:16, background:'var(--bg-card)', border:'1px solid var(--border)', textDecoration:'none' }}>
                    <div style={{ fontSize:20, color:'var(--text-3)' }}>{tool.icon}</div>
                    <div style={{ fontSize:12, letterSpacing:1.5, fontWeight:600 }}>{tool.title}</div>
                    <div style={{ fontSize:10, color:'var(--text-3)', lineHeight:1.5 }}>{tool.desc}</div>
                    <div style={{ marginTop:'auto', fontSize:11, color:'var(--text-3)' }}>→</div>
                  </Link>
                )
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ABOUT */}
      <section id="about" style={{ padding:'64px 24px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <SectionLabel>ABOUT THE SQUADRON</SectionLabel>
          <SectionTitle>What is SOURCE?</SectionTitle>
          <p style={{ maxWidth:700, color:'var(--text-2)', lineHeight:1.8, marginBottom:40 }}>
            At SOURCE we fly combined-arms operations across multiple airframes, with a planning and controller team that runs every op from start to finish. The planning team works through the week. The full briefing goes up on ATO Brief the day before. Friday 1600Z we go through it together, Saturday we fly. Our Controllers manage the picture in real time. Once Everyone recovers we debrief.
          </p>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:16 }}>
            {[
              { icon:'⊕', title:'TACTICAL OPERATIONS', desc:'Full ATO/ACO/SPINS packages, professional briefings, and coordinated combined-arms execution across multiple airframes.' },
              { icon:'◉', title:'OPEN-SOURCE TOOLS', desc:'All our tactical tools — ATO Brief, ASACS GCI server, Miz-to-YAML — will be fully open sourced and free to use.' },
              { icon:'≡', title:'REALISTIC PROCEDURES', desc:'We follow real-world-inspired procedures: semi-realistic comms discipline, ROE, ATO, SPINS, ACO, and mission planning cycles.' },
              { icon:'⌥', title:'WELCOMING COMMUNITY', desc:"Whether you're new to DCS or a veteran simmer, SOURCE has a place for motivated, team-first pilots." },
            ].map((card, i) => (
              <div key={i} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:20 }}>
                <div style={{ fontSize:24, color:'var(--text-3)', marginBottom:12 }}>{card.icon}</div>
                <div style={{ fontSize:11, letterSpacing:2, fontWeight:600, marginBottom:8 }}>{card.title}</div>
                <div style={{ fontSize:11, color:'var(--text-2)', lineHeight:1.6 }}>{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WINGS */}
      <section id="subsquadrons" style={{ padding:'64px 24px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <SectionLabel>WINGS</SectionLabel>
          <SectionTitle>Sub-Squadrons</SectionTitle>
          <p style={{ color:'var(--text-2)', marginBottom:32, lineHeight:1.8 }}>SOURCE operates multiple tactical wings, each focused on a distinct airframe.</p>
          {squadrons.length === 0 ? (
            <p style={{ color:'var(--text-3)' }}>LOADING WINGS...</p>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:16 }}>
              {squadrons.map(sq => (
                <Link key={sq.id} to={`/wing/${sq.id}`}
                  style={{ display:'block', background:'var(--bg-card)', border:'1px solid var(--border)', textDecoration:'none', overflow:'hidden' }}>
                  {sq.image && <img src={sq.image} alt={sq.name} style={{ width:'100%', height:120, objectFit:'cover' }} />}
                  <div style={{ padding:16 }}>
                    <div style={{ fontSize:10, letterSpacing:2, color:'var(--text-3)', marginBottom:4 }}>{sq.designator}</div>
                    <div style={{ fontSize:14, fontWeight:600, letterSpacing:1, marginBottom:4 }}>{sq.name}</div>
                    <div style={{ fontSize:11, color:'var(--text-2)' }}>{sq.airframe}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {isAdmin && (
            <div style={{ marginTop:20, padding:'8px 16px', background:'var(--bg2)', border:'1px solid var(--border)', fontSize:11 }}>
              ADMIN: <button style={{ background:'none', border:'1px solid var(--border-strong)', padding:'2px 12px', marginLeft:8, cursor:'pointer', fontSize:11 }}>⊕ ADD WING</button>
            </div>
          )}
        </div>
      </section>

      {/* UPCOMING OPS */}
      <section style={{ padding:'64px 24px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
            <SectionLabel>UPCOMING OPERATIONS</SectionLabel>
            <Link to="/schedule" style={{ fontSize:10, letterSpacing:2, color:'var(--text-3)' }}>VIEW FULL SCHEDULE →</Link>
          </div>
          {events.length === 0 ? (
            <p style={{ color:'var(--text-3)' }}>LOADING OPERATIONS...</p>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(260px, 1fr))', gap:12 }}>
              {events.map(ev => (
                <div key={ev.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                    <span style={{ fontSize:10, letterSpacing:1.5, color:'var(--text-3)', textTransform:'uppercase' }}>{ev.type}</span>
                    <span style={{ fontSize:10, letterSpacing:1, color: statusColors[ev.status] || 'var(--text-3)', textTransform:'uppercase' }}>{ev.status}</span>
                  </div>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{ev.title}</div>
                  <div style={{ fontSize:11, color:'var(--text-2)' }}>{ev.date}{ev.time ? ` · ${ev.time}` : ''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ROSTER */}
      <section id="roster" style={{ padding:'64px 24px', borderBottom:'1px solid var(--border)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <SectionLabel>PILOT ROSTER</SectionLabel>
          {isAdmin && (
            <div style={{ marginBottom:16, padding:'8px 16px', background:'var(--bg2)', border:'1px solid var(--border)', fontSize:11 }}>
              ADMIN: ROSTER MANAGEMENT
            </div>
          )}
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
            <button onClick={() => setRosterTab('')}
              style={{ background: rosterTab === '' ? 'var(--text)' : 'transparent', color: rosterTab === '' ? 'var(--text-inv)' : 'var(--text)', border:'1px solid var(--border)', padding:'4px 12px', fontSize:10, letterSpacing:1.5, cursor:'pointer' }}>
              ALL
            </button>
            {squadrons.map(sq => (
              <button key={sq.id} onClick={() => setRosterTab(sq.id)}
                style={{ background: rosterTab === sq.id ? 'var(--text)' : 'transparent', color: rosterTab === sq.id ? 'var(--text-inv)' : 'var(--text)', border:'1px solid var(--border)', padding:'4px 12px', fontSize:10, letterSpacing:1.5, cursor:'pointer' }}>
                {sq.designator || sq.name}
              </button>
            ))}
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead>
                <tr style={{ borderBottom:'1px solid var(--border-strong)' }}>
                  {['CALLSIGN','ROLE','SQUADRON'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'8px 12px', letterSpacing:1.5, color:'var(--text-3)', fontWeight:400, fontSize:10 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRoster.length === 0 ? (
                  <tr><td colSpan={3} style={{ textAlign:'center', color:'var(--text-3)', padding:20 }}>LOADING ROSTER...</td></tr>
                ) : filteredRoster.map((entry, i) => (
                  <tr key={entry.id} style={{ borderBottom:'1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg2)' }}>
                    <td style={{ padding:'8px 12px' }}>{entry.displayName || entry.name}</td>
                    <td style={{ padding:'8px 12px', color:'var(--text-2)' }}>{entry.roles[0] || '—'}</td>
                    <td style={{ padding:'8px 12px', color:'var(--text-3)' }}>{squadrons.find(s => s.id === entry.squadronId)?.designator || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* JOIN */}
      <section id="join" style={{ padding:'64px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto', display:'grid', gridTemplateColumns:'1fr 1fr', gap:40 }}>
          <div>
            <SectionLabel>JOIN SOURCE</SectionLabel>
            <SectionTitle>How to Join</SectionTitle>
            <p style={{ color:'var(--text-2)', lineHeight:1.8, marginBottom:24 }}>
              If you're here to learn, put in the effort, and fly as part of a team — SOURCE is for you. We don't care how many hours you have. We care that you show up, respect the people around you, and take the ops seriously.
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:16, marginBottom:24 }}>
              {[
                { n:'01', title:'SUBMIT AN APPLICATION', desc:'Fill in the short form with your callsign, timezone, and preferred wing.' },
                { n:'02', title:'JOIN DISCORD', desc:"We'll reach out on Discord within 48 hours to introduce you to the squadron." },
                { n:'03', title:'FLY WITH US', desc:'Join a check-ride to get familiar with SOURCE procedures.' },
              ].map(step => (
                <div key={step.n} style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
                  <div style={{ fontSize:20, fontFamily:'Orbitron, monospace', fontWeight:700, color:'var(--text-3)', minWidth:32 }}>{step.n}</div>
                  <div>
                    <div style={{ fontSize:11, letterSpacing:1.5, fontWeight:600, marginBottom:4 }}>{step.title}</div>
                    <div style={{ fontSize:11, color:'var(--text-2)', lineHeight:1.6 }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setApplyOpen(true)}
              style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'10px 20px', fontSize:11, letterSpacing:2, cursor:'pointer' }}>
              ⊕ APPLY TO JOIN SOURCE
            </button>
          </div>
          <div>
            <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:24 }}>
              <div style={{ fontSize:11, letterSpacing:2, fontWeight:600, marginBottom:16 }}>REQUIREMENTS</div>
              <ul style={{ listStyle:'none', display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  'DCS World installed (at least one full airframe module)',
                  'Working headset and microphone',
                  'SRS (Simple Radio Standalone) installed',
                  'Discord account',
                  'Commitment to attend at least once a week',
                  'RL comes first — communicate if you cannot attend',
                ].map((req, i) => (
                  <li key={i} style={{ display:'flex', gap:8, fontSize:11, color:'var(--text-2)', lineHeight:1.5 }}>
                    <span style={{ color:'var(--accent)' }}>›</span>{req}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* APPLY MODAL */}
      {applyOpen && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }}>
          <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', padding:32, width:'min(500px, 95vw)', maxHeight:'90vh', overflow:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:24 }}>
              <div style={{ fontSize:13, letterSpacing:2, fontWeight:600 }}>APPLY TO JOIN SOURCE</div>
              <button onClick={() => setApplyOpen(false)} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'var(--text)' }}>×</button>
            </div>
            {applyStatus ? (
              <p style={{ fontSize:11, lineHeight:1.6, color:'var(--text-2)' }}>{applyStatus}</p>
            ) : (
              <>
                {[
                  { label:'CALLSIGN / HANDLE', key:'callsign', type:'text' },
                  { label:'TIMEZONE (e.g. UTC+2)', key:'timezone', type:'text' },
                  { label:'PREFERRED WING', key:'wing', type:'text' },
                ].map(field => (
                  <div key={field.key} style={{ marginBottom:16 }}>
                    <label style={{ display:'block', fontSize:10, letterSpacing:1.5, color:'var(--text-3)', marginBottom:6 }}>{field.label}</label>
                    <input type={field.type} value={(applyData as Record<string,string>)[field.key]}
                      onChange={e => setApplyData(d => ({ ...d, [field.key]: e.target.value }))}
                      style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'8px 12px', fontSize:12, color:'var(--text)', fontFamily:'inherit' }} />
                  </div>
                ))}
                <div style={{ marginBottom:20 }}>
                  <label style={{ display:'block', fontSize:10, letterSpacing:1.5, color:'var(--text-3)', marginBottom:6 }}>MESSAGE (optional)</label>
                  <textarea value={applyData.message} onChange={e => setApplyData(d => ({ ...d, message: e.target.value }))}
                    rows={4} style={{ width:'100%', background:'transparent', border:'1px solid var(--border)', padding:'8px 12px', fontSize:12, color:'var(--text)', fontFamily:'inherit', resize:'vertical' }} />
                </div>
                <button onClick={submitApply}
                  style={{ background:'var(--accent)', color:'var(--text-inv)', border:'none', padding:'10px 24px', fontSize:11, letterSpacing:2, cursor:'pointer', width:'100%' }}>
                  SUBMIT APPLICATION
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
