# Security Policy

PodFluent is currently designed as a local-first personal learning app. Treat
the included Supabase schema and Cloudflare deployment examples as starter
templates, not production multi-user security.

## Supported Versions

Security fixes target the latest `master` branch until tagged releases are
introduced.

## Reporting A Vulnerability

Open a private security advisory on GitHub, or create an issue with sensitive
details removed. Do not publish API keys, Supabase project secrets, tokens, or
private audio URLs in public issues.

## Important Security Boundaries

- Supabase anon keys are public by design. Row Level Security policies must do
  the real access control.
- `docs/supabase-schema.sql` is permissive for a private personal deployment.
  Do not use those policies for a shared public product without tightening RLS.
- `VITE_*` variables are embedded into browser bundles by Vite. Do not put
  long-lived AI provider keys, service-role keys, or private tokens into
  Cloudflare Pages `VITE_*` variables for an untrusted public site.
- The web password gate is a convenience barrier for the UI. It does not secure
  Supabase data by itself.
- The Electron app currently uses Node integration for local desktop features.
  Do not load untrusted remote pages inside the Electron window.
- The local WhisperX server is intended for local use. If you expose it through
  a tunnel, add Cloudflare Access or another network-level protection.
