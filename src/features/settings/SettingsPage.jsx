import React, { useState, useEffect } from 'react';
import { Save, Key, CheckCircle, AlertCircle, FileText, RefreshCcw, Database, Shield, Cpu, Loader } from 'lucide-react';
import { useStore } from '../../store';
import { LogViewer } from '../../components/LogViewer';
import { canUseLocalFeatures } from '../../lib/env';
import { getRuntimeConfig, saveRuntimeConfig } from '../../lib/runtimeConfig';
import { testSupabaseConnection } from '../../lib/supabase';
import styles from './SettingsPage.module.css';

export function SettingsPage() {
    const { apiKey, setApiKey, transcriptionPrompt, setTranscriptionPrompt, geminiModel, setGeminiModel, whisperModel, setWhisperModel, remoteAccessEnabled, setRemoteAccessEnabled } = useStore();
    const runtimeConfig = getRuntimeConfig();
    const [inputKey, setInputKey] = useState(apiKey || '');
    const [inputPrompt, setInputPrompt] = useState(transcriptionPrompt || '');
    const [selectedModel, setSelectedModel] = useState(geminiModel || 'gemini-2.0-flash-exp');
    const [selectedWhisper, setSelectedWhisper] = useState(whisperModel || 'small');
    const [isRemoteEnabled, setIsRemoteEnabled] = useState(Boolean(remoteAccessEnabled));
    const [supabaseUrl, setSupabaseUrl] = useState(runtimeConfig.supabaseUrl || '');
    const [supabaseAnonKey, setSupabaseAnonKey] = useState(runtimeConfig.supabaseAnonKey || '');
    const [remotePassword, setRemotePassword] = useState(runtimeConfig.remoteAccessPassword || '');
    const [isLocalEngineDisabled, setIsLocalEngineDisabled] = useState(Boolean(runtimeConfig.disableLocalEngine));
    const [status, setStatus] = useState('idle'); // idle, saving, saved, error
    const [testStatus, setTestStatus] = useState('idle'); // idle, testing, success, error
    const [testResult, setTestResult] = useState(null);

    const resetSupabaseTest = () => {
        setTestStatus('idle');
        setTestResult(null);
    };

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
        if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
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
        saveRuntimeConfig({
            supabaseUrl,
            supabaseAnonKey,
            remoteAccessPassword: remotePassword,
            disableLocalEngine: isLocalEngineDisabled,
        });
        if (canUseLocalFeatures) {
            try {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('set-whisper-model', selectedWhisper);
                ipcRenderer.send('set-local-engine-disabled', isLocalEngineDisabled);
            } catch {
                console.warn('IPC not available');
            }
        }
        setStatus('saved');

        setTimeout(() => setStatus('idle'), 2000);
    };

    const handleTestSupabase = async () => {
        setTestStatus('testing');
        setTestResult(null);

        try {
            const result = await testSupabaseConnection({
                supabaseUrl,
                supabaseAnonKey,
            });
            setTestResult(result);
            setTestStatus(result.ok ? 'success' : 'error');
        } catch (error) {
            setTestResult({
                ok: false,
                checks: [{
                    name: 'Connection test',
                    ok: false,
                    message: error?.message || String(error),
                }],
            });
            setTestStatus('error');
        }
    };

    return (
        <div className="container">
            <header className={styles.header}>
                <h1>Settings</h1>
                <p className={styles.subtitle}>Configure your AI provider.</p>
            </header>

            <div className={styles.card}>
                {/* App Connection Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <Database className={styles.icon} />
                        <h2>App Connection</h2>
                    </div>

                    <p className={styles.description}>
                        Configure the Supabase project used for your podcast library, transcripts, and vocabulary.
                        These values are stored locally on this device.
                    </p>

                    <div className={styles.inputGroup}>
                        <label htmlFor="supabaseUrl">Supabase URL</label>
                        <input
                            id="supabaseUrl"
                            type="url"
                            value={supabaseUrl}
                            onChange={(e) => {
                                setSupabaseUrl(e.target.value);
                                setStatus('idle');
                                resetSupabaseTest();
                            }}
                            placeholder="https://your-project.supabase.co"
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label htmlFor="supabaseAnonKey">Supabase Anon Key</label>
                        <input
                            id="supabaseAnonKey"
                            type="password"
                            value={supabaseAnonKey}
                            onChange={(e) => {
                                setSupabaseAnonKey(e.target.value);
                                setStatus('idle');
                                resetSupabaseTest();
                            }}
                            placeholder="eyJ..."
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.inputGroup}>
                        <label htmlFor="remotePassword">
                            <Shield size={14} />
                            Remote Access Password
                        </label>
                        <input
                            id="remotePassword"
                            type="password"
                            value={remotePassword}
                            onChange={(e) => {
                                setRemotePassword(e.target.value);
                                setStatus('idle');
                            }}
                            placeholder="Password required by the web access gate"
                            className={styles.input}
                        />
                    </div>

                    {canUseLocalFeatures && (
                        <div className={styles.inputGroup}>
                            <label htmlFor="localEngineMode">
                                <Cpu size={14} />
                                Local WhisperX Engine
                            </label>
                            <select
                                id="localEngineMode"
                                value={isLocalEngineDisabled ? 'disabled' : 'enabled'}
                                onChange={(e) => {
                                    setIsLocalEngineDisabled(e.target.value === 'disabled');
                                    setStatus('idle');
                                }}
                                className={styles.input}
                            >
                                <option value="disabled">Disabled - use Gemini fallback only</option>
                                <option value="enabled">Enabled - use local WhisperX first</option>
                            </select>
                        </div>
                    )}

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
                                    Save Settings
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={handleTestSupabase}
                            className={styles.secondaryButton}
                            disabled={testStatus === 'testing'}
                        >
                            {testStatus === 'testing' ? (
                                <>
                                    <Loader size={16} className={styles.spin} />
                                    Testing
                                </>
                            ) : testStatus === 'success' ? (
                                <>
                                    <CheckCircle size={16} />
                                    Test Passed
                                </>
                            ) : (
                                <>
                                    <RefreshCcw size={16} />
                                    Test Connection
                                </>
                            )}
                        </button>

                        {status === 'error' && (
                            <span className={styles.error}>
                                <AlertCircle size={16} />
                                Please fill in Supabase URL and anon key.
                            </span>
                        )}

                        {testStatus === 'error' && (
                            <span className={styles.error}>
                                <AlertCircle size={16} />
                                Supabase test failed.
                            </span>
                        )}
                    </div>

                    {testResult && (
                        <div className={`${styles.testResult} ${testResult.ok ? styles.testSuccess : styles.testError}`}>
                            {testResult.checks.map((check) => (
                                <div key={check.name} className={styles.testRow}>
                                    {check.ok ? (
                                        <CheckCircle size={16} className={styles.testOkIcon} />
                                    ) : (
                                        <AlertCircle size={16} className={styles.testErrorIcon} />
                                    )}
                                    <div>
                                        <strong>{check.name}</strong>
                                        <p>{check.message}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

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
                                    Save Settings
                                </>
                            )}
                        </button>

                        {status === 'error' && (
                            <span className={styles.error}>
                                <AlertCircle size={16} />
                                Please fill in Supabase URL and anon key.
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
