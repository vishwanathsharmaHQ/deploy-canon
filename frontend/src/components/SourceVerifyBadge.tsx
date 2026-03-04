import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { VerifySourceResult } from '../types';

const _verifyCache: Record<string, VerifySourceResult> = {};

interface SourceVerifyBadgeProps {
  url: string;
  claim: string;
}

const SourceVerifyBadge: React.FC<SourceVerifyBadgeProps> = ({ url, claim }) => {
  const [data, setData] = useState<VerifySourceResult | null>(_verifyCache[url] || null);
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
  const st = data.status || 'unavailable';
  return <span className={`sv-badge sv-badge--${st}`} title={data.explanation}>{labels[st] || st}</span>;
};

export default SourceVerifyBadge;
