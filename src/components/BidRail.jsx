import { useState, useEffect } from 'react';

const fmt = (n) => '₹' + n.toLocaleString('en-IN');
const pad = (n) => String(n).padStart(2, '0');

const AUTO_RESTART_DELAY_MS = 6 * 60 * 60 * 1000;

function useTimer(targetMs) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, targetMs - Date.now());
  const total = Math.floor(diff / 1000);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60, total };
}

function PaymentCountdown({ expiresAt }) {
  const t = useTimer(new Date(expiresAt).getTime());
  if (t.total === 0) return <span style={{ color: 'var(--lose)', fontFamily: 'monospace', fontSize: '13px', fontWeight: 700 }}>EXPIRED</span>;
  return <span style={{ color: '#ff6b7d', fontFamily: 'monospace', fontSize: '14px', fontWeight: 700 }}>{pad(t.h)}:{pad(t.m)}:{pad(t.s)}</span>;
}

function NextAuctionCountdown({ endsAt }) {
  const targetMs = endsAt ? new Date(endsAt).getTime() + AUTO_RESTART_DELAY_MS : Date.now() + AUTO_RESTART_DELAY_MS;
  const t = useTimer(targetMs);
  if (t.total === 0) return <span style={{ fontFamily: 'monospace', color: 'var(--gold-bright)' }}>soon</span>;
  return (
    <span style={{ fontFamily: 'monospace', color: 'var(--gold-bright)' }}>
      {t.h > 0 ? `${pad(t.h)}h ` : ''}{pad(t.m)}m {pad(t.s)}s
    </span>
  );
}

function ClosedBlob({ lot, bids, user, winner, myRank, onPayNow }) {
  const topBid = bids[0] ?? null;
  const isCurrentPayee = user && lot?.currentPayeeId === user.id && lot?.paymentStatus?.startsWith('pending_');
  const isInQueue = user && !isCurrentPayee && myRank !== null && lot?.paymentStatus?.startsWith('pending_');
  const paymentExpired = lot?.paymentStatus === 'expired' || lot?.paymentStatus === 'paid';

  return (
    <div className="settlement-info" style={{
      padding: '18px 16px',
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--r-sm)',
      background: 'rgba(0,0,0,0.2)',
      textAlign: 'center',
      margin: '18px',
    }}>
      {isCurrentPayee ? (
        <>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏆</div>
          <h3 style={{ margin: '0 0 6px', fontSize: '16px', color: '#e6c27e', fontWeight: 700 }}>
            You won this lot!
          </h3>
          <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--txt-mute)', margin: '0 0 10px' }}>
            Winning bid: <strong style={{ color: 'var(--txt)' }}>{topBid ? fmt(topBid.amount) : '—'}</strong>
          </p>
          {lot.payeeExpiresAt && (
            <div style={{ margin: '0 0 16px', fontSize: '12px', color: 'var(--txt-mute)' }}>
              <span>Time to pay: </span><PaymentCountdown expiresAt={lot.payeeExpiresAt} />
            </div>
          )}
          <button
            onClick={onPayNow}
            style={{
              background: '#e6c27e',
              color: '#0c0d15',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 24px',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.04em',
              width: '100%',
            }}
          >
            Pay Now →
          </button>
        </>
      ) : isInQueue ? (
        <>
          <div style={{ fontSize: '28px', marginBottom: '10px' }}>⏳</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--txt)', fontWeight: 600 }}>
            Bidding Closed
          </h3>
          {topBid && (
            <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--txt-mute)', margin: '0 0 10px' }}>
              <strong style={{ color: 'var(--txt)' }}>{topBid.userName || topBid.name}</strong> won with <strong style={{ color: 'var(--txt)' }}>{fmt(topBid.amount)}</strong>.
            </p>
          )}
          <p style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--txt-mute)', margin: 0 }}>
            {(lot?.paymentStatus === 'pending_2nd' && myRank === 2) || (lot?.paymentStatus === 'pending_3rd' && myRank === 3)
              ? `You're now #${myRank} — check your email for a payment link.`
              : myRank === 2
                ? "You're 2nd in line. If the winner doesn't pay within 2h, you'll be emailed."
                : `You're #${myRank} in line. Watch your inbox (check Spam too)!.`
            }
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🔒</div>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: 'var(--txt)', fontWeight: 600 }}>
            Bidding Closed
          </h3>
          {topBid ? (
            <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--txt-mute)', margin: 0 }}>
              <strong style={{ color: 'var(--txt)' }}>{topBid.userName || topBid.name}</strong> won with <strong style={{ color: 'var(--txt)' }}>{fmt(topBid.amount)}</strong>.
              {paymentExpired && lot?.paymentStatus !== 'paid' && (
                <span style={{ display: 'block', marginTop: '6px', fontSize: '11px', color: 'var(--txt-mute)' }}>
                  Payment window closed — lot unsettled.
                </span>
              )}
            </p>
          ) : (
            <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--txt-mute)', margin: 0 }}>
              No bids were placed on this lot.
            </p>
          )}
        </>
      )}

      <div style={{
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: 'var(--txt-mute)',
        borderTop: '1px solid var(--line)',
        paddingTop: '12px',
        marginTop: '16px',
        fontWeight: 500,
      }}>
        Next auction in <NextAuctionCountdown endsAt={lot?.endsAt} />
      </div>
    </div>
  );
}

