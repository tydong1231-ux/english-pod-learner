-- Existing private-personal app access model: anon clients can read/write Remix.
-- Does not change Vocabulary, podcasts, transcripts, storage or their policies.
begin;

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

create index if not exists remix_items_updated_at_idx on public.remix_items(updated_at desc);
create index if not exists remix_items_phrase_idx on public.remix_items(phrase);
alter table public.remix_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'remix_items' and policyname = 'remix_items_private_personal_all'
  ) then
    create policy "remix_items_private_personal_all" on public.remix_items
      for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant select, insert, update on public.remix_items to anon, authenticated;
notify pgrst, 'reload schema';
commit;
