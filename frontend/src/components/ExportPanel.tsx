import React, { useState } from 'react';
import { api } from '../services/api';
import type { ExportResult } from '../types';
import './ExportPanel.css';

interface ExportPanelProps {
  threadId: number;
  threadTitle: string;
  onClose: () => void;
}

const ExportPanel: React.FC<ExportPanelProps> = ({ threadId, threadTitle, onClose }) => {
  const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
  const [preview, setPreview] = useState<ExportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const data = await api.exportThread(threadId, format);
      setPreview(data);
    } catch (err) {
      console.error('Export error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!preview) return;
    let content: string, mimeType: string, extension: string;
    if (format === 'json') {
      content = JSON.stringify(preview, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    } else {
      content = preview.markdown || '';
      mimeType = 'text/markdown';
      extension = 'md';
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(threadTitle || 'thread').replace(/[^a-z0-9]/gi, '_')}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="export-panel">
      <div className="ep-header">
        <h4>Export Thread</h4>
        <button className="ep-close" onClick={onClose}>&times;</button>
      </div>

      <div className="ep-format-select">
        <button className={format === 'markdown' ? 'active' : ''} onClick={() => { setFormat('markdown'); setPreview(null); }}>Markdown</button>
        <button className={format === 'json' ? 'active' : ''} onClick={() => { setFormat('json'); setPreview(null); }}>JSON</button>
        <button onClick={handlePrint}>Print/PDF</button>
      </div>

      <button className="ep-generate" onClick={handleExport} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Export'}
      </button>

      {preview && (
        <div className="ep-preview">
          <pre>{format === 'json' ? JSON.stringify(preview, null, 2) : preview.markdown || ''}</pre>
          <button className="ep-download" onClick={handleDownload}>Download</button>
        </div>
      )}
    </div>
  );
};

export default ExportPanel;
