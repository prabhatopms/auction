import { useState, useRef, useEffect } from 'react';
import { useCurrency } from '../contexts/CurrencyContext';

export default function CountrySwitcher() {
  const { selectedCountry, allCountries, setCountry, resetToGeo } = useCurrency();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [detecting, setDetecting] = useState(false);
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    setTimeout(() => searchRef.current?.focus(), 50);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const select = (code) => { setCountry(code); setOpen(false); };

  const handleAutoDetect = async () => {
    setDetecting(true);
    setOpen(false);
    await resetToGeo();
    setDetecting(false);
  };

  const filtered = query.trim()
    ? allCountries.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()) || c.code.toLowerCase().includes(query.toLowerCase()))
    : allCountries;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Select country"
        aria-expanded={open}
        style={{
          background: 'none',
          border: '1px solid #3d3952',
          borderRadius: '6px',
          width: '30px',
          height: '30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          fontSize: detecting ? '12px' : '16px',
          lineHeight: 1,
          padding: 0,
          outline: 'none',
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6a6488'}
        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#3d3952'}
      >
        {detecting ? '⟳' : selectedCountry.flag}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: '220px',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'linear-gradient(180deg, rgba(20,22,34,0.97), rgba(11,12,20,0.99))',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          zIndex: 100,
          animation: 'dropdown-in 0.15s ease',
          overflow: 'hidden',
        }}>
          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search country…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--line)',
                borderRadius: '5px',
                color: 'var(--txt)',
                fontSize: '12px',
                padding: '6px 8px',
                outline: 'none',
              }}
            />
          </div>

          {/* Auto-detect row */}
          {!query && (
            <button
              onClick={handleAutoDetect}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '8px 14px',
                border: 'none',
                borderBottom: '1px solid var(--line)',
                background: 'none',
                color: 'var(--gold-bright)',
                fontSize: '12px',
                textAlign: 'left',
                cursor: 'pointer',
                fontWeight: 600,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
            >
              <span style={{ fontSize: '14px' }}>⊙</span>
              <span>Auto-detect my location</span>
            </button>
          )}

          {/* Country list */}
          <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--txt-mute)', textAlign: 'center' }}>
                No countries found
              </div>
            ) : filtered.map((c) => (
              <button
                key={c.code}
                onClick={() => select(c.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  width: '100%',
                  padding: '8px 14px',
                  border: 'none',
                  background: c.code === selectedCountry.code ? 'rgba(255,255,255,0.06)' : 'none',
                  color: c.code === selectedCountry.code ? 'var(--txt)' : 'var(--txt-dim)',
                  fontSize: '13px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'background 0.1s, color 0.1s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                  e.currentTarget.style.color = 'var(--txt)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = c.code === selectedCountry.code ? 'rgba(255,255,255,0.06)' : 'none';
                  e.currentTarget.style.color = c.code === selectedCountry.code ? 'var(--txt)' : 'var(--txt-dim)';
                }}
              >
                <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>{c.flag}</span>
                <span>{c.name}</span>
                {c.code === selectedCountry.code && (
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--gold-bright)' }}>✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
