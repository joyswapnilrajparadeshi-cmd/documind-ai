-- DocuMind AI Supabase schema
-- Run this in Supabase SQL Editor after creating your project.

create extension if not exists pgcrypto;

create table if not exists public.doc_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  document_name text,
  document_type text,
  document_text text,
  summary text,
  insights jsonb default '{}'::jsonb,
  tasks jsonb default '[]'::jsonb,
  notes text,
  risk_analysis text,
  report text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doc_workspaces_user_id_idx on public.doc_workspaces(user_id);
create index if not exists doc_workspaces_updated_at_idx on public.doc_workspaces(updated_at desc);

alter table public.doc_workspaces enable row level security;

drop policy if exists "Users can read own doc workspaces" on public.doc_workspaces;
create policy "Users can read own doc workspaces"
  on public.doc_workspaces
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own doc workspaces" on public.doc_workspaces;
create policy "Users can insert own doc workspaces"
  on public.doc_workspaces
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own doc workspaces" on public.doc_workspaces;
create policy "Users can update own doc workspaces"
  on public.doc_workspaces
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own doc workspaces" on public.doc_workspaces;
create policy "Users can delete own doc workspaces"
  on public.doc_workspaces
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_doc_workspaces_updated_at on public.doc_workspaces;
create trigger set_doc_workspaces_updated_at
before update on public.doc_workspaces
for each row execute function public.set_updated_at();
