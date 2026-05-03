import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../api';

/* ── DD Form 175 types ── */
interface FpLeg {
  flightRules: string;
  trueAirspeed: string;
  departure: string;
  departureTime: string;
  altitude: string;
  route: string;
  destination: string;
  ete: string;
}
interface FpCrew {
  dutyPosition: string;
  nameInitials: string;
  rank: string;
  memberId: string;
  orgStation: string;
}
interface Dd175Plan {
  id: number;
  submittedAt: string;
  submittedBy: { sub: string; name: string };
  date: string;
  callSign: string;
  aircraftDesig: string;
  legs: FpLeg[];
  crew: FpCrew[];
  remarks?: string;
  rankHonorCode?: string;
  fuelOnBoard?: string;
  alternateAirfield?: string;
  eteToAlternate?: string;
  notamsChecked?: boolean;
  weatherBrief?: string;
  weightBalance?: string;
  aircraftSerial?: string;
  status?: string;
  baseOps?: { approvalSignature: string; actualDepartureTime: string; crewListAttached: boolean; approvedAt: string | null };
}

/* ── DD Form 1801 types ── */
interface Dd1801Plan {
  id: number;
  submittedAt: string;
  submittedBy: { sub: string; name: string };
  aircraftId: string;
  aircraftType?: string;
  flightRules?: string;
  typeOfFlight?: string;
  depAerodrome?: string;
  depTime?: string;
  speedValue?: string;
  levelValue?: string;
  route?: string;
  destAerodrome?: string;
  eet?: string;
  altn1?: string;
  altn2?: string;
  endurance?: string;
  pob?: string;
  pic?: string;
  remarks?: string;
  status?: string;
}

interface FpConfig {
  controllerSquadron: string;
  availableSquadrons: string[];
  isController: boolean;
  notifyChannelId?: string;
}

const DUTY_POSITIONS = ['PILOT IN COMMAND', 'CP', 'CE', 'TO', 'N', 'CDR', 'PASSENGER', 'OTHER'];

function Field({ label, value, onChange, placeholder, type = 'text', maxLength, style }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength?: number; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)' }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        style={{ background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', width: '100%' }}
      />
    </div>
  );
}

