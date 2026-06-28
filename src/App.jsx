import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import { useAuth } from './contexts/AuthContext';
import { useCurrency } from './contexts/CurrencyContext';
import Starfield from './components/Starfield';
import Stage from './components/Stage';
import BidRail from './components/BidRail';
import UserMenu from './components/UserMenu';
import CountrySwitcher from './components/CountrySwitcher';
import SEO from './components/SEO';

const API = import.meta.env.VITE_API_URL ?? '';

const pad = (n) => String(n).padStart(2, '0');

const AUTO_RESTART_DELAY_MS = 6 * 60 * 60 * 1000; // must match backend

function getCountdownTarget(lotClosed, endsAt) {
  if (endsAt) {
    const endsAtMs = new Date(endsAt).getTime();
    // Closed lot: endsAt is the actual close time; next lot opens 6h later
    if (lotClosed) return endsAtMs + AUTO_RESTART_DELAY_MS;
    // Active lot: count down to when bidding ends
    return endsAtMs;
  }
  return Date.now() + 6 * 3600 * 1000;
}

function useCountdown(lotClosed, endsAt) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const targetMs = getCountdownTarget(lotClosed, endsAt);
  const ms = Math.max(0, targetMs - Date.now());
  const total = Math.floor(ms / 1000);
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
    total,
  };
}

function getMyRank(bids, userId) {
  if (!userId || !bids.length) return null;
  const seen = new Set();
  let rank = 0;
  for (const bid of bids) {
    if (!seen.has(bid.userId)) {
      seen.add(bid.userId);
      rank++;
      if (bid.userId === userId) return rank;
    }
  }
  return null;
}

function getWatchingCount(lotNumber, bidsCount) {
  if (lotNumber == null) return 8;
  const base = 8 + (bidsCount ?? 0) * 3;
  const timeSeed = Math.floor(Date.now() / 15000); // changes every 15 seconds
  const offset = (timeSeed * 7 + lotNumber * 3) % 6;
  return base + offset;
}

