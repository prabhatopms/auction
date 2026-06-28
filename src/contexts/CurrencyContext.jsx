import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || '';
const LOCALSTORAGE_KEY = 'auction_country';
const LEGACY_KEY = 'auction_currency';

// Internal pricing buckets
export const CURRENCIES = [
  { currency: 'INR', symbol: '₹', locale: 'en-IN' },
  { currency: 'USD', symbol: '$', locale: 'en-US' },
  { currency: 'GBP', symbol: '£', locale: 'en-GB' },
  { currency: 'EUR', symbol: '€', locale: 'de-DE' },
];

// Countries visible to users — each maps to one internal currency bucket
export const COUNTRIES = [
  { code: 'AU', name: 'Australia',        flag: '🇦🇺', currency: 'USD' },
  { code: 'AT', name: 'Austria',          flag: '🇦🇹', currency: 'EUR' },
  { code: 'BE', name: 'Belgium',          flag: '🇧🇪', currency: 'EUR' },
  { code: 'CA', name: 'Canada',           flag: '🇨🇦', currency: 'USD' },
  { code: 'CZ', name: 'Czech Republic',   flag: '🇨🇿', currency: 'EUR' },
  { code: 'DK', name: 'Denmark',          flag: '🇩🇰', currency: 'EUR' },
  { code: 'FI', name: 'Finland',          flag: '🇫🇮', currency: 'EUR' },
  { code: 'FR', name: 'France',           flag: '🇫🇷', currency: 'EUR' },
  { code: 'DE', name: 'Germany',          flag: '🇩🇪', currency: 'EUR' },
  { code: 'GR', name: 'Greece',           flag: '🇬🇷', currency: 'EUR' },
  { code: 'HU', name: 'Hungary',          flag: '🇭🇺', currency: 'EUR' },
  { code: 'IN', name: 'India',            flag: '🇮🇳', currency: 'INR' },
  { code: 'IE', name: 'Ireland',          flag: '🇮🇪', currency: 'EUR' },
  { code: 'IT', name: 'Italy',            flag: '🇮🇹', currency: 'EUR' },
  { code: 'JP', name: 'Japan',            flag: '🇯🇵', currency: 'USD' },
  { code: 'MY', name: 'Malaysia',         flag: '🇲🇾', currency: 'USD' },
  { code: 'MX', name: 'Mexico',           flag: '🇲🇽', currency: 'USD' },
  { code: 'NL', name: 'Netherlands',      flag: '🇳🇱', currency: 'EUR' },
  { code: 'NZ', name: 'New Zealand',      flag: '🇳🇿', currency: 'USD' },
  { code: 'NO', name: 'Norway',           flag: '🇳🇴', currency: 'EUR' },
  { code: 'PL', name: 'Poland',           flag: '🇵🇱', currency: 'EUR' },
  { code: 'PT', name: 'Portugal',         flag: '🇵🇹', currency: 'EUR' },
  { code: 'RO', name: 'Romania',          flag: '🇷🇴', currency: 'EUR' },
  { code: 'SG', name: 'Singapore',        flag: '🇸🇬', currency: 'USD' },
  { code: 'ZA', name: 'South Africa',     flag: '🇿🇦', currency: 'USD' },
  { code: 'KR', name: 'South Korea',      flag: '🇰🇷', currency: 'USD' },
  { code: 'ES', name: 'Spain',            flag: '🇪🇸', currency: 'EUR' },
  { code: 'SE', name: 'Sweden',           flag: '🇸🇪', currency: 'EUR' },
  { code: 'CH', name: 'Switzerland',      flag: '🇨🇭', currency: 'EUR' },
  { code: 'AE', name: 'UAE',              flag: '🇦🇪', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom',   flag: '🇬🇧', currency: 'GBP' },
  { code: 'US', name: 'United States',    flag: '🇺🇸', currency: 'USD' },
];

const DEFAULT_COUNTRY = COUNTRIES.find((c) => c.code === 'IN');

function currencyMeta(code) {
  return CURRENCIES.find((c) => c.currency === code) || CURRENCIES[0];
}

const CurrencyContext = createContext(null);

function detectFromGeo(onResult) {
  return fetch(`${API_URL}/api/geo`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((data) => {
      const byCountry = COUNTRIES.find((c) => c.code === data?.country);
      const byCurrency = COUNTRIES.find((c) => c.currency === data?.currency);
      onResult(byCountry || byCurrency || DEFAULT_COUNTRY);
    })
    .catch(() => onResult(DEFAULT_COUNTRY));
}

export function CurrencyProvider({ children }) {
  const [selectedCountry, setSelectedCountry] = useState(DEFAULT_COUNTRY);
  const [productPrices, setProductPrices] = useState([]);

  // On mount: stored country → geo API → default
  useEffect(() => {
    let cancelled = false;

    const storedCode = localStorage.getItem(LOCALSTORAGE_KEY);
    if (storedCode) {
      const match = COUNTRIES.find((c) => c.code === storedCode);
      if (match) { setSelectedCountry(match); return; }
    }

    const legacyCurrency = localStorage.getItem(LEGACY_KEY);
    if (legacyCurrency) {
      const match = COUNTRIES.find((c) => c.currency === legacyCurrency);
      if (match) { setSelectedCountry(match); return; }
    }

    detectFromGeo((country) => { if (!cancelled) setSelectedCountry(country); });
    return () => { cancelled = true; };
  }, []);

  // Fetch product prices once
  useEffect(() => {
    fetch(`${API_URL}/api/product-prices`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setProductPrices(data?.prices || []))
      .catch(() => {});
  }, []);

  // Persist country choice
  useEffect(() => {
    localStorage.setItem(LOCALSTORAGE_KEY, selectedCountry.code);
  }, [selectedCountry]);

  const currency = selectedCountry.currency;
  const { symbol, locale } = currencyMeta(currency);

  const setCountry = useCallback((code) => {
    const match = COUNTRIES.find((c) => c.code === code);
    if (match) setSelectedCountry(match);
  }, []);

  const resetToGeo = useCallback(() => {
    localStorage.removeItem(LOCALSTORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    detectFromGeo(setSelectedCountry);
  }, []);

  // Keep legacy setCurrencyByCode working (picks first country for that currency)
  const setCurrencyByCode = useCallback((code) => {
    const match = COUNTRIES.find((c) => c.currency === code);
    if (match) setSelectedCountry(match);
  }, []);

  const getDisplayBid = useCallback((canonicalAmount, lot) => {
    if (currency === 'INR') return canonicalAmount;
    const productType = lot?.productType || 'tshirt';
    const entry = productPrices.find((p) => p.productType === productType && p.currency === currency);
    if (!entry || !lot?.startingBid || lot.startingBid === 0) return null;
    return Math.round(entry.startingBid * (canonicalAmount / lot.startingBid));
  }, [currency, productPrices]);

  const formatBid = useCallback((canonicalAmount, lot) => {
    const display = getDisplayBid(canonicalAmount, lot);
    if (display === null) return '₹' + Math.round(canonicalAmount).toLocaleString('en-IN');
    return symbol + Math.round(display).toLocaleString(locale);
  }, [getDisplayBid, symbol, locale]);

  const toCanonical = useCallback((displayAmount, lot) => {
    if (currency === 'INR') return displayAmount;
    const productType = lot?.productType || 'tshirt';
    const entry = productPrices.find((p) => p.productType === productType && p.currency === currency);
    if (!entry || !lot?.startingBid) return displayAmount;
    return Math.round(displayAmount * lot.startingBid / entry.startingBid);
  }, [currency, productPrices]);

  const getMinIncrement = useCallback((lot) => {
    if (currency === 'INR') return 50;
    const productType = lot?.productType || 'tshirt';
    const entry = productPrices.find((p) => p.productType === productType && p.currency === currency);
    return entry?.minIncrement ?? 1;
  }, [currency, productPrices]);

  const formatDirect = useCallback((amount) => {
    return symbol + Math.round(amount).toLocaleString(locale);
  }, [symbol, locale]);

  return (
    <CurrencyContext.Provider value={{
      currency, symbol, locale,
      selectedCountry, allCountries: COUNTRIES,
      // legacy shape consumers still expect
      selectedCurrency: { currency, symbol, locale },
      allCurrencies: CURRENCIES.map((c) => ({ ...c, label: c.currency, flag: '' })),
      productPrices,
      setCountry, setCurrencyByCode, resetToGeo,
      getDisplayBid, formatBid, toCanonical, getMinIncrement, formatDirect,
    }}>
    {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error('useCurrency must be used within a CurrencyProvider');
  return ctx;
}
