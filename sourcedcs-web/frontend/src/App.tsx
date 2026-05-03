import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from './contexts/ConfigContext';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Gallery from './pages/Gallery';
import Schedule from './pages/Schedule';
import Wing from './pages/Wing';
import Skills from './pages/Skills';
import SkillsAdmin from './pages/SkillsAdmin';
import FlightPlan from './pages/FlightPlan';
import AuthCallback from './pages/AuthCallback';

export default function App() {
  return (
    <ConfigProvider>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/auth-callback" element={<AuthCallback />} />
              <Route element={<Layout />}>
                <Route path="/" element={<Home />} />
                <Route path="/gallery" element={<Gallery />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="/wing/:id" element={<Wing />} />
                <Route path="/skills" element={<Skills />} />
                <Route path="/skills-admin" element={<SkillsAdmin />} />
                <Route path="/flightplan" element={<FlightPlan />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ConfigProvider>
  );
}
