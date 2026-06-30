import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const envDefaults = {
    geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
    vocabProvider: import.meta.env.VITE_VOCAB_PROVIDER || 'gemini',
    openaiApiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
    openaiBaseUrl: import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1',
    openaiModel: import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini',
};

export const useStore = create(
    persist(
        (set) => ({
            apiKey: envDefaults.geminiApiKey,
            setApiKey: (key) => set({ apiKey: key }),

            // Player State
            currentPodcastId: null,
            setCurrentPodcastId: (id) => set({ currentPodcastId: id }),

            isPlaying: false,
            setIsPlaying: (playing) => set({ isPlaying: playing }),

            currentTime: 0,
            setCurrentTime: (time) => set({ currentTime: time }),

            // UI State
            isSidebarOpen: false,
            toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

            // Custom Prompts & Settings
            transcriptionPrompt: '',
            setTranscriptionPrompt: (p) => set({ transcriptionPrompt: p }),

            geminiModel: 'gemini-2.0-flash-exp', // Default to 2.0 Flash Exp for balance
            setGeminiModel: (m) => set({ geminiModel: m }),

            // Vocabulary AI provider
            vocabProvider: envDefaults.vocabProvider,
            setVocabProvider: (provider) => set({ vocabProvider: provider }),

            openaiApiKey: envDefaults.openaiApiKey,
            setOpenaiApiKey: (key) => set({ openaiApiKey: key }),

            openaiBaseUrl: envDefaults.openaiBaseUrl,
            setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),

            openaiModel: envDefaults.openaiModel,
            setOpenaiModel: (model) => set({ openaiModel: model }),

            // Whisper Model
            whisperModel: 'small', // Options: small, medium
            setWhisperModel: (m) => set({ whisperModel: m }),

            // Remote Access
            remoteAccessEnabled: false,
            setRemoteAccessEnabled: (enabled) => set({ remoteAccessEnabled: enabled }),
        }),
        {
            name: 'english-pod-storage',
            partialize: (state) => ({
                apiKey: state.apiKey,
                transcriptionPrompt: state.transcriptionPrompt,
                geminiModel: state.geminiModel,
                vocabProvider: state.vocabProvider,
                openaiApiKey: state.openaiApiKey,
                openaiBaseUrl: state.openaiBaseUrl,
                openaiModel: state.openaiModel,
                whisperModel: state.whisperModel,
                remoteAccessEnabled: state.remoteAccessEnabled
            }),
            merge: (persistedState, currentState) => {
                const persisted = persistedState || {};
                return {
                    ...currentState,
                    ...persisted,
                    apiKey: persisted.apiKey || currentState.apiKey,
                    vocabProvider: persisted.vocabProvider || currentState.vocabProvider,
                    openaiApiKey: persisted.openaiApiKey || currentState.openaiApiKey,
                    openaiBaseUrl: persisted.openaiBaseUrl || currentState.openaiBaseUrl,
                    openaiModel: persisted.openaiModel || currentState.openaiModel,
                };
            },
        }
    )
);
