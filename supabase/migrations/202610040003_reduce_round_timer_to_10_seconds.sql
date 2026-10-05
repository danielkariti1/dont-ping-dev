-- Set the official per-question timer to 10 seconds.
-- The Edge Function gives ordinary mobile/network delivery three extra seconds,
-- so the database remains the authoritative 13-second scoring deadline.

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

  -- Players see a ten-second timer. Three seconds of server-side grace absorbs
  -- the feedback transition and ordinary mobile/network latency without letting
  -- a custom client take unlimited time to preserve a perfect score.
  v_effective_correct := p_is_correct and v_response_ms <= 13000;

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

