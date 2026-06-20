import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import SEO from '../components/SEO';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import { Hero, Toolbar, Grid } from '../components/lots/LotsGrid';
import PeekModal from '../components/lots/PeekModal';
import { LIVE_LOT } from '../data/lotsData';
import '../lots.css';

const API = import.meta.env.VITE_API_URL ?? '';

/* Shape a real API lot into the archive card format */
function shapeApiLot(lot) {
  const topBid = lot.bids?.[0];
  // lot.order is the confirmed payment; winner is whoever actually paid
  const winner = lot.order?.user
    ? { name: lot.order.user.name ?? 'Anonymous', hue: 268 }
    : topBid?.user ? { name: topBid.user.name ?? 'Anonymous', hue: 268 } : null;
  const soldPrice = lot.soldPrice ?? (lot.order ? Math.round(lot.order.amount / 100) : null) ?? topBid?.amount ?? 0;
  const isSold = lot.paymentStatus === 'paid';

  let title = lot.title;
  if (lot.artworkHeadline && lot.artworkHeadline.startsWith('{')) {
    try {
      const parsed = JSON.parse(lot.artworkHeadline);
      if (parsed.title) title = parsed.title;
    } catch (e) {}
  }

  return {
    id: lot.id,
    lotNo: lot.lotNumber < 0 ? 'Old ' + Math.abs(lot.lotNumber) : String(lot.lotNumber).padStart(3, '0'),
    lotNumber: lot.lotNumber,
    title,
    artist: lot.artist,
    desc: lot.description,
    size: lot.size,
    status: isSold ? 'sold' : 'unsold',
    startingBid: lot.startingBid,
    soldPrice,
    bids: lot.bids?.length ?? 0,
    winner,
    artworkUrl: lot.artworkUrl ?? null,
    artworkHeadline: lot.artworkHeadline ?? null,
    artworkDrafts: lot.artworkDrafts ?? [],
    startsAt: lot.startsAt ?? null,
    hue: (lot.lotNumber * 67 + 180) % 360,
    seed: lot.lotNumber * 37,
    shots: 3,
    owned: false,
    isReal: true,
  };
}

