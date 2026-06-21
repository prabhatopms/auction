import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL ?? '';
const ADMIN_EMAILS = ['harshit.rnnh@gmail.com', 'prabhat1992@gmail.com', 'abmzone@gmail.com'];

const STATUSES = ['processing', 'printing', 'shipped', 'delivered'];

const STATUS_META = {
  processing: { label: 'Processing', bg: 'rgba(230,194,126,0.12)', color: '#e6c27e' },
  printing:   { label: 'Printing',   bg: 'rgba(139,92,246,0.15)',  color: '#a78bfa' },
  shipped:    { label: 'Shipped',    bg: 'rgba(34,197,94,0.12)',   color: '#4ade80' },
  delivered:  { label: 'Delivered',  bg: 'rgba(34,197,94,0.2)',    color: '#86efac' },
};

function StatusChip({ status }) {
  const m = STATUS_META[status] || STATUS_META.processing;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '3px 10px', borderRadius: 20, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtAddress(a) {
  if (!a) return '—';
  return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ');
}

function getLotTitle(lot) {
  if (!lot) return '—';
  let title = lot.title || '—';
  try {
    if (lot.artworkHeadline && lot.artworkHeadline.startsWith('{')) {
      const parsed = JSON.parse(lot.artworkHeadline);
      if (parsed.title) title = parsed.title;
    }
  } catch (e) {}
  return title;
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
      color: '#7d7a8c', marginBottom: 6, ...style }}>
      {children}
    </div>
  );
}

function TimelineDot({ label, date, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: done ? '#4ade80' : '#3d3a4c' }}>{done ? '●' : '○'}</span>
      <span style={{ fontSize: 12, color: done ? '#b9b6c4' : '#4d4a5c' }}>{label}</span>
      {date && <span style={{ fontSize: 11, color: '#7d7a8c', marginLeft: 'auto' }}>{fmtDate(date)}</span>}
    </div>
  );
}

function AdminInput({ label, value, onChange, placeholder, type = 'text', textarea }) {
  const sharedStyle = {
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f1ea',
    fontSize: 13, padding: '7px 10px', outline: 'none', fontFamily: 'inherit',
  };
  return (
    <div style={{ marginBottom: 10 }}>
      {label && <div style={{ fontSize: 11, color: '#7d7a8c', marginBottom: 4 }}>{label}</div>}
      {textarea ? (
        <textarea value={value} onChange={onChange} placeholder={placeholder} rows={3}
          style={{ ...sharedStyle, resize: 'vertical' }} />
      ) : (
        <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={sharedStyle} />
      )}
    </div>
  );
}

