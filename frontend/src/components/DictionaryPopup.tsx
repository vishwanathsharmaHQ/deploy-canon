import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../services/api';
import { createMdComponents } from '../utils/markdown';
import './DictionaryPopup.css';

const askMdComponents = createMdComponents('dict-youtube');

interface LookupResult {
  word: string;
  definition: string;
  partOfSpeech: string;
  pronunciation: string;
  example: string;
  etymology: string;
}

type PopupMode = 'buttons' | 'define' | 'ask' | 'custom';

const DictionaryPopup: React.FC = () => {
  const [selectedText, setSelectedText] = useState('');
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [mode, setMode] = useState<PopupMode>('buttons');

  // Ask mode state
  const [askAnswer, setAskAnswer] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askQuestion, setAskQuestion] = useState('');
  const [customInput, setCustomInput] = useState('');

  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();

  const [inArticle, setInArticle] = useState(false);
  const [inChat, setInChat] = useState(false);

  const showForSelection = useCallback(() => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';

    if (text && text.length > 0 && text.length < 5000) {
      try {
        const range = selection!.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const isMobile = 'ontouchstart' in window;
        const y = isMobile ? rect.top - 40 : rect.bottom + 8;
        setSelectedText(text);
        setPosition({ x: rect.left + rect.width / 2, y });
        setLookup(null);
        setSaved(false);
        setAlreadyExists(false);
        setMode('buttons');
        setAskAnswer('');
        setAskQuestion('');
        setCustomInput('');
        const anchor = selection!.anchorNode;
        setInArticle(!!anchor && !!(anchor as Element).closest?.('.ar-content') || !!anchor?.parentElement?.closest('.ar-content'));
        setInChat(!!anchor && !!(anchor as Element).closest?.('.cp-bubble') || !!anchor?.parentElement?.closest('.cp-bubble'));
      } catch {
        // getRangeAt can throw if selection is gone
      }
    }
  }, []);

  const dismiss = useCallback(() => {
    if (popupRef.current?.contains(document.activeElement) || buttonRef.current?.contains(document.activeElement)) return;
    setSelectedText('');
    setPosition(null);
    setMode('buttons');
    setAskAnswer('');
    setAskQuestion('');
  }, []);

  // Desktop: mouseup
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      if (text) {
        showForSelection();
      } else {
        setTimeout(dismiss, 200);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [showForSelection, dismiss]);

  // Mobile: selectionchange
  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    const handleSelectionChange = () => {
      clearTimeout(dismissTimer.current);
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';
      if (text && text.length > 0 && text.length < 5000) {
        dismissTimer.current = setTimeout(() => showForSelection(), 300);
      } else {
        dismissTimer.current = setTimeout(dismiss, 400);
      }
    };
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(dismissTimer.current);
    };
  }, [showForSelection, dismiss]);

  // Adjust position if popup would go off-screen
  useEffect(() => {
    if (!popupRef.current || !position) return;
    const rect = popupRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = position;
    if (rect.right > vw - 16) x = vw - rect.width / 2 - 16;
    if (rect.left < 16) x = rect.width / 2 + 16;
    if (y < 8) y = 8;
    if (rect.bottom > vh - 16) y = position.y - rect.height - 50;
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [lookup, mode, askAnswer]);

  const dispatchAnnotation = useCallback((action: string, response: string, question?: string) => {
    window.dispatchEvent(new CustomEvent('article-annotation', {
      detail: { text: selectedText, action, response, question },
    }));
  }, [selectedText]);

  const handleLookup = async () => {
    setMode('define');
    setLoading(true);
    try {
      const result = await api.vocabLookup(selectedText, '');
      setLookup(result);
      dispatchAnnotation('define', result.definition);
    } catch (err) {
      console.error('Dictionary lookup error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!lookup) return;
    try {
      const result = await api.vocabSave({
        word: lookup.word,
        definition: lookup.definition,
        partOfSpeech: lookup.partOfSpeech,
        pronunciation: lookup.pronunciation,
        example: lookup.example,
        etymology: lookup.etymology,
        context: selectedText !== lookup.word ? selectedText : '',
      });
      if (result.alreadyExists) {
        setAlreadyExists(true);
      } else {
        setSaved(true);
      }
    } catch (err) {
      console.error('Save word error:', err);
    }
  };

  const handleHighlight = () => {
    if (inChat) {
      window.dispatchEvent(new CustomEvent('chat-highlight', { detail: { text: selectedText } }));
    } else {
      window.dispatchEvent(new CustomEvent('article-highlight', { detail: { text: selectedText } }));
    }
    setSelectedText('');
    setPosition(null);
  };

  const handleAsk = async (question: string) => {
    setMode('ask');
    setAskQuestion(question);
    setAskAnswer('');
    setAskLoading(true);

    const fullQuestion = `${question}: "${selectedText}"`;
    let fullAnswer = '';
    const actionType = question.toLowerCase().includes('why') ? 'why' : question.toLowerCase().includes('how') ? 'how' : 'ask';

    try {
      await api.chatStream({
        message: fullQuestion,
        history: [],
        onToken: (token: string) => {
          fullAnswer += token;
          setAskAnswer(prev => prev + token);
        },
        onDone: () => {
          setAskLoading(false);
          if (fullAnswer) dispatchAnnotation(actionType, fullAnswer, question);
        },
        onError: (err: Error) => {
          setAskAnswer(prev => prev || `Error: ${err.message}`);
          setAskLoading(false);
        },
      });
    } catch (err) {
      setAskAnswer(`Error: ${(err as Error).message}`);
      setAskLoading(false);
    }
  };

  const handleCustomSubmit = () => {
    const q = customInput.trim();
    if (!q) return;
    handleAsk(q);
  };

  const handleClose = () => {
    setSelectedText('');
    setPosition(null);
    setMode('buttons');
    setLookup(null);
    setAskAnswer('');
    setAskQuestion('');
  };

  if (!selectedText || !position) return null;

  return (
    <>
      {/* Small action buttons shown on text selection */}
      {mode === 'buttons' && (
        <div
          ref={buttonRef}
          className="dict-trigger"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          {selectedText.length < 200 && <span className="dict-trigger-btn" onClick={handleLookup}>Define</span>}
          {(inArticle || inChat) && <span className="dict-trigger-btn dict-trigger-highlight" onClick={handleHighlight}>Highlight</span>}
          <span className="dict-trigger-btn dict-trigger-ask" onClick={() => handleAsk('Explain why this is the case')}>Why?</span>
          <span className="dict-trigger-btn dict-trigger-ask" onClick={() => handleAsk('Explain how this works')}>How?</span>
          <span className="dict-trigger-btn dict-trigger-custom" onClick={() => setMode('custom')}>Ask...</span>
        </div>
      )}

      {/* Custom question input */}
      {mode === 'custom' && (
        <div
          ref={popupRef}
          className="dict-popup dict-ask-popup"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button className="dict-close" onClick={handleClose}>&times;</button>
          <div className="dict-ask-selected">"{selectedText.length > 100 ? selectedText.substring(0, 100) + '...' : selectedText}"</div>
          <div className="dict-custom-input-row">
            <input
              ref={customInputRef}
              className="dict-custom-input"
              type="text"
              placeholder="Ask anything about this text..."
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); if (e.key === 'Escape') handleClose(); }}
              autoFocus
            />
            <button className="dict-custom-send" onClick={handleCustomSubmit} disabled={!customInput.trim()}>Ask</button>
          </div>
        </div>
      )}

      {/* Ask answer popup (streaming) */}
      {mode === 'ask' && (
        <div
          ref={popupRef}
          className="dict-popup dict-ask-popup"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button className="dict-close" onClick={handleClose}>&times;</button>
          <div className="dict-ask-question">{askQuestion}</div>
          <div className="dict-ask-selected">"{selectedText.length > 100 ? selectedText.substring(0, 100) + '...' : selectedText}"</div>
          {askLoading && !askAnswer ? (
            <div className="dict-loading">
              <div className="dict-spinner" />
              Thinking...
            </div>
          ) : (
            <div className="dict-ask-answer">
              <ReactMarkdown components={askMdComponents as Record<string, React.ComponentType>}>{askAnswer}</ReactMarkdown>
              {askLoading && <span className="dict-ask-cursor" />}
            </div>
          )}
        </div>
      )}

      {/* Full dictionary popup */}
      {mode === 'define' && (
        <div
          ref={popupRef}
          className="dict-popup"
          style={{ left: position.x, top: position.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button className="dict-close" onClick={handleClose}>&times;</button>

          {loading ? (
            <div className="dict-loading">
              <div className="dict-spinner" />
              Looking up "{selectedText}"...
            </div>
          ) : lookup ? (
            <div className="dict-content">
              <div className="dict-header">
                <span className="dict-word">{lookup.word}</span>
                {lookup.pronunciation && <span className="dict-pronunciation">{lookup.pronunciation}</span>}
                {lookup.partOfSpeech && <span className="dict-pos">{lookup.partOfSpeech}</span>}
              </div>

              <p className="dict-definition">{lookup.definition}</p>

              {lookup.example && (
                <p className="dict-example">"{lookup.example}"</p>
              )}

              {lookup.etymology && (
                <p className="dict-etymology">{lookup.etymology}</p>
              )}

              <div className="dict-actions">
                {saved ? (
                  <span className="dict-saved">Added to vocabulary</span>
                ) : alreadyExists ? (
                  <span className="dict-exists">Already in your vocabulary</span>
                ) : (
                  <button className="dict-save-btn" onClick={handleSave}>
                    + Add to Vocabulary
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="dict-error">Failed to look up definition.</div>
          )}
        </div>
      )}
    </>
  );
};

export default DictionaryPopup;
