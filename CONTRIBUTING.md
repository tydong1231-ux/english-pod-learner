# Contributing

Thanks for helping improve PodFluent.

## Development Setup

1. Install Node.js 22.12.0 or newer. The repo includes `.nvmrc` and
   `.node-version` for version managers.
2. Install dependencies:

```bash
npm install
```

3. Copy `.env.example` to `.env` and fill in your own local values.
4. Run the React dev server:

```bash
npm run dev
```

5. Run the Electron app:

```bash
npm run electron:dev
```

## Checks Before Opening A PR

Run:

```bash
npm run lint
npm run build
npm run build:web
```

If you change the local WhisperX server, also test:

```bash
pip install -r python/requirements.txt
python python/align_server.py
```

## Pull Request Guidelines

- Keep changes scoped and explain the user-facing impact.
- Do not commit `.env`, API keys, Supabase service-role keys, Cloudflare
  credentials, Hugging Face tokens, generated builds, or model files.
- Update README or docs when behavior, setup, deployment, or security
  assumptions change.
- Prefer small, reviewable PRs over broad rewrites.
