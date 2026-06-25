import React, { useState, useEffect } from 'react';
import { Save, Key, CheckCircle, AlertCircle, FileText, RefreshCcw } from 'lucide-react';
import { useStore } from '../../store';
import { LogViewer } from '../../components/LogViewer';
import { canUseLocalFeatures } from '../../lib/env';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
    const { apiKey, setApiKey, transcriptionPrompt, setTranscriptionPrompt, geminiModel, setGeminiModel, whisperModel, setWhisperModel, remoteAccessEnabled, setRemoteAccessEnabled } = useStore();
    const [inputKey, setInputKey] = useState(apiKey || '');
    const [inputPrompt, setInputPrompt] = useState(transcriptionPrompt || '');
    const [selectedModel, setSelectedModel] = useState(geminiModel || 'gemini-2.0-flash-exp');
    const [selectedWhisper, setSelectedWhisper] = useState(whisperModel || 'small');
    const [isRemoteEnabled, setIsRemoteEnabled] = useState(Boolean(remoteAccessEnabled));
    const [status, setStatus] = useState('idle'); // idle, saving, saved, error

    // Notify Electron when remote setting changes (auto-apply)
    useEffect(() => {
        try {
            // Using window.require to access Electron in renderer
            // Check if running in Electron
            if (window.process && window.process.type === 'renderer') {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('toggle-remote-access', isRemoteEnabled);
            }
        } catch {
            console.warn('IPC not available');
        }
    }, [isRemoteEnabled]);

    const handleSave = () => {
        if (!inputKey.trim()) {
            setStatus('error');
            return;
        }

        // Basic validation (starts with AIza)
        if (!inputKey.startsWith('AIza')) {
            // Warn but allow
        }

        setApiKey(inputKey.trim());
        setTranscriptionPrompt(inputPrompt ? inputPrompt.trim() : '');
        setGeminiModel(selectedModel);
        setWhisperModel(selectedWhisper);
        setRemoteAccessEnabled(isRemoteEnabled);
        if (canUseLocalFeatures) {
            try {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('set-whisper-model', selectedWhisper);
            } catch {
                console.warn('IPC not available');
            }
        }
        setStatus('saved');

        setTimeout(() => setStatus('idle'), 2000);
    };

    return (
        <div className="container">
            <header className={styles.header}>
                <h1>Settings</h1>
                <p className={styles.subtitle}>Configure your AI provider.</p>
            </header>

            <div className={styles.card}>
                {/* API Key Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <Key className={styles.icon} />
                        <h2>Gemini API Key</h2>
                    </div>

                    <p className={styles.description}>
                        This application uses Google's Gemini API for transcription and vocabulary generation.
                        Your key is stored locally in your browser and never sent to our servers.
                    </p>

                    <div className={styles.inputGroup}>
                        <label htmlFor="apiKey">API Key (Google AI Studio)</label>
                        <input
                            id="apiKey"
                            type="password"
                            value={inputKey}
                            onChange={(e) => {
                                setInputKey(e.target.value);
                                setStatus('idle');
                            }}
                            placeholder="AIzaSy..."
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.actions}>
                        <button
                            onClick={handleSave}
                            className={styles.button}
                            disabled={status === 'saved'}
                        >
                            {status === 'saved' ? (
                                <>
                                    <CheckCircle size={18} />
                                    Saved
                                </>
                            ) : (
                                <>
                                    <Save size={18} />
                                    Save Key
                                </>
                            )}
                        </button>

                        {status === 'error' && (
                            <span className={styles.error}>
                                <AlertCircle size={16} />
                                Please enter a valid key.
                            </span>
                        )}
                    </div>

                    <div className={styles.help}>
                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">
                            Get a Gemini API Key &rarr;
                        </a>
                    </div>
                </div>

                {/* AI Model Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h2>AI Model</h2>
                    </div>
                    <p className={styles.description}>
                        Choose the Gemini model version.
                        <br />- <b>Gemini 1.5 Flash</b>: Most stable for audio.
                        <br />- <b>Gemini 2.0 Flash</b>: Newer, faster, but experimental.
                    </p>
                    <div className={styles.inputGroup}>
                        <label>Model Version</label>
                        <select
                            value={selectedModel}
                            onChange={(e) => { setSelectedModel(e.target.value); setStatus('idle'); }}
                            className={styles.input}
                        >
                            <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash Exp</option>
                            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Stable)</option>
                            <option value="gemini-3-flash-preview">Gemini 3 Flash Preview</option>
                        </select>
                    </div>
                </div>

                {/* Whisper Model Section - Hide in Web Mode */}
                {canUseLocalFeatures && (
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2>Whisper Model (Local)</h2>
                        </div>
                        <p className={styles.description}>
                            Choose the local WhisperX model for transcription.
                            <br />- <b>Small</b>: Fast, good for clear English podcasts.
                            <br />- <b>Medium</b>: Better accuracy, slightly slower.
                        </p>
                        <div className={styles.inputGroup}>
                            <label>Whisper Model</label>
                            <select
                                value={selectedWhisper}
                                onChange={(e) => { setSelectedWhisper(e.target.value); setStatus('idle'); }}
                                className={styles.input}
                            >
                                <option value="small">Small (Fast)</option>
                                <option value="medium">Medium (Balanced)</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Remote Access Section - Hide in Web Mode */}
                {canUseLocalFeatures && (
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2>Remote Access</h2>
                        </div>
                        <p className={styles.description}>
                            Allow accessing this app from other devices via <b>podcast.botly.cn</b>.
                            <br /><i>Requires setup of Cloudflare Tunnel credentials.</i>
                        </p>
                        <div className={styles.inputGroup}>
                            <label>Tunnel Status</label>
                            <select
                                value={isRemoteEnabled ? 'enabled' : 'disabled'}
                                onChange={(e) => { setIsRemoteEnabled(e.target.value === 'enabled'); setStatus('idle'); }}
                                className={styles.input}
                            >
                                <option value="disabled">Disabled (Local Only)</option>
                                <option value="enabled">Enabled (Remote Access)</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* Backend Logs Section */}
                {canUseLocalFeatures && (
                    <div className={styles.section}>
                        <LogViewer />
                    </div>
                )}

                {/* Transcription Prompt Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <FileText className={styles.icon} />
                        <h2>Transcription Prompt</h2>
                    </div>
                    <p className={styles.description}>
                        Customize the instructions sent to Gemini.
                    </p>
                    <div className={styles.inputGroup}>
                        <label htmlFor="prompt">System Instruction</label>
                        <textarea
                            id="prompt"
                            value={inputPrompt}
                            onChange={(e) => {
                                setInputPrompt(e.target.value);
                                setStatus('idle');
                            }}
                            placeholder="Generate a VERBATIM transcription..."
                            className={styles.textarea}
                            rows={8}
                        />
                    </div>
                    <div className={styles.actions}>
                        <button
                            className={styles.secondaryButton}
                            onClick={() => setInputPrompt(`Generate a **VERBATIM** transcription of this audio file.
Do NOT summarize. Do NOT skip any sentences. Transcribe every single word.
Return a STRICT JSON object with this structure:
{
  "segments": [
    {
      "start": number (seconds),
      "end": number (seconds),
      "text": string (sentence),
      "words": [
         { "word": string, "start": number, "end": number }
      ]
    }
  ]
}`)}
                        >
                            <RefreshCcw size={14} /> Reset to Default
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