/* Starfield that covers full scroll height */
function LotsStarfield() {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext('2d');
    let w, h, stars, raf;
    const resize = () => {
      w = c.width = window.innerWidth;
      h = c.height = Math.max(window.innerHeight, document.body.scrollHeight);
      stars = Array.from({ length: Math.round(w * h / 16000) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.2,
        a: Math.random() * 0.5 + 0.1,
        tw: Math.random() * 0.02 + 0.004,
        p: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener('resize', resize);
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.p += s.tw;
        const a = s.a * (0.6 + 0.4 * Math.sin(s.p));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 7);
        ctx.fillStyle = `rgba(255,250,235,${a})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return (
    <canvas
      ref={ref}
      className="starfield"
      style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}
    />
  );
}

/* IST countdown helpers — matches App.jsx exactly */
function checkBiddingClosed() {
  try {
    const str = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    }).format(new Date());
    return parseInt(str.split(':')[0], 10) >= 18;
  } catch { return false; }
}

const AUTO_RESTART_DELAY_MS = 6 * 60 * 60 * 1000; // must match backend

function getCountdownTarget(lotClosed, endsAt) {
  if (endsAt) {
    const endsAtMs = new Date(endsAt).getTime();
    if (lotClosed) return endsAtMs + AUTO_RESTART_DELAY_MS;
    return endsAtMs;
  }
  return Date.now() + 6 * 3600 * 1000;
}

function getWatchingCount(lotNumber, bidsCount) {
  if (lotNumber == null) return 8;
  const base = 8 + (bidsCount ?? 0) * 3;
  const timeSeed = Math.floor(Date.now() / 15000); // changes every 15 seconds
  const offset = (timeSeed * 7 + lotNumber * 3) % 6;
  return base + offset;
}

export default function Lots() {
  const { user, token, logout } = useAuth();

  /* body class so lots page can scroll */
  useEffect(() => {
    document.body.classList.add('lots-page-body');
    return () => document.body.classList.remove('lots-page-body');
  }, []);

  const [showMobileMenu, setShowMobileMenu] = useState(false);

  /* live lot state — fetched from the real API */
  const [apiLot, setApiLot] = useState(null);
  const [currentBid, setCurrentBid] = useState(null);
  const [liveBids, setLiveBids] = useState(0);
  const [bump, setBump] = useState(false);
  const [lotClosed, setLotClosed] = useState(true);
  const myBidRef = useRef(null);

  /* real past lots from API */
  const [realPastLots, setRealPastLots] = useState([]);
  /* lotIds the logged-in user has paid for */
  const [myLotIds, setMyLotIds] = useState(new Set());

  const flash = () => { setBump(true); setTimeout(() => setBump(false), 520); };

  /* fetch current lot once on mount */
  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API}/api/lots/current`, { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setApiLot(data.lot);
        setCurrentBid(data.currentBid);
        setLiveBids(data.bids?.length ?? 0);
        const closed = data.lot?.status === 'closed' || checkBiddingClosed();
        setLotClosed(closed);
      })
      .catch(() => null);
  }, [token]);

  /* fetch real past lots */
  useEffect(() => {
    fetch(`${API}/api/lots/past`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.lots?.length) return;
        setRealPastLots(data.lots.map(shapeApiLot));
      })
      .catch(() => null);
  }, []);

  /* fetch user's orders to know which lots they own */
  useEffect(() => {
    if (!token) { setMyLotIds(new Set()); return; }
    fetch(`${API}/api/orders`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data?.orders) return;
        setMyLotIds(new Set(data.orders.map((o) => o.lotId)));
      })
      .catch(() => null);
  }, [token]);

  const watching = getWatchingCount(apiLot?.lotNumber, liveBids);

  /* socket.io — stay in sync with the live room */
  useEffect(() => {
    if (!apiLot) return;
    const socket = API ? socketIO(API, { path: '/socket.io' }) : socketIO({ path: '/socket.io' });
    socket.emit('join:lot', apiLot.id);
    socket.on('bid:new', ({ bid }) => {
      flash();
      setCurrentBid(bid.amount);
      setLiveBids((n) => n + 1);
    });
    socket.on('lot:closed', () => setLotClosed(true));
    socket.on('lot:new', ({ lot: newLot }) => {
      setApiLot(newLot);
      setCurrentBid(newLot.startingBid);
      setLiveBids(0);
      setLotClosed(false);
    });
    socket.on('lot:artwork_updated', ({ lotId, artworkUrl, artworkHeadline, artworkPrompt }) => {
      setApiLot((prev) => {
        if (!prev || prev.id !== lotId) return prev;
        return { ...prev, artworkUrl, artworkHeadline, artworkPrompt };
      });
    });
    return () => socket.disconnect();
  }, [apiLot?.id]);

  /* merge real API data */
  let heroTitle = LIVE_LOT.title;
  let heroArtworkHeadline = null;
  let heroStartsAt = null;
  if (apiLot) {
    heroTitle = apiLot.title ?? LIVE_LOT.title;
    heroArtworkHeadline = apiLot.artworkHeadline ?? null;
    heroStartsAt = apiLot.startsAt ?? null;
    if (apiLot.artworkHeadline && apiLot.artworkHeadline.startsWith('{')) {
      try {
        const parsed = JSON.parse(apiLot.artworkHeadline);
        if (parsed.title) heroTitle = parsed.title;
      } catch (e) {}
    }
  }

  const heroLot = apiLot ? {
    ...LIVE_LOT,
    title: heroTitle,
    artworkHeadline: heroArtworkHeadline,
    startsAt: heroStartsAt,
    endsAt: apiLot.endsAt,
    artist: apiLot.artist ?? LIVE_LOT.artist,
    size: apiLot.size ?? LIVE_LOT.size,
    startingBid: apiLot.startingBid ?? LIVE_LOT.startingBid,
    lotNo: apiLot.lotNumber < 0 ? 'Old ' + Math.abs(apiLot.lotNumber) : String(apiLot.lotNumber ?? LIVE_LOT.lotNo).padStart(3, '0'),
    lotNumber: apiLot.lotNumber,
    artworkUrl: apiLot.artworkUrl,
    watching,
  } : { ...LIVE_LOT, watching };

  const displayBid = currentBid ?? LIVE_LOT.startingBid;

  /* filters */
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [ownedOnly, setOwnedOnly] = useState(false);

  /* quick-peek state */
  const [peekIdx, setPeekIdx] = useState(null);

  const ARCHIVE = useMemo(() => {
    // Only exclude the live lot from the archive when it's actively being auctioned,
    // to avoid it appearing in both the Hero and the grid. Closed lots belong in the archive.
    const lots = (apiLot?.status === 'active') ? realPastLots.filter((l) => l.id !== apiLot.id) : realPastLots;
    return lots.map((l) => myLotIds.has(l.id) ? { ...l, owned: true } : l);
  }, [realPastLots, apiLot, myLotIds]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = ARCHIVE.filter((l) => {
      if (ownedOnly && !l.owned) return false;
      if (qq && !l.title.toLowerCase().includes(qq) && !l.lotNo.toLowerCase().includes(qq)) return false;
      return true;
    });
    const by = {
      'recent': () => 0,
      'price-desc': (a, b) => (b.soldPrice || 0) - (a.soldPrice || 0),
      'price-asc': (a, b) => (a.soldPrice || Infinity) - (b.soldPrice || Infinity),
      'bids-desc': (a, b) => b.bids - a.bids,
    }[sort];
    return by ? [...list].sort(by) : list;
  }, [ARCHIVE, q, sort, ownedOnly]);

  const liveLotForPeek = { ...heroLot, currentBid: displayBid, bids: liveBids };

  const openPeek = useCallback((lot) => {
    if (lot.status === 'live') { setPeekIdx('live'); return; }
    const i = filtered.findIndex((l) => l.id === lot.id);
    setPeekIdx(i);
  }, [filtered]);

  const closePeek = () => setPeekIdx(null);
  const peekLot = peekIdx === 'live'
    ? liveLotForPeek
    : (typeof peekIdx === 'number' && peekIdx >= 0 ? filtered[peekIdx] : null);

  const soldCount = ARCHIVE.filter((l) => l.status === 'sold').length;
  const loggedIn = !!user;
  const userInitial = user?.name?.slice(0, 1)?.toUpperCase() ?? user?.email?.slice(0, 1)?.toUpperCase() ?? '?';

  return (
    <div className="lots-app">
      <SEO page="lots" />
      <LotsStarfield />

      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand-link">
            <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
            <div>
              <div className="brand-name">Oxide</div>
              <div className="brand-sub">Lots &amp; Archive</div>
            </div>
          </Link>
          <nav className="desktop-nav">
            <Link to="/" className="nav-link">Live Room</Link>
            <Link to="/how-it-works" className="nav-link">How it works</Link>
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

      <div className="lots-wrap">
        {apiLot && (
          <Hero
            lot={heroLot}
            currentBid={displayBid}
            bids={liveBids}
            bump={bump}
            lotClosed={lotClosed}
            getCountdownTarget={getCountdownTarget}
          />
        )}
        <div className="archive-scroll-area">
          <div className="archive-head">
            <div>
              <h2 className="archive-title">The Archive</h2>
              <div className="archive-sub">
                Every Oxide lot that&apos;s come before.
              </div>
            </div>
          </div>

          <Toolbar
            q={q} setQ={setQ}
            sort={sort} setSort={setSort}
            ownedOnly={ownedOnly} setOwnedOnly={setOwnedOnly}
            userLoggedIn={loggedIn}
          />

          <div className="result-count">
            {ownedOnly
              ? <><b>Your {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'}</b></>
              : <><b>{filtered.length} lots</b></>}
            {q && <> for &ldquo;{q}&rdquo;</>}
          </div>

          <Grid
            lots={filtered}
            onPeek={openPeek}
            showRibbon={loggedIn}
            ownedOnly={ownedOnly}
            userLoggedIn={loggedIn}
          />
        </div>
      </div>

      {peekLot && (
        <PeekModal
          lot={peekLot}
          onClose={closePeek}
          userLoggedIn={loggedIn}
        />
      )}

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
