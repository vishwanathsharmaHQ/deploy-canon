import { create } from 'zustand';
import type { ViewName } from '../types';

interface UIState {
  view: ViewName;
  isFullScreen: boolean;
  showCreateThreadModal: boolean;
  showSearchResults: boolean;
  showSemanticSearch: boolean;
  showThreadDropdown: boolean;
  searchQuery: string;
  isSearchLoading: boolean;
  loading: boolean;
  error: string | null;
  articlePage: Record<number, number>; // threadId → currentPage
  articleNodeId: number | null; // currently viewed node ID in article view

  setView: (view: ViewName) => void;
  toggleFullScreen: () => void;
  setShowCreateThreadModal: (show: boolean) => void;
  setShowSearchResults: (show: boolean) => void;
  setShowSemanticSearch: (show: boolean) => void;
  setShowThreadDropdown: (show: boolean) => void;
  setSearchQuery: (query: string) => void;
  setIsSearchLoading: (loading: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setArticlePage: (threadId: number, page: number) => void;
  setArticleNodeId: (nodeId: number | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  view: 'graph',
  isFullScreen: false,
  showCreateThreadModal: false,
  showSearchResults: false,
  showSemanticSearch: false,
  showThreadDropdown: false,
  searchQuery: '',
  isSearchLoading: false,
  loading: false,
  error: null,
  articlePage: {},
  articleNodeId: null,

  setView: (view) => set({ view }),
  toggleFullScreen: () => set((state) => ({ isFullScreen: !state.isFullScreen })),
  setShowCreateThreadModal: (show) => set({ showCreateThreadModal: show }),
  setShowSearchResults: (show) => set({ showSearchResults: show }),
  setShowSemanticSearch: (show) => set({ showSemanticSearch: show }),
  setShowThreadDropdown: (show) => set({ showThreadDropdown: show }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setIsSearchLoading: (loading) => set({ isSearchLoading: loading }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setArticlePage: (threadId, page) => set((state) => ({ articlePage: { ...state.articlePage, [threadId]: page } })),
  setArticleNodeId: (nodeId) => set({ articleNodeId: nodeId }),
}));
