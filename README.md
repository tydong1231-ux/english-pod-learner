# PodFluent

PodFluent is a desktop-first English podcast learning app. Import an audio or video file, transcribe it with a local WhisperX engine or Gemini fallback, follow timestamped subtitles while listening, and turn clicked words into vocabulary cards.

## Features

- Local Electron desktop app with React and Vite.
- Podcast library backed by Supabase Database and Storage.
- Local WhisperX transcription server with word-level timestamps.
- Optional speaker diarization with a Hugging Face token.
- Gemini fallback transcription for when the local engine is unavailable.
- Click-to-learn vocabulary cards with definitions, examples, translations, and speech synthesis.
- Remote read access through Cloudflare Tunnel, protected by an environment-configured password gate.

## Requirements

- Node.js 20+
- Python 3.10 or 3.11
- Supabase project
- Gemini API key
- Optional: CUDA-capable GPU for fast WhisperX
- Optional: Hugging Face token for pyannote speaker diarization
- Optional: Cloudflare Tunnel for remote access

## Setup

1. Install JavaScript dependencies.

```bash
npm install
```

2. Create your local environment file.

```bash
cp .env.example .env
```

Fill in:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_REMOTE_ACCESS_PASSWORD=
HF_TOKEN=
```

`HF_TOKEN` is optional unless you want speaker diarization. Never commit `.env`.

3. Create the Supabase tables and storage bucket.

Use [docs/supabase-schema.sql](docs/supabase-schema.sql) as a starting point. The included policies are intended for a private personal deployment. Tighten them before exposing a shared or public instance.

4. Install the local Python engine dependencies.

Windows users can start with:

```bash
cd python
run_engine_windows.bat
```

The Electron app also starts `python/align_server.py` automatically when launched.

## Development

```bash
npm run dev
```

Run the Electron desktop app:

```bash
npm run electron:dev
```

Build the app:

```bash
npm run build
```

Build the web bundle:

```bash
npm run build:web
```

Lint:

```bash
npm run lint
```

## Remote Access

Remote access is optional. Configure your own Cloudflare Tunnel credentials, then copy and edit `cloudflared-config.yml` into your Cloudflare config location.

The web build requires:

```env
VITE_REMOTE_ACCESS_PASSWORD=
```

This password gate protects the frontend route. If you expose the Python API directly, add additional network or Cloudflare access controls.

## Project Structure

```text
src/
  components/       Shared layout, password gate, backend log viewer
  features/         Library, player, settings, vocabulary pages
  hooks/            Audio playback hook
  lib/              Supabase, Gemini, WhisperX, environment helpers
  services/         Podcast and vocabulary workflows
python/
  align_server.py   WhisperX Flask server
electron/
  main.cjs          Electron shell and backend process manager
docs/
  FEATURES.md       Current feature inventory and iteration notes
```

## Security Notes

- Do not commit `.env`, API keys, Supabase service-role keys, Hugging Face tokens, or Cloudflare credentials.
- Supabase anon keys are public by design, but your Row Level Security policies still matter.
- The sample Supabase policies are permissive for personal use. Review them before sharing access.
- Remote access should be treated as private-by-default.
