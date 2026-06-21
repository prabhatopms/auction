import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';

const MemoizedGoogleLogin = memo(({ onSuccess, onError }) => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', width: '100%', margin: '8px 0 16px', colorScheme: 'light' }}>
      <GoogleLogin
        onSuccess={onSuccess}
        onError={onError}
        theme="filled_blue"
        shape="pill"
        text="signin_with"
      />
    </div>
  );
});

export default function Login() {
  const { sendEmailOtp, verifyEmailOtp, loginWithGoogle, loginWithPassword, updateProfile, checkEmail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  // Step state: 'enter_email' | 'enter_password' | 'enter_otp' | 'profile_setup'
  const [step, setStep] = useState('enter_email');
  
  const [email, setEmail] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  
  const [otpValues, setOtpValues] = useState(['', '', '', '', '', '']);
  const otpRefs = [useRef(null), useRef(null), useRef(null), useRef(null), useRef(null), useRef(null)];
  
  const [resendTimer, setResendTimer] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Profile setup state (optional intermediary page for Google users who are new)
  const [username, setUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [avatar, setAvatar] = useState('');

  // Resend OTP countdown
  useEffect(() => {
    if (resendTimer <= 0) return;
    const timer = setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendTimer]);

  const validateEmailFormat = (val) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(val).toLowerCase());
  };

  const handleGoogleSuccess = useCallback(async (response) => {
    console.log('[Google Auth Debug] onSuccess response:', response);
    setError('');
    setLoading(true);
    try {
      const data = await loginWithGoogle(response.credential);
      if (data.isNew) {
        setStep('profile_setup');
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Google authentication failed');
    } finally {
      setLoading(false);
    }
  }, [loginWithGoogle, from, navigate]);

  const handleGoogleError = useCallback(() => {
    setError('Google Sign-In failed. Try again.');
  }, []);

  const handleEmailSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!validateEmailFormat(email)) return;

    setError('');
    setLoading(true);
    try {
      const data = await checkEmail(email);
      setHasPassword(data.hasPassword);
      
      if (data.hasPassword) {
        setStep('enter_password');
      } else {
        // No password hash, send OTP directly
        await triggerSendOtp();
      }
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const triggerSendOtp = async () => {
    setError('');
    setLoading(true);
    try {
      await sendEmailOtp(email, 'login');
      setResendTimer(60);
      setStep('enter_otp');
      // Focus first OTP field
      setTimeout(() => otpRefs[0].current?.focus(), 100);
    } catch (err) {
      setError(err.message || 'Failed to send OTP code');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (otpString) => {
    setError('');
    setLoading(true);
    try {
      const data = await verifyEmailOtp(email, otpString);
      if (data.isNew) {
        setStep('profile_setup');
      } else {
        navigate(from, { replace: true });
      }
    } catch (err) {
      setError(err.message);
      setOtpValues(['', '', '', '', '', '']);
      otpRefs[0].current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (idx, e) => {
    const val = e.target.value.replace(/\D/g, '').slice(-1);
    const nextVals = [...otpValues];
    nextVals[idx] = val;
    setOtpValues(nextVals);
    setError('');

    // Shift focus to next input
    if (val && idx < 5) {
      otpRefs[idx + 1].current?.focus();
    }

    // Auto-submit if all 6 boxes are filled
    const fullOtp = nextVals.join('');
    if (fullOtp.length === 6) {
      verifyCode(fullOtp);
    }
  };

  const handleOtpKeyDown = (idx, e) => {
    if (e.key === 'Backspace' && !otpValues[idx] && idx > 0) {
      const nextVals = [...otpValues];
      nextVals[idx - 1] = '';
      setOtpValues(nextVals);
      otpRefs[idx - 1].current?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const nextVals = pastedData.split('');
      setOtpValues(nextVals);
      verifyCode(pastedData);
    } else if (pastedData.length > 0) {
      const nextVals = [...otpValues];
      for (let i = 0; i < pastedData.length; i++) {
        nextVals[i] = pastedData[i];
      }
      setOtpValues(nextVals);
      const nextFocusIdx = Math.min(pastedData.length, 5);
      otpRefs[nextFocusIdx].current?.focus();
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      await loginWithPassword(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid password');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Please select an image smaller than 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setAvatar(uploadEvent.target.result);
    };
    reader.readAsDataURL(file);
  };

  const handleProfileSetupSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const updates = {};
      if (username.trim()) updates.name = username.trim();
      if (setupPassword) updates.password = setupPassword;
      if (avatar) updates.avatarUrl = avatar;

      if (Object.keys(updates).length > 0) {
        await updateProfile(updates);
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSetupSkip = () => {
    navigate(from, { replace: true });
  };

  const isEmailValid = validateEmailFormat(email);

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-nebula-a" />
        <div className="auth-nebula-b" />
      </div>

      <div className="auth-card" style={{ maxWidth: '420px' }}>
        <div className="auth-brand">
          <img src="/favicon.png" className="brand-mark" style={{ background: 'none', boxShadow: 'none' }} alt="" />
          <div>
            <div className="brand-name">Oxide</div>
            <div className="brand-sub">Live Auction Portal</div>
          </div>
        </div>

        {/* STEP 1: Enter Email */}
        {step === 'enter_email' && (
          <div>
            <h2 className="auth-title">Sign In</h2>
            <p className="auth-sub">Authenticate to view live updates and place bids on today&apos;s lot.</p>
            
            <form onSubmit={handleEmailSubmit} className="auth-form">
              {/* Google OAuth Login Button */}
              <MemoizedGoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
              />

              {/* Separator */}
              <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0 16px' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
                <span style={{ fontSize: '11px', color: 'var(--txt-mute)', textTransform: 'uppercase', letterSpacing: '0.12em', padding: '0 12px' }}>or sign in with email</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
              </div>

              <div className="auth-field">
                <label className="auth-label">Email Address</label>
                <input
                  className="auth-input"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  disabled={loading}
                  autoFocus
                />
              </div>

              {error && <div className="auth-error"><span>⚠</span> {error}</div>}

              <button 
                className="auth-submit" 
                type="submit"
                disabled={loading || !isEmailValid}
                style={{ opacity: isEmailValid ? 1 : 0.5, cursor: isEmailValid ? 'pointer' : 'not-allowed', marginTop: '4px' }}
              >
                {loading ? 'Verifying email…' : 'Continue'}
              </button>

              <p className="auth-switch">
                Don&apos;t have an account?{' '}
                <Link to="/signup" className="auth-link">Sign Up →</Link>
              </p>
            </form>
          </div>
        )}

        {/* STEP 2A: Enter Password */}
        {step === 'enter_password' && (
          <div>
            <h2 className="auth-title">Enter Password</h2>
            <p className="auth-sub">Enter password for **{email.toLowerCase()}**.</p>
            
            <form onSubmit={handlePasswordSubmit} className="auth-form">
              <div className="auth-field">
                <label className="auth-label">Password</label>
                <input
                  className="auth-input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  required
                  autoFocus
                />
              </div>

              {error && <div className="auth-error"><span>⚠</span> {error}</div>}

              <button className="auth-submit" type="submit" disabled={loading || !password}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                <button 
                  type="button"
                  className="link-btn" 
                  onClick={() => setStep('enter_email')} 
                  style={{ fontSize: 12.5, opacity: 0.7 }}
                >
                  ← Edit Email
                </button>
                <button 
                  type="button"
                  className="link-btn"
                  onClick={triggerSendOtp}
                  style={{ fontSize: 12.5 }}
                >
                  Log in via OTP instead
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 2B: Enter OTP */}
        {step === 'enter_otp' && (
          <div>
            <h2 className="auth-title">Verify Your Email</h2>
            <p className="auth-sub">Enter the 6-digit OTP code sent to **{email.toLowerCase()}**.</p>
            
            <div className="auth-form">
              <div className="auth-field">
                <label className="auth-label">OTP Code</label>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', margin: '8px 0' }}>
                  {otpValues.map((v, idx) => (
                    <input
                      key={idx}
                      ref={otpRefs[idx]}
                      type="tel"
                      pattern="[0-9]*"
                      inputMode="numeric"
                      className="auth-input"
                      style={{
                        width: '45px',
                        height: '48px',
                        textAlign: 'center',
                        fontSize: '20px',
                        fontWeight: '700',
                        padding: '0',
                        borderRadius: 'var(--r-sm)',
                        borderColor: error ? 'var(--lose)' : 'var(--line-strong)'
                      }}
                      value={v}
                      onChange={(e) => handleOtpChange(idx, e)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={handlePaste}
                      disabled={loading}
                    />
                  ))}
                </div>
              </div>

              {error && <div className="auth-error"><span>⚠</span> {error}</div>}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                <button 
                  className="link-btn" 
                  onClick={() => setStep('enter_email')} 
                  style={{ fontSize: 12.5, opacity: 0.7 }}
                >
                  ← Edit Email
                </button>

                {resendTimer > 0 ? (
                  <span style={{ fontSize: 12.5, color: 'var(--txt-mute)' }}>Resend code in {resendTimer}s</span>
                ) : (
                  <button 
                    className="link-btn" 
                    onClick={() => {
                      sendEmailOtp(email, 'login').catch(() => {});
                      setResendTimer(60);
                      setOtpValues(['', '', '', '', '', '']);
                      otpRefs[0].current?.focus();
                    }}
                    style={{ fontSize: 12.5 }}
                  >
                    Resend Code
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Profile Setup (Google Redirect new users) */}
        {step === 'profile_setup' && (
          <div>
            <h2 className="auth-title">Complete Your Profile</h2>
            <p className="auth-sub">Customize your display preferences. You can skip this screen entirely.</p>
            
            <form onSubmit={handleProfileSetupSubmit} className="auth-form">
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                <div style={{ position: 'relative', width: '72px', height: '72px' }}>
                  <div className="account-avatar-lg" style={{ width: '72px', height: '72px', borderRadius: '50%', overflow: 'hidden', border: '2px solid var(--gold)' }}>
                    {avatar ? (
                      <img src={avatar} alt="Avatar Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 24 }}>👤</span>
                    )}
                  </div>
                  <label 
                    style={{
                      position: 'absolute',
                      bottom: '-4px',
                      right: '-4px',
                      background: 'var(--gold)',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '12px',
                      color: '#07070c',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                    }}
                  >
                    📷
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleAvatarFile} 
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">Username (Optional Display Name)</label>
                <input
                  className="auth-input"
                  type="text"
                  placeholder="How you appear in bid feeds"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>


              <div className="auth-field">
                <label className="auth-label">Password (Optional - enables password login)</label>
                <input
                  className="auth-input"
                  type="password"
                  placeholder="Min. 6 characters"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  minLength={6}
                />
              </div>

              {error && <div className="auth-error"><span>⚠</span> {error}</div>}

              <button className="auth-submit" type="submit" disabled={loading}>
                {loading ? 'Completing Setup…' : 'Complete Setup'}
              </button>

              <button 
                type="button" 
                className="link-btn" 
                onClick={handleProfileSetupSkip}
                style={{ alignSelf: 'center', marginTop: '12px', fontSize: 13, textDecoration: 'underline' }}
              >
                Skip and go to auction
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
