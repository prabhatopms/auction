import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Starfield from '../components/Starfield';
import SEO from '../components/SEO';
import { useAuth } from '../contexts/AuthContext';
import UserMenu from '../components/UserMenu';

export default function HowItWorks() {
  const { user, logout } = useAuth();

  useEffect(() => {
    document.body.classList.add('how-it-works-page-body');
    return () => document.body.classList.remove('how-it-works-page-body');
  }, []);

  const [showMobileMenu, setShowMobileMenu] = useState(false);

  return (
    <div className="how-it-works-page">
      <SEO page="how-it-works" />
      <Starfield />

      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand-link">
            <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
            <div>
              <div className="brand-name">Oxide</div>
              <div className="brand-sub">How it works</div>
            </div>
          </Link>
          <nav className="desktop-nav">
            <Link to="/" className="nav-link">Live Room</Link>
            <Link to="/lots" className="nav-link">View All Lots</Link>
          </nav>
        </div>
        <div className="topbar-center" />
        <div className="topbar-right">
          {user ? (
            <UserMenu user={user} logout={logout} />
          ) : (
            <Link className="pill auth-pill" to="/login">Sign in</Link>
          )}
        </div>
        <button 
          className="mobile-menu-toggle" 
          onClick={() => setShowMobileMenu(true)} 
          aria-label="Open navigation menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </header>

      <main className="how-it-works-content">
        <h1 className="page-title">How the Auction Works</h1>
        <p className="page-subtitle">A simple guide to our daily autonomous AI art tee drops.</p>

        <div className="explanation-grid">
          <div className="info-card">
            <div className="card-icon">🤖</div>
            <h3>Autonomous AI Creation</h3>
            <p>
              Every day, the Oxide system autonomously pulls global data signals—weird news headlines, Wikipedia top searches, music charts, and trending prediction markets. 
              Using these signals, it synthesizes an interpretive prompt to generate a completely unique, high-resolution piece of art.
            </p>
          </div>

          <div className="info-card">
            <div className="card-icon">⏳</div>
            <h3>18-Hour Active Bidding</h3>
            <p>
              Each daily drop starts a live bidding session lasting exactly <strong>18 hours</strong>. 
              Anyone can bid in real-time to win the physical piece.
            </p>
          </div>

          <div className="info-card">
            <div className="card-icon">📈</div>
            <h3>Bid Raise Logic</h3>
            <p>
              The first bid begins with a fixed price to kickstart the bidding. 
              Post that, you can only keep raising the bid by the fixed amount of ₹50. 
              After you place a bid, you must wait until someone outbids you before you can raise your bid again.
            </p>
          </div>

          <div className="info-card">
            <div className="card-icon">🏆</div>
            <h3>Winning &amp; The 2-Hour Window</h3>
            <p>
              When the 18-hour auction ends, the highest bidder wins the lot. 
              The winner has a strict <strong>2-hour payment window</strong>. 
              You can log in to this website to make your payment, and you will also receive an email notification (check Spam too)! with a checkout link. 
              If unpaid, the payment opportunity is passed to the 2nd highest bidder for 2 hours, and then the 3rd.
            </p>
          </div>

          <div className="info-card">
            <div className="card-icon">🔄</div>
            <h3>The 24-Hour Reset Cycle</h3>
            <p>
              After the 18-hour bidding concludes, a 6-hour payment settlement window occurs. 
              Immediately after this window ends, the daily auction resets and the AI launches a fresh, newly synthesized drop for the next day.
            </p>
          </div>

          <div className="info-card">
            <div className="card-icon">👕</div>
            <h3>1-of-1 Organic Cotton Print</h3>
            <p>
              The winning artwork is printed onto a single, heavyweight 220 GSM organic cotton t-shirt. 
              This is a true <strong>1-of-1 edition</strong>. Once a daily lot is settled or passed, it will never be printed or auctioned again.
            </p>
          </div>
        </div>
      </main>
      {showMobileMenu && (
        <div className="mobile-menu-overlay" onClick={() => setShowMobileMenu(false)}>
          <div className="mobile-menu-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="brand">
                <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
                <span className="brand-name">Oxide</span>
              </div>
              <button className="drawer-close" onClick={() => setShowMobileMenu(false)} aria-label="Close menu">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {user && (
              <div className="drawer-profile">
                <span className="av" style={{ background: `hsl(${user.hue ?? 200} 45% 62%)` }}>
                  {(user.name ?? user.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
                <div className="drawer-user-info">
                  <div className="drawer-user-name">{user.name || 'Anonymous User'}</div>
                  <div className="drawer-user-email">{user.email}</div>
                </div>
              </div>
            )}

            <nav className="drawer-nav">
              <Link to="/" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                <span className="icon">🏠</span> Live Auction
              </Link>
              <Link to="/lots" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                <span className="icon">📁</span> View All Lots
              </Link>
              <Link to="/how-it-works" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                <span className="icon">📖</span> How It Works
              </Link>
              {user ? (
                <>
                  <Link to="/profile" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                    <span className="icon">👤</span> My Profile
                  </Link>
                  <Link to="/orders" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                    <span className="icon">📦</span> My Orders
                  </Link>
                  <Link to="/addresses" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                    <span className="icon">📍</span> Shipping Addresses
                  </Link>
                  {user.role === 'admin' && (
                    <Link to="/admin" className="drawer-link" onClick={() => setShowMobileMenu(false)}>
                      <span className="icon">⚙️</span> Admin Studio
                    </Link>
                  )}
                  <button 
                    className="drawer-link logout-btn" 
                    onClick={() => {
                      logout();
                      setShowMobileMenu(false);
                    }}
                  >
                    <span className="icon">🚪</span> Sign Out
                  </button>
                </>
              ) : (
                <Link 
                  to="/login"
                  className="drawer-signin-btn" 
                  style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
                  onClick={() => setShowMobileMenu(false)}
                >
                  Sign in to bid
                </Link>
              )}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}
