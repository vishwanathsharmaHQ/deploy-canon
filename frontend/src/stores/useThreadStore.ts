import { create } from 'zustand';
import { api } from '../services/api';
import { NODE_TYPES } from '../constants';
import { useUIStore } from './useUIStore';
import type { Thread, NodeTypeName } from '../types';

interface ThreadState {
  threads: Thread[];
  selectedThreadId: number | null;
  title: string;
  description: string;
  content: string;
  threadType: string;

  setSelectedThreadId: (id: number | null) => void;
  setTitle: (s: string) => void;
  setDescription: (s: string) => void;
  setContent: (s: string) => void;
  setThreadType: (s: string) => void;
  setThreads: (threads: Thread[]) => void;
  loadThreads: () => Promise<void>;
  createThread: () => Promise<void>;
}

export const useThreadStore = create<ThreadState>((set, get) => ({
  threads: [],
  selectedThreadId: null,
  title: '',
  description: '',
  content: '',
  threadType: 'standard',

  setSelectedThreadId: (id) => set({ selectedThreadId: id }),
  setTitle: (s) => set({ title: s }),
  setDescription: (s) => set({ description: s }),
  setContent: (s) => set({ content: s }),
  setThreadType: (s) => set({ threadType: s }),
  setThreads: (threads) => set({ threads }),

  loadThreads: async () => {
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
                  : NODE_TYPES.indexOf(node.node_type as NodeTypeName),
              })),
              edges,
            };
          } catch {
            return { ...thread, nodes: [] };
          }
        })
      );
      set({ threads: threadsWithNodes });
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  },

  createThread: async () => {
    const { title, description, content, threadType } = get();
    const newThread = await api.createThread({
      title,
      description,
      content,
      metadata: { title, description, content, thread_type: threadType, createdAt: new Date().toISOString() },
    });
    await get().loadThreads();
    set({
      selectedThreadId: newThread.id,
      title: '',
      description: '',
      content: '',
      threadType: 'standard',
    });
    useUIStore.getState().setView('article');
    useUIStore.getState().setShowCreateThreadModal(false);
  },
}));
