begin;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.chiir_settings (
  id boolean primary key default true check(id), study_open boolean not null default false
);
insert into public.chiir_settings(id) values(true) on conflict do nothing;
create table if not exists public.chiir_plan (
  participant text primary key, ordinal integer unique not null, canonical jsonb not null
);
create table if not exists public.chiir_sessions (
  session_id uuid primary key default gen_random_uuid(), token_hash bytea unique not null,
  participant text not null references public.chiir_plan(participant),
  data_kind text not null check(data_kind in ('study','software-test')),
  experience text not null check(experience in ('yes','no')),
  consent_version text not null, consent_at timestamptz not null default now(),
  revision integer not null default 0, record jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.chiir_sessions add column if not exists platform_id text;
create unique index if not exists chiir_study_platform_id on public.chiir_sessions(platform_id) where data_kind='study';
create unique index if not exists chiir_study_participant on public.chiir_sessions(participant) where data_kind='study';
alter table public.chiir_settings enable row level security;
alter table public.chiir_plan enable row level security;
alter table public.chiir_sessions enable row level security;
revoke all on public.chiir_settings, public.chiir_plan, public.chiir_sessions from anon, authenticated;

drop function if exists public.chiir_start_session(text,text,text,text);
create or replace function public.chiir_start_session(p_token text,p_kind text,p_experience text,p_consent text,p_platform_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chiir_sessions%rowtype; chosen text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_kind is null or p_kind not in ('study','software-test')
    or p_experience is null or p_experience not in ('yes','no') or p_consent is distinct from 'chiir-consent-02' or p_platform_id is null or p_platform_id !~ '^[A-Za-z0-9_-]{1,40}$'
    then raise exception 'invalid session request'; end if;
  perform pg_advisory_xact_lock(2026101140);
  select * into s from public.chiir_sessions where token_hash=extensions.digest(p_token,'sha256');
  if found then
    if s.data_kind<>p_kind or s.experience<>p_experience or s.platform_id is distinct from p_platform_id then raise exception 'session mismatch'; end if;
  else
    if p_kind='study' then
      if exists(select 1 from public.chiir_sessions where data_kind='study' and platform_id=p_platform_id) then raise exception 'platform participant already used'; end if;
      if not (select study_open from public.chiir_settings where id) then raise exception 'study not open'; end if;
      select p.participant into chosen from public.chiir_plan p where not exists
        (select 1 from public.chiir_sessions r where r.participant=p.participant and r.data_kind='study') order by p.ordinal limit 1;
    else
      select participant into chosen from public.chiir_plan order by ordinal offset
        ((select count(*) from public.chiir_sessions where data_kind='software-test') % 36) limit 1;
    end if;
    if chosen is null then raise exception 'study allocation full'; end if;
    insert into public.chiir_sessions(token_hash,participant,data_kind,experience,consent_version,platform_id)
      values(extensions.digest(p_token,'sha256'),chosen,p_kind,p_experience,p_consent,p_platform_id) returning * into s;
  end if;
  return jsonb_build_object('sessionId',s.session_id,'participant',s.participant,'record',s.record,'revision',s.revision,
    'experience',s.experience,'dataKind',s.data_kind,'consentVersion',s.consent_version,'consentAt',s.consent_at,'platformId',s.platform_id,'platformTaskId','202610118100');
end $$;

create or replace function public.chiir_resume_session(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chiir_sessions%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'invalid session request'; end if;
  select * into s from public.chiir_sessions where token_hash=extensions.digest(p_token,'sha256');
  if not found then return null; end if;
  return jsonb_build_object('sessionId',s.session_id,'participant',s.participant,'record',s.record,'revision',s.revision,
    'experience',s.experience,'dataKind',s.data_kind,'consentVersion',s.consent_version,'consentAt',s.consent_at,'platformId',s.platform_id,'platformTaskId','202610118100');
end $$;

create or replace function public.chiir_save_record(p_token text,p_record jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.chiir_sessions%rowtype; plan jsonb; r jsonb; t jsonb; e jsonb;
  n integer; i integer; v_revision integer; phase text; rec_count integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_record is null or jsonb_typeof(p_record)<>'object'
    or octet_length(p_record::text)>2000000 then raise exception 'invalid record'; end if;
  select * into s from public.chiir_sessions where token_hash=extensions.digest(p_token,'sha256') for update;
  if not found then raise exception 'session not found'; end if;
  select canonical into plan from public.chiir_plan where participant=s.participant;
  if p_record->>'sessionId' is distinct from s.session_id::text or p_record->>'participant' is distinct from s.participant
    or p_record->>'dataKind' is distinct from s.data_kind or p_record#>>'{profile,birdExperience}' is distinct from s.experience
    or p_record->>'platformId' is distinct from s.platform_id or p_record->>'platformTaskId' is distinct from '202610118100'
    or p_record->>'consentVersion' is distinct from s.consent_version
    or p_record->'allocation' is distinct from plan->'allocation' or p_record->'schedule' is distinct from plan->'schedule'
    or p_record->'recallIds' is distinct from plan->'recallIds' or p_record->'version' is distinct from plan->'version'
    or p_record->'uiRevision' is distinct from plan->'uiRevision' or p_record->'materialSha' is distinct from plan->'materialSha'
    or p_record->>'responseFormat' is distinct from 'binary-plus-confidence7'
    or p_record->>'timingDefinition' is distinct from 'available-images-ready-to-submit;whole-trial'
    or p_record ? 'previewSeededRows' then raise exception 'record identity mismatch'; end if;
  if jsonb_typeof(p_record->'rows') is distinct from 'array' or jsonb_typeof(p_record->'events') is distinct from 'array'
    or jsonb_typeof(p_record->'recalls') is distinct from 'array' or jsonb_typeof(p_record->'cloudRevision') is distinct from 'number'
    then raise exception 'invalid record arrays'; end if;
  n=jsonb_array_length(p_record->'rows'); rec_count=jsonb_array_length(p_record->'recalls');
  v_revision=(p_record->>'cloudRevision')::integer;phase=p_record->>'phase';
  if n>40 or n<0 or (p_record->>'index')::integer is distinct from n or rec_count>3 or jsonb_array_length(p_record->'events')>10000
    or v_revision<1 then raise exception 'invalid progress'; end if;
  if not coalesce(case phase
    when 'task' then n<40 when 'practice_feedback' then n between 1 and 4 when 'main_intro' then n=4
    when 'break' then n in (16,28) when 'recall_intro' then n=40 and rec_count=0
    when 'recall' then n=40 and rec_count<3 when 'complete' then n=40 and rec_count=3 else false end,false)
    or (n<40 and rec_count<>0) or ((p_record->>'mainCompletedAt' is not null)<>(n=40))
    or ((p_record->>'completedAt' is not null)<>(phase='complete')) then raise exception 'invalid phase'; end if;
  if v_revision<=s.revision then
    if v_revision=s.revision and p_record=s.record then
      return jsonb_build_object('revision',s.revision,'rows',n,'complete',s.completed_at is not null);
    end if;
    raise exception 'record conflict';
  end if;
  if s.record is not null then
    if n<jsonb_array_length(s.record->'rows') or rec_count<jsonb_array_length(s.record->'recalls')
      or jsonb_array_length(p_record->'events')<jsonb_array_length(s.record->'events')
      or p_record->'startedAt' is distinct from s.record->'startedAt' then raise exception 'record regression'; end if;
    for i in 0..jsonb_array_length(s.record->'rows')-1 loop
      if p_record->'rows'->i is distinct from s.record->'rows'->i then raise exception 'submitted answer changed'; end if;
    end loop;
    for i in 0..jsonb_array_length(s.record->'events')-1 loop
      if p_record->'events'->i is distinct from s.record->'events'->i then raise exception 'event history changed'; end if;
    end loop;
    for i in 0..jsonb_array_length(s.record->'recalls')-1 loop
      if p_record->'recalls'->i is distinct from s.record->'recalls'->i then raise exception 'recall history changed'; end if;
    end loop;
  end if;
  for i in 0..n-1 loop
    r=p_record->'rows'->i;t=plan->'schedule'->i;
    if r->>'participant' is distinct from s.participant or r->>'session_id' is distinct from s.session_id::text
      or r->>'data_kind' is distinct from s.data_kind or r->'app_version' is distinct from plan->'version'
      or r->'ui_revision' is distinct from plan->'uiRevision' or r->'material_sha' is distinct from plan->'materialSha'
      or r->'item_id' is distinct from t->'id' or r->'layout' is distinct from t->'layout'
      or r->'set_id' is distinct from t->'set_id' or r->'block_index' is distinct from t->'block_index'
      or r->'trial_type' is distinct from t->'kind' or (r->>'position')::integer is distinct from i+1
      or r->'order_sequence' is distinct from plan#>'{allocation,variant}' or r->'form' is distinct from plan#>'{allocation,form}'
      or r->>'response_format' is distinct from 'binary-plus-confidence7'
      or r->>'response' is null or r->>'response' not in ('0','1')
      or r->>'confidence' is null or r->>'confidence' !~ '^[1-7]$'
      or (r->>'error_score')::integer is distinct from (case when r->>'response'='1' then 7+(r->>'confidence')::integer else 8-(r->>'confidence')::integer end)
      then raise exception 'invalid answer'; end if;
    if jsonb_typeof(r->'timing_interrupted') is distinct from 'boolean'
      or r->>'toggle_count' is null or r->>'toggle_count' !~ '^[0-9]+$'
      or r->>'rt_decision_ms' is not null or r->>'rt_confidence_ms' is not null or r->>'rt_request_ms' is not null
      then raise exception 'invalid timing'; end if;
    if (r->>'timing_interrupted')::boolean and (r->>'response_total_ms' is not null or r->>'first_toggle_ms' is not null or r->>'dwell_query_ms' is not null or r->>'dwell_proto_ms' is not null)
      then raise exception 'interrupted time must be null'; end if;
    perform (r->>'ready_at')::timestamptz, (r->>'submitted_at')::timestamptz;
  end loop;
  for i in 0..jsonb_array_length(p_record->'events')-1 loop
    e=p_record->'events'->i;
    if (e->>'index')::integer is distinct from i+1 or jsonb_typeof(e->'type') is distinct from 'string' then raise exception 'invalid event'; end if;
    perform (e->>'at')::timestamptz;
  end loop;
  for i in 0..rec_count-1 loop
    r=p_record->'recalls'->i;
    if r->'item_id' is distinct from plan->'recallIds'->i or jsonb_typeof(r->'basis') is distinct from 'string'
      or length(r->>'basis')>600 or jsonb_typeof(r->'skipped') is distinct from 'boolean'
      or jsonb_typeof(r->'cannotRecall') is distinct from 'boolean' then raise exception 'invalid recall'; end if;
  end loop;
  update public.chiir_sessions set record=p_record,revision=v_revision,updated_at=now(),
    completed_at=case when phase='complete' then coalesce(s.completed_at,now()) else null end where session_id=s.session_id;
  return jsonb_build_object('revision',v_revision,'rows',n,'complete',phase='complete');
end $$;
revoke all on function public.chiir_start_session(text,text,text,text,text),public.chiir_resume_session(text),public.chiir_save_record(text,jsonb) from public,anon,authenticated;
grant execute on function public.chiir_start_session(text,text,text,text,text),public.chiir_resume_session(text),public.chiir_save_record(text,jsonb) to anon;
commit;
