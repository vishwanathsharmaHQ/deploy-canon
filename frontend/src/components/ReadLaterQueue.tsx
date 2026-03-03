import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { Bookmark, User } from '../types';
import './ReadLaterQueue.css';

type BookmarkStatus = 'unread' | 'reading' | 'ingested';

const STATUS_LABELS: Record<BookmarkStatus, string> = { unread: 'Unread', reading: 'Reading', ingested: 'Ingested' };
const STATUS_COLORS: Record<BookmarkStatus, string> = { unread: '#888', reading: '#4fc3f7', ingested: '#00ff9d' };

interface ReadLaterQueueProps {
  onIngestUrl?: (url: string) => void;
  currentUser: User | null;
  onAuthRequired: () => void;
}

const ReadLaterQueue: React.FC<ReadLaterQueueProps> = ({ onIngestUrl, currentUser, onAuthRequired }) => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [filter, setFilter] = useState<'all' | BookmarkStatus>('all');
  const [loading, setLoading] = useState(true);

  const loadBookmarks = async () => {
    try {
      const data = await api.getBookmarks();
      setBookmarks(data);
    } catch (err) {
      console.error('Bookmarks load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBookmarks(); }, []);

  const filteredBookmarks = filter === 'all' ? bookmarks : bookmarks.filter(b => b.status === filter);

  const handleStatusChange = async (id: number, status: string) => {
    try {
      await api.updateBookmark(id, { status });
      setBookmarks(prev => prev.map(b => b.id === id ? { ...b, status } : b));
    } catch (err) {
      console.error('Status update error:', err);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteBookmark(id);
      setBookmarks(prev => prev.filter(b => b.id !== id));
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  return (
    <div className="read-later-queue">
      <div className="rlq-header">
        <h4>Read Later</h4>
        <div className="rlq-filters">
          {(['all', 'unread', 'reading', 'ingested'] as const).map(f => (
            <button
              key={f}
              className={filter === f ? 'active' : ''}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : STATUS_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="rlq-list">
        {loading ? (
          <p className="rlq-empty">Loading...</p>
        ) : filteredBookmarks.length === 0 ? (
          <p className="rlq-empty">No bookmarks yet</p>
        ) : (
          filteredBookmarks.map(b => (
            <div key={b.id} className="rlq-item">
              <div className="rlq-item-main">
                <span className="rlq-status" style={{ color: STATUS_COLORS[b.status as BookmarkStatus] }}>
                  {STATUS_LABELS[b.status as BookmarkStatus]}
                </span>
                <a className="rlq-title" href={b.url} target="_blank" rel="noreferrer">{b.title || b.url}</a>
              </div>
              <div className="rlq-item-actions">
                {b.status !== 'ingested' && (
                  <button className="rlq-ingest" onClick={() => onIngestUrl?.(b.url)}>Ingest</button>
                )}
                <select
                  value={b.status}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleStatusChange(b.id, e.target.value)}
                >
                  <option value="unread">Unread</option>
                  <option value="reading">Reading</option>
                  <option value="ingested">Ingested</option>
                </select>
                <button className="rlq-delete" onClick={() => handleDelete(b.id)}>&times;</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ReadLaterQueue;
