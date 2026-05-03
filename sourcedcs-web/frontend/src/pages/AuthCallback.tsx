import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AuthCallback() {
  const [status, setStatus] = useState('AUTHENTICATING...');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const errParam = params.get('error');

    if (errParam) {
      setError(`Casdoor error: ${params.get('error_description') || errParam}`);
      return;
    }
    if (!code) {
      setError('No authorization code received.');
      return;
    }

    const savedState = (() => { try { return sessionStorage.getItem('sdcs-oauth-state'); } catch { return null; } })();
    if (savedState && state && state !== savedState) {
      setError('State mismatch — possible CSRF attack.');
      return;
    }
    try { sessionStorage.removeItem('sdcs-oauth-state'); } catch {}

    const redirectUri = window.location.origin + '/auth-callback';

    fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok || !data.access_token) {
          setError(data.error || 'No access token received.');
          return;
        }
        const token = data.access_token;
        try { localStorage.setItem('sdcs-token', token); } catch {}
        try {
          const parts = token.split('.');
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          localStorage.setItem('sdcs-user', JSON.stringify({ name: payload.name || payload.preferred_username || payload.sub || '', email: payload.email || '' }));
        } catch {}
        setStatus('LOGGED IN — REDIRECTING...');
        let returnUrl = '/';
        try { returnUrl = localStorage.getItem('sdcs-return-url') || '/'; localStorage.removeItem('sdcs-return-url'); } catch {}
        navigate(returnUrl.startsWith('/') ? returnUrl : '/');
      })
      .catch(err => setError(`Network error: ${(err as Error).message}`));
  }, [navigate]);

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', gap:20, textAlign:'center' }}>
      <img src="/sourcelogobg.png" alt="SOURCE" style={{ width:64, height:64, borderRadius:8 }} />
      <div style={{ fontFamily:'Orbitron, monospace', fontSize:18, letterSpacing:4, color:'var(--text)' }}>SOURCEDCS</div>
      {!error && <div style={{ width:20, height:20, border:'2px solid var(--border)', borderTopColor:'var(--text)', borderRadius:'50%', animation:'spin .8s linear infinite' }} />}
      <div style={{ fontSize:11, letterSpacing:1.5, color:'var(--text-3)' }}>{status}</div>
      {error && <div style={{ fontSize:11, color:'var(--red)', maxWidth:400, lineHeight:1.6 }}>{error}</div>}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
