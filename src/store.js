import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
    persist(
        (set) => ({
            apiKey: '',
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
            vocabProvider: 'gemini',
            setVocabProvider: (provider) => set({ vocabProvider: provider }),

            openaiApiKey: '',
            setOpenaiApiKey: (key) => set({ openaiApiKey: key }),

            openaiBaseUrl: 'https://api.openai.com/v1',
            setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),

            openaiModel: 'gpt-4o-mini',
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
        }
    )
);
