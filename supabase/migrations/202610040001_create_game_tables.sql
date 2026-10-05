-- DON'T PING DEV - authoritative game state and scoring.
-- The browser never writes these tables directly. All access goes through the
-- game-api Edge Function, which uses the service role after validating input.

create extension if not exists pgcrypto;

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null
    check (event_id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  player_name text not null
    check (char_length(player_name) between 2 and 24),
  team_name text
    check (team_name is null or char_length(team_name) between 1 and 32),
  -- SHA-256 of the normalized player/team identity. This makes start requests
  -- idempotent and keeps one official attempt per identity and event.
  player_key text not null
    check (player_key ~ '^[a-f0-9]{64}$'),
  question_order text[] not null
    check (cardinality(question_order) = 7),
  current_index smallint not null default 0
    check (current_index between 0 and 7),
  correct_answers smallint not null default 0
    check (correct_answers between 0 and 7),
  interruptions_avoided smallint not null default 0
    check (interruptions_avoided between 0 and 7),
  time_saved_minutes smallint not null default 0
    check (time_saved_minutes between 0 and 240),
  status text not null default 'active'
    check (status in ('active', 'completed')),
  rank_title text,
  duration_ms integer
    check (duration_ms is null or duration_ms >= 0),
  started_at timestamptz not null default clock_timestamp(),
  last_question_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint game_sessions_event_player_unique unique (event_id, player_key),
  constraint game_sessions_completion_consistent check (
    (status = 'active' and completed_at is null and duration_ms is null)
    or
    (status = 'completed' and completed_at is not null and duration_ms is not null
      and current_index = 7 and rank_title is not null)
  )
);

create table if not exists public.game_answers (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  answer_index smallint not null check (answer_index between 0 and 6),
  question_id text not null,
  choice text not null check (choice in ('agent', 'dev', 'timeout')),
  is_correct boolean not null,
  response_ms integer not null check (response_ms between 0 and 3600000),
  answered_at timestamptz not null default clock_timestamp(),
  constraint game_answers_question_once unique (session_id, question_id),
  constraint game_answers_index_once unique (session_id, answer_index)
);

