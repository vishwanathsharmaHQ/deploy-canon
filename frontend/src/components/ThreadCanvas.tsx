import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { api } from '../services/api';
import type { Thread } from '../types';
import './ThreadCanvas.css';

interface ThreadCanvasProps {
  thread: Thread;
  nodeId?: number | null;
}

const ThreadCanvas: React.FC<ThreadCanvasProps> = ({ thread, nodeId }) => {
  const [initialData, setInitialData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{ threadId: number; nodeId?: number | null; scene: Record<string, unknown> } | null>(null);

  // Stable key for re-mounting when scope changes
  const scopeKey = nodeId ? `node-${nodeId}` : `thread-${thread.id}`;

  // Load saved canvas data on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInitialData(null);
    (async () => {
      try {
        const saved = nodeId
          ? await api.loadNodeCanvas(thread.id, nodeId)
          : await api.loadThreadCanvas(thread.id);
        if (!cancelled) {
          setInitialData(saved);
        }
      } catch (e) {
        console.error('Failed to load canvas:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [thread.id, nodeId]);

  // Debounced auto-save
  const handleChange = useCallback((elements: unknown[], appState: Record<string, unknown>) => {
    if (loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    const scene = {
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
        zoom: appState.zoom,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
      },
    };
    pendingSaveRef.current = { threadId: thread.id, nodeId, scene };
    saveTimeoutRef.current = setTimeout(() => {
      pendingSaveRef.current = null;
      const save = nodeId
        ? api.saveNodeCanvas(thread.id, nodeId, scene)
        : api.saveThreadCanvas(thread.id, scene);
      save.catch((e: unknown) => console.error('Failed to save canvas:', e));
    }, 2000);
  }, [thread.id, nodeId, loading]);

  // Flush pending save on unmount (don't lose data)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (pendingSaveRef.current) {
        const { threadId, nodeId: nId, scene } = pendingSaveRef.current;
        const save = nId
          ? api.saveNodeCanvas(threadId, nId, scene)
          : api.saveThreadCanvas(threadId, scene);
        save.catch((e: unknown) => console.error('Failed to flush canvas save:', e));
        pendingSaveRef.current = null;
      }
    };
  }, [scopeKey]);

  if (loading) {
    return (
      <div className="thread-canvas-loading">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="thread-canvas">
      <Excalidraw
        initialData={initialData || undefined}
        theme="dark"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Excalidraw onChange type mismatch
        onChange={handleChange as any}
        UIOptions={{
          canvasActions: {
            loadScene: false,
          },
        }}
      />
    </div>
  );
};

export default ThreadCanvas;
