import React, { useState } from 'react';
import { api } from '../services/api';
import type { User } from '../types';
import './AuthModal.css';

interface AuthModalProps {
  onSuccess: (user: User) => void;
  onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onSuccess, onClose }) => {
  const [tab] = useState<'signin'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await api.login({ email, password });
      onSuccess(user);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <button className="auth-close" onClick={onClose}>x</button>
        <div className="auth-tabs">
          <button
            className="auth-tab auth-tab--active"
            type="button"
          >
            Sign In
          </button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? '...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthModal;
