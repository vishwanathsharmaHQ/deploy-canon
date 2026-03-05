import React, { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../services/api';
import type { ValidationResult, ValidationIssue } from '../types';

interface ReasoningValidatorProps {
  threadId: number;
  onHighlightNodes?: (nodeIds: number[]) => void;
}

const ISSUE_ICONS: Record<string, string> = {
  fallacy: '!',
  missing_link: '?',
  circular: 'C',
  over_reliance: 'S',
  unsupported: 'U',
  contradiction: 'X',
};

const ISSUE_LABELS: Record<string, string> = {
  fallacy: 'Logical Fallacy',
  missing_link: 'Missing Link',
  circular: 'Circular Reasoning',
  over_reliance: 'Over-reliance',
  unsupported: 'Unsupported Claim',
  contradiction: 'Contradiction',
};

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef5350',
  medium: '#fdd835',
  low: '#66bb6a',
};

function strengthColor(score: number): string {
  if (score >= 70) return '#66bb6a';
  if (score >= 45) return '#fdd835';
  return '#ef5350';
}

const ReasoningValidator: React.FC<ReasoningValidatorProps> = ({ threadId, onHighlightNodes }) => {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  const handleValidate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const data = await api.validateReasoningChain(threadId);
      setResult(data as ValidationResult);
      if (data.issues.length === 0) {
        toast.success('No reasoning issues found!');
      } else {
        toast(`Found ${data.issues.length} issue${data.issues.length > 1 ? 's' : ''} in reasoning chain`);
      }
    } catch { /* toast shown by api layer */ }
    finally { setLoading(false); }
  };

  const highCount = result?.issues.filter(i => i.severity === 'high').length ?? 0;
  const medCount = result?.issues.filter(i => i.severity === 'medium').length ?? 0;
  const lowCount = result?.issues.filter(i => i.severity === 'low').length ?? 0;

  return (
    <div style={{
      background: '#111', border: '1px solid #333', borderRadius: 8,
      padding: 12, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 13, color: '#aaa' }}>Reasoning Validator</h4>
        <button
          onClick={handleValidate}
          disabled={loading}
          style={{
            background: loading ? '#333' : '#1a1a1a',
            border: '1px solid #444', borderRadius: 4,
            color: loading ? '#666' : '#00ff9d', padding: '4px 10px',
            fontSize: 11, cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Analyzing...' : result ? 'Re-analyze' : 'Validate'}
        </button>
      </div>

      {result && (
        <>
          {/* Chain strength meter */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginBottom: 4 }}>
              <span>Chain Strength</span>
              <span style={{ color: strengthColor(result.chain_strength), fontWeight: 600 }}>
                {result.chain_strength}/100
              </span>
            </div>
            <div style={{ height: 6, background: '#222', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', width: `${result.chain_strength}%`,
                background: strengthColor(result.chain_strength),
                borderRadius: 3, transition: 'width 0.5s ease',
              }} />
            </div>
          </div>

          {/* Summary */}
          <p style={{ fontSize: 12, color: '#ccc', margin: '0 0 10px', lineHeight: 1.5 }}>
            {result.summary}
          </p>

          {/* Issue counts */}
          {result.issues.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 11 }}>
              {highCount > 0 && <span style={{ color: SEVERITY_COLORS.high }}>{highCount} high</span>}
              {medCount > 0 && <span style={{ color: SEVERITY_COLORS.medium }}>{medCount} medium</span>}
              {lowCount > 0 && <span style={{ color: SEVERITY_COLORS.low }}>{lowCount} low</span>}
            </div>
          )}

          {/* Issues list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.issues.map((issue, idx) => (
              <IssueCard
                key={idx}
                issue={issue}
                expanded={expandedIssue === idx}
                onToggle={() => setExpandedIssue(expandedIssue === idx ? null : idx)}
                onHighlight={() => onHighlightNodes?.(issue.node_ids)}
              />
            ))}
          </div>

          {result.issues.length === 0 && (
            <div style={{ textAlign: 'center', color: '#66bb6a', fontSize: 12, padding: 8 }}>
              No reasoning issues detected
            </div>
          )}
        </>
      )}
    </div>
  );
};

function IssueCard({ issue, expanded, onToggle, onHighlight }: {
  issue: ValidationIssue; expanded: boolean;
  onToggle: () => void; onHighlight: () => void;
}) {
  return (
    <div
      style={{
        background: '#1a1a1a', border: `1px solid ${SEVERITY_COLORS[issue.severity]}33`,
        borderRadius: 6, overflow: 'hidden', cursor: 'pointer',
        borderLeft: `3px solid ${SEVERITY_COLORS[issue.severity]}`,
      }}
      onClick={onToggle}
    >
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 20, height: 20, borderRadius: '50%',
          background: `${SEVERITY_COLORS[issue.severity]}22`,
          color: SEVERITY_COLORS[issue.severity],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>
          {ISSUE_ICONS[issue.type] || '?'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>
            {ISSUE_LABELS[issue.type] || issue.type}
            {issue.fallacy_name && <span style={{ color: SEVERITY_COLORS[issue.severity] }}> — {issue.fallacy_name}</span>}
          </div>
          <div style={{ fontSize: 12, color: '#ddd', whiteSpace: expanded ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {issue.description}
          </div>
        </div>
        <span style={{ color: '#555', fontSize: 12, flexShrink: 0 }}>{expanded ? '-' : '+'}</span>
      </div>
      {expanded && (
        <div style={{ padding: '0 10px 8px', borderTop: '1px solid #222' }}>
          <div style={{ fontSize: 11, color: '#888', marginTop: 6, marginBottom: 6 }}>
            Suggestion: <span style={{ color: '#ccc' }}>{issue.suggestion}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: '#666' }}>Nodes: {issue.node_ids.join(', ')}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onHighlight(); }}
              style={{
                background: 'none', border: '1px solid #444', borderRadius: 3,
                color: '#00ff9d', fontSize: 10, padding: '2px 6px', cursor: 'pointer',
              }}
            >
              Highlight in graph
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ReasoningValidator;
