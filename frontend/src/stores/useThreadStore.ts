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
  threadType: 'argument',

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
            const { nodes, edges, relationships } = await api.getThreadNodes(thread.id);
            return {
              ...thread,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodes: nodes.map((node: any) => ({
                ...node,
                // entity_type is already lowercase from API; node_type is uppercase compat
                node_type: node.node_type || node.entity_type || NODE_TYPES[0],
                type: typeof node.type === 'number' && node.type >= 0
                  ? node.type
                  : NODE_TYPES.indexOf((node.entity_type || node.node_type?.toLowerCase() || NODE_TYPES[0]) as NodeTypeName),
              })),
              edges,
              relationships,
            };
          } catch (err) {
            console.error(`Failed to load thread ${thread.id} nodes:`, err);
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
      thread_type: threadType,
      metadata: { title, description, createdAt: new Date().toISOString() },
    });
    await get().loadThreads();
    set({
      selectedThreadId: newThread.id,
      title: '',
      description: '',
      content: '',
      threadType: 'argument',
    });
    useUIStore.getState().setView('article');
    useUIStore.getState().setShowCreateThreadModal(false);
  },
}));
