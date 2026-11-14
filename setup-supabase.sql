begin;

create table if not exists public.jot_backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object')
);

alter table public.jot_backups enable row level security;
revoke all on table public.jot_backups from public, anon, authenticated;
grant select, insert, update on table public.jot_backups to authenticated;

drop policy if exists jot_read_own on public.jot_backups;
create policy jot_read_own on public.jot_backups for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists jot_insert_own on public.jot_backups;
create policy jot_insert_own on public.jot_backups for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists jot_update_own on public.jot_backups;
create policy jot_update_own on public.jot_backups for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
