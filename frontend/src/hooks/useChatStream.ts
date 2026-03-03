import { useState, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../services/api';
import type { ChatCitation, ChatStreamDoneEvent, ChatExtractResult, ProposedNode } from '../types';

export interface ChatMessage {
  role: string;
  content: string;
  citations?: ChatCitation[];
  extractedNodes?: ProposedNode[];
  createdNodes?: ProposedNode[];
  newThread?: { id: number; title: string; description: string } | null;
  proposedUpdate?: { nodeId: number; title: string; description: string; content: string } | null;
  proposedNodes?: ProposedNode[] | null;
  proposedThreadId?: number;
  streaming?: boolean;
  processing?: boolean;
  nodesAccepted?: boolean;
  duplicateSkipped?: string[] | null;
  updateApplied?: boolean;
}

export interface ChatHistoryItem {
  id: number;
  title: string;
  messageCount: number;
  created_at: string;
}

interface UseChatStreamOptions {
  initialThreadId?: number | null;
  selectedThreadId: number | null;
  articleContext?: { nodeId: number; nodeType: string; title: string; content: string } | null;
  onThreadCreated?: (threadId: number) => void;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  loading: boolean;
  activeChatId: number | null;
  setActiveChatId: React.Dispatch<React.SetStateAction<number | null>>;
  chatHistory: ChatHistoryItem[];
  loadChatHistory: (threadId: number | null) => Promise<void>;
  activeThreadIdRef: React.MutableRefObject<number | null>;
  savedChatIdRef: React.MutableRefObject<number | null>;
  handleSend: (input: string) => Promise<void>;
  handleLoadChat: (chatId: number) => Promise<void>;
  handleNewChat: (inputSetter: () => void) => void;
}

export function useChatStream({
  initialThreadId,
  selectedThreadId,
  articleContext,
  onThreadCreated,
}: UseChatStreamOptions): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);

  const activeThreadIdRef = useRef<number | null>(initialThreadId || null);
  const savedChatIdRef = useRef<number | null>(null);
  const accReplyRef = useRef('');

  const loadChatHistory = useCallback(async (threadId: number | null) => {
    if (!threadId) { setChatHistory([]); return; }
    try {
      const chats = await api.getThreadChats(threadId);
      setChatHistory(chats);
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  }, []);

  const handleLoadChat = useCallback(async (chatId: number) => {
    try {
      const chat = await api.getChat(chatId);
      setMessages(chat.messages || []);
      savedChatIdRef.current = chatId;
      setActiveChatId(chatId);
      if (chat.threadId && chat.threadId !== activeThreadIdRef.current) {
        activeThreadIdRef.current = chat.threadId;
        await loadChatHistory(chat.threadId);
      }
    } catch (err) {
      console.error('Failed to load chat:', err);
    }
  }, [loadChatHistory]);

  const handleNewChat = useCallback((inputSetter: () => void) => {
    setMessages([]);
    inputSetter();
    activeThreadIdRef.current = initialThreadId || selectedThreadId || null;
    savedChatIdRef.current = null;
    setActiveChatId(null);
  }, [initialThreadId, selectedThreadId]);

  const handleSend = useCallback(async (userMsg: string) => {
    if (!userMsg.trim() || loading) return;

    // Capture history snapshot — only role + content go to the LLM
    const historySnapshot = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(({ role, content }) => ({ role, content }));

    const assistantIndex = messages.length + 1;
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMsg },
      { role: 'assistant', content: '', citations: [], createdNodes: [], newThread: null, proposedUpdate: null, streaming: true, processing: false },
    ]);
    setLoading(true);
    accReplyRef.current = '';

    try {
      // Phase 1: stream the LLM reply
      await api.chatStream({
        message: userMsg,
        history: historySnapshot,
        threadId: activeThreadIdRef.current,
        nodeContext: articleContext || null,
        onToken: (token: string) => {
          accReplyRef.current += token;
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = { ...msg, content: msg.content + token };
            }
            return updated;
          });
        },
        onDone: async (data: ChatStreamDoneEvent) => {
          // Streaming finished — show "extracting" spinner while we call /api/chat/extract
          flushSync(() => {
            setMessages(prev => {
              const updated = [...prev];
              const msg = updated[assistantIndex];
              if (msg?.role === 'assistant') {
                updated[assistantIndex] = { ...msg, streaming: false, processing: true, citations: data.citations || [] };
              }
              return updated;
            });
          });

          const streamedReply = data.reply || accReplyRef.current;
          const streamedCitations = data.citations || [];

          // Phase 2: extraction — returns proposed nodes (not yet saved)
          let extractData: ChatExtractResult = { citations: streamedCitations, proposedNodes: [], threadId: activeThreadIdRef.current, newThread: null, proposedUpdate: null };
          try {
            extractData = await api.chatExtract({
              message: userMsg,
              reply: streamedReply,
              threadId: activeThreadIdRef.current,
              nodeContext: articleContext || null,
              citations: streamedCitations,
            });
          } catch (extractErr) {
            console.error('Extraction failed:', extractErr);
          }

          // Finalize the assistant message with proposed nodes (not yet saved)
          setMessages(prev => {
            const updated = [...prev];
            const msg = updated[assistantIndex];
            if (msg?.role === 'assistant') {
              updated[assistantIndex] = {
                ...msg,
                streaming: false,
                processing: false,
                citations: extractData.citations || streamedCitations,
                proposedNodes: extractData.proposedNodes?.length > 0 ? extractData.proposedNodes : null,
                proposedThreadId: extractData.threadId ?? undefined,
                newThread: extractData.newThread || null,
                proposedUpdate: extractData.proposedUpdate || null,
              };
            }
            return updated;
          });

          const resolvedThreadId = extractData.threadId || activeThreadIdRef.current;

          // Auto-notify for new thread (thread is created immediately, nodes need accept)
          if (extractData.newThread) {
            activeThreadIdRef.current = extractData.threadId;
            onThreadCreated?.(extractData.threadId!);
          }

          // Persist the conversation to the database
          if (resolvedThreadId) {
            const finalMessages = [
              ...historySnapshot,
              { role: 'user', content: userMsg },
              {
                role: 'assistant',
                content: accReplyRef.current,
                citations: extractData.citations || streamedCitations,
                createdNodes: [],
              },
            ];
            const chatTitle = userMsg.substring(0, 80);
            try {
              if (savedChatIdRef.current) {
                await api.updateChat(savedChatIdRef.current, { messages: finalMessages });
              } else {
                const saved = await api.createChat({ threadId: resolvedThreadId, title: chatTitle, messages: finalMessages });
                savedChatIdRef.current = saved.id;
                setActiveChatId(saved.id);
              }
              await loadChatHistory(resolvedThreadId);
            } catch (err) {
              console.error('Failed to save chat:', err);
            }
          }

          setLoading(false);
        },
        onError: (err: Error) => {
          setMessages(prev => {
            const updated = [...prev];
            updated[assistantIndex] = { role: 'error', content: `Error: ${err.message}` };
            return updated;
          });
          setLoading(false);
        },
      });
    } catch (err: unknown) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = { role: 'error', content: `Error: ${(err as Error).message}` };
        return updated;
      });
      setLoading(false);
    }
  }, [loading, messages, loadChatHistory, onThreadCreated, articleContext]);

  return {
    messages,
    setMessages,
    loading,
    activeChatId,
    setActiveChatId,
    chatHistory,
    loadChatHistory,
    activeThreadIdRef,
    savedChatIdRef,
    handleSend,
    handleLoadChat,
    handleNewChat,
  };
}
