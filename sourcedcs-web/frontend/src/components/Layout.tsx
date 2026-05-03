import { useState } from 'react';
import { Outlet, Link, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useConfig } from '../contexts/ConfigContext';

export default function Layout() {
  const { user, login, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const config = useConfig();
  const [navOpen, setNavOpen] = useState(false);

  const userName = user?.name?.toUpperCase() || 'USER';

  return (
    <>
      <div className="scanline" />
      <header style={{ position:'sticky', top:0, zIndex:100, height:48, display:'flex', alignItems:'center', gap:20, padding:'0 24px', background:'var(--bg2)', borderBottom:'1px solid var(--border-strong)' }}>
        <Link to="/" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none' }}>
          <img src="/sourcelogobg.png" alt="SOURCE logo" style={{ width:24, height:24, borderRadius:4 }} />
          <span style={{ fontFamily:'var(--font-mono)', fontWeight:600, fontSize:13, letterSpacing:4, color:'var(--text)', whiteSpace:'nowrap' }}>SOURCEDCS</span>
        </Link>

        <nav style={{ display:'flex', gap:16 }}>
          <NavLink to="/#about" style={{ fontSize:11, letterSpacing:2, color:'var(--text-2)', textTransform:'uppercase' }}>ABOUT</NavLink>
          <NavLink to="/#subsquadrons" style={{ fontSize:11, letterSpacing:2, color:'var(--text-2)', textTransform:'uppercase' }}>WINGS</NavLink>
          <NavLink to="/#join" style={{ fontSize:11, letterSpacing:2, color:'var(--text-2)', textTransform:'uppercase' }}>JOIN</NavLink>
        </nav>

        <div style={{ flex:1 }} />

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button
            onClick={() => setNavOpen(o => !o)}
            aria-label="Toggle menu"
            aria-expanded={navOpen}
            style={{ display:'none', background:'none', border:'none', padding:4, cursor:'pointer' }}
          >☰</button>

          {user ? (
            <button
              onClick={logout}
              title="Click to log out"
              style={{ background:'none', border:'1px solid var(--border-strong)', padding:'4px 12px', fontSize:11, letterSpacing:1, color:'var(--text)', cursor:'pointer' }}
            >
              {userName} ⏻
            </button>
          ) : (
            <button
              onClick={login}
              style={{ background:'none', border:'1px solid var(--border-strong)', padding:'4px 12px', fontSize:11, letterSpacing:1, color:'var(--text)', cursor:'pointer' }}
            >
              LOGIN
            </button>
          )}

          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <span style={{ fontSize:7, letterSpacing:1.5, color:'var(--text-3)', textTransform:'uppercase' }}>DISPLAY</span>
            <div style={{ display:'flex', border:'1px solid var(--border-strong)', background:'var(--bg3)', overflow:'hidden' }}>
              <button
                onClick={() => setTheme('pro')}
                style={{ border:'none', background: theme === 'pro' ? 'var(--text)' : 'transparent', padding:'4px 10px', fontSize:9, letterSpacing:1, color: theme === 'pro' ? 'var(--text-inv)' : 'var(--text-3)', cursor:'pointer' }}
              >PROF</button>
              <button
                onClick={() => setTheme('movie')}
                style={{ border:'none', background: theme === 'movie' ? 'var(--accent)' : 'transparent', padding:'4px 10px', fontSize:9, letterSpacing:1, color: theme === 'movie' ? '#000' : 'var(--text-3)', cursor:'pointer' }}
              >MFD</button>
            </div>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <footer style={{ background:'var(--bg2)', borderTop:'1px solid var(--border)', padding:'40px 24px', marginTop:64 }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
            <img src="/sourcelogobg.png" alt="SOURCE" style={{ width:32, height:32, borderRadius:6 }} />
            <span style={{ fontFamily:'Orbitron, monospace', fontSize:15, fontWeight:700, letterSpacing:4 }}>SOURCEDCS</span>
          </div>
          <div style={{ display:'flex', gap:20, flexWrap:'wrap', marginBottom:20, fontSize:11, letterSpacing:1 }}>
            <Link to="/" style={{ color:'var(--text-2)' }}>HOME</Link>
            {config.discordUrl && <a href={config.discordUrl} target="_blank" rel="noopener noreferrer" style={{ color:'var(--text-2)' }}>DISCORD</a>}
            {config.wikiUrl && <a href={config.wikiUrl} target="_blank" rel="noopener noreferrer" style={{ color:'var(--text-2)' }}>WIKI</a>}
            <Link to="/schedule" style={{ color:'var(--text-2)' }}>SCHEDULE</Link>
            {config.githubUrl && <a href={config.githubUrl} target="_blank" rel="noopener noreferrer" style={{ color:'var(--text-2)' }}>GITHUB</a>}
          </div>
          <p style={{ fontSize:10, color:'var(--text-3)', letterSpacing:1 }}>© {new Date().getFullYear()} SOURCE DCS — VIRTUAL AVIATION SQUADRON</p>
        </div>
      </footer>
    </>
  );
}
