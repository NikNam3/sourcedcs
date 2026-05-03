import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';
import type { SkillCategory, GradingRequest } from '../types';

interface SkillTreeData { categories: SkillCategory[] }
interface PilotRecord { sub: string; name?: string; callsign?: string; registered_at?: string }
type AllGrades = Record<string, Record<string, { grade: string; gradedBy?: string; gradedAt?: string; notes?: string }>>

const GRADE_COLORS: Record<string, string> = { U: 'var(--red)', F: 'var(--yellow,#d4a800)', G: 'var(--blue)', E: 'var(--green)' };
const VALID_GRADES = ['U', 'F', 'G', 'E'];

export default function SkillsAdmin() {
  const { token, isSkillAdmin } = useAuth();
  const [tree, setTree]       = useState<SkillTreeData | null>(null);
  const [grades, setGrades]   = useState<AllGrades>({});
  const [pilots, setPilots]   = useState<Record<string, PilotRecord>>({});
  const [requests, setRequests] = useState<GradingRequest[]>([]);
  const [pilotSquadrons, setPilotSquadrons] = useState<Record<string, string | null>>({});
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const [tab, setTab]         = useState<'queue' | 'pilots' | 'tree'>('queue');
  const [toast, setToast]     = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadAll = useCallback(() => {
    if (!token) return;
    Promise.all([
      apiFetch<SkillTreeData>('/api/skill-tree'),
      apiFetch<AllGrades>('/api/skill-grades'),
      apiFetch<Record<string, PilotRecord>>('/api/skill-pilots'),
      apiFetch<GradingRequest[]>('/api/grading-requests'),
      apiFetch<Record<string, string | null>>('/api/skill-pilots-squadrons').catch(() => ({})),
    ]).then(([treeData, gradesData, pilotsData, reqs, pSqs]) => {
      setTree(treeData);
      setGrades(gradesData || {});
      setPilots(pilotsData || {});
      setRequests(Array.isArray(reqs) ? reqs : []);
      setPilotSquadrons(pSqs || {});
    }).catch(() => showToast('Failed to load data'));
  }, [token]);

  useEffect(() => { if (isSkillAdmin) loadAll(); }, [isSkillAdmin, loadAll]);

  async function claimRequest(reqId: string) {
    try {
      await apiFetch(`/api/grading-requests/${reqId}/claim`, { method: 'PUT' });
      loadAll();
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  async function unclaimRequest(reqId: string) {
    try {
      await apiFetch(`/api/grading-requests/${reqId}/unclaim`, { method: 'PUT' });
      loadAll();
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  async function gradeModule(sub: string, moduleId: string, grade: string, notes: string) {
    try {
      await apiFetch(`/api/skill-grades/${sub}/${moduleId}`, {
        method: 'PUT',
        body: JSON.stringify({ grade, notes }),
      });
      loadAll();
      showToast('Grade saved');
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  async function deleteGrade(sub: string, moduleId: string) {
    if (!confirm('Delete this grade?')) return;
    try {
      await apiFetch(`/api/skill-grades/${sub}/${moduleId}`, { method: 'DELETE' });
      loadAll();
      showToast('Grade deleted');
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  if (!token) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
        Please log in to access the admin panel.
      </div>
    );
  }

  if (!isSkillAdmin) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--red)', fontSize: 12, letterSpacing: 2 }}>
        ACCESS DENIED — Skill Admin role required.
      </div>
    );
  }

  const pending = requests.filter(r => r.status === 'pending' || r.status === 'claimed');
  const activePilot = activeSub ? pilots[activeSub] : null;
  const activePilotGrades = activeSub ? (grades[activeSub] || {}) : {};

  return (
    <div>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '32px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 8 }}>SKILL ADMIN</div>
        <h1 style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(18px, 3vw, 28px)', letterSpacing: 4 }}>TRAINING ADMINISTRATION</h1>
      </div>

      {/* Tabs */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex', gap: 0 }}>
        {(['queue', 'pilots', 'tree'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', padding: '12px 20px', fontSize: 10, letterSpacing: 2, cursor: 'pointer', color: tab === t ? 'var(--text)' : 'var(--text-3)' }}
          >
            {t === 'queue' ? `GRADING QUEUE (${pending.length})` : t === 'pilots' ? `PILOTS (${Object.keys(pilots).length})` : 'SKILL TREE'}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

        {/* Grading Queue */}
        {tab === 'queue' && (
          <div>
            {pending.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 12 }}>No pending grading requests.</div>
            ) : (
              pending.map(req => (
                <div key={req.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '16px 20px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{req.moduleName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
                      PILOT: {req.pilotName || req.pilotId} · {new Date(req.requestedAt).toLocaleDateString()}
                    </div>
                    <div style={{ fontSize: 10, color: req.status === 'claimed' ? 'var(--yellow,#d4a800)' : 'var(--text-2)', letterSpacing: 1 }}>
                      {req.status === 'claimed' ? `CLAIMED BY ${req.claimedBy || 'YOU'}` : 'PENDING'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {req.status === 'pending' && (
                      <button onClick={() => claimRequest(String(req.id))} style={{ fontSize: 9, letterSpacing: 1.5, background: 'none', border: '1px solid var(--border-strong)', padding: '5px 12px', cursor: 'pointer', color: 'var(--text)' }}>
                        CLAIM
                      </button>
                    )}
                    {req.status === 'claimed' && (
                      <>
                        <GradeSelector
                          onGrade={(g, n) => gradeModule(req.pilotId, req.moduleId, g, n)}
                        />
                        <button onClick={() => unclaimRequest(String(req.id))} style={{ fontSize: 9, background: 'none', border: '1px solid var(--border)', padding: '5px 12px', cursor: 'pointer', color: 'var(--text-3)' }}>
                          UNCLAIM
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Pilot List */}
        {tab === 'pilots' && (
          <div style={{ display: 'grid', gridTemplateColumns: activeSub ? '260px 1fr' : '1fr', gap: 24 }}>
            <div>
              {Object.values(pilots).map(p => (
                <button
                  key={p.sub}
                  onClick={() => setActiveSub(s => s === p.sub ? null : p.sub)}
                  style={{ width: '100%', textAlign: 'left', background: activeSub === p.sub ? 'var(--bg2)' : 'var(--bg-card)', border: `1px solid ${activeSub === p.sub ? 'var(--accent)' : 'var(--border)'}`, padding: '10px 14px', marginBottom: 4, cursor: 'pointer', color: 'var(--text)', fontSize: 12 }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, marginBottom: 2 }}>{p.callsign || p.name || p.sub.slice(0, 12)}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{pilotSquadrons[p.sub] || '—'}</div>
                </button>
              ))}
            </div>

            {activeSub && activePilot && tree && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 16 }}>
                  {activePilot.callsign || activePilot.name || activeSub}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 12 }}>{pilotSquadrons[activeSub] || 'No squadron'}</span>
                </div>
                {tree.categories.map(cat => (
                  <div key={cat.id} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{cat.name}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                      {cat.modules.map(mod => {
                        const gradeRec = activePilotGrades[mod.id];
                        return (
                          <div key={mod.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '10px 12px' }}>
                            <div style={{ fontSize: 11, marginBottom: 8 }}>{mod.name}</div>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              {VALID_GRADES.map(g => (
                                <button
                                  key={g}
                                  onClick={() => gradeModule(activeSub, mod.id, g, '')}
                                  style={{ fontSize: 9, padding: '3px 8px', border: `1px solid ${gradeRec?.grade === g ? GRADE_COLORS[g] : 'var(--border)'}`, background: gradeRec?.grade === g ? (GRADE_COLORS[g] + '33') : 'transparent', color: gradeRec?.grade === g ? GRADE_COLORS[g] : 'var(--text-3)', cursor: 'pointer' }}
                                >
                                  {g}
                                </button>
                              ))}
                              {gradeRec && (
                                <button onClick={() => deleteGrade(activeSub, mod.id)} style={{ fontSize: 9, padding: '3px 8px', border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', cursor: 'pointer', marginLeft: 4 }}>✕</button>
                              )}
                            </div>
                            {gradeRec?.gradedBy && (
                              <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4 }}>by {gradeRec.gradedBy}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Skill Tree Editor */}
        {tab === 'tree' && tree && (
          <SkillTreeEditor tree={tree} onSaved={() => { loadAll(); showToast('Skill tree saved'); }} />
        )}
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg2)', border: '1px solid var(--border-strong)', padding: '10px 20px', fontSize: 11, zIndex: 300 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ── Grade Selector inline component ── */
function GradeSelector({ onGrade }: { onGrade: (grade: string, notes: string) => void }) {
  const [g, setG] = useState('G');
  const [n, setN] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <select value={g} onChange={e => setG(e.target.value)} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', color: 'var(--text)', padding: '4px 8px', fontSize: 10, fontFamily: 'inherit' }}>
        {VALID_GRADES.map(v => <option key={v} value={v}>{v}</option>)}
      </select>
      <input placeholder="notes" value={n} onChange={e => setN(e.target.value)} style={{ background: 'transparent', border: '1px solid var(--border)', padding: '4px 8px', fontSize: 10, color: 'var(--text)', fontFamily: 'inherit', width: 100 }} />
      <button onClick={() => onGrade(g, n)} style={{ fontSize: 9, letterSpacing: 1.5, background: 'var(--accent)', border: 'none', padding: '5px 12px', cursor: 'pointer', color: 'var(--text-inv)' }}>
        GRADE
      </button>
    </div>
  );
}

/* ── Simple Skill Tree Editor ── */
function SkillTreeEditor({ tree, onSaved }: { tree: SkillTreeData; onSaved: () => void }) {
  const [draft, setDraft] = useState<SkillTreeData>(() => JSON.parse(JSON.stringify(tree)));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await apiFetch('/api/skill-tree', { method: 'PUT', body: JSON.stringify(draft) });
      onSaved();
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Editing skill tree — {draft.categories.length} categories</span>
        <button onClick={save} disabled={saving} style={{ background: 'var(--accent)', border: 'none', color: 'var(--text-inv)', padding: '6px 16px', fontSize: 10, cursor: 'pointer', letterSpacing: 1.5 }}>
          {saving ? 'SAVING…' : 'SAVE TREE'}
        </button>
      </div>
      <textarea
        value={JSON.stringify(draft, null, 2)}
        onChange={e => { try { setDraft(JSON.parse(e.target.value)); } catch { /* invalid JSON while typing */ } }}
        rows={40}
        style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', padding: '12px', fontSize: 11, color: 'var(--text)', fontFamily: 'var(--font-mono)', lineHeight: 1.5, resize: 'vertical' }}
      />
    </div>
  );
}

