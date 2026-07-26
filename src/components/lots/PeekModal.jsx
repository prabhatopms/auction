import { useState, useEffect } from 'react';
import { getArtworkUrl, getPrintUrl } from '../../data/lotsData';
import { useCurrency } from '../../contexts/CurrencyContext';
import ZoomableImage from './ZoomableImage';
import { createBackCanvasForCard } from './LotGallery';

const API = import.meta.env.VITE_API_URL ?? '';
import DeliveryTracker from './DeliveryTracker';
import { getSignalUrl } from './artworkSignals';


function createFrontCanvasForCard(artworkImage, lot, callback) {
  const lotNo = lot?.lotNumber != null 
    ? (lot.lotNumber < 0 ? 'Old ' + Math.abs(lot.lotNumber) : String(lot.lotNumber).padStart(3, '0')) 
    : (lot?.lotNo ? String(lot.lotNo).padStart(3, '0') : '001');

  const rawDate = lot?.startsAt || new Date();
  let dateStr = '';
  try {
    dateStr = new Date(rawDate).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    dateStr = '';
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = artworkImage;
  img.onload = () => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.naturalWidth || img.width;
    tempCanvas.height = img.naturalHeight || img.height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, 0, 0);

    try {
      const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imgData.data;
      const threshold = 15;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r < threshold && g < threshold && b < threshold) {
          data[i + 3] = 0;
        }
      }
      tempCtx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.warn('Failed to process image transparency:', e);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1600;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    
    ctx.drawImage(tempCanvas, 124, 70, 952, 1360);

    ctx.font = '46px Georgia, serif';
    ctx.fillText('Field Notes From the Day', 600, 1495);

    ctx.font = '32px Georgia, serif';
    ctx.fillText(`${dateStr}   •   Lot ${lotNo}   •   Edition 1/1`, 600, 1545);

    callback(canvas);
  };
  img.onerror = () => {
    callback(null);
  };
}