export default function App() {
  const { user, token, logout } = useAuth();
  const { formatBid, symbol, locale, getDisplayBid, getMinIncrement, toCanonical } = useCurrency();
  const navigate = useNavigate();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const [lot, setLot] = useState(null);
  const [bids, setBids] = useState([]);
  const [currentBid, setCurrentBid] = useState(0);
  const [myBid, setMyBid] = useState(null);
  const [status, setStatus] = useState('none');
  const [bump, setBump] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [winner, setWinner] = useState(null);
  const [minInc, setMinInc] = useState(1);
  const [submittingBid, setSubmittingBid] = useState(false);

  const myBidRef = useRef(myBid);
  myBidRef.current = myBid;

  const watching = getWatchingCount(lot?.lotNumber, bids.length);

  const lotClosed = lot?.status === 'closed';
  const cd = useCountdown(lotClosed, lot?.endsAt);
  const flash = () => { setBump(true); setTimeout(() => setBump(false), 520); };

  const fetchLot = useCallback(async () => {
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const r = await fetch(`${API}/api/lots/current`, { headers });
      if (!r.ok) { setError('No active lot right now.'); return; }
      const data = await r.json();
      setLot(data.lot);
      setBids(data.bids);
      setCurrentBid(data.currentBid);
      setMinInc(data.minInc ?? 1);
      setMyBid(data.myBid ?? null);
      setStatus(data.myStatus ?? 'none');

      const isClosed = data.lot.status === 'closed';
      if (isClosed && data.bids && data.bids.length > 0) {
        const top = data.bids[0];
        setWinner({ userId: top.userId, name: top.userName || top.name, amount: top.amount });
      } else {
        setWinner(null);
      }
    } catch {
      setError('Could not connect to the auction server.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!user) { setMyBid(null); setStatus('none'); }
  }, [user]);

  useEffect(() => { fetchLot(); }, [fetchLot]);

  useEffect(() => {
    if (!lot) return;
    const socket = API
      ? socketIO(API, { path: '/socket.io', transports: ['websocket', 'polling'] })
      : socketIO({ path: '/socket.io', transports: ['websocket', 'polling'] });

    socket.on('connect_error', (err) => {
      console.warn('[Socket] connection error:', err.message);
    });

    socket.emit('join:lot', lot.id);

    socket.on('bid:new', ({ bid }) => {
      flash();
      const isMe = bid.userId === user?.id;
      setBids((prev) => [{ ...bid, you: isMe }, ...prev]);
      setCurrentBid(bid.amount);
      if (isMe) {
        setMyBid(bid.amount);
        setStatus('winning');
      } else if (myBidRef.current !== null && bid.amount > myBidRef.current) {
        setStatus('outbid');
      }
    });

    socket.on('lot:closed', ({ winner: w }) => {
      setLot((prev) => prev ? { ...prev, status: 'closed' } : prev);
      setWinner(w);
      fetchLot();
    });

    socket.on('lot:new', ({ lot: newLot }) => {
      setLot(newLot);
      setBids([]);
      setCurrentBid(newLot.startingBid);
      setMyBid(null);
      setStatus('none');
      setWinner(null);
    });

    socket.on('lot:payee_changed', () => { fetchLot(); });
    socket.on('lot:paid', () => { fetchLot(); });
    socket.on('lot:artwork_updated', ({ lotId, artworkUrl, artworkHeadline, artworkPrompt, swappedAt }) => {
      setLot((prev) => {
        if (!prev || prev.id !== lotId) return prev;
        return { ...prev, artworkUrl, artworkHeadline, artworkPrompt, _artworkSwappedAt: swappedAt ?? Date.now() };
      });
    });

    return () => socket.disconnect();
  }, [lot?.id, user?.id]);

  const placeBid = useCallback(async (amount) => {
    if (!user) { navigate('/login', { state: { from: '/' } }); return; }
    const r = await fetch(`${API}/api/lots/${lot.id}/bids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ amount }),
    });
    if (!r.ok) {
      const data = await r.json();
      throw new Error(data.error || 'Bid failed');
    }
  }, [user, lot?.id, token, navigate]);

  const handleMobileBid = async () => {
    if (!user) { navigate('/login', { state: { from: '/' } }); return; }
    setSubmittingBid(true);
    try {
      await placeBid(minNext);
    } catch (err) {
      alert(err.message || 'Failed to place bid. Try again.');
    } finally {
      setSubmittingBid(false);
    }
  };

  const scrollToBid = () => {
    const el = document.querySelector('.bidrail');
    if (el) window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - 70, behavior: 'smooth' });
  };

  const [stageFullscreen, setStageFullscreen] = useState(false);

  const openFullscreen = () => {
    setStageFullscreen(true);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  const closeFullscreen = () => {
    setStageFullscreen(false);
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  };
  const urgent = cd.total < 300 && cd.total > 0 && !lotClosed;
  const startingBid = lot?.startingBid ?? 1;
  const displayCurrentBid = getDisplayBid(currentBid, lot) ?? currentBid;
  const displayStartingBid = getDisplayBid(startingBid, lot) ?? startingBid;
  const displayMinInc = getMinIncrement(lot);
  const displayMinNext = bids.length > 0 ? displayCurrentBid + displayMinInc : displayStartingBid;
  const minNext = toCanonical(displayMinNext, lot);

  const myRank = (user && lot?.status === 'closed') ? getMyRank(bids, user.id) : null;

  const auction = {
    lot, startingBid, currentBid, minInc, myBid, status, bids,
    placeBid, bump, user, winner, watching, lotClosed,
    onLoginPrompt: () => navigate('/login', { state: { from: '/' } }),
    onPayNow: () => navigate('/pay'),
    myRank,
  };

  if (loading) {
    return (
      <div className="app">
        <Starfield />
        <div className="app-loading">
          <img src="/favicon.png" className="brand-mark" style={{ width: 40, height: 40, marginBottom: 16, background: 'none', boxShadow: 'none' }} alt="" />
          <span>Loading auction…</span>
        </div>
      </div>
    );
  }

  if (error && !lot) {
    return (
      <div className="app">
        <Starfield />
        <div className="app-loading">
          <img src="/favicon.png" className="brand-mark" style={{ width: 40, height: 40, marginBottom: 16, background: 'none', boxShadow: 'none' }} alt="" />
          <span style={{ color: 'var(--txt-mute)' }}>{error}</span>
          <button className="app-retry" onClick={fetchLot}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <SEO lot={lot} />
      <Starfield />

      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand-link">
            <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
            <div>
              <div className="brand-name">Oxide</div>
              {lot && <div className="brand-sub">Drop #{lot.lotNumber}</div>}
            </div>
          </Link>
          <nav className="desktop-nav">
            <Link to="/lots" className="nav-link">View All Lots</Link>
            <Link to="/how-it-works" className="nav-link">How it works</Link>
          </nav>
        </div>

        <div className="topbar-center">
          <div className={'countdown' + (urgent ? ' urgent' : '')}>
            <span className="countdown-label">
              {lotClosed ? 'Next auction starts in' : urgent ? 'Ending soon' : 'Bidding ends in'}
            </span>
            <span className="countdown-time num">
              {cd.h > 0 && <><span>{pad(cd.h)}</span><span className="u">h</span></>}
              <span>{pad(cd.m)}</span><span className="u">m</span>
              <span>{pad(cd.s)}</span><span className="u">s</span>
            </span>
          </div>
        </div>

        <div className="topbar-right" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <CountrySwitcher />
          {user ? (
            <UserMenu user={user} logout={logout} />
          ) : (
            <button className="pill auth-pill" onClick={() => navigate('/login')}>
              Sign in
            </button>
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

      <div className={'stage-wrap' + (stageFullscreen ? ' fullscreen' : '')}>
        <Stage modelCount={0} lot={lot} onTap={stageFullscreen ? undefined : openFullscreen} />

        {stageFullscreen && (
          <>
            <button className="stage-fs-close" onClick={closeFullscreen} aria-label="Exit full view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>

      <BidRail auction={auction} />

      <div className="mobile-bidbar">
        <div className="mb-info">
          <div className="k">
            {status === 'winning' ? (
              <span style={{ color: 'var(--win)', fontWeight: 600 }}>● Leading</span>
            ) : status === 'outbid' ? (
              "You've been outbid"
            ) : (
              bids.length === 0 ? 'Starting bid' : 'Current bid'
            )}
          </div>
          <div className="v num" style={{ color: status === 'outbid' ? 'var(--lose)' : 'var(--txt)' }}>
            {formatBid(currentBid, lot)}
          </div>
        </div>
        <button
          className="mb-btn"
          disabled={user ? (status === 'winning' || lotClosed || submittingBid) : false}
          onClick={user ? handleMobileBid : () => navigate('/login', { state: { from: '/' } })}
        >
          {!user 
            ? 'Sign in to bid' 
            : lotClosed 
              ? 'Bidding closed' 
              : submittingBid
                ? 'Placing bid…'
                : bids.length === 0 
                  ? 'Place Bid' 
                  : `Raise Bid : ${symbol}${Math.round(displayMinNext).toLocaleString(locale)}`}
        </button>
      </div>

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
                <button 
                  className="drawer-signin-btn" 
                  onClick={() => {
                    navigate('/login');
                    setShowMobileMenu(false);
                  }}
                >
                  Sign in to bid
                </button>
              )}
            </nav>
          </div>
        </div>
      )}

    </div>
  );
}
