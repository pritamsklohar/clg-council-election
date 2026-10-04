import { Link, NavLink, Route, Routes } from 'react-router-dom';
import Admin from './pages/Admin.jsx';
import Home from './pages/Home.jsx';
import Vote from './pages/Vote.jsx';

const COLLEGE = import.meta.env.VITE_COLLEGE_NAME || '';

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <Link to="/" className="brand">
            <img src="/logo.png" alt="CIT Logo" className="brand-logo" />
            <span>
              {COLLEGE && <small>{COLLEGE}</small>}
              Student Council Election
            </span>
          </Link>
          <nav>
            <NavLink to="/" end>Home</NavLink>
            <NavLink to="/admin">Admin</NavLink>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vote" element={<Vote />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<p className="empty">Page not found. <Link to="/">Go home</Link></p>} />
        </Routes>
      </main>
    </>
  );
}