function StatusBanner({ status, currentBid }) {
  if (status === 'winning') {
    return (
      <div className="status-banner win">
        <span className="icon">✓</span>
        <span className="sb-text">You&apos;re the <b>highest bidder</b>. Hold tight.</span>
      </div>
    );
  }
  if (status === 'outbid') {
    return (
      <div className="status-banner lose">
        <span className="icon">!</span>
        <span className="sb-text">You&apos;ve been <b>outbid</b> — current is {fmt(currentBid)}.</span>
      </div>
    );
  }
  return null;
}

function BidForm({ minNext, onPlace, disabled, onLoginPrompt, user, bidsCount, isHighestBidder }) {
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) { onLoginPrompt(); return; }
    setErr('');
    setSubmitting(true);
    try {
      await onPlace(minNext);
    } catch (e) {
      setErr(e.message || 'Failed to place bid. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (disabled) {
    return (
      <div className="bid-form">
        <div className="bid-help" style={{ textAlign: 'center', padding: '8px 0' }}>
          This auction has ended.
        </div>
      </div>
    );
  }

  return (
    <div className="bid-form" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <button
        className="bid-submit"
        onClick={submit}
        disabled={submitting || isHighestBidder}
        style={{ width: '100%', padding: '14px 18px', fontSize: '15px', borderRadius: 'var(--r-sm)', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
      >
        {!user ? 'Sign in to bid' : submitting ? 'Placing bid…' : bidsCount === 0 ? 'Place Bid' : `Raise Bid : ${fmt(minNext)}`}
      </button>
      {err && <div className="bid-error" style={{ justifyContent: 'center' }}><span>⚠</span> {err}</div>}
      {!user && (
        <div className="bid-help" style={{ textAlign: 'center', marginTop: '4px' }}>
          <button className="link-btn" style={{ padding: 0 }} onClick={onLoginPrompt}>Sign in or create an account</button> to bid on this lot.
        </div>
      )}
    </div>
  );
}

function MyBid({ myBid, status }) {
  return (
    <div className="mybid">
      <div className="row"><span className="k">Your bid</span></div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="amt num">{fmt(myBid)}</span>
        <span style={{ fontSize: 12, color: status === 'winning' ? 'var(--win)' : 'var(--lose)' }}>
          {status === 'winning' ? '● Leading' : '● Outbid'}
        </span>
      </div>
    </div>
  );
}

function Feed({ bids }) {
  return (
    <div className="feed">
      <div className="feed-head">
        <span className="t">Live activity</span>
        <span className="live"><span className="dot" /> Live · {bids.length} bids</span>
      </div>
      <div className="feed-list">
        {bids.map((b, i) => (
          <div key={b.id} className={'feed-item' + (b.you ? ' you' : '')}>
            <span className="av" style={{ background: b.you ? 'linear-gradient(135deg,var(--gold-bright),var(--gold))' : `hsl(${b.hue ?? 200} 45% 62%)` }}>
              {b.you ? '★' : (b.userName ?? b.name ?? '?').slice(0, 1)}
            </span>
            <div className="who">
              <div className="n">
                {b.you ? 'You' : (b.userName ?? b.name)}
                {i === 0 && <span className="tag">High</span>}
              </div>
              <div className="tm">
                {b.time ?? new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <span className="amt num">{fmt(b.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BidRail({ auction }) {
  const { lot, startingBid, currentBid, minInc, myBid, status, bids, placeBid, bump, user, winner, watching, onLoginPrompt, lotClosed, onPayNow, myRank } = auction;
  const minNext = bids.length > 0 ? currentBid + minInc : startingBid;

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

  return (
    <aside className="bidrail">
      <div className="lot-head">
        <div className="lot-toprow">
          <span className="lot-kicker">Drop #{lot?.lotNumber} · Today's auction</span>
          <span className="watching"><span className="dot" /> {watching} watching</span>
        </div>
        <h1 className="lot-title">
          {(() => {
            if (isJson) {
              try {
                const parsed = JSON.parse(lot.artworkHeadline);
                if (parsed.title) return parsed.title;
              } catch (e) {}
            }
            return lot?.title ?? 'Loading…';
          })()}
        </h1>
        <div className="lot-edition">Unique piece · 1 of 1 · never reprinted</div>
        {(() => {
          if (!lot?.artworkHeadline) {
            return <p className="lot-desc">{lot?.description ?? ''}</p>;
          }

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
            
            return (
              <>
                {text} <span style={{ fontStyle: 'italic' }}>[{source}]</span>
              </>
            );
          };

          return (
            <>
              {(!isJson) && <p className="lot-desc">{lot?.description ?? ''}</p>}
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
                {isJson ? (
                  <ul style={{ color: 'var(--txt-dim)', lineHeight: '1.45', margin: 0, paddingLeft: '14px', listStyleType: 'disc' }}>
                    {signalsUsed.map((sig, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {formatSignalWithSource(sig)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span style={{ color: 'var(--txt-dim)', fontStyle: 'italic', lineHeight: '1.4' }}>
                    &ldquo;{lot.artworkHeadline}&rdquo;
                  </span>
                )}
              </div>
            </>
          );
        })()}
        <div className="lot-meta">
          <div className="m"><span className="k">Edition</span><span className="v">{lot?.edition ?? '1 / 1'}</span></div>
          <div className="m"><span className="k">Ships</span><span className="v">Worldwide</span></div>
          <div className="m"><span className="k">Material</span><span className="v">220 GSM, 100% Cotton</span></div>
        </div>
      </div>

      <div className="price-block">
        <div className="price-row price-start">
          <span className="label">Starting bid</span>
          <span className="amt num">{fmt(startingBid)}</span>
        </div>
        <div className="current">
          <div className="price-row"><span className="label">{bids.length === 0 ? 'Starting bid' : 'Current bid'}</span></div>
          <div className={'amt' + (bump ? ' bump' : '')} key={currentBid}>
            <span className="cur num">₹</span>
            <span className="num">{currentBid.toLocaleString('en-IN')}</span>
          </div>
          <div className="sub">{bids.length} bids · {fmt(currentBid - startingBid)} over start</div>
        </div>
      </div>

      {!lotClosed && <StatusBanner status={status} currentBid={currentBid} />}

      {myBid !== null && !lotClosed && (
        <MyBid myBid={myBid} status={status} />
      )}

      {!lotClosed && (
        <BidForm
          minNext={minNext}
          onPlace={placeBid}
          disabled={false}
          user={user}
          onLoginPrompt={onLoginPrompt}
          bidsCount={bids.length}
          isHighestBidder={status === 'winning'}
        />
      )}

      {lotClosed && (
        <ClosedBlob
          lot={lot}
          bids={bids}
          user={user}
          winner={winner}
          myRank={myRank}
          onPayNow={onPayNow}
        />
      )}

      {!lotClosed && <Feed bids={bids} />}

      {isJson && interpretiveStatement && (
        <div style={{
          padding: '18px 18px 18px',
          textAlign: 'left',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <span style={{ display: 'block', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '9.5px', color: 'var(--gold-bright)', marginBottom: '6px', fontWeight: 600 }}>
            Artist Interpretive Statement
          </span>
          <p style={{ color: 'var(--txt-dim)', fontSize: '12.5px', lineHeight: '1.55', margin: 0, fontStyle: 'italic' }}>
            {interpretiveStatement}
          </p>
        </div>
      )}
    </aside>
  );
}
