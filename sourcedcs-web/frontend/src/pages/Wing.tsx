import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api';
import type { Squadron, RosterEntry } from '../types';

const ROSTER_COLORS = ['#1a3a6b', '#1a5c2e', '#7c5000', '#9b1c1c', '#4a2075', '#1a5a5a'];
function roleColor(role: string): string {
  let h = 0;
  for (let i = 0; i < role.length; i++) h = ((h * 31 + role.charCodeAt(i)) & 0x7fffffff);
  return ROSTER_COLORS[h % ROSTER_COLORS.length];
}

export default function Wing() {
  const { id } = useParams<{ id: string }>();
  const [squadron, setSquadron] = useState<Squadron | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      apiFetch<Squadron>(`/api/squadrons/${encodeURIComponent(id)}`).catch(() => null),
      apiFetch<RosterEntry[]>('/api/roster').catch(() => []),
    ]).then(([sq, ros]) => {
      if (!sq) { setError('Wing not found.'); return; }
      setSquadron(sq);
      setRoster(ros);
    }).catch(() => setError('Error loading wing data.'));
  }, [id]);

  if (!id) return (
    <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--red)' }}>
      No wing ID specified. <Link to="/" style={{ color: 'var(--text)', textDecoration: 'underline' }}>Back to wings →</Link>
    </div>
  );

  if (error) return (
    <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--red)' }}>
      {error} <Link to="/#subsquadrons" style={{ color: 'var(--text)', textDecoration: 'underline' }}>Back to wings →</Link>
    </div>
  );

  if (!squadron) return (
    <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--text-3)', fontSize: 11, letterSpacing: 2 }}>
      LOADING WING DATA…
    </div>
  );

  const wingPilots = roster.filter(p => (p as { squadron?: string }).squadron === squadron.id);

  return (
    <div>
      {/* Hero */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '48px 24px 40px', textAlign: 'center' }}>
        {squadron.image && (
          <img src={squadron.image} alt="" style={{ width: 80, height: 80, objectFit: 'contain', marginBottom: 16 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(36px, 8vw, 72px)', fontWeight: 700, letterSpacing: 4, marginBottom: 8 }}>
          {squadron.designator}
        </div>
        <div style={{ fontSize: 'clamp(14px, 3vw, 20px)', letterSpacing: 2, marginBottom: 4 }}>{squadron.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>{squadron.airframe}</div>
        {(squadron.tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
            {squadron.tags!.map(tag => (
              <span key={tag} style={{ fontSize: 9, letterSpacing: 2, border: '1px solid var(--border-strong)', padding: '3px 8px', color: 'var(--text-2)' }}>{tag}</span>
            ))}
          </div>
        )}
        <a
          href="/#join"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--accent)', color: 'var(--text-inv)', padding: '8px 20px', fontSize: 11, letterSpacing: 2, textDecoration: 'none' }}
        >
          ⊕ APPLY TO {squadron.designator}
        </a>
      </div>

      {/* About */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '40px 24px' }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 16 }}>ABOUT THIS WING</div>
        {(squadron.about || squadron.description) && (
          <p style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)', marginBottom: 24 }}>
            {squadron.about || squadron.description}
          </p>
        )}
        <Link to="/" style={{ fontSize: 11, letterSpacing: 1.5, color: 'var(--text-2)', textDecoration: 'none' }}>← ALL WINGS</Link>
      </section>

      {/* Roster */}
      <section style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px 64px' }}>
        <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 16 }}>WING ROSTER</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-strong)' }}>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontSize: 9, letterSpacing: 2, color: 'var(--text-3)' }}>CALLSIGN</th>
                <th style={{ textAlign: 'left', padding: '6px 12px', fontSize: 9, letterSpacing: 2, color: 'var(--text-3)' }}>ROLE</th>
              </tr>
            </thead>
            <tbody>
              {wingPilots.length === 0 ? (
                <tr>
                  <td colSpan={2} style={{ padding: '16px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>
                    NO PILOTS ASSIGNED YET — <Link to="/#join" style={{ color: 'var(--text)' }}>APPLY NOW →</Link>
                  </td>
                </tr>
              ) : (
                wingPilots.map(p => {
                  const role = (p as { role?: string }).role || '';
                  const callsign = (p as { callsign?: string }).callsign || p.name;
                  const c = roleColor(role);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{callsign}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {role && (
                          <span style={{ fontSize: 9, letterSpacing: 1.5, border: `1px solid ${c}`, color: c, padding: '2px 6px' }}>{role}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              {wingPilots.length > 0 && (
                <tr>
                  <td colSpan={2} style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--text-3)', fontSize: 10 }}>
                    PILOT SLOTS OPEN — <Link to="/#join" style={{ color: 'var(--text)' }}>APPLY NOW →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
