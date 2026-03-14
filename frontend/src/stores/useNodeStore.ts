import { create } from 'zustand';
import type { ThreadNode } from '../types';

interface NodeState {
  selectedNode: ThreadNode | null;
  graphSelectedNodeId: number | null;
  editorNode: ThreadNode | null;

  setSelectedNode: (node: ThreadNode | null) => void;
  setGraphSelectedNodeId: (id: number | null) => void;
  setEditorNode: (node: ThreadNode | null) => void;
  handleCloseModal: () => void;
}

export const useNodeStore = create<NodeState>((set) => ({
  selectedNode: null,
  graphSelectedNodeId: null,
  editorNode: null,

  setSelectedNode: (node) => set({ selectedNode: node }),
  setGraphSelectedNodeId: (id) => set({ graphSelectedNodeId: id }),
  setEditorNode: (node) => set({ editorNode: node }),
  handleCloseModal: () => set({ selectedNode: null }),
}));
