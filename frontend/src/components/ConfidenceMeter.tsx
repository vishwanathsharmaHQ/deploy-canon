import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { api } from '../services/api';
import type { AnalysisResult } from '../types';

interface AnalysisData extends AnalysisResult {
  nodeCount?: number;
}

const _analysisCache: Record<number, AnalysisData> = {};

interface ConfidenceMeterProps {
  threadId: number;
}

const ConfidenceMeter: React.FC<ConfidenceMeterProps> = ({ threadId }) => {
  const [data, setData] = useState<AnalysisData | null>(_analysisCache[threadId] || null);
  const [loading, setLoading] = useState(!_analysisCache[threadId]);
  const [expanded, setExpanded] = useState(false);

  const fetchAnalysis = useCallback(async () => {
    delete _analysisCache[threadId];
    setLoading(true);
    setData(null);
    try {
      const result = await api.analyzeThread(threadId);
      _analysisCache[threadId] = result;
      setData(result);
    } catch (err) {
      console.error('Analysis failed:', err);
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!_analysisCache[threadId]) fetchAnalysis();
  }, [threadId, fetchAnalysis]);

  const score = data?.score ?? 0;
  const scoreColor = score >= 70 ? '#00ff9d' : score >= 45 ? '#fdd835' : '#ef5350';
  const r = 44, cx = 56, cy = 56;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - score / 100);

  const bars = data ? [
    { label: 'Evidence Strength', val: data.breakdown?.evidenceStrength ?? 0 },
    { label: 'Counterpoint Cov.', val: data.breakdown?.counterpointCoverage ?? 0 },
    { label: 'Sourcing Quality', val: data.breakdown?.sourcingQuality ?? 0 },
    { label: 'Logical Coherence', val: data.breakdown?.logicalCoherence ?? 0 },
  ] : [];

  return (
    <div className="cm-card">
      <div className="cm-header">
        <span className="cm-title">Claim Analysis</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {!loading && data && (
            <button
              className="cm-refresh"
              onClick={async () => {
                try {
                  await api.recordConfidence(threadId, {
                    score: data.score,
                    breakdown: data.breakdown,
                    verdict: data.verdict,
                    node_count: data.nodeCount || 0,
                  });
                  toast.success('Confidence recorded to timeline');
                } catch (e) { console.error('Failed to record confidence:', e); }
              }}
              title="Save current confidence score to timeline"
            >
              ⏱
            </button>
          )}
          <button className="cm-refresh" onClick={fetchAnalysis} title="Re-analyse" disabled={loading}>↻</button>
        </div>
      </div>

      {loading && <div className="cm-loading">Analysing argument strength…</div>}

      {!loading && data && (
        <>
          <div className="cm-main">
            <div className="cm-gauge">
              <svg width="112" height="112" viewBox="0 0 112 112">
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
                <circle
                  cx={cx} cy={cy} r={r} fill="none"
                  stroke={scoreColor} strokeWidth="10" strokeLinecap="round"
                  strokeDasharray={circumference} strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                />
                <text x={cx} y={cy - 4} textAnchor="middle" fill="#fff" fontSize="22" fontWeight="700" fontFamily="system-ui">{score}</text>
                <text x={cx} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="system-ui">/ 100</text>
              </svg>
            </div>
            <div className="cm-right">
              <div className="cm-verdict" style={{ color: scoreColor, borderColor: scoreColor + '55' }}>{data.verdict}</div>
              <p className="cm-summary">{data.summary}</p>
            </div>
          </div>

          <div className="cm-bars">
            {bars.map(({ label, val }) => (
              <div key={label} className="cm-bar-row">
                <span className="cm-bar-label">{label}</span>
                <div className="cm-bar-track">
                  <div className="cm-bar-fill" style={{ width: `${val}%`, background: val >= 70 ? '#00ff9d' : val >= 45 ? '#fdd835' : '#ef5350' }} />
                </div>
                <span className="cm-bar-val">{val}%</span>
              </div>
            ))}
          </div>

          {((data.strengths?.length ?? 0) > 0 || (data.gaps?.length ?? 0) > 0) && (
            <div className="cm-accordion">
              <button className="cm-accordion-toggle" onClick={() => setExpanded(e => !e)}>
                {expanded ? '▾' : '▸'} Strengths &amp; Gaps
              </button>
              {expanded && (
                <div className="cm-accordion-content">
                  {data.strengths?.map((s: string, i: number) => <div key={i} className="cm-point cm-point--strength">✓ {s}</div>)}
                  {data.gaps?.map((g: string, i: number) => <div key={i} className="cm-point cm-point--gap">✗ {g}</div>)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ConfidenceMeter;
