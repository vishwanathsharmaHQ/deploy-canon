import React, { useState, useRef } from 'react';
import { api } from '../services/api';
import { NODE_TYPE_COLORS } from '../constants';
import type { User, NodeTypeName } from '../types';
import './IngestPanel.css';

interface IngestResult {
  title: string;
  summary?: string;
  truncated?: boolean;
  sourceUrl?: string;
  threadId?: number;
  proposedNodes?: { title: string; content: string; type: NodeTypeName }[];
}

interface IngestPanelProps {
  threadId: number | null;
  onNodesCreated?: (threadId: number) => void;
  onThreadCreated?: (threadId: number) => void;
  currentUser: User | null | undefined;
  onAuthRequired?: () => void;
}

const IngestPanel: React.FC<IngestPanelProps> = ({ threadId, onNodesCreated, onThreadCreated, currentUser, onAuthRequired }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUrlIngest = async () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAccepted(new Set());
    try {
      const data = await api.ingestUrl(url, threadId);
      setResult(data);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement> | { target: { files: File[] } }) => {
    if (!currentUser) { onAuthRequired?.(); return; }
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAccepted(new Set());
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        try {
          const data = await api.ingestPdf(base64, file.name, threadId);
          setResult(data);
        } catch (err: unknown) {
          setError((err as Error).message);
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err: unknown) {
      setError((err as Error).message);
      setLoading(false);
    }
  };

  const handleAcceptAll = async () => {
    if (!result?.proposedNodes?.length) return;
    setLoading(true);
    try {
      const targetThreadId = result.threadId || threadId;
      if (!targetThreadId) {
        // Create new thread first
        const newThread = await api.createThread({
          title: result.title,
          description: result.summary,
          content: '',
          metadata: { title: result.title, description: result.summary, sourceUrl: result.sourceUrl },
        });
        const rootNode = result.proposedNodes.find(n => n.type === 'ROOT');
        const otherNodes = result.proposedNodes.filter(n => n.type !== 'ROOT');

        const nodes: { title: string; content: string; nodeType: string }[] = [];
        if (rootNode) nodes.push({ title: rootNode.title, content: rootNode.content, nodeType: rootNode.type });
        otherNodes.forEach(n => nodes.push({ title: n.title, content: n.content, nodeType: n.type }));

        await api.createNodesBatch(newThread.id, nodes);
        onThreadCreated?.(newThread.id);
      } else {
        const rootNode = result.proposedNodes.find(n => n.type === 'ROOT');
        const otherNodes = result.proposedNodes.filter(n => n.type !== 'ROOT');
        const nodes: { title: string; content: string; nodeType: string }[] = [];
        if (rootNode) nodes.push({ title: rootNode.title, content: rootNode.content, nodeType: rootNode.type });
        otherNodes.forEach(n => nodes.push({ title: n.title, content: n.content, nodeType: n.type }));
        await api.createNodesBatch(targetThreadId, nodes);
        onNodesCreated?.(targetThreadId);
      }
      setResult(null);
      setUrl('');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAccept = (idx: number) => {
    setAccepted(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const handleAcceptSelected = async () => {
    if (accepted.size === 0) return;
    setLoading(true);
    try {
      const selectedNodes = result!.proposedNodes!.filter((_, i) => accepted.has(i));
      const targetThreadId = result!.threadId || threadId;
      if (!targetThreadId) {
        const newThread = await api.createThread({
          title: result!.title,
          description: result!.summary,
          content: '',
          metadata: { title: result!.title },
        });
        await api.createNodesBatch(newThread.id, selectedNodes.map(n => ({ title: n.title, content: n.content, nodeType: n.type })));
        onThreadCreated?.(newThread.id);
      } else {
        await api.createNodesBatch(targetThreadId, selectedNodes.map(n => ({ title: n.title, content: n.content, nodeType: n.type })));
        onNodesCreated?.(targetThreadId);
      }
      setResult(null);
      setUrl('');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveBookmark = async () => {
    if (!currentUser) { onAuthRequired?.(); return; }
    if (!url.trim()) return;
    try {
      await api.createBookmark({ url, title: url, source_type: 'url' });
      setUrl('');
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="ingest-panel">
      <h3>Ingest Content</h3>

      <div className="ip-input-section">
        <div className="ip-url-row">
          <input
            type="text"
            value={url}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            placeholder="Paste a URL to extract knowledge..."
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && handleUrlIngest()}
          />
          <button onClick={handleUrlIngest} disabled={loading || !url.trim()}>
            {loading ? '...' : 'Extract'}
          </button>
          <button className="ip-bookmark-btn" onClick={handleSaveBookmark} disabled={!url.trim()} title="Save to Read Later">
            +
          </button>
        </div>

        <div className="ip-pdf-zone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e: React.DragEvent<HTMLDivElement>) => e.preventDefault()}
          onDrop={(e: React.DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file?.type === 'application/pdf') {
              const dt = new DataTransfer();
              dt.items.add(file);
              fileInputRef.current!.files = dt.files;
              handlePdfUpload({ target: { files: [file] } });
            }
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handlePdfUpload}
            style={{ display: 'none' }}
          />
          <p>Drop PDF here or click to upload</p>
        </div>
      </div>

      {error && <div className="ip-error">{error}</div>}

      {loading && <div className="ip-loading">Processing content...</div>}

      {result && (
        <div className="ip-results">
          <div className="ip-result-header">
            <h4>{result.title}</h4>
            {result.summary && <p className="ip-summary">{result.summary}</p>}
            {result.truncated && <p className="ip-warning">Content was truncated. Some information may be missing.</p>}
          </div>

          <div className="ip-proposed-nodes">
            <div className="ip-nodes-header">
              <span>Proposed Nodes ({result.proposedNodes?.length || 0})</span>
              <div className="ip-actions">
                <button className="ip-accept-all" onClick={handleAcceptAll} disabled={loading}>Accept All</button>
                {accepted.size > 0 && (
                  <button className="ip-accept-selected" onClick={handleAcceptSelected} disabled={loading}>
                    Accept {accepted.size}
                  </button>
                )}
              </div>
            </div>
            {result.proposedNodes?.map((node, i) => (
              <div
                key={i}
                className={`ip-node-card ${accepted.has(i) ? 'selected' : ''}`}
                onClick={() => toggleAccept(i)}
              >
                <span className="ip-node-type" style={{ color: NODE_TYPE_COLORS[node.type] }}>{node.type}</span>
                <span className="ip-node-title">{node.title}</span>
              </div>
            ))}
          </div>

          <button className="ip-discard" onClick={() => { setResult(null); setAccepted(new Set()); }}>
            Discard All
          </button>
        </div>
      )}
    </div>
  );
};

export default IngestPanel;