export default function FlightPlan() {
  const { token, isAdmin } = useAuth();
  const [tab, setTab] = useState<'175' | '1801'>('175');
  const [fpConfig, setFpConfig] = useState<FpConfig>({ controllerSquadron: '', availableSquadrons: [], isController: false });

  /* DD-175 state */
  const [plans175, setPlans175]   = useState<Dd175Plan[]>([]);
  const [legs, setLegs]           = useState<FpLeg[]>([{ flightRules: 'I', trueAirspeed: '', departure: '', departureTime: '', altitude: '', route: '', destination: '', ete: '' }]);
  const [crew, setCrew]           = useState<FpCrew[]>([{ dutyPosition: 'PILOT IN COMMAND', nameInitials: '', rank: '', memberId: '', orgStation: '' }]);
  const [fp175, setFp175]         = useState({ date: '', callSign: '', aircraftDesig: '', authority: '', remarks: '', rankHonorCode: '', fuelOnBoard: '', alternateAirfield: '', eteToAlternate: '', notamsChecked: false, weatherBrief: '', weightBalance: '', aircraftSerial: '' });
  const [submitting175, setSubmitting175] = useState(false);
  const [error175, setError175]   = useState('');

  /* DD-1801 state */
  const [plans1801, setPlans1801] = useState<Dd1801Plan[]>([]);
  const [fp1801, setFp1801]       = useState({ aircraftId: '', aircraftType: '', flightRules: 'I', typeOfFlight: 'M', depAerodrome: '', depTime: '', speedValue: '', speedUnit: 'N', levelValue: '', levelUnit: 'F', route: '', destAerodrome: '', eet: '', altn1: '', altn2: '', otherInfo: '', endurance: '', pob: '', pic: '' });
  const [submitting1801, setSubmitting1801] = useState(false);
  const [error1801, setError1801] = useState('');

  const [toast, setToast]         = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<FpConfig>('/api/flight-plans/config').then(setFpConfig).catch(() => { /* not fatal */ });
    apiFetch<Dd175Plan[]>('/api/flight-plans').then(setPlans175).catch(() => { /* not fatal */ });
    apiFetch<Dd1801Plan[]>('/api/fpl1801').then(setPlans1801).catch(() => { /* not fatal */ });
  }, [token]);
  useEffect(() => { load(); }, [load]);

  /* ── DD-175 submission ── */
  async function submit175() {
    setError175('');
    if (!fp175.date || !fp175.callSign || !fp175.aircraftDesig) {
      setError175('Date, call sign and aircraft designation are required.'); return;
    }
    setSubmitting175(true);
    try {
      await apiFetch('/api/flight-plans', { method: 'POST', body: JSON.stringify({ ...fp175, legs, crew }) });
      showToast('Flight plan submitted');
      setFp175({ date: '', callSign: '', aircraftDesig: '', authority: '', remarks: '', rankHonorCode: '', fuelOnBoard: '', alternateAirfield: '', eteToAlternate: '', notamsChecked: false, weatherBrief: '', weightBalance: '', aircraftSerial: '' });
      setLegs([{ flightRules: 'I', trueAirspeed: '', departure: '', departureTime: '', altitude: '', route: '', destination: '', ete: '' }]);
      setCrew([{ dutyPosition: 'PILOT IN COMMAND', nameInitials: '', rank: '', memberId: '', orgStation: '' }]);
      load();
    } catch (e: unknown) { setError175(e instanceof Error ? e.message : 'Submission failed'); }
    finally { setSubmitting175(false); }
  }

  /* ── DD-1801 submission ── */
  async function submit1801() {
    setError1801('');
    if (!fp1801.aircraftId || !fp1801.depAerodrome || !fp1801.destAerodrome) {
      setError1801('Aircraft ID, departure and destination are required.'); return;
    }
    setSubmitting1801(true);
    try {
      await apiFetch('/api/fpl1801', { method: 'POST', body: JSON.stringify(fp1801) });
      showToast('ICAO flight plan submitted');
      setFp1801({ aircraftId: '', aircraftType: '', flightRules: 'I', typeOfFlight: 'M', depAerodrome: '', depTime: '', speedValue: '', speedUnit: 'N', levelValue: '', levelUnit: 'F', route: '', destAerodrome: '', eet: '', altn1: '', altn2: '', otherInfo: '', endurance: '', pob: '', pic: '' });
      load();
    } catch (e: unknown) { setError1801(e instanceof Error ? e.message : 'Submission failed'); }
    finally { setSubmitting1801(false); }
  }

  async function deletePlan175(id: number) {
    if (!confirm('Delete this flight plan?')) return;
    await apiFetch(`/api/flight-plans/${id}`, { method: 'DELETE' });
    load();
  }

  async function deletePlan1801(id: number) {
    if (!confirm('Delete this plan?')) return;
    await apiFetch(`/api/fpl1801/${id}`, { method: 'DELETE' });
    load();
  }

  if (!token) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--text-2)', fontSize: 13 }}>
        Log in to access flight plan submission.
      </div>
    );
  }

  const canManage = isAdmin || fpConfig.isController;

  return (
    <div>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '32px 24px' }}>
        <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 8 }}>FLIGHT OPS</div>
        <h1 style={{ fontFamily: 'Orbitron, monospace', fontSize: 'clamp(18px, 3vw, 28px)', letterSpacing: 4 }}>FLIGHT PLAN SUBMISSION</h1>
      </div>

      {/* Form tabs */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '0 24px', display: 'flex' }}>
        {(['175', '1801'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent', padding: '12px 20px', fontSize: 10, letterSpacing: 2, cursor: 'pointer', color: tab === t ? 'var(--text)' : 'var(--text-3)' }}>
            DD FORM {t}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

        {/* ── DD-175 ── */}
        {tab === '175' && (
          <div>
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 20 }}>DD FORM 175 — MILITARY FLIGHT PLAN</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                <Field label="1. DATE" value={fp175.date} onChange={v => setFp175(f => ({ ...f, date: v }))} type="date" />
                <Field label="2. CALL SIGN" value={fp175.callSign} onChange={v => setFp175(f => ({ ...f, callSign: v }))} maxLength={16} />
                <Field label="3. AIRCRAFT" value={fp175.aircraftDesig} onChange={v => setFp175(f => ({ ...f, aircraftDesig: v }))} maxLength={32} />
                <Field label="AUTHORITY (10 USC 8012)" value={fp175.authority} onChange={v => setFp175(f => ({ ...f, authority: v }))} maxLength={64} />
                <Field label="13. RANK/HONOR CODE" value={fp175.rankHonorCode} onChange={v => setFp175(f => ({ ...f, rankHonorCode: v }))} maxLength={32} />
                <Field label="14. FUEL ON BOARD" value={fp175.fuelOnBoard} onChange={v => setFp175(f => ({ ...f, fuelOnBoard: v }))} placeholder="HHNN" maxLength={5} />
                <Field label="15. ALT AIRFIELD" value={fp175.alternateAirfield} onChange={v => setFp175(f => ({ ...f, alternateAirfield: v }))} maxLength={4} />
                <Field label="16. ETE TO ALTN" value={fp175.eteToAlternate} onChange={v => setFp175(f => ({ ...f, eteToAlternate: v }))} placeholder="HHNN" maxLength={5} />
                <Field label="18. WEATHER BRIEF" value={fp175.weatherBrief} onChange={v => setFp175(f => ({ ...f, weatherBrief: v }))} maxLength={64} />
                <Field label="19. WT &amp; BALANCE" value={fp175.weightBalance} onChange={v => setFp175(f => ({ ...f, weightBalance: v }))} maxLength={64} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: 'pointer' }}>
                  <input type="checkbox" checked={fp175.notamsChecked} onChange={e => setFp175(f => ({ ...f, notamsChecked: e.target.checked }))} />
                  17. NOTAMs Reviewed
                </label>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>20. A/C SERIAL / UNIT / STATION</label>
                <input value={fp175.aircraftSerial} onChange={e => setFp175(f => ({ ...f, aircraftSerial: e.target.value }))} maxLength={128} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }} />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>12. REMARKS</label>
                <textarea value={fp175.remarks} onChange={e => setFp175(f => ({ ...f, remarks: e.target.value }))} rows={3} maxLength={1000} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }} />
              </div>

              {/* Route Legs */}
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 12 }}>9. ROUTE OF FLIGHT</div>
              {legs.map((leg, i) => (
                <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>LEG {i + 1}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                    {([['RULES', 'flightRules', 1], ['TAS', 'trueAirspeed', 6], ['FROM', 'departure', 4], ['DEP TIME', 'departureTime', 4], ['ALT', 'altitude', 6], ['TO', 'destination', 4], ['ETE', 'ete', 5]] as [string, keyof FpLeg, number][]).map(([lbl, key, mx]) => (
                      <div key={key}>
                        <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 3 }}>{lbl}</label>
                        <input value={leg[key]} onChange={e => setLegs(ls => ls.map((l, j) => j === i ? { ...l, [key]: e.target.value } : l))} maxLength={mx} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '5px 8px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }} />
                      </div>
                    ))}
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 3 }}>ROUTE</label>
                      <input value={leg.route} onChange={e => setLegs(ls => ls.map((l, j) => j === i ? { ...l, route: e.target.value } : l))} maxLength={500} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '5px 8px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }} />
                    </div>
                  </div>
                  {legs.length > 1 && <button onClick={() => setLegs(ls => ls.filter((_, j) => j !== i))} style={{ marginTop: 8, fontSize: 9, background: 'none', border: '1px solid var(--red)', color: 'var(--red)', padding: '3px 10px', cursor: 'pointer' }}>REMOVE LEG</button>}
                </div>
              ))}
              <button onClick={() => setLegs(ls => [...ls, { flightRules: 'I', trueAirspeed: '', departure: '', departureTime: '', altitude: '', route: '', destination: '', ete: '' }])} style={{ fontSize: 9, letterSpacing: 1.5, background: 'none', border: '1px solid var(--border-strong)', padding: '6px 14px', cursor: 'pointer', color: 'var(--text)', marginBottom: 24 }}>
                ⊕ ADD LEG
              </button>

              {/* Crew */}
              <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 12 }}>CREW / PASSENGERS</div>
              {crew.map((c, i) => (
                <div key={i} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '12px 16px', marginBottom: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 3 }}>DUTY POSITION</label>
                      <select value={c.dutyPosition} onChange={e => setCrew(cs => cs.map((x, j) => j === i ? { ...x, dutyPosition: e.target.value } : x))} style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', padding: '5px 8px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }}>
                        {DUTY_POSITIONS.map(dp => <option key={dp}>{dp}</option>)}
                      </select>
                    </div>
                    {([['NAME/INITIALS', 'nameInitials', 32], ['RANK', 'rank', 8], ['MEMBER ID', 'memberId', 32], ['ORG/STATION', 'orgStation', 64]] as [string, keyof FpCrew, number][]).map(([lbl, key, mx]) => (
                      <div key={key}>
                        <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 3 }}>{lbl}</label>
                        <input value={c[key]} onChange={e => setCrew(cs => cs.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x))} maxLength={mx} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '5px 8px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }} />
                      </div>
                    ))}
                  </div>
                  {crew.length > 1 && <button onClick={() => setCrew(cs => cs.filter((_, j) => j !== i))} style={{ marginTop: 8, fontSize: 9, background: 'none', border: '1px solid var(--red)', color: 'var(--red)', padding: '3px 10px', cursor: 'pointer' }}>REMOVE</button>}
                </div>
              ))}
              <button onClick={() => setCrew(cs => [...cs, { dutyPosition: 'CP', nameInitials: '', rank: '', memberId: '', orgStation: '' }])} style={{ fontSize: 9, letterSpacing: 1.5, background: 'none', border: '1px solid var(--border-strong)', padding: '6px 14px', cursor: 'pointer', color: 'var(--text)', marginBottom: 24 }}>
                ⊕ ADD CREW
              </button>

              {error175 && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 12 }}>{error175}</div>}
              <button onClick={submit175} disabled={submitting175} style={{ background: 'var(--accent)', color: 'var(--text-inv)', border: 'none', padding: '10px 24px', fontSize: 11, letterSpacing: 2, cursor: 'pointer', opacity: submitting175 ? 0.7 : 1 }}>
                {submitting175 ? 'SUBMITTING…' : 'SUBMIT FLIGHT PLAN'}
              </button>
            </div>

            {/* Plans list */}
            {plans175.length > 0 && (
              <div style={{ marginTop: 40 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 16 }}>SUBMITTED PLANS</div>
                {plans175.map(plan => (
                  <div key={plan.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '14px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>FP-{plan.id} — {plan.callSign}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>{plan.date} · {plan.aircraftDesig} · {plan.submittedBy.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{(plan.legs || []).map(l => `${l.departure}→${l.destination}`).join(', ')}</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, marginTop: 4, color: plan.status === 'approved' ? 'var(--green)' : 'var(--text-3)' }}>
                        {(plan.status || 'submitted').toUpperCase()}
                        {plan.baseOps?.approvalSignature && ` · ${plan.baseOps.approvalSignature}`}
                      </div>
                    </div>
                    {canManage && (
                      <button onClick={() => deletePlan175(plan.id)} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', padding: '4px 10px', fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── DD-1801 ── */}
        {tab === '1801' && (
          <div>
            <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 20 }}>DD FORM 1801 — ICAO IFR FLIGHT PLAN</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <Field label="7. AIRCRAFT ID" value={fp1801.aircraftId} onChange={v => setFp1801(f => ({ ...f, aircraftId: v }))} maxLength={7} />
              <Field label="AIRCRAFT TYPE" value={fp1801.aircraftType} onChange={v => setFp1801(f => ({ ...f, aircraftType: v }))} maxLength={4} />
              <div>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>8. FLIGHT RULES</label>
                <select value={fp1801.flightRules} onChange={e => setFp1801(f => ({ ...f, flightRules: e.target.value }))} style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }}>
                  <option value="I">I — IFR</option>
                  <option value="V">V — VFR</option>
                  <option value="Y">Y — IFR first</option>
                  <option value="Z">Z — VFR first</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>TYPE OF FLIGHT</label>
                <select value={fp1801.typeOfFlight} onChange={e => setFp1801(f => ({ ...f, typeOfFlight: e.target.value }))} style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit' }}>
                  <option value="M">M — Military</option>
                  <option value="S">S — Scheduled</option>
                  <option value="N">N — Non-scheduled</option>
                  <option value="G">G — General</option>
                  <option value="X">X — Other</option>
                </select>
              </div>
              <Field label="13. DEPARTURE" value={fp1801.depAerodrome} onChange={v => setFp1801(f => ({ ...f, depAerodrome: v.toUpperCase() }))} maxLength={4} placeholder="ICAO" />
              <Field label="DEP TIME (UTC)" value={fp1801.depTime} onChange={v => setFp1801(f => ({ ...f, depTime: v }))} maxLength={4} placeholder="HHMM" />
              <Field label="SPEED" value={fp1801.speedValue} onChange={v => setFp1801(f => ({ ...f, speedValue: v }))} maxLength={4} />
              <Field label="LEVEL" value={fp1801.levelValue} onChange={v => setFp1801(f => ({ ...f, levelValue: v }))} maxLength={4} />
              <Field label="15. DESTINATION" value={fp1801.destAerodrome} onChange={v => setFp1801(f => ({ ...f, destAerodrome: v.toUpperCase() }))} maxLength={4} placeholder="ICAO" />
              <Field label="EET (HHNN)" value={fp1801.eet} onChange={v => setFp1801(f => ({ ...f, eet: v }))} maxLength={4} />
              <Field label="ALTN 1" value={fp1801.altn1} onChange={v => setFp1801(f => ({ ...f, altn1: v.toUpperCase() }))} maxLength={4} />
              <Field label="ALTN 2" value={fp1801.altn2} onChange={v => setFp1801(f => ({ ...f, altn2: v.toUpperCase() }))} maxLength={4} />
              <Field label="ENDURANCE (HHNN)" value={fp1801.endurance} onChange={v => setFp1801(f => ({ ...f, endurance: v }))} maxLength={4} />
              <Field label="PERSONS ON BOARD" value={fp1801.pob} onChange={v => setFp1801(f => ({ ...f, pob: v }))} maxLength={8} />
              <Field label="PIC NAME" value={fp1801.pic} onChange={v => setFp1801(f => ({ ...f, pic: v.toUpperCase() }))} maxLength={56} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>15b. ROUTE</label>
              <textarea value={fp1801.route} onChange={e => setFp1801(f => ({ ...f, route: e.target.value.toUpperCase() }))} rows={4} maxLength={1000} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 9, letterSpacing: 1.5, color: 'var(--text-3)', marginBottom: 4 }}>OTHER INFO</label>
              <textarea value={fp1801.otherInfo} onChange={e => setFp1801(f => ({ ...f, otherInfo: e.target.value.toUpperCase() }))} rows={2} maxLength={500} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '6px 10px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            {error1801 && <div style={{ color: 'var(--red)', fontSize: 11, marginBottom: 12 }}>{error1801}</div>}
            <button onClick={submit1801} disabled={submitting1801} style={{ background: 'var(--accent)', color: 'var(--text-inv)', border: 'none', padding: '10px 24px', fontSize: 11, letterSpacing: 2, cursor: 'pointer', opacity: submitting1801 ? 0.7 : 1 }}>
              {submitting1801 ? 'SUBMITTING…' : 'SUBMIT ICAO PLAN'}
            </button>

            {/* Plans list */}
            {plans1801.length > 0 && (
              <div style={{ marginTop: 40 }}>
                <div style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-3)', marginBottom: 16 }}>SUBMITTED PLANS</div>
                {plans1801.map(plan => (
                  <div key={plan.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '14px 16px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>1801-{plan.id} — {plan.aircraftId}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 2 }}>{plan.depAerodrome} → {plan.destAerodrome} · {plan.submittedBy.name}</div>
                      <div style={{ fontSize: 9, letterSpacing: 1, marginTop: 4, color: 'var(--text-3)' }}>{(plan.status || 'submitted').toUpperCase()}</div>
                    </div>
                    {canManage && (
                      <button onClick={() => deletePlan1801(plan.id)} style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', padding: '4px 10px', fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
