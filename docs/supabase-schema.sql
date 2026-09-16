-- PodFluent Supabase starter schema.
-- WARNING:
-- This schema is suitable for a private personal deployment. The included RLS
-- policies intentionally allow broad anon-key access so the local-first app can
-- work without Supabase Auth. Tighten policies before exposing a shared/public
-- instance or storing sensitive content.

create extension if not exists "pgcrypto";

create table if not exists public.podcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'PENDING',
  audio_url text not null,
  folder text not null default 'Inbox',
  progress text,
  error text,
  created_at timestamptz not null default now()
);

alter table public.podcasts
add column if not exists folder text not null default 'Inbox';

create table if not exists public.transcripts (
  podcast_id uuid primary key references public.podcasts(id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  meaning text not null,
  ipa text,
  translation text,
  examples jsonb not null default '[]'::jsonb,
  context_sentence text,
  source_podcast_id uuid references public.podcasts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (word, source_podcast_id)
);

create table if not exists public.remix_items (
  id uuid primary key default gen_random_uuid(),
  source_podcast_id uuid not null references public.podcasts(id) on delete cascade,
  source_segment_index integer not null,
  source_sentence text not null,
  source_start double precision,
  source_end double precision,
  phrase text not null,
  meaning text,
  question text not null,
  examples jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_podcast_id, source_segment_index)
);

create index if not exists podcasts_created_at_idx on public.podcasts(created_at desc);
create index if not exists podcasts_folder_idx on public.podcasts(folder);
create index if not exists vocabulary_created_at_idx on public.vocabulary(created_at desc);
create index if not exists vocabulary_word_idx on public.vocabulary(word);
create index if not exists remix_items_updated_at_idx on public.remix_items(updated_at desc);
create index if not exists remix_items_phrase_idx on public.remix_items(phrase);

insert into storage.buckets (id, name, public)
values ('audio-files', 'audio-files', true)
on conflict (id) do nothing;

alter table public.podcasts enable row level security;
alter table public.transcripts enable row level security;
alter table public.vocabulary enable row level security;
alter table public.remix_items enable row level security;

-- Private personal deployment policies. Replace these with authenticated user
-- policies before operating a shared instance.
drop policy if exists "podcasts_private_personal_all" on public.podcasts;
create policy "podcasts_private_personal_all"
on public.podcasts for all
using (true)
with check (true);

drop policy if exists "transcripts_private_personal_all" on public.transcripts;
create policy "transcripts_private_personal_all"
on public.transcripts for all
using (true)
with check (true);

drop policy if exists "vocabulary_private_personal_all" on public.vocabulary;
create policy "vocabulary_private_personal_all"
on public.vocabulary for all
using (true)
with check (true);

drop policy if exists "remix_items_private_personal_all" on public.remix_items;
create policy "remix_items_private_personal_all"
on public.remix_items for all
using (true)
with check (true);

drop policy if exists "audio_files_private_personal_select" on storage.objects;
create policy "audio_files_private_personal_select"
on storage.objects for select
using (bucket_id = 'audio-files');

drop policy if exists "audio_files_private_personal_insert" on storage.objects;
create policy "audio_files_private_personal_insert"
on storage.objects for insert
with check (bucket_id = 'audio-files');

drop policy if exists "audio_files_private_personal_delete" on storage.objects;
create policy "audio_files_private_personal_delete"
on storage.objects for delete
using (bucket_id = 'audio-files');
