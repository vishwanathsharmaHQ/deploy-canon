import { useState } from 'react';
import { api } from '../services/api';
import './AuthModal.css';

export default function AuthModal({ onSuccess, onClose }) {
  const [tab, setTab] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let user;
      if (tab === 'signin') {
        user = await api.login({ email, password });
      } else {
        user = await api.register({ name, email, password });
      }
      onSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (newTab) => {
    setTab(newTab);
    setError('');
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose}>×</button>
        <div className="auth-tabs">
          <button
            className={`auth-tab${tab === 'signin' ? ' auth-tab--active' : ''}`}
            onClick={() => switchTab('signin')}
            type="button"
          >
            Sign In
          </button>
          <button
            className={`auth-tab${tab === 'register' ? ' auth-tab--active' : ''}`}
            onClick={() => switchTab('register')}
            type="button"
            style={{ display: 'none' }}
          >
            Register
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === 'register' && (
            <input
              className="auth-input"
              type="text"
              placeholder="Name"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
            />
          )}
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? '...' : tab === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
