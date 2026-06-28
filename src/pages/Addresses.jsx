import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrency } from '../contexts/CurrencyContext';

const API = import.meta.env.VITE_API_URL ?? '';

const EMPTY_FORM = { name: '', line1: '', line2: '', city: '', state: '', pincode: '', phone: '', country: 'IN' };

const COUNTRY_OPTIONS = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'CA', label: 'Canada' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'ES', label: 'Spain' },
  { code: 'IT', label: 'Italy' },
  { code: 'BE', label: 'Belgium' },
  { code: 'AT', label: 'Austria' },
  { code: 'SE', label: 'Sweden' },
  { code: 'DK', label: 'Denmark' },
  { code: 'FI', label: 'Finland' },
  { code: 'NO', label: 'Norway' },
  { code: 'CH', label: 'Switzerland' },
  { code: 'PL', label: 'Poland' },
  { code: 'AU', label: 'Australia' },
];

function AddressForm({ initial, onSave, onCancel }) {
  const { token } = useAuth();
  const { currency } = useCurrency();
  const defaultCountry = currency === 'USD' ? 'US' : currency === 'GBP' ? 'GB' : currency === 'EUR' ? 'DE' : 'IN';
  const [form, setForm] = useState(
    initial
      ? { ...EMPTY_FORM, ...initial }
      : { ...EMPTY_FORM, country: defaultCountry }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const intl = form.country && form.country !== 'IN';

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErr('');
    try {
      const url = initial?.id ? `${API}/api/addresses/${initial.id}` : `${API}/api/addresses`;
      const method = initial?.id ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Failed to save');
      onSave(data.address);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="addr-form">
      <div className="addr-form-row">
        <div className="addr-form-group">
          <label className="addr-label">Full name</label>
          <input className="addr-input" value={form.name} onChange={set('name')} required />
        </div>
        <div className="addr-form-group">
          <label className="addr-label">Phone</label>
          <input className="addr-input" value={form.phone} onChange={set('phone')} required />
        </div>
      </div>
      <div className="addr-form-group">
        <label className="addr-label">Address line 1</label>
        <input className="addr-input" value={form.line1} onChange={set('line1')} required />
      </div>
      <div className="addr-form-group">
        <label className="addr-label">Address line 2 (optional)</label>
        <input className="addr-input" value={form.line2} onChange={set('line2')} />
      </div>
      <div className="addr-form-group">
        <label className="addr-label">Country</label>
        <select className="addr-input" value={form.country || 'IN'} onChange={set('country')} required>
          {COUNTRY_OPTIONS.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="addr-form-row">
        <div className="addr-form-group">
          <label className="addr-label">City</label>
          <input className="addr-input" value={form.city} onChange={set('city')} required />
        </div>
        <div className="addr-form-group">
          <label className="addr-label">{intl ? 'State / Region' : 'State'}</label>
          <input className="addr-input" value={form.state} onChange={set('state')} required />
        </div>
        <div className="addr-form-group addr-form-group--sm">
          <label className="addr-label">{intl ? 'Postal Code' : 'Pincode'}</label>
          <input className="addr-input" value={form.pincode} onChange={set('pincode')} required />
        </div>
      </div>
      {err && <div className="auth-error" style={{ marginBottom: '8px', justifyContent: 'center' }}><span>⚠</span> {err}</div>}
      <div className="addr-form-actions">
        {onCancel && <button type="button" className="addr-cancel-btn" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="addr-save-btn" disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Update address' : 'Save address'}</button>
      </div>
    </form>
  );
}

export default function Addresses() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch(`${API}/api/addresses`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await r.json();
        setAddresses(data.addresses || []);
      } catch (_) {}
      setLoading(false);
    })();
  }, [token]);

  const handleSaved = (addr) => {
    if (editing) {
      setAddresses((prev) => prev.map((a) => (a.id === addr.id ? addr : a)));
      setEditing(null);
    } else {
      setAddresses((prev) => [...prev, addr]);
      setShowForm(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await fetch(`${API}/api/addresses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch (_) {}
    setDeleting(null);
  };

  const handleSetDefault = async (id) => {
    try {
      await fetch(`${API}/api/addresses/${id}/default`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` } });
      setAddresses((prev) => prev.map((a) => ({ ...a, isDefault: a.id === id })));
    } catch (_) {}
  };

  return (
    <div className="account-page">
      <div className="auth-bg">
        <div className="auth-nebula-a" />
        <div className="auth-nebula-b" />
      </div>

      <div className="account-card">
        <div className="account-header">
          <button className="account-back" onClick={() => navigate('/')}>← Back</button>
          <div className="account-title-row">
            <img src="/favicon.png" className="brand-mark" style={{ width: 26, height: 26, background: 'none', boxShadow: 'none' }} alt="" />
            <h2 className="account-title">Addresses</h2>
          </div>
        </div>

        {loading ? (
          <div className="account-empty"><div className="account-empty-text">Loading…</div></div>
        ) : (
          <>
            {addresses.length === 0 && !showForm && (
              <div className="account-empty">
                <div className="account-empty-icon">📍</div>
                <div className="account-empty-text">No saved addresses</div>
                <div className="account-empty-sub">Add a shipping address to use at checkout.</div>
              </div>
            )}

            {addresses.length > 0 && (
              <div className="addr-list">
                {addresses.map((a) => (
                  editing?.id === a.id ? (
                    <div key={a.id} className="addr-card addr-card--editing">
                      <AddressForm initial={editing} onSave={handleSaved} onCancel={() => setEditing(null)} />
                    </div>
                  ) : (
                    <div key={a.id} className={'addr-card' + (a.isDefault ? ' addr-card--default' : '')}>
                      {a.isDefault && <span className="addr-default-badge">Default</span>}
                      <div className="addr-card-name">{a.name}</div>
                      <div className="addr-card-text">{[a.line1, a.line2, a.city, a.state, a.pincode, (a.country && a.country !== 'IN') ? a.country : null].filter(Boolean).join(', ')}</div>
                      <div className="addr-card-text">{a.phone}</div>
                      <div className="addr-card-actions">
                        <button className="addr-action-btn" onClick={() => setEditing(a)}>Edit</button>
                        {!a.isDefault && (
                          <button className="addr-action-btn" onClick={() => handleSetDefault(a.id)}>Set as default</button>
                        )}
                        <button
                          className="addr-action-btn addr-action-btn--danger"
                          onClick={() => handleDelete(a.id)}
                          disabled={deleting === a.id}
                        >
                          {deleting === a.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}

            {showForm ? (
              <div className="addr-card addr-card--editing" style={{ marginTop: 16 }}>
                <AddressForm onSave={handleSaved} onCancel={() => setShowForm(false)} />
              </div>
            ) : (
              <button className="account-add-btn" onClick={() => setShowForm(true)}>+ Add address</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