create table if not exists public.game_rate_limits (
  bucket_key text primary key check (bucket_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 1 check (request_count > 0)
);

create index if not exists game_sessions_leaderboard_idx
  on public.game_sessions
  (event_id, correct_answers desc, duration_ms asc, completed_at asc)
  where status = 'completed';

create index if not exists game_answers_session_idx
  on public.game_answers (session_id, answer_index);

alter table public.game_sessions enable row level security;
alter table public.game_answers enable row level security;
alter table public.game_rate_limits enable row level security;

-- Deliberately create no anon/authenticated policies. Even someone who extracts
-- the public anon key from GitHub Pages cannot forge a score through PostgREST.
revoke all on table public.game_sessions from anon, authenticated;
revoke all on table public.game_answers from anon, authenticated;
revoke all on table public.game_rate_limits from anon, authenticated;
revoke all on sequence public.game_answers_id_seq from anon, authenticated;

grant select, insert, update, delete on table public.game_sessions to service_role;
grant select, insert, update, delete on table public.game_answers to service_role;
grant select, insert, update, delete on table public.game_rate_limits to service_role;
grant usage, select on sequence public.game_answers_id_seq to service_role;

-- Atomic, coarse IP/action rate limiting for the public booth endpoint. The
-- Edge Function hashes the address before it reaches this table.
create or replace function public.consume_game_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_bucket_key is null
     or p_bucket_key !~ '^[a-f0-9]{64}$'
     or p_limit is null
     or p_limit not between 1 and 10000
     or p_window_seconds is null
     or p_window_seconds not between 1 and 3600 then
    raise exception using errcode = '22023', message = 'INVALID_RATE_LIMIT_INPUT';
  end if;

  insert into public.game_rate_limits as rl (
    bucket_key,
    window_started_at,
    request_count
  ) values (
    p_bucket_key,
    v_now,
    1
  )
  on conflict (bucket_key) do update
    set window_started_at = case
          when rl.window_started_at <= v_now - (p_window_seconds * interval '1 second')
            then v_now
          else rl.window_started_at
        end,
        request_count = case
          when rl.window_started_at <= v_now - (p_window_seconds * interval '1 second')
            then 1
          else rl.request_count + 1
        end
  returning (rl.request_count <= p_limit) into v_allowed;

  return v_allowed;
end;
$$;

revoke all on function public.consume_game_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_game_rate_limit(text, integer, integer)
  to service_role;

-- Record one answer and advance the session as a single transaction. Row locking
-- plus unique constraints make retries safe and reject double answers.
create or replace function public.record_game_answer(
  p_session_id uuid,
  p_question_id text,
  p_choice text,
  p_is_correct boolean,
  p_interruption_avoided integer,
  p_time_saved_minutes integer
)
returns table (
  out_was_duplicate boolean,
  out_answer_correct boolean,
  out_response_ms integer,
  out_session_status text,
  out_current_index integer,
  out_correct_answers integer,
  out_interruptions_avoided integer,
  out_time_saved_minutes integer,
  out_duration_ms integer,
  out_rank_title text,
  out_completed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.game_sessions%rowtype;
  v_existing public.game_answers%rowtype;
  v_expected_question text;
  v_response_ms integer;
  v_new_index integer;
  v_new_correct integer;
  v_effective_correct boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_choice is null or p_choice not in ('agent', 'dev', 'timeout') then
    raise exception using errcode = '22023', message = 'INVALID_CHOICE';
  end if;

  if p_question_id is null or char_length(p_question_id) > 80 then
    raise exception using errcode = '22023', message = 'INVALID_QUESTION';
  end if;

  if p_is_correct is null
     or p_interruption_avoided is null
     or p_interruption_avoided not between 0 and 1
     or p_time_saved_minutes is null
     or p_time_saved_minutes not between 0 and 60 then
    raise exception using errcode = '22023', message = 'INVALID_SCORE_INPUT';
  end if;

  select gs.*
    into v_session
    from public.game_sessions gs
   where gs.id = p_session_id
   for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'SESSION_NOT_FOUND';
  end if;

  select ga.*
    into v_existing
    from public.game_answers ga
   where ga.session_id = p_session_id
     and ga.question_id = p_question_id;

  if found then
    if v_existing.choice <> p_choice then
      raise exception using errcode = 'P0001', message = 'ANSWER_CONFLICT';
    end if;

    return query
      select true,
             v_existing.is_correct,
             v_existing.response_ms,
             v_session.status,
             v_session.current_index::integer,
             v_session.correct_answers::integer,
             v_session.interruptions_avoided::integer,
             v_session.time_saved_minutes::integer,
             v_session.duration_ms,
             v_session.rank_title,
             v_session.completed_at;
    return;
  end if;

  if v_session.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'SESSION_ALREADY_COMPLETED';
  end if;

  v_expected_question := v_session.question_order[v_session.current_index + 1];
  if v_expected_question is distinct from p_question_id then
    raise exception using errcode = 'P0001', message = 'QUESTION_OUT_OF_SEQUENCE';
  end if;

  v_response_ms := greatest(
    0,
    least(
      3600000::numeric,
      round(extract(epoch from (v_now - v_session.last_question_at)) * 1000)
    )::integer
  );

  -- Players see a seven-second timer. Three seconds of server-side grace absorbs
  -- the feedback transition and ordinary mobile/network latency without letting
  -- a custom client take unlimited time to preserve a perfect score.
  v_effective_correct := p_is_correct and v_response_ms <= 10000;

  insert into public.game_answers (
    session_id,
    answer_index,
    question_id,
    choice,
    is_correct,
    response_ms,
    answered_at
  ) values (
    p_session_id,
    v_session.current_index,
    p_question_id,
    p_choice,
    v_effective_correct,
    v_response_ms,
    v_now
  );

  v_new_index := v_session.current_index + 1;
  v_new_correct := v_session.correct_answers + case when v_effective_correct then 1 else 0 end;

  if v_new_index = cardinality(v_session.question_order) then
    update public.game_sessions gs
       set current_index = v_new_index,
           correct_answers = v_new_correct,
           interruptions_avoided = gs.interruptions_avoided
             + case when v_effective_correct then p_interruption_avoided else 0 end,
           time_saved_minutes = gs.time_saved_minutes
             + case when v_effective_correct then p_time_saved_minutes else 0 end,
           status = 'completed',
           rank_title = case
             when v_new_correct = 7 then 'Legendary Developer Bodyguard'
             when v_new_correct = 6 then 'Developer Protector'
             when v_new_correct >= 4 then 'Context-Switch Defender'
             when v_new_correct >= 2 then 'Recovering Pinger'
             else 'Serial Developer Pinger'
           end,
           duration_ms = greatest(
             0,
             least(
               2147483647::numeric,
               round(extract(epoch from (v_now - gs.started_at)) * 1000)
             )::integer
           ),
           last_question_at = v_now,
           completed_at = v_now
     where gs.id = p_session_id;
  else
    update public.game_sessions gs
       set current_index = v_new_index,
           correct_answers = v_new_correct,
           interruptions_avoided = gs.interruptions_avoided
             + case when v_effective_correct then p_interruption_avoided else 0 end,
           time_saved_minutes = gs.time_saved_minutes
             + case when v_effective_correct then p_time_saved_minutes else 0 end,
           last_question_at = v_now
     where gs.id = p_session_id;
  end if;

  select gs.*
    into v_session
    from public.game_sessions gs
   where gs.id = p_session_id;

  return query
    select false,
           v_effective_correct,
           v_response_ms,
           v_session.status,
           v_session.current_index::integer,
           v_session.correct_answers::integer,
           v_session.interruptions_avoided::integer,
           v_session.time_saved_minutes::integer,
           v_session.duration_ms,
           v_session.rank_title,
           v_session.completed_at;
end;
$$;

revoke all on function public.record_game_answer(uuid, text, text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.record_game_answer(uuid, text, text, boolean, integer, integer)
  to service_role;

comment on table public.game_sessions is
  'Authoritative sessions and final scores for the DON''T PING DEV booth game.';
comment on table public.game_answers is
  'Server-validated per-question answers. Never writable by browser clients.';
comment on table public.game_rate_limits is
  'Hashed, short-window counters for coarse protection of the public Edge Function.';
comment on function public.record_game_answer(uuid, text, text, boolean, integer, integer) is
  'Atomically records a validated Edge Function answer and advances its session.';