function OrderRow({ order, expanded, onToggle, onUpdate, token }) {
  const initEdit = () => ({
    status: order.status,
    carrier: order.carrier || '',
    trackingNumber: order.trackingNumber || '',
    trackingUrl: order.trackingUrl || '',
    notes: order.notes || '',
  });

  const [edit, setEdit] = useState(initEdit);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (expanded) setEdit(initEdit());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const set = (k) => (e) => setEdit((prev) => ({ ...prev, [k]: e.target.value }));

  const showMsg = (text, ok) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 3500);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/admin/orders/${order.id}/tracking`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(edit),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      onUpdate(order.id, data.order);
      showMsg('Saved!', true);
    } catch (err) {
      showMsg(err.message, false);
    }
    setSaving(false);
  };

  const handleResend = async (endpoint, label) => {
    try {
      const r = await fetch(`${API}/api/admin/orders/${order.id}/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      showMsg(`${label} sent!`, true);
    } catch (err) {
      showMsg(err.message, false);
    }
  };

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 20px',
    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
    borderBottom: expanded ? 'none' : '1px solid rgba(255,255,255,0.04)',
    transition: 'background 0.15s',
  };

  const btnBase = {
    padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: '#b9b6c4', letterSpacing: '0.04em', transition: 'all 0.15s',
  };

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      {/* Collapsed row */}
      <button style={rowStyle} onClick={onToggle}>
        <div style={{ flex: '0 0 110px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e6c27e', fontFamily: 'monospace' }}>
            {order.orderNumber}
          </div>
          <div style={{ fontSize: 11, color: '#7d7a8c' }}>Lot #{order.lot?.lotNumber < 0 ? 'Old ' + Math.abs(order.lot?.lotNumber) : order.lot?.lotNumber}</div>
        </div>
        <div style={{ flex: '1 1 160px', overflow: 'hidden' }}>
          <div style={{ fontSize: 13, color: '#f4f1ea', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getLotTitle(order.lot)}
          </div>
          <div style={{ fontSize: 11, color: '#7d7a8c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.user?.name} · {order.user?.email}
          </div>
        </div>
        <div style={{ flex: '0 0 90px', textAlign: 'right' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f4f1ea', fontFamily: 'monospace' }}>
            ₹{(order.amount / 100).toLocaleString('en-IN')}
          </div>
          <div style={{ fontSize: 11, color: '#7d7a8c' }}>{fmtDate(order.paidAt)}</div>
        </div>
        <div style={{ flex: '0 0 90px', display: 'flex', justifyContent: 'center' }}>
          <StatusChip status={order.status} />
        </div>
        <div style={{ fontSize: 12, color: '#4d4a5c', marginLeft: 4 }}>{expanded ? '▲' : '▼'}</div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div style={{ padding: '0 20px 24px', background: 'rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', paddingTop: 20 }}>

            {/* Left column: read-only details */}
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>

              <SectionLabel>Customer</SectionLabel>
              <div style={{ fontSize: 14, color: '#f4f1ea', fontWeight: 600, marginBottom: 2 }}>{order.user?.name}</div>
              <div style={{ fontSize: 12, color: '#b9b6c4', marginBottom: 2 }}>{order.user?.email}</div>
              {order.user?.phone && <div style={{ fontSize: 12, color: '#7d7a8c' }}>{order.user.phone}</div>}

              <SectionLabel style={{ marginTop: 18 }}>Shipping address</SectionLabel>
              <div style={{ fontSize: 13, color: '#f4f1ea', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 600 }}>{order.address?.name}</div>
                <div style={{ color: '#b9b6c4' }}>{fmtAddress(order.address)}</div>
                <div style={{ color: '#7d7a8c' }}>{order.address?.phone}</div>
              </div>

              <SectionLabel style={{ marginTop: 18 }}>Payment</SectionLabel>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#e6c27e', fontFamily: 'monospace' }}>
                ₹{(order.amount / 100).toLocaleString('en-IN')}
              </div>
              {order.razorpayPaymentId && (
                <div style={{ fontSize: 11, color: '#4d4a5c', fontFamily: 'monospace', marginTop: 2 }}>
                  {order.razorpayPaymentId}
                </div>
              )}
              {order.vendorOrderId && (
                <div style={{ fontSize: 11, color: '#7d7a8c', marginTop: 4 }}>
                  Vendor ID: <span style={{ fontFamily: 'monospace', color: '#a78bfa' }}>{order.vendorOrderId}</span>
                </div>
              )}

              <SectionLabel style={{ marginTop: 18 }}>Timeline</SectionLabel>
              <TimelineDot label="Paid" date={order.paidAt} done />
              <TimelineDot label="Printing" date={order.printedAt} done={!!order.printedAt} />
              <TimelineDot label="Shipped" date={order.shippedAt} done={!!order.shippedAt} />
              <TimelineDot label="Delivered" date={order.deliveredAt} done={!!order.deliveredAt} />
            </div>

            {/* Right column: edit */}
            <div style={{ flex: '1 1 260px', minWidth: 240 }}>
              <SectionLabel>Update fulfillment</SectionLabel>

              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#7d7a8c', marginBottom: 4 }}>Status</div>
                <select value={edit.status} onChange={set('status')} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 6, color: '#f4f1ea', fontSize: 13, padding: '7px 10px', outline: 'none',
                  fontFamily: 'inherit', cursor: 'pointer',
                }}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s} style={{ background: '#1a1b2e' }}>
                      {STATUS_META[s].label}
                    </option>
                  ))}
                </select>
              </div>

              <AdminInput label="Carrier" value={edit.carrier} onChange={set('carrier')} placeholder="e.g. Blue Dart, DTDC, Delhivery" />
              <AdminInput label="Tracking number" value={edit.trackingNumber} onChange={set('trackingNumber')} placeholder="1234567890" />
              <AdminInput label="Tracking URL" value={edit.trackingUrl} onChange={set('trackingUrl')} placeholder="https://track.carrier.com/…" />
              <AdminInput label="Internal notes" value={edit.notes} onChange={set('notes')} placeholder="Notes visible only to you…" textarea />

              {edit.trackingUrl && (
                <div style={{ marginBottom: 10 }}>
                  <a href={edit.trackingUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 12, color: '#4ade80', textDecoration: 'none' }}>
                    ↗ Open tracking link
                  </a>
                </div>
              )}

              {msg && (
                <div style={{ fontSize: 12, color: msg.ok ? '#4ade80' : '#ff6b7d', marginBottom: 10, fontWeight: 600 }}>
                  {msg.ok ? '✓ ' : '⚠ '}{msg.text}
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  width: '100%', padding: '9px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer', marginBottom: 12,
                  background: saving ? 'rgba(230,194,126,0.3)' : 'linear-gradient(90deg, #e6c27e, #f0d49a)',
                  color: '#0c0d15', letterSpacing: '0.04em',
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => handleResend('resend-invoice', 'Invoice')} style={btnBase}>
                  Resend invoice
                </button>
                <button
                  onClick={() => handleResend('resend-vendor', 'Qikink order')}
                  style={{
                    ...btnBase,
                    borderColor: order.vendorOrderId ? 'rgba(167,139,250,0.3)' : 'rgba(230,194,126,0.3)',
                    color: order.vendorOrderId ? '#a78bfa' : '#e6c27e',
                    background: order.vendorOrderId ? 'rgba(167,139,250,0.07)' : 'rgba(230,194,126,0.07)',
                  }}
                >
                  {order.vendorOrderId ? '↺ Re-send to Qikink' : '↑ Create Qikink order'}
                </button>
              </div>

              {edit.status === 'shipped' && order.status !== 'shipped' && (
                <div style={{ marginTop: 10, fontSize: 11, color: '#4ade80', lineHeight: 1.5,
                  padding: '8px 10px', background: 'rgba(74,222,128,0.06)', borderRadius: 6,
                  border: '1px solid rgba(74,222,128,0.15)' }}>
                  Saving will email the customer their tracking info automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, token, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [globalMsg, setGlobalMsg] = useState('');
  const [auctionLoading, setAuctionLoading] = useState(null);
  const [activeTab, setActiveTab] = useState('bidding');
  const [currentLot, setCurrentLot] = useState(null);
  const [artworkDrafts, setArtworkDrafts] = useState([]);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [artworkMsg, setArtworkMsg] = useState(null);
  const [igPosting, setIgPosting] = useState(new Set());
  const [igPosted, setIgPosted] = useState(new Set());
  const [sessionHistory, setSessionHistory] = useState([]);
  const [expandedSession, setExpandedSession] = useState(null);
  const [sessionDrafts, setSessionDrafts] = useState({});

  // Artwork Generation Studio states
  const [showStudio, setShowStudio] = useState(false);
  const [studioStep, setStudioStep] = useState('signals'); // 'signals' | 'prompt' | 'preview'
  const [signals, setSignals] = useState(null);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [selectedSignals, setSelectedSignals] = useState([]);
  const [studioPrompt, setStudioPrompt] = useState({
    title: '',
    image_prompt: '',
    essence: '',
    interpretive_statement: '',
    data_signals_used: [],
    data_signals_used_summarized: []
  });
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatedDraft, setGeneratedDraft] = useState(null);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [studioError, setStudioError] = useState(null);
  const [previewMode, setPreviewMode] = useState('tshirt'); // 'tshirt' | 'artwork'
  const [selectedDraftForNewLot, setSelectedDraftForNewLot] = useState(null);

  const isAdmin = !authLoading && user && ADMIN_EMAILS.includes(user.email);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate('/');
  }, [authLoading, isAdmin]);

  const authHeader = useCallback(
    () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }),
    [token]
  );

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setOrders(data.orders || []);
    } catch (_) {}
    setLoading(false);
  }, [token]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const fetchCurrentLot = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/lots/current`);
      const data = await r.json();
      const lot = data.lot ?? null;
      setCurrentLot(lot);
      return lot;
    } catch (_) {
      setCurrentLot(null);
      return null;
    }
  }, []);

  const fetchDrafts = useCallback(async (lotId) => {
    try {
      const url = lotId
        ? `${API}/api/admin/artwork-drafts?lotId=${lotId}&includeUnassigned=true`
        : `${API}/api/admin/artwork-drafts`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setArtworkDrafts(data.drafts ?? []);
    } catch (_) {}
  }, [token]);

  const fetchSessionHistory = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(`${API}/api/admin/session-history`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setSessionHistory(data.lots ?? []);
    } catch (_) {}
  }, [token]);

  const fetchSessionDrafts = useCallback(async (lotId) => {
    if (sessionDrafts[lotId]) return; // already loaded
    try {
      const r = await fetch(`${API}/api/admin/artwork-drafts?lotId=${lotId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await r.json();
      setSessionDrafts((prev) => ({ ...prev, [lotId]: data.drafts ?? [] }));
    } catch (_) {}
  }, [token, sessionDrafts]);

  const refreshBiddingTab = useCallback(async () => {
    const lot = await fetchCurrentLot();
    await fetchDrafts(lot?.id ?? null);
    await fetchSessionHistory();
  }, [fetchCurrentLot, fetchDrafts, fetchSessionHistory]);

  useEffect(() => { refreshBiddingTab(); }, [refreshBiddingTab]);

  const notify = (msg) => {
    setGlobalMsg(msg);
    setTimeout(() => setGlobalMsg(''), 3000);
  };

  const handleAuctionAction = async (endpoint, label, body = null) => {
    setAuctionLoading(endpoint);
    try {
      const r = await fetch(`${API}/api/admin/${endpoint}`, {
        method: 'POST',
        headers: authHeader(),
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      notify(`${label} — done.`);
      fetchOrders();
      refreshBiddingTab();
    } catch (err) {
      notify(`Error: ${err.message}`);
    } finally {
      setAuctionLoading(null);
    }
  };

  const handleGenerateDraft = async () => {
    setGeneratingDraft(true);
    setArtworkMsg(null);
    try {
      const r = await fetch(`${API}/api/admin/generate-artwork-draft`, {
        method: 'POST',
        headers: authHeader(),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Generation failed');
      setArtworkDrafts((prev) => [data.draft, ...prev]);
    } catch (err) {
      setArtworkMsg({ text: `Error: ${err.message}`, ok: false });
    } finally {
      setGeneratingDraft(false);
    }
  };

  const openStudio = async () => {
    setShowStudio(true);
    setStudioStep('signals');
    setSelectedSignals([]);
    setStudioPrompt({
      title: '',
      image_prompt: '',
      essence: '',
      interpretive_statement: '',
      data_signals_used: [],
      data_signals_used_summarized: []
    });
    setGeneratedDraft(null);
    setStudioError(null);
    setSignalsLoading(true);
    try {
      const r = await fetch(`${API}/api/admin/daily-signals`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const resData = await r.json();
      if (!r.ok) throw new Error(resData.error || 'Failed to fetch daily signals');
      setSignals(resData.data);
    } catch (err) {
      setStudioError(err.message);
    } finally {
      setSignalsLoading(false);
    }
  };

  const handleSmartSelect = () => {
    if (!signals) return;
    const group1 = [...(signals.upi_weird_news || []).map(s => `UPI Weird News: ${s}`), ...(signals.oddity_central || []).map(s => `Oddity Central: ${s}`)];
    const group2 = (signals.top_wikipedia || []).map(s => `Wikipedia Top Search: ${s}`);
    const group3 = [...(signals.positive_news || []).map(s => `Good News Network: ${s.headline} (${s.summary})`), ...(signals.optimist_daily || []).map(s => `Optimist Daily: ${s.headline} (${s.summary})`)];
    const group4 = (signals.polymarket || []).map(s => `Polymarket Trending: ${s.question} (${s.percentage}% probability)`);
    const group5 = (signals.top_song || []).map(s => `Top Song: ${s.title} by ${s.artist}`);
    const group6 = signals.wikipedia_on_this_day ? [`Wikipedia On this Day: In ${signals.wikipedia_on_this_day.year}, ${signals.wikipedia_on_this_day.event}`] : [];
    const group7 = (signals.google_news || []).map(s => `Google News: ${s}`);

    const selected = [];

    // Always pick 1 from Google News (group7) if it exists and has items
    if (group7.length > 0) {
      const randomGoogleNews = group7[Math.floor(Math.random() * group7.length)];
      selected.push(randomGoogleNews);
    }

    // Pick exactly 4 other signals from 4 different groups (out of groups 1 to 6)
    const otherGroups = [group1, group2, group3, group4, group5, group6].filter(g => g.length > 0);
    const shuffledOther = [...otherGroups].sort(() => 0.5 - Math.random());
    const pickedOther = shuffledOther.slice(0, 4);
    
    pickedOther.forEach(group => {
      const randomItem = group[Math.floor(Math.random() * group.length)];
      if (randomItem) selected.push(randomItem);
    });

    setSelectedSignals(selected);
  };

  const toggleSignal = (val) => {
    setSelectedSignals(prev => 
      prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]
    );
  };

  const handleGeneratePrompt = async () => {
    if (selectedSignals.length === 0) return;
    setGeneratingPrompt(true);
    setStudioError(null);
    try {
      const r = await fetch(`${API}/api/admin/generate-prompt`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ selectedSignals })
      });
      const resData = await r.json();
      if (!r.ok) throw new Error(resData.error || 'Failed to synthesize prompt');
      setStudioPrompt({
        title: resData.result.title || '',
        image_prompt: resData.result.image_prompt || '',
        essence: resData.result.essence || '',
        interpretive_statement: resData.result.interpretive_statement || '',
        data_signals_used: resData.result.data_signals_used || [],
        data_signals_used_summarized: resData.result.data_signals_used_summarized || []
      });
      setStudioStep('prompt');
    } catch (err) {
      setStudioError(err.message);
    } finally {
      setGeneratingPrompt(false);
    }
  };

  const handleGenerateImage = async () => {
    setGeneratingImage(true);
    setStudioError(null);
    try {
      const r = await fetch(`${API}/api/admin/generate-image-from-prompt`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({
          prompt: studioPrompt.image_prompt,
          title: studioPrompt.title,
          essence: studioPrompt.essence,
          interpretive_statement: studioPrompt.interpretive_statement,
          data_signals_used: studioPrompt.data_signals_used,
          data_signals_used_summarized: studioPrompt.data_signals_used_summarized
        })
      });
      const resData = await r.json();
      if (!r.ok) throw new Error(resData.error || 'Failed to generate image');
      setGeneratedDraft(resData.draft);
      setStudioStep('preview');
      refreshBiddingTab();
    } catch (err) {
      setStudioError(err.message);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleMakeLiveFromStudio = async () => {
    if (!generatedDraft) return;
    setStudioError(null);
    try {
      if (currentLot) {
        await handleSetArtwork(generatedDraft.id);
        setShowStudio(false);
        notify('Artwork is now live on active lot.');
      } else {
        await handleStartBidWithDraft(generatedDraft.id);
        setShowStudio(false);
        notify('New lot started with this artwork.');
      }
    } catch (err) {
      setStudioError(err.message || 'Failed to update bidding session');
    }
  };

  const handleStartBidWithDraft = async (draftId) => {
    setAuctionLoading('new-bid');
    try {
      const r = await fetch(`${API}/api/admin/new-bid`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ draftId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      notify('New lot started.');
      fetchOrders();
      refreshBiddingTab();
    } catch (err) {
      notify(`Error: ${err.message}`);
    } finally {
      setAuctionLoading(null);
    }
  };

  const handleSetArtwork = async (draftId) => {
    setArtworkMsg(null);
    try {
      const r = await fetch(`${API}/api/admin/set-artwork`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ draftId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      setArtworkMsg({ text: 'Artwork set on active lot.', ok: true });
      refreshBiddingTab();
    } catch (err) {
      setArtworkMsg({ text: `Error: ${err.message}`, ok: false });
    }
  };

  const handlePostToInstagram = async (draft) => {
    setIgPosting(prev => new Set([...prev, draft.id]));
    try {
      const r = await fetch(`${API}/api/admin/instagram/post-now`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ draftId: draft.id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed');
      setIgPosted(prev => new Set([...prev, draft.id]));
      notify('Posted to Instagram!');
    } catch (err) {
      notify(`Instagram post failed: ${err.message}`);
    } finally {
      setIgPosting(prev => { const n = new Set(prev); n.delete(draft.id); return n; });
    }
  };

  const toggleLotVisibility = async (lotId) => {
    try {
      const r = await fetch(`${API}/api/admin/toggle-lot-visibility`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ lotId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to toggle visibility');
      const data = await r.json();
      setSessionHistory((prev) =>
        prev.map((lot) =>
          lot.id === lotId ? { ...lot, status: data.status } : lot
        )
      );
      notify(`Lot visibility updated to: ${data.status === 'hidden' ? 'Hidden' : 'Visible'}`);
    } catch (err) {
      notify(`Error: ${err.message}`);
    }
  };

  const handleResetToLot1 = async () => {
    const ok = window.confirm("This will archive all past lots (renumbering them to negative numbers) and start a new sequence at Lot #1 today with blank artwork. No bids, orders, or drafts will be deleted. Do you want to proceed?");
    if (!ok) return;

    setAuctionLoading('reset-db-to-lot-1');
    try {
      const r = await fetch(`${API}/api/admin/reset-db-to-lot-1`, {
        method: 'POST',
        headers: authHeader(),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      notify('Bidding sequence reset. Lot #1 is now active today with blank artwork.');
      fetchOrders();
      refreshBiddingTab();
    } catch (err) {
      notify(`Error: ${err.message}`);
    } finally {
      setAuctionLoading(null);
    }
  };


  const handleUpdate = useCallback((orderId, updatedOrder) => {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, ...updatedOrder } : o)));
  }, []);

  const stats = useMemo(() => {
    const s = { all: orders.length };
    STATUSES.forEach((st) => { s[st] = orders.filter((o) => o.status === st).length; });
    return s;
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') list = list.filter((o) => o.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((o) =>
        [o.orderNumber, o.user?.name, o.user?.email, getLotTitle(o.lot)]
          .some((v) => v?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [orders, statusFilter, search]);

  const tabStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    border: 'none', letterSpacing: '0.05em', transition: 'all 0.15s',
    background: active ? 'rgba(230,194,126,0.15)' : 'transparent',
    color: active ? '#e6c27e' : '#7d7a8c',
  });

  const auctionBtnStyle = {
    padding: '8px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', cursor: 'pointer', border: '1px solid rgba(230,194,126,0.25)',
    background: 'rgba(230,194,126,0.07)', color: '#e6c27e',
  };

  if (authLoading || !isAdmin) return null;

  return (
    <div className="account-page">
      <div className="auth-bg"><div className="auth-nebula-a" /><div className="auth-nebula-b" /></div>

      <div className="account-card" style={{ maxWidth: 960 }}>
        {/* Header */}
        <div className="account-header">
          <button className="account-back" onClick={() => navigate('/')}>← Back</button>
          <div className="account-title-row">
            <img src="/favicon.png" className="brand-mark" style={{ width: 26, height: 26, background: 'none', boxShadow: 'none' }} alt="" />
            <h2 className="account-title">Admin</h2>
          </div>
        </div>

        {/* Top-level tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
          {[['bidding', 'Bidding'], ['orders', 'Orders']].map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              padding: '13px 22px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', letterSpacing: '0.03em',
              color: activeTab === key ? '#f4f1ea' : '#7d7a8c',
              borderBottom: activeTab === key ? '2px solid #e6c27e' : '2px solid transparent',
              transition: 'color 0.15s',
            }}>
              {label}
            </button>
          ))}
          {globalMsg && (
            <span style={{ fontSize: 12, color: globalMsg.startsWith('Error') ? '#ff6b7d' : '#4ade80',
              marginLeft: 'auto', alignSelf: 'center', paddingRight: 20 }}>
              {globalMsg}
            </span>
          )}
        </div>

        {activeTab === 'bidding' && (
          <>
            {/* Auction controls */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)',
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {currentLot?.status === 'active' ? (
                <button
                  disabled={!!auctionLoading}
                  onClick={() => handleAuctionAction('close-bid', 'Bid closed')}
                  style={{
                    ...auctionBtnStyle,
                    border: '1px solid rgba(255,107,125,0.35)',
                    background: 'rgba(255,107,125,0.08)',
                    color: '#ff6b7d',
                    opacity: auctionLoading ? 0.55 : 1,
                    cursor: auctionLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {auctionLoading === 'close-bid' ? '… Closing' : '■ Stop bidding'}
                </button>
              ) : (
                <button
                   disabled={!!auctionLoading || !selectedDraftForNewLot}
                   onClick={() => handleStartBidWithDraft(selectedDraftForNewLot)}
                   style={{
                     ...auctionBtnStyle,
                     opacity: auctionLoading ? 0.55 : !selectedDraftForNewLot ? 0.4 : 1,
                     cursor: auctionLoading ? 'not-allowed' : !selectedDraftForNewLot ? 'not-allowed' : 'pointer',
                     borderColor: !selectedDraftForNewLot ? 'rgba(255,255,255,0.06)' : 'rgba(230,194,126,0.25)',
                     background: !selectedDraftForNewLot ? 'rgba(255,255,255,0.02)' : 'rgba(230,194,126,0.07)',
                     color: !selectedDraftForNewLot ? '#7d7a8c' : '#e6c27e',
                     transition: 'all 0.15s'
                   }}
                 >
                   {auctionLoading === 'new-bid' ? '⟳ Starting…' : '▶ Start bidding'}
                 </button>
              )}
              {currentLot && (
                <span style={{ fontSize: 12,
                  color: currentLot.status === 'active' ? '#4ade80' : '#4d4a5c' }}>
                  {currentLot.status === 'active'
                    ? '● Lot #' + (currentLot.lotNumber < 0 ? 'Old ' + Math.abs(currentLot.lotNumber) : currentLot.lotNumber) + ' live'
                    : '○ Lot #' + (currentLot.lotNumber < 0 ? 'Old ' + Math.abs(currentLot.lotNumber) : currentLot.lotNumber) + ' closed'}
                </span>
              )}
              <button
                disabled={!!auctionLoading}
                onClick={handleResetToLot1}
                style={{
                  ...auctionBtnStyle,
                  border: '1px solid rgba(230,194,126,0.3)',
                  background: 'rgba(230,194,126,0.02)',
                  color: '#e6c27e',
                  marginLeft: 'auto',
                  opacity: auctionLoading ? 0.55 : 1,
                  cursor: auctionLoading ? 'not-allowed' : 'pointer',
                  padding: '6px 12px',
                  fontSize: '12px'
                }}
              >
                {auctionLoading === 'reset-db-to-lot-1' ? '… Starting' : 'Start fresh today (Lot #1)'}
              </button>
            </div>

            {/* Session artwork studio */}
            <div style={{ padding: '20px' }}>

              {/* Section heading: lot identifier + generate button */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                <div>
                  {currentLot ? (
                    <>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#f4f1ea', lineHeight: 1.2 }}>
                        Lot #{currentLot.lotNumber < 0 ? 'Old ' + Math.abs(currentLot.lotNumber) : currentLot.lotNumber}
                      </div>
                      <div style={{ fontSize: 12, color: '#7d7a8c', marginTop: 3 }}>
                        {new Date(currentLot.startsAt).toLocaleDateString('en-IN', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                        })}
                        {' · '}
                        <span style={{ color: currentLot.status === 'active' ? '#4ade80' : '#7d7a8c' }}>
                          {currentLot.status === 'active' ? 'Bidding live' : 'Closed'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#7d7a8c' }}>No active lot</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={openStudio}
                    disabled={!!auctionLoading}
                    style={{
                      ...auctionBtnStyle,
                      opacity: auctionLoading ? 0.55 : 1,
                      cursor: auctionLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ✨ Generate Artwork
                  </button>
                  {artworkMsg && (
                    <span style={{ fontSize: 12, color: artworkMsg.ok ? '#4ade80' : '#ff6b7d' }}>
                      {artworkMsg.text}
                    </span>
                  )}
                </div>
              </div>

              {/* Artwork cards */}
              {artworkDrafts.length === 0 && !generatingDraft ? (
                <div style={{ fontSize: 13, color: '#4d4a5c', paddingTop: 8 }}>
                  No artworks generated yet. Click "Generate Artwork" to create one.
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {artworkDrafts.map((draft) => {
                    let title = 'Untitled';
                    try {
                      if (draft.artworkHeadline?.startsWith('{')) {
                        const p = JSON.parse(draft.artworkHeadline);
                        if (p.title) title = p.title;
                      }
                    } catch (_) {}
                    const isActive = !!(currentLot?.status === 'active' && currentLot?.artworkUrl && currentLot.artworkUrl === draft.artworkUrl);
                    const isSelectedForNew = selectedDraftForNewLot === draft.id;
                    return (
                      <div key={draft.id} style={{
                        width: 180, flexShrink: 0,
                        background: isActive ? 'rgba(230,194,126,0.05)' : isSelectedForNew ? 'rgba(230,194,126,0.08)' : 'rgba(255,255,255,0.025)',
                        border: `1px solid ${isActive ? 'rgba(230,194,126,0.4)' : isSelectedForNew ? '#e6c27e' : 'rgba(255,255,255,0.07)'}`,
                        borderRadius: 10, overflow: 'hidden',
                      }}>
                        {/* Image */}
                        {draft.artworkUrl ? (
                          <img src={draft.artworkUrl} alt={title}
                            style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', aspectRatio: '3/4', background: '#0d0d0d',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, color: '#3d3a4c' }}>
                            no image
                          </div>
                        )}
                        {/* Info */}
                        <div style={{ padding: '10px 12px 12px' }}>
                          {isActive && (
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                              textTransform: 'uppercase', color: '#e6c27e', marginBottom: 5 }}>
                              ● Active
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: '#c9c6d4', lineHeight: 1.4, fontWeight: 500,
                            overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', marginBottom: 6 }}>
                            {title}
                          </div>
                          <div style={{ fontSize: 10, color: '#4d4a5c', marginBottom: 10 }}>
                            {new Date(draft.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          {/* Actions */}
                          {isActive ? (
                            <div style={{ fontSize: 10, color: '#7d7a8c', fontStyle: 'italic' }}>
                              Shown on bid page
                            </div>
                          ) : currentLot?.status === 'active' ? (
                            <button onClick={() => handleSetArtwork(draft.id)}
                              disabled={!!auctionLoading}
                              style={{ width: '100%', fontSize: 11, padding: '6px 0', borderRadius: 5,
                                border: '1px solid rgba(230,194,126,0.3)', background: 'rgba(230,194,126,0.08)',
                                color: '#e6c27e', cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em' }}>
                              Make active
                            </button>
                          ) : (
                            <button onClick={() => {
                              setSelectedDraftForNewLot(prev => prev === draft.id ? null : draft.id);
                            }}
                              style={{ width: '100%', fontSize: 11, padding: '6px 0', borderRadius: 5,
                                border: isSelectedForNew ? '1px solid #e6c27e' : '1px solid rgba(255,255,255,0.12)',
                                background: isSelectedForNew ? 'rgba(230,194,126,0.18)' : 'rgba(255,255,255,0.04)',
                                color: isSelectedForNew ? '#e6c27e' : '#b9b6c4',
                                cursor: 'pointer', fontWeight: 600, letterSpacing: '0.04em',
                                transition: 'all 0.15s' }}>
                              {isSelectedForNew ? '✓ Selected' : 'Select for Bidding'}
                            </button>
                          )}
                          <button
                            onClick={() => handlePostToInstagram(draft)}
                            disabled={igPosting.has(draft.id) || igPosted.has(draft.id)}
                            style={{ width: '100%', fontSize: 11, padding: '6px 0', borderRadius: 5, marginTop: 6,
                              border: igPosted.has(draft.id) ? '1px solid rgba(100,200,100,0.4)' : '1px solid rgba(225,48,108,0.35)',
                              background: igPosted.has(draft.id) ? 'rgba(100,200,100,0.08)' : 'rgba(225,48,108,0.08)',
                              color: igPosted.has(draft.id) ? '#6dc86d' : '#e1306c',
                              cursor: igPosting.has(draft.id) || igPosted.has(draft.id) ? 'default' : 'pointer',
                              fontWeight: 600, letterSpacing: '0.04em', transition: 'all 0.15s' }}>
                            {igPosting.has(draft.id) ? 'Posting…' : igPosted.has(draft.id) ? '✓ Posted' : '📸 Instagram'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Session repository */}
            {sessionHistory.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', padding: '20px' }}>
                <div style={{ fontSize: 11, color: '#7d7a8c', textTransform: 'uppercase',
                  letterSpacing: '0.1em', marginBottom: 14 }}>Past Sessions</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sessionHistory.map((lot) => {
                    let lotTitle = lot.title;
                    try {
                      if (lot.artworkHeadline?.startsWith('{')) {
                        const p = JSON.parse(lot.artworkHeadline);
                        if (p.title) lotTitle = p.title;
                      }
                    } catch (_) {}
                    const isOpen = expandedSession === lot.id;
                    const loadedDrafts = sessionDrafts[lot.id];
                    let drafts = [];
                    if (loadedDrafts) {
                      drafts = [...loadedDrafts];
                      if (lot.artworkUrl && !drafts.some(d => d.artworkUrl === lot.artworkUrl)) {
                        drafts.unshift({
                          id: `synth-${lot.id}`,
                          artworkUrl: lot.artworkUrl,
                          artworkHeadline: lot.artworkHeadline,
                          artworkPrompt: lot.artworkPrompt,
                          createdAt: lot.startsAt,
                        });
                      }
                    }
                    return (
                      <div key={lot.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button
                            onClick={() => {
                              setExpandedSession(isOpen ? null : lot.id);
                              if (!isOpen) fetchSessionDrafts(lot.id);
                            }}
                            style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12,
                              padding: '10px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                              background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent',
                              textAlign: 'left', transition: 'background 0.15s' }}
                          >
                            {lot.artworkUrl && (
                              <img src={lot.artworkUrl} alt=""
                                style={{ width: 32, height: 42, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: '#c9c6d4',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Lot #{lot.lotNumber < 0 ? 'Old ' + Math.abs(lot.lotNumber) : lot.lotNumber} — {lotTitle}
                              </div>
                              <div style={{ fontSize: 11, color: '#4d4a5c', marginTop: 2 }}>
                                {new Date(lot.startsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                {' · '}
                                {lot._count?.artworkDrafts ?? 0} artwork{(lot._count?.artworkDrafts ?? 0) !== 1 ? 's' : ''} generated
                              </div>
                            </div>
                            <span style={{ fontSize: 11, color: '#4d4a5c', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLotVisibility(lot.id);
                            }}
                            style={{
                              background: lot.status === 'hidden' ? 'rgba(255,255,255,0.05)' : 'rgba(218,165,32,0.1)',
                              border: `1px solid ${lot.status === 'hidden' ? 'rgba(255,255,255,0.1)' : 'var(--gold)'}`,
                              color: lot.status === 'hidden' ? '#7d7a8c' : 'var(--gold-bright)',
                              borderRadius: '999px', padding: '6px 12px', fontSize: '10px',
                              cursor: 'pointer', fontFamily: 'var(--font-display)', textTransform: 'uppercase',
                              letterSpacing: '0.05em', whiteSpace: 'nowrap', transition: 'all 0.15s',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                            }}
                            title={lot.status === 'hidden' ? "Make Visible in Archive" : "Hide from Archive"}
                          >
                            {lot.status === 'hidden' ? 'Hidden' : 'Visible'}
                          </button>
                        </div>

                        {isOpen && (
                          <div style={{ padding: '8px 12px 12px 56px' }}>
                            {!loadedDrafts ? (
                              <div style={{ fontSize: 12, color: '#4d4a5c' }}>Loading…</div>
                            ) : drafts.length === 0 ? (
                              <div style={{ fontSize: 12, color: '#4d4a5c' }}>No artworks found for this session.</div>
                            ) : (
                              <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
                                {drafts.map((draft) => {
                                  let draftTitle = 'Untitled';
                                  try {
                                    if (draft.artworkHeadline?.startsWith('{')) {
                                      const p = JSON.parse(draft.artworkHeadline);
                                      if (p.title) draftTitle = p.title;
                                    }
                                  } catch (_) {}
                                  const wasActive = lot.artworkUrl && lot.artworkUrl === draft.artworkUrl;
                                  const isSelectedForNew = selectedDraftForNewLot === draft.id;
                                  return (
                                    <div key={draft.id} style={{
                                      flexShrink: 0, width: 110,
                                      border: `1px solid ${wasActive ? 'rgba(230,194,126,0.35)' : isSelectedForNew ? '#e6c27e' : 'rgba(255,255,255,0.07)'}`,
                                      borderRadius: 7, overflow: 'hidden',
                                      background: wasActive ? 'rgba(230,194,126,0.04)' : isSelectedForNew ? 'rgba(230,194,126,0.08)' : 'rgba(255,255,255,0.02)',
                                    }}>
                                      {draft.artworkUrl ? (
                                        <img src={draft.artworkUrl} alt={draftTitle}
                                          style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
                                      ) : (
                                        <div style={{ width: '100%', aspectRatio: '3/4', background: '#0d0d0d' }} />
                                      )}
                                      <div style={{ padding: '6px 7px 7px' }}>
                                        {wasActive && (
                                          <div style={{ fontSize: 9, fontWeight: 700, color: '#e6c27e',
                                            letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>
                                            ● Used
                                          </div>
                                        )}
                                        <div style={{ fontSize: 10, color: '#7d7a8c', lineHeight: 1.3,
                                          overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2,
                                          WebkitBoxOrient: 'vertical' }}>
                                          {draftTitle}
                                        </div>
                                        {currentLot?.status === 'active' ? (
                                          <button
                                            onClick={() => handleSetArtwork(draft.id)}
                                            disabled={!!auctionLoading}
                                            style={{
                                              width: '100%', fontSize: 9, padding: '3px 0', marginTop: 5, borderRadius: 4,
                                              border: '1px solid rgba(230,194,126,0.3)', background: 'rgba(230,194,126,0.08)',
                                              color: '#e6c27e', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s'
                                            }}
                                          >
                                            Make active
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => setSelectedDraftForNewLot(prev => prev === draft.id ? null : draft.id)}
                                            style={{
                                              width: '100%', fontSize: 9, padding: '3px 0', marginTop: 5, borderRadius: 4,
                                              border: isSelectedForNew ? '1px solid #e6c27e' : '1px solid rgba(255,255,255,0.12)',
                                              background: isSelectedForNew ? 'rgba(230,194,126,0.18)' : 'rgba(255,255,255,0.04)',
                                              color: isSelectedForNew ? '#e6c27e' : '#b9b6c4',
                                              cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s'
                                            }}
                                          >
                                            {isSelectedForNew ? '✓ Selected' : 'Select'}
                                          </button>
                                        )}
                                        <button
                                          onClick={() => handlePostToInstagram(draft)}
                                          disabled={igPosting.has(draft.id) || igPosted.has(draft.id)}
                                          style={{
                                            width: '100%', fontSize: 9, padding: '3px 0', marginTop: 4, borderRadius: 4,
                                            border: igPosted.has(draft.id) ? '1px solid rgba(100,200,100,0.4)' : '1px solid rgba(225,48,108,0.3)',
                                            background: igPosted.has(draft.id) ? 'rgba(100,200,100,0.08)' : 'rgba(225,48,108,0.07)',
                                            color: igPosted.has(draft.id) ? '#6dc86d' : '#e1306c',
                                            cursor: igPosting.has(draft.id) || igPosted.has(draft.id) ? 'default' : 'pointer',
                                            fontWeight: 600, transition: 'all 0.15s'
                                          }}
                                        >
                                          {igPosting.has(draft.id) ? 'Posting…' : igPosted.has(draft.id) ? '✓ Posted' : '📸 Instagram'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'orders' && (
          <>
            {/* Status filter row */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
              {[['all', 'All'], ...STATUSES.map((s) => [s, STATUS_META[s].label])].map(([key, label]) => (
                <button key={key} onClick={() => setStatusFilter(key)} style={{
                  ...tabStyle(statusFilter === key),
                  borderRadius: 0, padding: '12px 18px', fontSize: 12,
                  borderBottom: statusFilter === key ? '2px solid #e6c27e' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>({stats[key] ?? 0})</span>
                </button>
              ))}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 12 }}>
                <button onClick={fetchOrders} style={{ fontSize: 11, color: '#7d7a8c', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                  Refresh
                </button>
              </div>
            </div>

            {/* Search */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by order #, customer name, email, or product…"
                style={{
                  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#f4f1ea',
                  fontSize: 13, padding: '8px 12px', outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Column headers */}
            {!loading && filtered.length > 0 && (
              <div style={{ display: 'flex', padding: '6px 20px', gap: 12 }}>
                {[['Order #', '110px'], ['Product / Customer', '1 1 160px'], ['Amount', '90px'], ['Status', '90px']].map(
                  ([h, w]) => (
                    <div key={h} style={{ flex: `0 0 ${w}`, fontSize: 11, color: '#4d4a5c',
                      textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 500 }}>
                      {h}
                    </div>
                  )
                )}
              </div>
            )}

            {/* Orders */}
            {loading ? (
              <div className="account-empty"><div className="account-empty-text">Loading…</div></div>
            ) : filtered.length === 0 ? (
              <div className="account-empty">
                <div className="account-empty-icon">📦</div>
                <div className="account-empty-text">{search ? 'No orders match your search.' : 'No orders yet.'}</div>
              </div>
            ) : (
              filtered.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  expanded={expanded === order.id}
                  onToggle={() => setExpanded(expanded === order.id ? null : order.id)}
                  onUpdate={handleUpdate}
                  token={token}
                />
              ))
            )}
          </>
        )}
      </div>

      {showStudio && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(5, 5, 8, 0.88)', backdropFilter: 'blur(8px)',
          zIndex: 1000, display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 20
        }}>
          <style>{`
            @keyframes studioSpin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}</style>
          <div style={{
            background: 'linear-gradient(145deg, #11111d, #09090e)',
            border: '1px solid rgba(230,194,126,0.18)', borderRadius: 16,
            width: '100%', maxWidth: 880, maxHeight: '90vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            boxShadow: '0 24px 64px rgba(0,0,0,0.8)'
          }}>
            {/* Header */}
            <div style={{
              padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f4f1ea', margin: 0, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#e6c27e' }}>✨</span> Artwork Generator Studio
              </h3>
              <button
                onClick={() => setShowStudio(false)}
                style={{
                  background: 'none', border: 'none', color: '#7d7a8c',
                  fontSize: 20, cursor: 'pointer', transition: 'color 0.15s'
                }}
                onMouseEnter={(e) => e.target.style.color = '#f4f1ea'}
                onMouseLeave={(e) => e.target.style.color = '#7d7a8c'}
              >
                ×
              </button>
            </div>

            {/* Stepper */}
            <div style={{ padding: '20px 24px 0' }}>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
                    background: studioStep === 'signals' ? '#e6c27e' : 'rgba(255,255,255,0.1)',
                    color: studioStep === 'signals' ? '#0c0d15' : '#7d7a8c',
                    fontSize: 11, fontWeight: 700
                  }}>1</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: studioStep === 'signals' ? '#f4f1ea' : '#7d7a8c' }}>Select Signals</span>
                </div>
                <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
                    background: studioStep === 'prompt' ? '#e6c27e' : 'rgba(255,255,255,0.1)',
                    color: studioStep === 'prompt' ? '#0c0d15' : '#7d7a8c',
                    fontSize: 11, fontWeight: 700
                  }}>2</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: studioStep === 'prompt' ? '#f4f1ea' : '#7d7a8c' }}>Edit Prompt</span>
                </div>
                <div style={{ width: 40, height: 1, background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', alignItems: 'center', justifyContent: 'center',
                    background: studioStep === 'preview' ? '#e6c27e' : 'rgba(255,255,255,0.1)',
                    color: studioStep === 'preview' ? '#0c0d15' : '#7d7a8c',
                    fontSize: 11, fontWeight: 700
                  }}>3</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: studioStep === 'preview' ? '#f4f1ea' : '#7d7a8c' }}>Preview & Live</span>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {studioError && (
              <div style={{
                margin: '10px 24px 0', padding: '10px 14px', borderRadius: 8,
                background: 'rgba(255,107,125,0.08)', border: '1px solid rgba(255,107,125,0.25)',
                color: '#ff6b7d', fontSize: 13, fontWeight: 500
              }}>
                ⚠️ {studioError}
              </div>
            )}

            {/* Body */}
            <div style={{ padding: '20px 24px 24px', overflowY: 'auto', flex: 1 }}>
              {studioStep === 'signals' && (
                <div>
                  {signalsLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 0', gap: 12 }}>
                      <span style={{ fontSize: 28, animation: 'studioSpin 1s linear infinite' }}>⟳</span>
                      <span style={{ fontSize: 13, color: '#7d7a8c' }}>Collecting today's news signals...</span>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <span style={{ fontSize: 13, color: '#b9b6c4' }}>
                          Select daily signals to incorporate. Select at least 5 different categories for the best outcome.
                        </span>
                        <button
                          onClick={handleSmartSelect}
                          style={{
                            padding: '6px 12px', border: '1px solid #e6c27e',
                            background: 'rgba(230,194,126,0.08)', color: '#e6c27e',
                            borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                            letterSpacing: '0.02em', transition: 'all 0.15s'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'rgba(230,194,126,0.15)'}
                          onMouseLeave={(e) => e.target.style.background = 'rgba(230,194,126,0.08)'}
                        >
                          ⚡ Smart Select 5
                        </button>
                      </div>

                      {/* Signals Grid */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxHeight: '48vh', overflowY: 'auto', paddingRight: 6 }}>
                        {signals && Object.keys(signals).map(categoryKey => {
                          const categoryTitle = categoryKey.toUpperCase().replace(/_/g, ' ');
                          const items = Array.isArray(signals[categoryKey]) 
                            ? signals[categoryKey] 
                            : signals[categoryKey] ? [signals[categoryKey]] : [];

                          if (items.length === 0) return null;

                          return (
                            <div key={categoryKey} style={{
                              background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.03)',
                              borderRadius: 8, padding: 12
                            }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#e6c27e', letterSpacing: '0.08em', marginBottom: 10 }}>
                                {categoryTitle}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {items.map((rawItem, idx) => {
                                  let displayLabel = '';
                                  let stringVal = '';

                                  if (categoryKey === 'upi_weird_news') {
                                    displayLabel = rawItem;
                                    stringVal = `UPI Weird News: ${rawItem}`;
                                  } else if (categoryKey === 'oddity_central') {
                                    displayLabel = rawItem;
                                    stringVal = `Oddity Central: ${rawItem}`;
                                  } else if (categoryKey === 'top_wikipedia') {
                                    displayLabel = rawItem;
                                    stringVal = `Wikipedia Top Search: ${rawItem}`;
                                  } else if (categoryKey === 'positive_news') {
                                    displayLabel = `${rawItem.headline} — ${rawItem.summary}`;
                                    stringVal = `Good News Network: ${rawItem.headline} (${rawItem.summary})`;
                                  } else if (categoryKey === 'optimist_daily') {
                                    displayLabel = `${rawItem.headline} — ${rawItem.summary}`;
                                    stringVal = `Optimist Daily: ${rawItem.headline} (${rawItem.summary})`;
                                  } else if (categoryKey === 'polymarket') {
                                    displayLabel = `${rawItem.question} (${rawItem.percentage}%)`;
                                    stringVal = `Polymarket Trending: ${rawItem.question} (${rawItem.percentage}% probability)`;
                                  } else if (categoryKey === 'top_song') {
                                    displayLabel = `${rawItem.title} by ${rawItem.artist}`;
                                    stringVal = `Top Song: ${rawItem.title} by ${rawItem.artist}`;
                                  } else if (categoryKey === 'wikipedia_on_this_day') {
                                    displayLabel = `In ${rawItem.year}: ${rawItem.event}`;
                                    stringVal = `Wikipedia On this Day: In ${rawItem.year}, ${rawItem.event}`;
                                  } else if (categoryKey === 'google_news') {
                                    displayLabel = rawItem;
                                    stringVal = `Google News: ${rawItem}`;
                                  }

                                  const isChecked = selectedSignals.includes(stringVal);

                                  return (
                                    <label
                                      key={idx}
                                      style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 10,
                                        padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                                        background: isChecked ? 'rgba(230,194,126,0.05)' : 'rgba(255,255,255,0.02)',
                                        border: `1px solid ${isChecked ? 'rgba(230,194,126,0.22)' : 'rgba(255,255,255,0.04)'}`,
                                        color: isChecked ? '#f4f1ea' : '#b9b6c4',
                                        fontSize: 12, lineHeight: 1.4, transition: 'all 0.15s'
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleSignal(stringVal)}
                                        style={{ marginTop: 2, accentColor: '#e6c27e' }}
                                      />
                                      <span>{displayLabel}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Footer Actions */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16 }}>
                        <button
                          onClick={() => setShowStudio(false)}
                          style={{
                            padding: '9px 18px', borderRadius: 6, border: 'none',
                            background: 'rgba(255,255,255,0.06)', color: '#b9b6c4',
                            cursor: 'pointer', fontSize: 13, fontWeight: 600
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleGeneratePrompt}
                          disabled={selectedSignals.length === 0 || generatingPrompt}
                          style={{
                            padding: '9px 22px', borderRadius: 6, border: 'none',
                            background: selectedSignals.length === 0 || generatingPrompt ? 'rgba(230,194,126,0.3)' : 'linear-gradient(90deg, #e6c27e, #f0d49a)',
                            color: '#0c0d15', cursor: selectedSignals.length === 0 || generatingPrompt ? 'not-allowed' : 'pointer',
                            fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6
                          }}
                        >
                          {generatingPrompt ? <span style={{ display: 'inline-block', animation: 'studioSpin 1s linear infinite', marginRight: 4 }}>⟳</span> : null}
                          {generatingPrompt ? 'Generating...' : 'Synthesize Prompt →'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {studioStep === 'prompt' && (
                <div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#7d7a8c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Surrealist Title</label>
                      <input
                        type="text"
                        value={studioPrompt.title}
                        onChange={(e) => setStudioPrompt(prev => ({ ...prev, title: e.target.value }))}
                        style={{
                          width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f1ea',
                          fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: 'inherit'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#7d7a8c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Thematic Essence</label>
                      <textarea
                        rows={2}
                        value={studioPrompt.essence}
                        onChange={(e) => setStudioPrompt(prev => ({ ...prev, essence: e.target.value }))}
                        style={{
                          width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f1ea',
                          fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: 'inherit', resize: 'vertical'
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 11, color: '#7d7a8c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Interpretive Statement (Mentions selected signals)</label>
                      <textarea
                        rows={3}
                        value={studioPrompt.interpretive_statement}
                        onChange={(e) => setStudioPrompt(prev => ({ ...prev, interpretive_statement: e.target.value }))}
                        style={{
                          width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f1ea',
                          fontSize: 13, padding: '9px 12px', outline: 'none', fontFamily: 'inherit', resize: 'vertical'
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <label style={{ fontSize: 11, color: '#7d7a8c', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Image Generation Prompt</label>
                        <span style={{ fontSize: 11, color: '#e6c27e', fontWeight: 500 }}>Monochrome Line Art Instruction Required</span>
                      </div>
                      <textarea
                        rows={6}
                        value={studioPrompt.image_prompt}
                        onChange={(e) => setStudioPrompt(prev => ({ ...prev, image_prompt: e.target.value }))}
                        style={{
                          width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#f4f1ea',
                          fontSize: 12, padding: '9px 12px', outline: 'none', fontFamily: 'inherit', resize: 'vertical',
                          lineHeight: 1.5
                        }}
                      />
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16 }}>
                    <button
                      onClick={() => setStudioStep('signals')}
                      style={{
                        padding: '9px 18px', borderRadius: 6, border: 'none',
                        background: 'rgba(255,255,255,0.06)', color: '#b9b6c4',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600
                      }}
                    >
                      ← Back to Signals
                    </button>
                    <button
                      onClick={handleGenerateImage}
                      disabled={generatingImage}
                      style={{
                        padding: '9px 22px', borderRadius: 6, border: 'none',
                        background: generatingImage ? 'rgba(230,194,126,0.3)' : 'linear-gradient(90deg, #e6c27e, #f0d49a)',
                        color: '#0c0d15', cursor: generatingImage ? 'not-allowed' : 'pointer',
                        fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6
                      }}
                    >
                      {generatingImage ? <span style={{ display: 'inline-block', animation: 'studioSpin 1s linear infinite', marginRight: 4 }}>⟳</span> : null}
                      {generatingImage ? 'Painting Artwork...' : '🎨 Generate Image with Imagen →'}
                    </button>
                  </div>
                </div>
              )}

              {studioStep === 'preview' && generatedDraft && (
                <div>
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    {/* Left Column: Preview Display */}
                    <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      {/* View Mode Toggle */}
                      <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderRadius: 6, padding: 3, marginBottom: 14 }}>
                        <button
                          onClick={() => setPreviewMode('tshirt')}
                          style={{
                            padding: '4px 12px', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: previewMode === 'tshirt' ? 'rgba(230,194,126,0.15)' : 'transparent',
                            color: previewMode === 'tshirt' ? '#e6c27e' : '#7d7a8c', cursor: 'pointer'
                          }}
                        >
                          T-Shirt Mockup
                        </button>
                        <button
                          onClick={() => setPreviewMode('artwork')}
                          style={{
                            padding: '4px 12px', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600,
                            background: previewMode === 'artwork' ? 'rgba(230,194,126,0.15)' : 'transparent',
                            color: previewMode === 'artwork' ? '#e6c27e' : '#7d7a8c', cursor: 'pointer'
                          }}
                        >
                          Raw Artwork
                        </button>
                      </div>

                      {previewMode === 'tshirt' ? (
                        <div style={{
                          position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '1 / 1',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: '#0d0d12', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)',
                          overflow: 'hidden', padding: 20
                        }}>
                          <img
                            src="/tshirt_front_black_transparent10small.png"
                            alt="T-shirt front base"
                            style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                          />
                          <img
                            src={generatedDraft.artworkUrl}
                            alt="Chest Artwork"
                            style={{
                              position: 'absolute', top: '50%', left: '50%',
                              transform: 'translate(-50%, -68%)', width: '30%',
                              objectFit: 'contain', pointerEvents: 'none', mixBlendMode: 'screen'
                            }}
                          />
                        </div>
                      ) : (
                        <div style={{
                          width: '100%', maxWidth: 300, aspectRatio: '3/4',
                          background: '#0a0a0f', borderRadius: 10, border: '1px solid rgba(255,255,255,0.05)',
                          overflow: 'hidden'
                        }}>
                          <img
                            src={generatedDraft.artworkUrl}
                            alt="Generated raw artwork"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      )}
                    </div>

                    {/* Right Column: Metadata review */}
                    <div style={{ flex: '1 1 380px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#e6c27e', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Surrealist Title</div>
                        <h4 style={{ fontSize: 18, fontWeight: 700, color: '#f4f1ea', margin: 0 }}>{studioPrompt.title}</h4>
                      </div>

                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7d7a8c', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Essence</div>
                        <p style={{ fontSize: 13, color: '#c9c6d4', margin: 0, lineHeight: 1.5 }}>{studioPrompt.essence}</p>
                      </div>

                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7d7a8c', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>Interpretive Statement</div>
                        <p style={{ fontSize: 12, color: '#b9b6c4', margin: 0, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.04)' }}>
                          {studioPrompt.interpretive_statement}
                        </p>
                      </div>

                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: '#7d7a8c', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Daily Signals Incorporated</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {studioPrompt.data_signals_used_summarized && studioPrompt.data_signals_used_summarized.map((sig, sIdx) => (
                            <span key={sIdx} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: 'rgba(230,194,126,0.08)', border: '1px solid rgba(230,194,126,0.18)', color: '#e6c27e' }}>
                              #{sig}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 16, flexWrap: 'wrap', gap: 12 }}>
                    <button
                      onClick={() => setStudioStep('signals')}
                      style={{
                        padding: '9px 18px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                        background: 'transparent', color: '#b9b6c4',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600
                      }}
                    >
                      ↺ Regenerate / Start Over
                    </button>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={() => setShowStudio(false)}
                        style={{
                          padding: '9px 18px', borderRadius: 6, border: 'none',
                          background: 'rgba(255,255,255,0.06)', color: '#f4f1ea',
                          cursor: 'pointer', fontSize: 13, fontWeight: 600
                        }}
                      >
                        Save and Close
                      </button>
                      <button
                        onClick={handleMakeLiveFromStudio}
                        style={{
                          padding: '9px 24px', borderRadius: 6, border: 'none',
                          background: 'linear-gradient(90deg, #e6c27e, #f0d49a)',
                          color: '#0c0d15', cursor: 'pointer',
                          fontSize: 13, fontWeight: 700
                        }}
                      >
                        {currentLot ? '👕 Put on T-shirt & Make Live' : '🚀 Start Bidding with This'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
