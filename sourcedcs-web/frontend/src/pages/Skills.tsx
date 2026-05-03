import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';
import type { SkillCategory, SkillGrade, GradingRequest } from '../types';

interface SkillTreeData { categories: SkillCategory[] }

const GRADE_VALUES: Record<string, number> = { U: 0, F: 1, G: 2, E: 3 };
const GRADE_NAMES: Record<string, string>  = { U: 'Unsatisfactory', F: 'Fair', G: 'Good', E: 'Excellent' };
const GRADE_COLORS: Record<string, string> = { U: 'var(--red)', F: 'var(--yellow,#d4a800)', G: 'var(--blue)', E: 'var(--green)' };

function gradeValue(g: string | null | undefined) {
  return g != null && GRADE_VALUES[g] != null ? GRADE_VALUES[g] : -1;
}

interface ModuleGrade { grade: string }

type MyGrades = Record<string, ModuleGrade>;

interface SkillModuleExt {
  id: string;
  name: string;
  description?: string;
  min_pass_grade?: string;
  prerequisites?: { module_id: string; min_grade: string }[];
}

interface SkillCategoryExt extends SkillCategory {
  modules: SkillModuleExt[];
  weight?: number;
  squadrons?: string[];
}

function moduleState(mod: SkillModuleExt, grades: MyGrades): 'locked' | 'not-started' | 'in-progress' | 'completed' {
  for (const p of (mod.prerequisites || [])) {
    const gr = grades[p.module_id]?.grade ?? null;
    if (gradeValue(gr) < gradeValue(p.min_grade)) return 'locked';
  }
  const myGrade = grades[mod.id]?.grade ?? null;
  if (myGrade == null) return 'not-started';
  if (gradeValue(myGrade) >= gradeValue(mod.min_pass_grade ?? 'G')) return 'completed';
  return 'in-progress';
}

function categoryScore(cat: SkillCategoryExt, grades: MyGrades): number {
  const mods = cat.modules || [];
  if (!mods.length) return 0;
  const done = mods.filter(m => moduleState(m, grades) === 'completed').length;
  return done / mods.length;
}

const STATE_COLORS: Record<string, string> = {
  locked:       'var(--text-3)',
  'not-started': 'var(--text-2)',
  'in-progress': 'var(--yellow,#d4a800)',
  completed:    'var(--green)',
};

