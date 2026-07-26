import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import SEO from '../components/SEO';
import UserMenu from '../components/UserMenu';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { getArtworkUrl } from '../data/lotsData';
import { createFrontCanvasForCard } from '../components/lots/LotsGrid';
import { parseArtworkMeta, formatSignalWithSource } from '../components/lots/artworkSignals';
import '../lots.css';

const API = import.meta.env.VITE_API_URL ?? '';

function parseHeadline(artworkHeadline) {
  if (!artworkHeadline || !artworkHeadline.startsWith('{')) return null;
  try {
    return JSON.parse(artworkHeadline);
  } catch {
    return null;
  }
}

function lotNoLabel(lotNumber) {
  return lotNumber < 0 ? 'Old ' + Math.abs(lotNumber) : String(lotNumber).padStart(3, '0');
}

function MiniLotCard({ lot }) {
  const { formatBid } = useCurrency();
  const artworkUrl = getArtworkUrl({ artworkUrl: lot.artworkUrl, lotNumber: lot.lotNumber }, API);
  const [overlaySrc, setOverlaySrc] = useState(null);
  const parsed = parseHeadline(lot.artworkHeadline);
  const title = parsed?.title ?? lot.title;

  useEffect(() => {
    if (!artworkUrl) return;
    createFrontCanvasForCard(artworkUrl, lot, (canvas) => {
      if (canvas) setOverlaySrc(canvas.toDataURL());
    });
  }, [artworkUrl, lot]);

  return (
    <Link to={`/lots/${lot.lotNumber}`} className="lot-card related-lot-card">
      <div className="card-art">
        <div className="card-tshirt-zoom">
          <img src="/tshirt_front_black_transparent10small.png" alt="" className="card-tshirt-base" />
          {overlaySrc && <img src={overlaySrc} alt={title} className="card-chest-art" />}
        </div>
        <div className="card-badges">
          <span className="l-tag lotno num">Lot {lotNoLabel(lot.lotNumber)}</span>
        </div>
      </div>
      <div className="card-body">
        <h3 className="card-title">{title}</h3>
        <div className="card-result">
          <div>
            <div className="price-k">{lot.status === 'closed' && lot.soldPrice ? 'Sold for' : 'Result'}</div>
            <div className="price-v num">{lot.soldPrice ? formatBid(lot.soldPrice, lot) : 'No sale'}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function LotDetail() {
  const { lotNumber } = useParams();
  const { user, logout } = useAuth();
  const { formatBid } = useCurrency();

  const [data, setData] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [overlaySrc, setOverlaySrc] = useState(null);

  useEffect(() => {
    document.body.classList.add('lots-page-body');
    return () => document.body.classList.remove('lots-page-body');
  }, []);

  useEffect(() => {
    setData(null);
    setNotFound(false);
    setOverlaySrc(null);
    fetch(`${API}/api/lots/by-number/${lotNumber}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setData(d))
      .catch(() => setNotFound(true));
  }, [lotNumber]);

  const lot = data?.lot;

  useEffect(() => {
    if (!lot) return;
    const artUrl = getArtworkUrl(lot, API);
    if (!artUrl) return;
    createFrontCanvasForCard(artUrl, lot, (canvas) => {
      if (canvas) setOverlaySrc(canvas.toDataURL());
    });
  }, [lot]);

  if (notFound) {
    return (
      <div className="lots-app">
        <SEO />
        <div className="lots-wrap">
          <div className="lots-empty" style={{ marginTop: 120 }}>
            <div className="big">Lot not found</div>
            <div>
              This drop doesn&apos;t exist, or hasn&apos;t happened yet. <Link to="/lots">Browse the archive →</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!lot) {
    return (
      <div className="lots-app">
        <div className="lots-wrap" />
      </div>
    );
  }

  const { title: parsedTitle, signalsUsed, interpretiveStatement } = parseArtworkMeta(lot.artworkHeadline);
  const title = parsedTitle ?? lot.title;
  const topBid = lot.bids?.[0];
  const winnerName = lot.order?.user?.name ?? topBid?.user?.name ?? null;
  const isLive = lot.status === 'active';
  const isSold = lot.paymentStatus === 'paid';
  const bidCount = lot._count?.bids ?? lot.bids?.length ?? 0;
  const dateStr = lot.startsAt
    ? new Date(lot.startsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="lots-app">
      <SEO page="lot-detail" lot={lot} />

      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand-link">
            <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
            <div>
              <div className="brand-name">Oxide</div>
              <div className="brand-sub">Lot #{lot.lotNumber}</div>
            </div>
          </Link>
          <nav className="desktop-nav">
            <Link to="/" className="nav-link">Live Room</Link>
            <Link to="/lots" className="nav-link">Lots &amp; Archive</Link>
          </nav>
        </div>
        <div className="topbar-center" />
        <div className="topbar-right">
          {user ? <UserMenu user={user} logout={logout} /> : <Link className="pill auth-pill" to="/login">Sign in</Link>}
        </div>
      </header>

      <div className="lots-wrap">
        <div className="archive-scroll-area">
          <nav className="lot-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">Oxide</Link>
            <span aria-hidden="true">›</span>
            <Link to="/lots">Lots &amp; Archive</Link>
            <span aria-hidden="true">›</span>
            <span aria-current="page">{title}</span>
          </nav>

          <article className="lot-detail">
            <div className="lot-detail-art">
              <div className="hero-tshirt-wrap">
                <img src="/tshirt_front_black_transparent10small.png" alt="" className="hero-tshirt-base" />
                {overlaySrc && <img src={overlaySrc} alt={title} className="hero-chest-art" />}
              </div>
            </div>

            <div className="lot-detail-info">
              <div className="live-row">
                {isLive
                  ? <span className="live-badge"><span className="dot" /> Live now</span>
                  : <span className={'l-tag ' + (isSold ? 'sold' : 'unsold')}>{isSold ? 'Sold' : 'Reserve not met'}</span>}
                <span className="hero-lotno">Drop #{lot.lotNumber}</span>
              </div>
              <h1 className="hero-title">{title}</h1>
              <p className="hero-edition">{dateStr && `${dateStr} · `}Unique piece · Edition {lot.edition} · never reprinted</p>

              <p className="lot-detail-desc">{lot.description}</p>

              {signalsUsed.length > 0 && (
                <div className="lot-news-banner">
                  <span className="lot-news-banner-label">🗞 Inspired by today&apos;s happenings</span>
                  <ul>
                    {signalsUsed.map((sig, idx) => {
                      const { text, source } = formatSignalWithSource(sig);
                      return (
                        <li key={idx}>
                          {text} <span className="src">[{source}]</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {interpretiveStatement && (
                <div className="lot-interpretive">
                  <span className="lot-interpretive-label">Artist Interpretive Statement</span>
                  <p>{interpretiveStatement}</p>
                </div>
              )}

              <dl className="lot-spec-list">
                <div><dt>Artist</dt><dd>{lot.artist}</dd></div>
                <div><dt>Size</dt><dd>{lot.size}</dd></div>
                <div><dt>Product</dt><dd>{lot.productType === 'tshirt' ? 'T-Shirt' : lot.productType}</dd></div>
                <div><dt>Ships</dt><dd>Worldwide</dd></div>
                <div><dt>Material</dt><dd>220 GSM, 100% Cotton</dd></div>
                <div><dt>Starting bid</dt><dd>{formatBid(lot.startingBid, lot)}</dd></div>
                <div>
                  <dt>{isLive ? (bidCount === 0 ? 'Starting bid' : 'Current bid') : (isSold ? 'Sold for' : 'Top bid')}</dt>
                  <dd>
                    {isLive
                      ? formatBid(topBid?.amount ?? lot.startingBid, lot)
                      : (isSold ? formatBid(lot.soldPrice ?? topBid?.amount ?? 0, lot) : (topBid ? formatBid(topBid.amount, lot) : '—'))}
                  </dd>
                </div>
                <div><dt>Bids placed</dt><dd>{bidCount}</dd></div>
                {!isLive && winnerName && <div><dt>Winner</dt><dd>{winnerName}</dd></div>}
              </dl>

              <div className="hero-cta">
                {isLive
                  ? <Link className="btn-primary" to="/">Enter live room <span aria-hidden="true">→</span></Link>
                  : <Link className="btn-primary" to="/lots">Back to the archive <span aria-hidden="true">→</span></Link>}
              </div>
            </div>
          </article>

          <nav className="lot-prevnext" aria-label="Adjacent lots">
            {data.prevLot ? (
              <Link to={`/lots/${data.prevLot.lotNumber}`} className="lot-prevnext-link prev" rel="prev">
                <span className="k">← Previous drop</span>
                <span className="v">Lot {lotNoLabel(data.prevLot.lotNumber)} · {data.prevLot.title}</span>
              </Link>
            ) : <span />}
            {data.nextLot ? (
              <Link to={`/lots/${data.nextLot.lotNumber}`} className="lot-prevnext-link next" rel="next">
                <span className="k">Next drop →</span>
                <span className="v">Lot {lotNoLabel(data.nextLot.lotNumber)} · {data.nextLot.title}</span>
              </Link>
            ) : <span />}
          </nav>

          {data.related?.length > 0 && (
            <section className="related-lots">
              <h2 className="archive-title">More from the archive</h2>
              <div className="lots-grid">
                {data.related.map((r) => <MiniLotCard key={r.lotNumber} lot={r} />)}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
