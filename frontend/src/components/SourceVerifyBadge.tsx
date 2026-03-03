import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const _verifyCache: Record<string, any> = {};

interface SourceVerifyBadgeProps {
  url: string;
  claim: string;
}

const SourceVerifyBadge: React.FC<SourceVerifyBadgeProps> = ({ url, claim }) => {
  const [data, setData] = useState<any>(_verifyCache[url] || null);
  const [loading, setLoading] = useState(!_verifyCache[url]);

  useEffect(() => {
    if (_verifyCache[url]) return;
    let cancelled = false;
    api.verifySource({ url, claim })
      .then(result => {
        if (cancelled) return;
        _verifyCache[url] = result;
        setData(result);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  if (loading) return <span className="sv-badge sv-badge--loading">verifying…</span>;
  if (!data) return null;
  const labels: Record<string, string> = { verified: '✓ Verified', partial: '~ Partial', unverified: '✗ Unverified', unavailable: '? Unavailable' };
  return <span className={`sv-badge sv-badge--${data.status}`} title={data.explanation}>{labels[data.status] || data.status}</span>;
};

export default SourceVerifyBadge;
