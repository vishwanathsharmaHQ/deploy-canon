import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import type { ThreadSummary } from '../types';

interface ThreadSummaryPanelProps {
  threadId: number;
  threadTitle: string;
}

const ThreadSummaryPanel: React.FC<ThreadSummaryPanelProps> = ({ threadId, threadTitle }) => {
  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load existing summary on mount
  useEffect(() => {
    setInitialLoading(true);
    setSummary(null);
    setError(null);
    api.getSummary(threadId)
      .then(result => {
        if (result) setSummary(result);
      })
      .catch(() => { /* no cached summary */ })
      .finally(() => setInitialLoading(false));
  }, [threadId]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.generateSummary(threadId);
      setSummary(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  const buildMarkdown = useCallback(() => {
    if (!summary) return '';
    let md = `# Summary: ${threadTitle}\n\n`;
    md += `## Executive Summary\n\n${summary.executive_summary}\n\n`;
    md += `## Key Arguments\n\n`;
    for (const arg of summary.key_arguments) {
      const pct = Math.round(arg.confidence * 100);
      md += `### ${arg.title}\n`;
      md += `- Supporting evidence: ${arg.supporting_evidence_count}\n`;
      md += `- Confidence: ${pct}%\n\n`;
    }
    md += `## Overall Verdict\n\n${summary.overall_verdict}\n\n`;
    md += `---\n`;
    md += `Word count: ${summary.word_count} | Generated: ${new Date(summary.generated_at).toLocaleString()}\n`;
    return md;
  }, [summary, threadTitle]);

  const handleCopyToClipboard = useCallback(async () => {
    const md = buildMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [buildMarkdown]);

  const handleExportMarkdown = useCallback(() => {
    const md = buildMarkdown();
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `summary-${threadTitle.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [buildMarkdown, threadTitle]);

  const containerStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: '24px',
    background: '#1a1a1a',
    color: '#e0e0e0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  };

  const btnPrimary: React.CSSProperties = {
    background: '#00ff9d',
    color: '#1a1a1a',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  };

  const btnOutline: React.CSSProperties = {
    background: 'transparent',
    color: '#00ff9d',
    border: '1px solid #00ff9d',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    marginLeft: '8px',
    transition: 'opacity 0.2s',
  };

  const sectionStyle: React.CSSProperties = {
    background: '#2a2a2a',
    borderRadius: '8px',
    padding: '20px',
    marginBottom: '16px',
    border: '1px solid #333',
  };

  const cardStyle: React.CSSProperties = {
    background: '#333',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
    border: '1px solid #333',
  };

  const confidenceBarBg: React.CSSProperties = {
    background: '#333',
    borderRadius: '4px',
    height: '8px',
    marginTop: '8px',
    overflow: 'hidden',
  };

  if (initialLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
          Loading summary...
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: '20px', color: '#e0e0e0' }}>
          Thread Summary
        </h2>
        <div>
          <button
            style={{
              ...btnPrimary,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'wait' : 'pointer',
            }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Generating...' : summary ? 'Regenerate Summary' : 'Generate Summary'}
          </button>
          {summary && (
            <>
              <button style={btnOutline} onClick={handleCopyToClipboard}>
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button style={btnOutline} onClick={handleExportMarkdown}>
                Export as Markdown
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div style={{
          background: '#3e1a1a',
          border: '1px solid #ff4444',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          color: '#ff8888',
          fontSize: '13px',
        }}>
          {error}
        </div>
      )}

      {!summary && !loading && (
        <div style={{
          textAlign: 'center',
          padding: '60px 0',
          color: '#888',
        }}>
          <p style={{ fontSize: '16px', marginBottom: '8px' }}>No summary generated yet</p>
          <p style={{ fontSize: '13px' }}>Click "Generate Summary" to create an AI-powered executive summary of this thread.</p>
        </div>
      )}

      {loading && !summary && (
        <div style={{
          textAlign: 'center',
          padding: '60px 0',
          color: '#00ff9d',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            border: '3px solid #333',
            borderTopColor: '#00ff9d',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px',
          }} />
          <p style={{ fontSize: '14px' }}>Analyzing thread and generating summary...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {summary && (
        <>
          {/* Executive Summary */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#00ff9d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Executive Summary
            </h3>
            <div style={{ fontSize: '14px', lineHeight: '1.7', whiteSpace: 'pre-wrap', color: '#d0d0d0' }}>
              {summary.executive_summary}
            </div>
          </div>

          {/* Key Arguments */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 16px', fontSize: '15px', color: '#00ff9d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Key Arguments
            </h3>
            {summary.key_arguments.map((arg, i) => {
              const pct = Math.round(arg.confidence * 100);
              return (
                <div key={i} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px', color: '#e0e0e0' }}>{arg.title}</span>
                    <span style={{
                      fontSize: '12px',
                      color: pct >= 70 ? '#00ff9d' : pct >= 40 ? '#ffaa00' : '#ff4444',
                      fontWeight: 600,
                    }}>
                      {pct}% confidence
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
                    {arg.supporting_evidence_count} supporting evidence node{arg.supporting_evidence_count !== 1 ? 's' : ''}
                  </div>
                  <div style={confidenceBarBg}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: pct >= 70 ? '#00ff9d' : pct >= 40 ? '#ffaa00' : '#ff4444',
                      borderRadius: '4px',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall Verdict */}
          <div style={sectionStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#00ff9d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Overall Verdict
            </h3>
            <p style={{ fontSize: '15px', fontWeight: 500, color: '#e0e0e0', margin: 0, lineHeight: '1.5' }}>
              {summary.overall_verdict}
            </p>
          </div>

          {/* Meta info */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '12px',
            color: '#666',
            padding: '8px 0',
          }}>
            <span>Word count: {summary.word_count.toLocaleString()}</span>
            <span>Generated: {new Date(summary.generated_at).toLocaleString()}</span>
          </div>
        </>
      )}
    </div>
  );
};

export default ThreadSummaryPanel;
