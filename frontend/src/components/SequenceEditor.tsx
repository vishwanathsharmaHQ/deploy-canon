import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../services/api';
import { NODE_TYPES, NODE_TYPE_COLORS } from '../constants';
import type { Thread, ThreadNode, NodeTypeName } from '../types';
import './SequenceEditor.css';

interface AiSuggestion {
  reasoning: string;
  orderedNodes: ThreadNode[];
}

interface SequenceEditorProps {
  thread: Thread;
  onDone: () => void;
}

const SequenceEditor: React.FC<SequenceEditorProps> = ({ thread, onDone }) => {
  const [items, setItems] = useState<ThreadNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!thread?.id) return;
    loadSequence();
  }, [thread?.id]);

  const loadSequence = async () => {
    setLoading(true);
    try {
      const nodes = thread.nodes || [];
      const saved: number[] | null = await api.loadArticleSequence(thread.id);

      if (saved && Array.isArray(saved)) {
        // Build ordered list: saved order first, then any new nodes appended
        const savedSet = new Set(saved);
        const ordered = saved
          .map(id => nodes.find(n => n.id === id))
          .filter((n): n is ThreadNode => Boolean(n));
        const remaining = nodes.filter(n => !savedSet.has(n.id));
        setItems([...ordered, ...remaining]);
      } else {
        setItems([...nodes]);
      }
    } catch (err) {
      console.error('Failed to load sequence:', err);
      setItems([...(thread.nodes || [])]);
    } finally {
      setLoading(false);
    }
  };

  const saveSequence = useCallback((orderedItems: ThreadNode[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const sequence = orderedItems.map(n => n.id);
        await api.saveArticleSequence(thread.id, sequence);
      } catch (err) {
        console.error('Failed to save sequence:', err);
      }
    }, 400);
  }, [thread?.id]);

  const handleAiOptimize = async () => {
    setAiLoading(true);
    try {
      const result = await api.suggestSequence(thread.id);
      const ids = result.sequence || [];
      const nodeMap = Object.fromEntries(items.map(n => [n.id, n]));
      const orderedNodes = ids.map((id: number) => nodeMap[id]).filter(Boolean);
      const inSuggestion = new Set<number>(ids);
      const remaining = items.filter(n => !inSuggestion.has(n.id));
      setAiSuggestion({ reasoning: 'AI-optimized reading order', orderedNodes: [...orderedNodes, ...remaining] });
    } catch (err) {
      console.error('AI suggest failed:', err);
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplySuggestion = () => {
    if (!aiSuggestion) return;
    setItems(aiSuggestion.orderedNodes);
    saveSequence(aiSuggestion.orderedNodes);
    setAiSuggestion(null);
  };

  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    if (dragItem.current === dragOverItem.current) {
      dragItem.current = null;
      dragOverItem.current = null;
      return;
    }

    const copy = [...items];
    const [removed] = copy.splice(dragItem.current, 1);
    copy.splice(dragOverItem.current, 0, removed);
    setItems(copy);
    saveSequence(copy);

    dragItem.current = null;
    dragOverItem.current = null;
  };

  const getNodeType = (node: ThreadNode): NodeTypeName => {
    if (node.node_type) return node.node_type;
    if (typeof node.type === 'number') return NODE_TYPES[node.type] || 'ROOT';
    return ((node.type as string) || 'ROOT') as NodeTypeName;
  };

  if (loading) {
    return (
      <div className="se-page">
        <div className="se-loading">Loading sequence...</div>
      </div>
    );
  }

  return (
    <div className="se-page">
      <div className="se-container">
        <div className="se-header">
          <h2 className="se-title">Reading Order</h2>
          <div className="se-header-actions">
            <button
              className={`se-ai-btn${aiLoading ? ' se-ai-btn--loading' : ''}`}
              onClick={handleAiOptimize}
              disabled={aiLoading || items.length === 0}
            >
              {aiLoading ? 'Analysing\u2026' : '\u2726 AI Optimise'}
            </button>
            <button className="se-done-btn" onClick={onDone}>Done</button>
          </div>
        </div>
        <p className="se-hint">Drag items to reorder. The article reader will follow this sequence.</p>

        {aiSuggestion && (
          <div className="se-ai-suggestion">
            <div className="se-ai-suggestion-header">
              <span className="se-ai-suggestion-title">{'\u2726'} AI Suggestion</span>
              <button className="se-ai-dismiss" onClick={() => setAiSuggestion(null)}>{'\u2715'}</button>
            </div>
            <p className="se-ai-reasoning">{aiSuggestion.reasoning}</p>
            <div className="se-ai-preview">
              {aiSuggestion.orderedNodes.map((node, i) => {
                const nodeType = getNodeType(node);
                const color = NODE_TYPE_COLORS[nodeType] || '#888';
                return (
                  <div key={node.id} className="se-ai-preview-item">
                    <span className="se-index">{i + 1}</span>
                    <span className="se-badge" style={{ background: color }}>{nodeType}</span>
                    <span className="se-node-title">{node.title || `Node ${node.id}`}</span>
                  </div>
                );
              })}
            </div>
            <button className="se-ai-apply" onClick={handleApplySuggestion}>Apply This Order</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="se-empty">No nodes in this thread yet.</div>
        ) : (
          <ul className="se-list">
            {items.map((node, index) => {
              const nodeType = getNodeType(node);
              const color = NODE_TYPE_COLORS[nodeType] || '#888';
              return (
                <li
                  key={node.id}
                  className="se-item"
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragEnter={() => handleDragEnter(index)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e: React.DragEvent) => e.preventDefault()}
                >
                  <span className="se-handle">&#x2630;</span>
                  <span className="se-index">{index + 1}</span>
                  <span className="se-badge" style={{ background: color }}>
                    {nodeType}
                  </span>
                  <span className="se-node-title">{node.title || `Node ${node.id}`}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SequenceEditor;