export default function Skills() {
  const { token, isSkillAdmin } = useAuth();
  const [tree, setTree]         = useState<SkillTreeData | null>(null);
  const [grades, setGrades]     = useState<MyGrades>({});
  const [requests, setRequests] = useState<GradingRequest[]>([]);
  const [mySquadron, setMySquadron] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [toast, setToast]       = useState('');

  const mySub = token ? (() => {
    try {
      const parts = token.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.sub as string | null || null;
    } catch { return null; }
  })() : null;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  useEffect(() => {
    if (!token) return;

    Promise.all([
      apiFetch<SkillTreeData>('/api/skill-tree'),
      apiFetch<Record<string, Record<string, SkillGrade>>>('/api/skill-grades'),
      apiFetch<GradingRequest[]>('/api/grading-requests'),
      apiFetch<{ squadron: string | null }>('/api/my-squadron').catch(() => ({ squadron: null })),
    ]).then(([treeData, gradesMap, reqs, mySquadronData]) => {
      setTree(treeData);
      const sub = (() => {
        try {
          const parts = token.split('.');
          const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          return p.sub || '';
        } catch { return ''; }
      })();
      setGrades((sub && gradesMap[sub]) ? (gradesMap[sub] as MyGrades) : {});
      setRequests(Array.isArray(reqs) ? reqs : []);
      setMySquadron(mySquadronData?.squadron ?? null);
    }).catch(() => showToast('Failed to load skill data'));
  }, [token]);

  const visibleCats = useCallback((): SkillCategoryExt[] => {
    if (!tree) return [];
    return (tree.categories as SkillCategoryExt[]).filter(cat => {
      const sqs = cat.squadrons;
      if (!sqs || !sqs.length) return true;
      if (!mySquadron) return false;
      return sqs.includes(mySquadron);
    });
  }, [tree, mySquadron]);

  async function requestGrading(moduleId: string, moduleName: string, categoryId: string) {
    try {
      await apiFetch('/api/grading-requests', {
        method: 'POST',
        body: JSON.stringify({ moduleId, moduleName, categoryId }),
      });
      const reqs = await apiFetch<GradingRequest[]>('/api/grading-requests');
      setRequests(Array.isArray(reqs) ? reqs : []);
      showToast('Grading request submitted');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to submit request');
    }
  }

  async function cancelRequest(reqId: string) {
    try {
      await apiFetch(`/api/grading-requests/${reqId}`, { method: 'DELETE' });
      setRequests(rs => rs.filter(r => r.id !== reqId));
      showToast('Request cancelled');
    } catch { showToast('Failed to cancel request'); }
  }

  if (!token) {
    return (
      <div>
        <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 8 }}>QUALIFICATION RECORD</div>
          <h1 style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(20px, 3vw, 36px)', letterSpacing: 4, marginBottom: 8 }}>TRAINING OVERVIEW</h1>
        </div>
        <div style={{ maxWidth: 600, margin: '60px auto', padding: '0 24px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13, lineHeight: 1.8 }}>
          Log in to view your skill record and request evaluations.
        </div>
      </div>
    );
  }

  const cats = visibleCats();
  const totalWeight = cats.reduce((s, c) => s + (c.weight || 0), 0);
  const overall = totalWeight
    ? cats.reduce((s, cat) => s + (cat.weight || 0) * categoryScore(cat, grades), 0) / totalWeight
    : 0;

  const myPending = requests.filter(r =>
    (r as unknown as { pilot_id?: string }).pilot_id === mySub &&
    (r.status === 'pending' || r.status === 'claimed')
  );

  return (
    <div>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '48px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 8 }}>QUALIFICATION RECORD</div>
        <h1 style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(20px, 3vw, 36px)', letterSpacing: 4, marginBottom: 8 }}>TRAINING OVERVIEW</h1>
        <p style={{ fontSize: 11, color: 'var(--text-3)' }}>Track your qualifications · Request evaluations</p>
        {isSkillAdmin && (
          <a href="/skills-admin" style={{ display: 'inline-block', marginTop: 12, fontSize: 10, letterSpacing: 2, color: 'var(--accent)', textDecoration: 'none' }}>
            ADMIN PANEL →
          </a>
        )}
      </div>

      {tree && (
        <>
          {/* Score bar */}
          <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '16px 24px' }}>
            <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 4 }}>OVERALL PROGRESS</div>
                <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 24, fontWeight: 700, color: 'var(--accent)' }}>
                  {Math.round(overall * 100)}%
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {cats.map(cat => {
                  const score = Math.round(categoryScore(cat, grades) * 100);
                  const done = cat.modules.filter(m => moduleState(m, grades) === 'completed').length;
                  return (
                    <div key={cat.id} style={{ minWidth: 140 }}>
                      <div style={{ fontSize: 9, letterSpacing: 1, color: 'var(--text-3)', marginBottom: 4 }}>
                        {cat.name} <span style={{ color: 'var(--text-3)' }}>{cat.weight}%</span>
                      </div>
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginBottom: 2 }}>
                        <div style={{ height: '100%', width: `${score}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width .3s' }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{done}/{cat.modules.length} · {score}%</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Skill tree */}
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
            {cats.map(cat => {
              const isCollapsed = !!collapsed[cat.id];
              const done = cat.modules.filter(m => moduleState(m, grades) === 'completed').length;
              return (
                <div key={cat.id} style={{ marginBottom: 24, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <button
                    onClick={() => setCollapsed(c => ({ ...c, [cat.id]: !c[cat.id] }))}
                    style={{ width: '100%', background: 'var(--bg2)', border: 'none', borderBottom: '1px solid var(--border)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', color: 'var(--text)' }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: 2 }}>{cat.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{done}/{cat.modules.length} {isCollapsed ? '▸' : '▾'}</span>
                  </button>
                  {!isCollapsed && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 1, background: 'var(--border)' }}>
                      {cat.modules.map(mod => {
                        const state = moduleState(mod, grades);
                        const myGrade = grades[mod.id]?.grade;
                        const pendingReq = requests.find(r =>
                          r.moduleId === mod.id &&
                          (r as unknown as { pilot_id?: string }).pilot_id === mySub &&
                          (r.status === 'pending' || r.status === 'claimed')
                        );
                        return (
                          <div key={mod.id} style={{ background: 'var(--bg-card)', padding: '14px 16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{mod.name}</div>
                              <span style={{ fontSize: 9, letterSpacing: 1, color: STATE_COLORS[state], whiteSpace: 'nowrap', marginLeft: 8 }}>{state.replace('-', ' ').toUpperCase()}</span>
                            </div>
                            {mod.description && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8, lineHeight: 1.5 }}>{mod.description}</div>}
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              {myGrade && (
                                <span style={{ fontSize: 10, color: GRADE_COLORS[myGrade] || 'var(--text-2)', border: `1px solid ${GRADE_COLORS[myGrade] || 'var(--border)'}`, padding: '2px 8px' }}>
                                  {myGrade} — {GRADE_NAMES[myGrade]}
                                </span>
                              )}
                              {state !== 'locked' && state !== 'completed' && !pendingReq && (
                                <button
                                  onClick={() => requestGrading(mod.id, mod.name, cat.id)}
                                  style={{ fontSize: 9, letterSpacing: 1.5, background: 'none', border: '1px solid var(--border-strong)', padding: '3px 10px', cursor: 'pointer', color: 'var(--text)' }}
                                >
                                  REQUEST EVAL
                                </button>
                              )}
                              {pendingReq && (
                                <span style={{ fontSize: 9, color: 'var(--yellow,#d4a800)', letterSpacing: 1 }}>
                                  PENDING
                                  <button onClick={() => cancelRequest(String(pendingReq.id))} style={{ marginLeft: 8, fontSize: 9, background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pending requests */}
            {myPending.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 12 }}>YOUR GRADING REQUESTS</div>
                {myPending.map(req => (
                  <div key={req.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 12, marginBottom: 4 }}>{req.moduleName}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                        {req.status === 'claimed' ? `CLAIMED BY ${req.claimedBy || 'INSTRUCTOR'}` : 'PENDING INSTRUCTOR'}
                      </div>
                    </div>
                    <button onClick={() => cancelRequest(String(req.id))} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', padding: '4px 10px', fontSize: 9, cursor: 'pointer' }}>
                      CANCEL
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--bg2)', border: '1px solid var(--border-strong)', padding: '10px 20px', fontSize: 11, zIndex: 300 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