export default function PeekModal({ lot, onClose, userLoggedIn }) {
  const { formatBid } = useCurrency();
  const [shot, setShot] = useState(0);
  const [immersive, setImmersive] = useState(false);
  const live = lot.status === 'live';
  const passed = lot.status === 'unsold';

  const [frontOverlaySrc, setFrontOverlaySrc] = useState(null);
  const [backOverlaySrc, setBackOverlaySrc] = useState(null);
  // draft overlay srcs: array parallel to lot.artworkDrafts
  const [draftSrcs, setDraftSrcs] = useState([]);

  const artworkUrl = getArtworkUrl(lot, API);

  useEffect(() => {
    setShot(0);
  }, [lot.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  useEffect(() => {
    // Server print files are the source of truth; canvas drawing is the
    // fallback for lots without them. (Draft previews below always draw
    // client-side — drafts have no print files.)
    const frontPrint = getPrintUrl(lot, 'front', API);
    if (frontPrint) {
      setFrontOverlaySrc(frontPrint);
    } else if (artworkUrl) {
      createFrontCanvasForCard(artworkUrl, lot, (canvas) => {
        if (canvas) setFrontOverlaySrc(canvas.toDataURL());
      });
    }
    const backPrint = getPrintUrl(lot, 'back', API);
    if (backPrint) {
      setBackOverlaySrc(backPrint);
    } else {
      createBackCanvasForCard(lot, (canvas) => {
        if (canvas) setBackOverlaySrc(canvas.toDataURL());
      });
    }
  }, [artworkUrl, lot]);

  // Render draft images
  useEffect(() => {
    const drafts = lot.artworkDrafts ?? [];
    if (drafts.length === 0) { setDraftSrcs([]); return; }
    const srcs = new Array(drafts.length).fill(null);
    let mounted = true;
    drafts.forEach((draft, i) => {
      const url = getArtworkUrl({ artworkUrl: draft.artworkUrl, lotNumber: lot.lotNumber }, API);
      if (!url) return;
      createFrontCanvasForCard(url, lot, (canvas) => {
        if (!mounted || !canvas) return;
        srcs[i] = canvas.toDataURL();
        setDraftSrcs([...srcs]);
      });
    });
    return () => { mounted = false; };
  }, [lot.id]);

  const overStart = !passed && !live && lot.startingBid
    ? Math.round((lot.soldPrice - lot.startingBid) / lot.startingBid * 100)
    : 0;

  let signalsUsed = [];
  let isJson = false;
  let interpretiveStatement = '';
  try {
    if (lot?.artworkHeadline && lot.artworkHeadline.startsWith('{')) {
      const parsed = JSON.parse(lot.artworkHeadline);
      signalsUsed = parsed.data_signals_used || [];
      interpretiveStatement = parsed.interpretive_statement || '';
      isJson = true;
    }
  } catch (e) {}

  const getDynamicTitle = () => {
    if (isJson) {
      try {
        const parsed = JSON.parse(lot.artworkHeadline);
        if (parsed.title) return parsed.title;
      } catch (e) {}
    }
    return lot.title ?? 'Loading…';
  };

  return (
    <div
      className="lots-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="peek-modal" role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>

        {/* gallery — left column */}
        <div className="m-gallery">
          <div className="m-main">
            <ZoomableImage resetKey={shot} onTap={() => setImmersive(true)}>
              {/* Shot 0: front t-shirt with selected artwork */}
              {(shot === 0 || (live && shot >= 4)) && (
                <div className="m-tshirt-wrap">
                  <img src="/tshirt_front_black_transparent10small.png" alt="" className="m-tshirt-base" />
                  {shot === 0 && frontOverlaySrc && (
                    <img src={frontOverlaySrc} alt={lot.title} className="m-chest-art" />
                  )}
                  {live && shot >= 4 && draftSrcs[shot - 4] && (
                    <img src={draftSrcs[shot - 4]} alt={`Draft ${shot - 3}`} className="m-chest-art" />
                  )}
                </div>
              )}
              {/* Shot 1: back t-shirt */}
              {shot === 1 && (
                <div className="m-tshirt-wrap">
                  <img src="/tshirt_back_black_transparent10small.png" alt="" className="m-tshirt-base" />
                  {backOverlaySrc && (
                    <img src={backOverlaySrc} alt={lot.title} className="m-chest-art m-back-art" />
                  )}
                </div>
              )}
              {/* Shot 2: artwork with background removed */}
              {shot === 2 && frontOverlaySrc && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '100%', padding: '12px',
                }}>
                  <img
                    src={frontOverlaySrc}
                    alt={lot.title}
                    style={{
                      maxWidth: 'min(80%, 320px)',
                      maxHeight: '100%',
                      objectFit: 'contain',
                      borderRadius: 8,
                    }}
                  />
                </div>
              )}
            </ZoomableImage>
            <div style={{
              position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
              fontSize: '10px', color: 'rgba(255,255,255,0.28)', letterSpacing: '0.05em',
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              Click or scroll to zoom · tap to expand
            </div>
          </div>
          <div className="m-thumbs">
            {/* Shot 0: front t-shirt */}
            <button
              className={'m-thumb' + (shot === 0 ? ' on' : '')}
              onClick={() => setShot(0)}
              title="Front view"
            >
              <div className="m-thumb-tshirt">
                <img src="/tshirt_front_black_transparent10small.png" alt="Front" className="m-thumb-img" />
                {frontOverlaySrc && (
                  <img src={frontOverlaySrc} alt="" className="m-thumb-art" />
                )}
              </div>
            </button>
            {/* Shot 1: back t-shirt */}
            <button
              className={'m-thumb' + (shot === 1 ? ' on' : '')}
              onClick={() => setShot(1)}
              title="Back view"
            >
              <div className="m-thumb-tshirt">
                <img src="/tshirt_back_black_transparent10small.png" alt="Back" className="m-thumb-img" />
                {backOverlaySrc && (
                  <img src={backOverlaySrc} alt="" className="m-thumb-art m-back-art" />
                )}
              </div>
            </button>
            {/* Shot 2: artwork without background */}
            {frontOverlaySrc && (
              <button
                className={'m-thumb' + (shot === 2 ? ' on' : '')}
                onClick={() => setShot(2)}
                title="Artwork image"
              >
                <div className="m-thumb-tshirt" style={{ padding: 4 }}>
                  <img
                    src={frontOverlaySrc}
                    alt="Artwork"
                    style={{ width: '90%', height: '90%', objectFit: 'contain', borderRadius: 4 }}
                  />
                </div>
              </button>
            )}
            {/* Shots 4+: draft artwork alternatives — live only */}
            {live && (lot.artworkDrafts ?? []).map((draft, i) => (
              <button
                key={draft.id ?? i}
                className={'m-thumb' + (shot === i + 4 ? ' on' : '')}
                onClick={() => setShot(i + 4)}
                title={`Generated image ${i + 1}`}
              >
                <div className="m-thumb-tshirt">
                  <img src="/tshirt_front_black_transparent10small.png" alt="" className="m-thumb-img" />
                  {draftSrcs[i]
                    ? <img src={draftSrcs[i]} alt="" className="m-thumb-art" />
                    : <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '10px', color: 'rgba(255,255,255,0.35)',
                      }}>…</div>
                  }
                  <div style={{
                    position: 'absolute', bottom: 2, right: 2,
                    fontSize: '8px', color: 'rgba(255,255,255,0.55)',
                    background: 'rgba(0,0,0,0.45)', borderRadius: 3, padding: '0 3px',
                    lineHeight: '1.6',
                  }}>v{i + 1}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* detail — right column */}
        <div className="m-detail">
          <div className="m-kicker">
            <span className="lotno num">Lot {lot.lotNo}</span>
            {live
              ? (
                <span className="l-tag sold" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--live, #ff6b7d)',
                    boxShadow: '0 0 10px var(--live, #ff6b7d)',
                    display: 'inline-block',
                    animation: 'lots-blink 1.4s infinite',
                  }} />
                  Live now
                </span>
              )
              : <span className={'l-tag ' + (passed ? 'unsold' : 'sold')}>{passed ? 'Passed' : 'Sold'}</span>}
          </div>
          <h2 className="m-title">{getDynamicTitle()}</h2>
          <div className="m-artist">{lot.artist}</div>
          
          {isJson ? (
            <>
              <div className="lot-news-banner" style={{
                marginTop: '14px',
                padding: '10px 12px',
                borderRadius: 'var(--r-sm)',
                border: '1px dashed rgba(230, 194, 126, 0.25)',
                background: 'rgba(230, 194, 126, 0.04)',
                fontSize: '12px',
                textAlign: 'left'
              }}>
                <span style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '9.5px', color: 'var(--gold-bright)', marginBottom: '4px', fontWeight: 600 }}>
                  🗞 Inspired by today's happenings
                </span>
                {(() => {
                  const formatSignalWithSource = (sig) => {
                    if (!sig) return '';
                    
                    let text = sig.trim();
                    let source = '';
                    
                    // 1. Detect category from the original string before any stripping
                    const orig = text.toLowerCase();
                    
                    if (orig.includes('weird news') || orig.includes('upi_weird_news') || orig.includes('weird') || orig.includes('watch:')) {
                      source = 'UPI Weird News';
                    } else if (orig.includes('oddity_central') || orig.includes('oddity')) {
                      source = 'Oddity Central';
                    } else if (orig.includes('global attention') || orig.includes('collective attention') || orig.includes('top_wikipedia') || orig.includes('top wikipedia') || orig.includes('pageviews') || orig.includes('wikipedia top search') || orig.includes('daily news') || orig.includes('daily_news') || (orig.includes('wikipedia') && !orig.includes('day') && !orig.includes('event'))) {
                      source = 'Wikipedia Top Search';
                    } else if (orig.includes('optimist_daily') || orig.includes('optimist')) {
                      source = 'Optimist Daily';
                    } else if (orig.includes('positive_news') || orig.includes('positive news') || orig.includes('good news') || orig.includes('gnn')) {
                      source = 'Good News Network';
                    } else if (orig.includes('future prediction') || orig.includes('polymarket') || orig.includes('prediction') || orig.includes('probability') || orig.includes('percent probability') || orig.includes('% probability')) {
                      source = 'Polymarket Trending';
                    } else if (orig.includes('cultural resonance') || orig.includes('top_song') || orig.includes('top song') || orig.includes('song') || orig.includes('spotify') || orig.includes('apple music')) {
                      source = 'Top Song';
                    } else if (orig.includes('historical lens') || orig.includes('wikipedia_on_this_day') || orig.includes('wikipedia event') || orig.includes('historical') || orig.includes('history') || orig.includes('wikipedia on this day') || orig.includes('day') || orig.match(/^\d{3,4}:/)) {
                      source = 'Wikipedia On this Day';
                    } else if (orig.includes('google_news') || orig.includes('google news')) {
                      source = 'Google News';
                    }
                    
                    // 2. Define patterns to remove category prefixes
                    const categoryPatterns = [
                      /^(weird\s*news|upi_weird_news|oddity_central):\s*/i,
                      /^(global\s*attention|top_wikipedia|collective\s*attention):\s*/i,
                      /^(positive\s*news|optimist_daily):\s*/i,
                      /^(future\s*prediction|polymarket):\s*/i,
                      /^(cultural\s*resonance|top_song|song):\s*/i,
                      /^(historical\s*lens|wikipedia_on_this_day|wikipedia\s*event):\s*/i,
                      /^(google_news|google\s*news):\s*/i
                    ];
                    
                    // 3. Define patterns to remove source prefixes
                    const sourcePatterns = [
                      { pat: /^watch:\s*/i, src: 'UPI Weird News' },
                      { pat: /^upi\s*weird\s*news:\s*/i, src: 'UPI Weird News' },
                      { pat: /^top\s*wikipedia:\s*/i, src: 'Wikipedia Top Search' },
                      { pat: /^wikipedia\s*top\s*search:\s*/i, src: 'Wikipedia Top Search' },
                      { pat: /^wikipedia\s*on\s*this\s*day:\s*/i, src: 'Wikipedia On this Day' },
                      { pat: /^optimist\s*daily:\s*/i, src: 'Optimist Daily' },
                      { pat: /^positive\s*news:\s*/i, src: 'Good News Network' },
                      { pat: /^good\s*news\s*network:\s*/i, src: 'Good News Network' },
                      { pat: /^polymarket:\s*/i, src: 'Polymarket Trending' },
                      { pat: /^polymarket\s*trending:\s*/i, src: 'Polymarket Trending' },
                      { pat: /^top\s*song:\s*/i, src: 'Top Song' },
                      { pat: /^oddity\s*central:\s*/i, src: 'Oddity Central' },
                      { pat: /^google\s*news:\s*/i, src: 'Google News' }
                    ];
                    
                    // 4. Repeatedly strip category & source prefixes from the text until stable
                    let cleaned = true;
                    while (cleaned) {
                      cleaned = false;
                      for (const pat of categoryPatterns) {
                        if (pat.test(text)) {
                          text = text.replace(pat, '');
                          cleaned = true;
                          break;
                        }
                      }
                      for (const item of sourcePatterns) {
                        if (item.pat.test(text)) {
                          if (!source) source = item.src;
                          text = text.replace(item.pat, '');
                          cleaned = true;
                          break;
                        }
                      }
                    }
                    
                    // 5. Ultimate fallback if still no source determined
                    if (!source) {
                      source = 'Wikipedia Top Search';
                    }
                    
                    // Capitalize first letter of the remaining text
                    if (text.length > 0) {
                      text = text.charAt(0).toUpperCase() + text.slice(1);
                    }
                    
                    const url = getSignalUrl(source, text);
                    return (
                      <>
                        {text}{' '}
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="nofollow noopener noreferrer"
                            style={{ fontStyle: 'italic', color: 'inherit', textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}
                          >[{source}]</a>
                        ) : (
                          <span style={{ fontStyle: 'italic' }}>[{source}]</span>
                        )}
                      </>
                    );
                  };
                  return (
                    <ul style={{ color: 'var(--txt-dim)', lineHeight: '1.45', margin: 0, paddingLeft: '14px', listStyleType: 'disc' }}>
                      {signalsUsed.map((sig, idx) => (
                        <li key={idx} style={{ marginBottom: '4px' }}>
                          {formatSignalWithSource(sig)}
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>

              {interpretiveStatement && (
                <div style={{ marginTop: '20px', textAlign: 'left' }}>
                  <span style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '9.5px', color: 'var(--gold-bright)', marginBottom: '6px', fontWeight: 600 }}>
                    Artist Interpretive Statement
                  </span>
                  <p style={{ color: 'var(--txt-dim)', fontSize: '12.5px', lineHeight: '1.55', margin: 0, fontStyle: 'italic' }}>
                    {interpretiveStatement}
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="m-desc">{lot.desc}</p>
          )}

          <div className="m-meta">
            <div className="m"><span className="k">Edition</span><span className="v">1 / 1</span></div>
            <div className="m"><span className="k">Ships</span><span className="v">Worldwide</span></div>
            <div className="m"><span className="k">Material</span><span className="v">220 GSM, 100% Cotton</span></div>
          </div>

          {live ? (
            <div className="m-result">
              <div className="r-top">
                <div>
                  <div className="r-k">{lot.bids === 0 ? 'Starting bid' : 'Current bid'}</div>
                  <div className="r-price">
                    {lot.currentBid != null ? formatBid(lot.currentBid, lot) : '—'}
                  </div>
                </div>
                <div className="r-bids"><span className="n num">{lot.bids}</span> bids so far</div>
              </div>
              <div className="r-foot">
                <span>Auction in progress</span>
                <a href="/" style={{ color: 'var(--gold-bright)', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: '3px' }}>
                  Enter live room →
                </a>
              </div>
            </div>
          ) : (
            <div className={'m-result' + (passed ? ' passed' : '')}>
              <div className="r-top">
                <div>
                  <div className="r-k">{passed ? 'Outcome' : 'Hammer price'}</div>
                  {passed
                    ? <div className="r-price passed">No sale</div>
                    : <div className="r-price num">{formatBid(lot.soldPrice, lot)}</div>}
                </div>
                <div className="r-bids">
                  <span className="n num">{lot.bids}</span> bid{lot.bids === 1 ? '' : 's'} placed
                </div>
              </div>
              <div className="r-foot">
                {passed ? (
                  <span>Reserve was not met — returned to the atelier.</span>
                ) : (
                  <>
                    <span className={'winner' + (lot.winner?.name === 'You' ? ' you' : '')}>
                      Won by
                      <span
                        className="av"
                        style={{
                          background: lot.winner?.name === 'You'
                            ? 'linear-gradient(135deg,var(--gold-bright),var(--gold))'
                            : `hsl(${lot.winner?.hue ?? 0} 45% 62%)`,
                        }}
                      >
                        {lot.winner ? (lot.winner.name === 'You' ? '★' : lot.winner.name.slice(0, 1)) : '?'}
                      </span>
                      <b>{lot.winner?.name ?? '—'}</b>
                    </span>
                    {overStart > 0 && <span className="over">+{overStart}% over start</span>}
                  </>
                )}
              </div>
            </div>
          )}

          {userLoggedIn && lot.owned && lot.delivery && (
            <DeliveryTracker delivery={lot.delivery} />
          )}
        </div>
      </div>

      {/* Immersive full-screen image viewer (mobile tap / desktop expand) */}
      {immersive && (
        <div
          className="immersive-overlay"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setImmersive(false); }}
        >
          <ZoomableImage resetKey={`immersive-${shot}`}>
            {(shot === 0 || (live && shot >= 4)) && (
              <div className="m-tshirt-wrap">
                <img src="/tshirt_front_black_transparent10small.png" alt="" className="m-tshirt-base immersive" />
                {shot === 0 && frontOverlaySrc && (
                  <img src={frontOverlaySrc} alt={lot.title} className="m-chest-art immersive" />
                )}
                {live && shot >= 4 && draftSrcs[shot - 4] && (
                  <img src={draftSrcs[shot - 4]} alt={`Draft ${shot - 3}`} className="m-chest-art immersive" />
                )}
              </div>
            )}
            {shot === 1 && (
              <div className="m-tshirt-wrap">
                <img src="/tshirt_back_black_transparent10small.png" alt="" className="m-tshirt-base immersive" />
                {backOverlaySrc && (
                  <img src={backOverlaySrc} alt={lot.title} className="m-chest-art immersive m-back-art" />
                )}
              </div>
            )}
            {shot === 2 && frontOverlaySrc && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '20px' }}>
                <img
                  src={frontOverlaySrc}
                  alt={lot.title}
                  style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain', borderRadius: 8 }}
                />
              </div>
            )}
          </ZoomableImage>
          <button
            className="immersive-close"
            onClick={() => setImmersive(false)}
            aria-label="Back to details"
          >
            ←
          </button>
        </div>
      )}
    </div>
  );
}
