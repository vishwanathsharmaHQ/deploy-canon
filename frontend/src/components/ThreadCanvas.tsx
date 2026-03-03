import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { api } from '../services/api';
import type { Thread } from '../types';
import './ThreadCanvas.css';

interface ThreadCanvasProps {
  thread: Thread;
}

const ThreadCanvas: React.FC<ThreadCanvasProps> = ({ thread }) => {
  const [initialData, setInitialData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const excalidrawAPIRef = useRef<{ getSceneElements: () => unknown; getAppState: () => unknown } | null>(null);

  // Load saved canvas data on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await api.loadThreadCanvas(thread.id);
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
  }, [thread.id]);

  // Debounced auto-save
  const handleChange = useCallback((elements: unknown[], appState: Record<string, unknown>) => {
    if (loading) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const scene = {
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          zoom: appState.zoom,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        },
      };
      api.saveThreadCanvas(thread.id, scene).catch((e: unknown) =>
        console.error('Failed to save canvas:', e)
      );
    }, 2000);
  }, [thread.id, loading]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

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
        onChange={handleChange}
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
