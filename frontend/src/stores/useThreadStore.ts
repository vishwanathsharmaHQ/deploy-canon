import { create } from 'zustand';
import { api } from '../services/api';
import { NODE_TYPES } from '../constants';
import { useUIStore } from './useUIStore';
import type { Thread } from '../types';

interface ThreadState {
  threads: Thread[];
  offChainThreads: Thread[];
  selectedThreadId: number | null;
  title: string;
  description: string;
  content: string;
  isOnChain: boolean;

  setSelectedThreadId: (id: number | null) => void;
  setTitle: (s: string) => void;
  setDescription: (s: string) => void;
  setContent: (s: string) => void;
  setIsOnChain: (v: boolean) => void;
  setOffChainThreads: (threads: Thread[]) => void;
  loadOffChainThreads: () => Promise<void>;
  createThread: () => Promise<void>;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  offChainThreads: [],
  selectedThreadId: null,
  title: '',
  description: '',
  content: '',
  isOnChain: false,

  setSelectedThreadId: (id) => set({ selectedThreadId: id }),
  setTitle: (s) => set({ title: s }),
  setDescription: (s) => set({ description: s }),
  setContent: (s) => set({ content: s }),
  setIsOnChain: (v) => set({ isOnChain: v }),
  setOffChainThreads: (threads) => set({ offChainThreads: threads }),

  loadOffChainThreads: async () => {
    try {
      const threadsData = await api.getThreads();
      const threadsWithNodes: Thread[] = await Promise.all(
        threadsData.map(async (thread: Thread) => {
          try {
            const { nodes, edges } = await api.getThreadNodes(thread.id);
            return {
              ...thread,
              nodes: nodes.map((node: any) => ({
                ...node,
                node_type:
                  typeof node.node_type === 'number'
                    ? NODE_TYPES[node.node_type]
                    : node.node_type || NODE_TYPES[0],
                type: typeof node.type === 'number'
                  ? node.type
                  : NODE_TYPES.indexOf(node.node_type),
              })),
              edges,
            };
          } catch {
            return { ...thread, nodes: [] };
          }
        })
      );
      set({ offChainThreads: threadsWithNodes });
    } catch (err) {
      console.error('Failed to load off-chain threads:', err);
    }
  },

  createThread: async () => {
    const { title, description, content } = get();
    const newThread = await api.createThread({
      title,
      description,
      content,
      metadata: { title, description, content, createdAt: new Date().toISOString() },
    });
    await get().loadOffChainThreads();
    set({
      selectedThreadId: newThread.id,
      title: '',
      description: '',
      content: '',
    });
    useUIStore.getState().setView('article');
    useUIStore.getState().setShowCreateThreadModal(false);
  },
}));
