# Cloudflare Pages Web Deployment

This mode is a pure cloud/static web app. It does not require the local
Electron app, the local Vite server, Cloudflare Tunnel, or the local WhisperX
Python server to be running.

The deployed page reads podcast metadata, transcripts, vocabulary, and audio
URLs directly from Supabase.

## What Works In Cloud Mode

- Browse the podcast library from Supabase.
- Open processed podcasts and play audio from Supabase Storage.
- Read timestamped transcripts from Supabase.
- Search, sort, and browse folders.
- Generate vocabulary cards only when the viewer configures a browser-side AI
  key locally, or when you add your own backend proxy.

## What Stays Local

- Importing new audio files is desktop-only for now.
- Local WhisperX transcription is desktop-only.
- Batch upload and processing queues run in the Electron app.
- The `/audio-proxy` endpoint is only available through the packaged Electron
  static server, not Cloudflare Pages.

For the current architecture, the normal workflow is:

1. Use the desktop app to upload and process podcasts into Supabase.
2. Open the Cloudflare Pages URL from any device.
3. The web app reads the already-processed Supabase data directly.

## Supabase Requirements

Run `docs/supabase-schema.sql` in the Supabase SQL Editor before deploying.

The `audio-files` storage bucket must be public, because Cloudflare Pages has
no local audio proxy and browser playback uses the Supabase public file URL.

The included SQL policies are permissive and intended for a private personal
deployment. Tighten RLS before sharing this with other users.

## Cloudflare Pages Settings

Create a Cloudflare Pages project connected to this repository.

Build settings:

```text
Build command: npm run build:web
Build output directory: dist-web
Root directory: /
```

Environment variables:

```env
NODE_VERSION=22.12.0
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_REMOTE_ACCESS_PASSWORD=choose-a-password
VITE_VOCAB_PROVIDER=gemini
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=gpt-4o-mini
```

`VITE_REMOTE_ACCESS_PASSWORD` is strongly recommended. It protects the frontend
route. It is not a replacement for Supabase RLS.

Do not put long-lived AI provider API keys in Cloudflare Pages `VITE_*`
variables for an untrusted public site. Vite embeds `VITE_*` values into the
browser bundle. For a public deployment, prefer a backend proxy, Supabase Edge
Function, or let each trusted viewer enter their own key in Settings.

After changing any `VITE_*` variable in Cloudflare Pages, redeploy the project.
Vite embeds these values at build time.

## Routing

`public/_redirects` is included so direct URLs like `/player/<id>` and browser
refreshes are served by the React app instead of returning a 404.

## Difference From Cloudflare Tunnel

Cloudflare Tunnel mode exposes services running on your computer:

- `localhost:5173` for the app
- `localhost:8765` for the local WhisperX backend

Cloudflare Pages mode is different. It deploys only static files to Cloudflare
and talks to Supabase directly. Your computer can be off and the web app can
still open existing Supabase data.
