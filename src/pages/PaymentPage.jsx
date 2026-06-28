import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';

const API = import.meta.env.VITE_API_URL ?? '';
const HAS_RAZORPAY = Boolean(import.meta.env.VITE_RAZORPAY_KEY_ID);

const pad = (n) => String(n).padStart(2, '0');

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function AddressForm({ onSave, onCancel }) {
  const [form, setForm] = useState({ name: '', line1: '', line2: '', city: '', state: '', pincode: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const token = localStorage.getItem('oxide_token');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const r = await fetch(`${API}/api/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to save address');
      onSave(data.address);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="celebration-addr-form">
      <div className="celebration-addr-row">
        <input className="celebration-input" placeholder="Full name" value={form.name} onChange={set('name')} required />
        <input className="celebration-input" placeholder="Phone" value={form.phone} onChange={set('phone')} required />
      </div>
      <input className="celebration-input" placeholder="Address line 1" value={form.line1} onChange={set('line1')} required />
      <input className="celebration-input" placeholder="Address line 2 (optional)" value={form.line2} onChange={set('line2')} />
      <div className="celebration-addr-row">
        <input className="celebration-input" placeholder="City" value={form.city} onChange={set('city')} required />
        <input className="celebration-input" placeholder="State" value={form.state} onChange={set('state')} required />
        <input className="celebration-input" placeholder="Pincode" value={form.pincode} onChange={set('pincode')} required />
      </div>
      {err && <div className="auth-error" style={{ marginBottom: '8px', justifyContent: 'center' }}><span>⚠</span> {err}</div>}
      <div className="celebration-addr-actions">
        {onCancel && <button type="button" className="celebration-cancel-btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="celebration-pay-btn" disabled={saving}>{saving ? 'Saving…' : 'Save address'}</button>
      </div>
    </form>
  );
}

export default function PaymentPage() {
  const { user, token } = useAuth();
  const { currency, formatBid, formatDirect } = useCurrency();
  const navigate = useNavigate();

  const [lot, setLot] = useState(null);
  const [myBid, setMyBid] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [step, setStep] = useState('address'); // 'address' | 'paying' | 'paid'
  const [addresses, setAddresses] = useState([]);
  const [selectedAddr, setSelectedAddr] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loadingAddrs, setLoadingAddrs] = useState(true);
  const [tshirtSize, setTshirtSize] = useState('M');
  const [payError, setPayError] = useState('');
  const [timeLeft, setTimeLeft] = useState('');
  const [paidOrderId, setPaidOrderId] = useState(null);
  const [paidOrderNumber, setPaidOrderNumber] = useState(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!token && !loading) navigate('/login', { state: { from: '/pay' } });
  }, [token, loading]);

  // Load current lot and validate payee status
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`${API}/api/lots/my-payment`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json();
        if (!r.ok) {
          // 404 means no pending payment — check if user had a bid on the last closed lot
          // to decide between "missed window" and generic "no payment" message
          if (r.status === 404) {
            const fallback = await fetch(`${API}/api/lots/current`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const fallbackData = await fallback.json();
            const l = fallbackData.lot;
            const hadBid = fallbackData.myBid !== null;
            const windowPassed = l?.status === 'closed' && hadBid && l?.currentPayeeId !== user?.id;
            setPageError(windowPassed ? 'window_missed' : 'no_payment');
          } else {
            setPageError('no_payment');
          }
          setLoading(false);
          return;
        }
        setLot(data.lot);
        setMyBid(data.myBid ?? data.lot.startingBid);
      } catch (e) {
        setPageError(e.message);
      }
      setLoading(false);
    })();
  }, [token, user?.id]);

  // Payment countdown timer
  useEffect(() => {
    if (!lot?.payeeExpiresAt) return;
    const update = () => {
      const diff = new Date(lot.payeeExpiresAt) - Date.now();
      if (diff <= 0) { setTimeLeft('EXPIRED'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${pad(h)}:${pad(m)}:${pad(s)}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [lot?.payeeExpiresAt]);

  // Load addresses
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`${API}/api/addresses`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await r.json();
        const list = data.addresses || [];
        setAddresses(list);
        const def = list.find((a) => a.isDefault) || list[0] || null;
        setSelectedAddr(def?.id ?? null);
        if (list.length === 0) setShowForm(true);
      } catch (_) {}
      setLoadingAddrs(false);
    })();
  }, [token]);

  const handleNewAddress = (addr) => {
    setAddresses((prev) => [...prev, addr]);
    setSelectedAddr(addr.id);
    setShowForm(false);
  };

  const handleSimulatePay = async () => {
    if (!selectedAddr) return;
    setPayError('');
    setStep('paying');
    try {
      const r = await fetch(`${API}/api/lots/dev-simulate-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ addressId: selectedAddr, tshirtSize }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Simulation failed');
      setPaidOrderId(data.orderId);
      setPaidOrderNumber(data.orderNumber);
      setStep('paid');
    } catch (err) {
      setPayError(err.message || 'Payment simulation failed');
      setStep('address');
    }
  };

  const handleRazorpay = async () => {
    if (!selectedAddr) return;
    setPayError('');
    setStep('paying');

    const loaded = await loadRazorpayScript();
    if (!loaded) {
      setPayError('Could not load Razorpay. Check your internet connection.');
      setStep('address');
      return;
    }

    try {
      const r = await fetch(`${API}/api/lots/create-razorpay-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ addressId: selectedAddr, tshirtSize, currency }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to create order');

      const selectedAddress = addresses.find((a) => a.id === selectedAddr);
      const rzp = new window.Razorpay({
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        order_id: data.razorpayOrderId,
        amount: data.amount,
        currency: data.currency,
        name: 'Oxide Atelier',
        description: data.lotTitle,
        prefill: {
          name: user?.name ?? '',
          email: user?.email ?? '',
          contact: selectedAddress?.phone ?? user?.phone ?? '',
        },
        theme: { color: '#e6c27e' },
        handler: async (response) => {
          try {
            const vr = await fetch(`${API}/api/lots/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                addressId: selectedAddr,
                tshirtSize,
              }),
            });
            const vdata = await vr.json();
            if (!vr.ok) throw new Error(vdata.error || 'Verification failed');
            setPaidOrderId(vdata.orderId);
            setPaidOrderNumber(vdata.orderNumber);
            setStep('paid');
          } catch (err) {
            setPayError(err.message || 'Payment verification failed');
            setStep('address');
          }
        },
        modal: { ondismiss: () => setStep('address') },
      });
      rzp.open();
    } catch (err) {
      setPayError(err.message || 'Payment failed');
      setStep('address');
    }
  };

  const expired = timeLeft === 'EXPIRED';

  if (loading) {
    return (
      <div className="account-page">
        <div className="auth-bg"><div className="auth-nebula-a" /><div className="auth-nebula-b" /></div>
        <div className="account-card">
          <div className="account-empty"><div className="account-empty-text">Loading…</div></div>
        </div>
      </div>
    );
  }

  if (pageError) {
    const missedWindow = pageError === 'window_missed';
    return (
      <div className="account-page">
        <div className="auth-bg"><div className="auth-nebula-a" /><div className="auth-nebula-b" /></div>
        <div className="account-card">
          <div className="account-header">
            <button className="account-back" onClick={() => navigate('/')}>← Back</button>
          </div>
          <div className="account-empty">
            <div className="account-empty-icon">{missedWindow ? '⏰' : '🔒'}</div>
            <div className="account-empty-text">
              {missedWindow ? 'You missed your payment window.' : 'No active payment found.'}
            </div>
            <div className="account-empty-sub">
              {missedWindow
                ? 'Your 2-hour window to complete payment has closed. The lot has been offered to the next bidder in line.'
                : 'No active payment window found for your account.'}
            </div>
            <button className="celebration-pay-btn" style={{ marginTop: '20px' }} onClick={() => navigate('/')}>Back to Auction</button>
          </div>
        </div>
      </div>
    );
  }

  let parsedTitle = lot?.title || '';
  let dateStr = '';
  const lotNo = lot?.lotNumber != null 
    ? (lot.lotNumber < 0 ? 'Old ' + Math.abs(lot.lotNumber) : String(lot.lotNumber).padStart(3, '0')) 
    : (lot?.lotNo ? String(lot.lotNo).padStart(3, '0') : '001');

  if (lot) {
    try {
      if (lot.artworkHeadline && lot.artworkHeadline.startsWith('{')) {
        const parsed = JSON.parse(lot.artworkHeadline);
        if (parsed.title) parsedTitle = parsed.title;
      }
    } catch (e) {}

    try {
      const rawDate = lot.startsAt || new Date();
      dateStr = new Date(rawDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {}
  }

  return (
    <div className="account-page">
      <div className="auth-bg"><div className="auth-nebula-a" /><div className="auth-nebula-b" /></div>

      <div className="account-card" style={{ maxWidth: '520px' }}>
        {step === 'paid' ? (
          <>
            <div style={{ textAlign: 'center', padding: '32px 20px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
              <h2 style={{ margin: '0 0 10px', fontSize: '22px', color: '#e6c27e' }}>Payment Confirmed!</h2>
              <p style={{ fontSize: '14px', color: '#b9b6c4', lineHeight: '1.6', margin: '0 0 8px' }}>
                You&apos;ve successfully claimed <strong style={{ color: '#f4f1ea' }}>{parsedTitle}</strong>.
              </p>
              {dateStr && (
                <p style={{ fontSize: '12.5px', color: '#7d7a8c', margin: '0 0 16px' }}>
                  {dateStr}   •   Lot {lotNo}   •   Edition 1/1
                </p>
              )}
              <p style={{ fontSize: '13px', color: '#b9b6c4', margin: '0 0 8px' }}>
                T-shirt size: <strong style={{ color: '#f4f1ea' }}>{tshirtSize}</strong>
              </p>
              <p style={{ fontSize: '13px', color: '#7d7a8c', margin: '0 0 28px' }}>
                Order <strong style={{ color: '#e6c27e' }}>{paidOrderNumber}</strong> — a confirmation email is on its way.
              </p>
              <button
                className="celebration-pay-btn"
                onClick={() => navigate('/orders')}
                style={{ width: '100%' }}
              >
                View Order & Tracker →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="account-header">
              <button className="account-back" onClick={() => navigate('/')}>← Back</button>
              <div className="account-title-row">
                <img src="/favicon.png" className="brand-mark" style={{ width: 26, height: 26, background: 'none', boxShadow: 'none' }} alt="" />
                <h2 className="account-title">Complete Payment</h2>
              </div>
            </div>

            {/* Won badge */}
            <div style={{ textAlign: 'center', padding: '16px 20px 0' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏆</div>
              <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: '#e6c27e' }}>You Won the Bid!</h3>
              <p style={{ fontSize: '13px', color: '#b9b6c4', margin: '0', lineHeight: '1.6' }}>
                Congratulations! You won <strong style={{ color: '#f4f1ea' }}>{parsedTitle}</strong>.
              </p>
              {dateStr && (
                <p style={{ fontSize: '12px', color: '#7d7a8c', margin: '4px 0 0' }}>
                  {dateStr}   •   Lot {lotNo}   •   Edition 1/1
                </p>
              )}
              <p style={{ fontSize: '13px', color: '#b9b6c4', margin: '8px 0 0', lineHeight: '1.6' }}>
                Complete payment below to claim it.
              </p>
            </div>

            {/* Countdown timer */}
            <div className="celebration-timer-box" style={{ margin: '16px 20px 0' }}>
              <div className="celebration-timer-label">
                {expired ? 'Payment Window' : 'Time Remaining to Settle'}
              </div>
              <div
                className="celebration-timer-val"
                style={{ color: expired ? '#ff6b7d' : undefined }}
              >
                {expired ? 'EXPIRED' : timeLeft}
              </div>
              {expired && (
                <p style={{ fontSize: '12px', color: '#ff6b7d', margin: '8px 0 0', textAlign: 'center' }}>
                  Your 2-hour window has closed. The lot has been offered to the next bidder in line.
                </p>
              )}
            </div>

            {!expired && (
              <>
                {/* Bid amount */}
                <div style={{ margin: '16px 20px 0', padding: '12px 16px', background: 'rgba(230,194,126,0.05)', border: '1px solid rgba(230,194,126,0.15)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#7d7a8c' }}>Your winning bid</span>
                  <span style={{ fontSize: '18px', fontWeight: 700, color: '#e6c27e', fontFamily: 'monospace' }}>
                    {lot ? formatBid(myBid, lot) : formatDirect(myBid)}
                  </span>
                </div>

                {/* T-shirt size */}
                <div style={{ padding: '16px 20px 0' }}>
                  <div className="celebration-section-label">T-shirt size</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                    {['XS', 'S', 'M', 'L', 'XL', 'XXL'].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTshirtSize(s)}
                        style={{
                          padding: '7px 16px',
                          borderRadius: '6px',
                          border: tshirtSize === s ? '1.5px solid #e6c27e' : '1.5px solid rgba(255,255,255,0.14)',
                          background: tshirtSize === s ? 'rgba(230,194,126,0.12)' : 'rgba(255,255,255,0.04)',
                          color: tshirtSize === s ? '#e6c27e' : '#b9b6c4',
                          fontSize: '13px',
                          fontWeight: tshirtSize === s ? 600 : 400,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          fontFamily: 'inherit',
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Address section */}
                <div style={{ padding: '16px 20px 0' }}>
                  <div className="celebration-section-label">Ship to</div>

                  {loadingAddrs ? (
                    <div className="celebration-loading">Loading addresses…</div>
                  ) : showForm ? (
                    <AddressForm
                      onSave={handleNewAddress}
                      onCancel={addresses.length > 0 ? () => setShowForm(false) : undefined}
                    />
                  ) : (
                    <>
                      <div className="celebration-addr-list">
                        {addresses.map((a) => (
                          <label key={a.id} className={'celebration-addr-card' + (selectedAddr === a.id ? ' selected' : '')}>
                            <input
                              type="radio"
                              name="address"
                              value={a.id}
                              checked={selectedAddr === a.id}
                              onChange={() => setSelectedAddr(a.id)}
                            />
                            <div className="celebration-addr-info">
                              <div className="celebration-addr-name">{a.name}</div>
                              <div className="celebration-addr-text">
                                {[a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ')}
                              </div>
                              <div className="celebration-addr-text">{a.phone}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button className="celebration-add-addr-btn" onClick={() => setShowForm(true)}>
                        + Add new address
                      </button>
                    </>
                  )}
                </div>

                {payError && (
                  <div style={{ margin: '12px 20px' }}>
                    <div className="auth-error" style={{ justifyContent: 'center' }}>
                      <span>⚠</span> {payError}
                    </div>
                    <p style={{ fontSize: 12, color: '#7d7a8c', textAlign: 'center', margin: '8px 0 0' }}>
                      Still having trouble?{' '}
                      <a href="mailto:support-oxide@chemicalfarmers.com" style={{ color: '#b9b6c4', textDecoration: 'underline' }}>
                        Email support
                      </a>
                    </p>
                  </div>
                )}

                {/* Payment button */}
                {!showForm && (
                  <div style={{ padding: '16px 20px 24px' }}>
                    {HAS_RAZORPAY ? (
                      <button
                        className="celebration-pay-btn"
                        onClick={handleRazorpay}
                        disabled={step === 'paying' || !selectedAddr}
                        style={{ width: '100%' }}
                      >
                        {step === 'paying' ? 'Opening payment…' : `Pay ${lot ? formatBid(myBid, lot) : formatDirect(myBid)} →`}
                      </button>
                    ) : (
                      <div>
                        <div style={{ fontSize: '11px', textAlign: 'center', color: '#7d7a8c', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                          Dev mode — simulated payment
                        </div>
                        <button
                          className="celebration-pay-btn"
                          onClick={handleSimulatePay}
                          disabled={step === 'paying' || !selectedAddr}
                          style={{ width: '100%', background: 'linear-gradient(90deg, #e6c27e 0%, #f0d49a 100%)' }}
                        >
                          {step === 'paying'
                            ? 'Processing…'
                            : `Simulate Payment · ${lot ? formatBid(myBid, lot) : formatDirect(myBid)}`
                          }
                        </button>
                        <p style={{ fontSize: '11px', color: '#7d7a8c', textAlign: 'center', margin: '8px 0 0', lineHeight: '1.5' }}>
                          Razorpay not configured. This simulates a successful payment for testing.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {expired && (
              <div style={{ padding: '20px' }}>
                <button className="celebration-cancel-btn" onClick={() => navigate('/')} style={{ width: '100%' }}>
                  Back to Auction
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
