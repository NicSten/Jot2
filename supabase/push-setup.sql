-- Jot push reminders: run once in the Supabase SQL Editor, after setup-supabase.sql.
-- Jot's More -> Notifications screen copies this with your project address already filled in.
-- If you copy it from here instead, replace YOUR-PROJECT-URL below with your project URL (https://<ref>.supabase.co).

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- each device you turn notifications on for
create table if not exists public.jot_push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
-- the key pair that signs your pushes; Jot makes it on the first device you turn notifications on for
create table if not exists public.jot_push_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vapid_public text not null,
  vapid_private jsonb not null
);
-- reminders already sent, so each goes out once
create table if not exists public.jot_push_sent (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
-- the secret the scheduled job uses to call the function, and when it last ran
create table if not exists public.jot_push_cron (
  id int primary key default 1 check (id = 1),
  secret text not null,
  last_run timestamptz
);
insert into public.jot_push_cron (id, secret)
  values (1, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;

alter table public.jot_push_subs enable row level security;
alter table public.jot_push_keys enable row level security;
alter table public.jot_push_sent enable row level security;
alter table public.jot_push_cron enable row level security;
revoke all on table public.jot_push_subs, public.jot_push_keys, public.jot_push_sent, public.jot_push_cron from public, anon, authenticated;
grant select, insert, update, delete on table public.jot_push_subs to authenticated;
grant select, insert on table public.jot_push_keys to authenticated;
-- jot_push_sent and jot_push_cron have no policies: only the function (service role) reads them

drop policy if exists jot_subs_own on public.jot_push_subs;
create policy jot_subs_own on public.jot_push_subs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists jot_keys_read_own on public.jot_push_keys;
create policy jot_keys_read_own on public.jot_push_keys for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists jot_keys_insert_own on public.jot_push_keys;
create policy jot_keys_insert_own on public.jot_push_keys for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- check for reminders every minute; scheduling the same name again replaces the job
select cron.schedule('jot-push', '* * * * *', $job$
  select net.http_post(
    url := 'YOUR-PROJECT-URL/functions/v1/jot-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-jot-cron', (select secret from public.jot_push_cron where id = 1)),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
$job$);
-- clear out the sent log once a day
select cron.schedule('jot-push-cleanup', '17 9 * * *', $job$
  delete from public.jot_push_sent where sent_at < now() - interval '3 days';
$job$);

commit;
