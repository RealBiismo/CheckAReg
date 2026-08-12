-- Forward-only reconciliation of the AI schema currently used by production.
-- Replaces the original per-chat credit charge with question entitlements,
-- permits standalone chats, and records user-visible deletion as a soft delete.

alter table private.user_accounts
  add column if not exists ai_questions_purchased integer not null default 0,
  add column if not exists ai_questions_plan integer not null default 0,
  add column if not exists plan text not null default 'free',
  add column if not exists subscription_status text not null default 'inactive',
  add column if not exists subscription_period_end timestamptz;

alter table public.ai_mechanic_cases
  alter column vehicle_id drop not null,
  alter column registration drop not null,
  add column if not exists user_deleted_at timestamptz,
  add column if not exists user_deleted_reason text;

create table if not exists private.ai_question_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  source text not null,
  created_at timestamptz not null default now()
);

create table if not exists private.ai_question_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid references public.ai_mechanic_cases(id) on delete set null,
  source text not null check (source in ('plan','purchased')),
  status text not null default 'reserved' check (status in ('reserved','consumed','refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.ai_question_transactions enable row level security;
alter table private.ai_question_reservations enable row level security;

create index if not exists ai_question_transactions_user_created_idx
  on private.ai_question_transactions(user_id, created_at desc);
create index if not exists ai_question_reservations_user_status_idx
  on private.ai_question_reservations(user_id, status, created_at desc);

create or replace function public.get_biismo_entitlements() returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_account private.user_accounts%rowtype; v_plus boolean;
begin
  if v_user_id is null then raise insufficient_privilege using message='Sign in to view your BIISMO REG plan.'; end if;
  insert into private.user_accounts(user_id) values(v_user_id) on conflict(user_id) do nothing;
  select * into v_account from private.user_accounts where user_id=v_user_id;
  v_plus:=v_account.plan='plus' and v_account.subscription_status in ('active','trialing');
  return jsonb_build_object(
    'credits',v_account.credits,
    'aiQuestions',v_account.ai_questions_purchased+v_account.ai_questions_plan,
    'purchasedAiQuestions',v_account.ai_questions_purchased,
    'planAiQuestions',v_account.ai_questions_plan,
    'plan',case when v_plus then 'plus' else 'free' end,
    'plusActive',v_plus,
    'garageLimit',case when v_plus then 6 else 3 end,
    'subscriptionStatus',v_account.subscription_status,
    'subscriptionPeriodEnd',v_account.subscription_period_end
  );
end $$;

create or replace function public.purchase_ai_question_pack() returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_account private.user_accounts%rowtype;
begin
  if v_user_id is null then raise insufficient_privilege using message='Sign in to buy AI Mechanic questions.'; end if;
  insert into private.user_accounts(user_id) values(v_user_id) on conflict(user_id) do nothing;
  select * into v_account from private.user_accounts where user_id=v_user_id for update;
  if v_account.credits < 4 then raise exception 'You need 4 credits to unlock 10 AI Mechanic questions.'; end if;
  update private.user_accounts set credits=credits-4,ai_questions_purchased=ai_questions_purchased+10,updated_at=now() where user_id=v_user_id;
  insert into private.credit_transactions(user_id,amount,reason) values(v_user_id,-4,'ai_question_pack');
  insert into private.ai_question_transactions(user_id,amount,source) values(v_user_id,10,'credit_pack');
  return public.get_biismo_entitlements();
end $$;

create or replace function public.reserve_ai_mechanic_question(p_case_id uuid default null) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_account private.user_accounts%rowtype; v_source text; v_reservation uuid;
begin
  if v_user_id is null then raise insufficient_privilege using message='Sign in to use AI Mechanic.'; end if;
  if p_case_id is not null and not exists(select 1 from public.ai_mechanic_cases where id=p_case_id and user_id=v_user_id and user_deleted_at is null) then raise exception 'AI Mechanic case not found.'; end if;
  insert into private.user_accounts(user_id) values(v_user_id) on conflict(user_id) do nothing;
  select * into v_account from private.user_accounts where user_id=v_user_id for update;
  if v_account.ai_questions_plan > 0 then
    v_source:='plan';
    update private.user_accounts set ai_questions_plan=ai_questions_plan-1,updated_at=now() where user_id=v_user_id;
  elsif v_account.ai_questions_purchased > 0 then
    v_source:='purchased';
    update private.user_accounts set ai_questions_purchased=ai_questions_purchased-1,updated_at=now() where user_id=v_user_id;
  else
    raise exception 'You have no AI Mechanic questions left. Unlock 10 questions for 4 credits or upgrade to BIISMO REG+.';
  end if;
  insert into private.ai_question_reservations(user_id,case_id,source) values(v_user_id,p_case_id,v_source) returning id into v_reservation;
  return jsonb_build_object('reservationId',v_reservation,'source',v_source,'remaining',(select ai_questions_plan+ai_questions_purchased from private.user_accounts where user_id=v_user_id));
end $$;

create or replace function public.consume_ai_mechanic_question(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();
begin
  update private.ai_question_reservations set status='consumed',updated_at=now() where id=p_reservation_id and user_id=v_user_id and status='reserved';
  return jsonb_build_object('consumed',found);
end $$;

create or replace function public.refund_ai_mechanic_question(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_source text;
begin
  select source into v_source from private.ai_question_reservations where id=p_reservation_id and user_id=v_user_id and status='reserved' for update;
  if not found then return jsonb_build_object('refunded',false); end if;
  if v_source='plan' then update private.user_accounts set ai_questions_plan=ai_questions_plan+1,updated_at=now() where user_id=v_user_id;
  else update private.user_accounts set ai_questions_purchased=ai_questions_purchased+1,updated_at=now() where user_id=v_user_id; end if;
  update private.ai_question_reservations set status='refunded',updated_at=now() where id=p_reservation_id;
  return jsonb_build_object('refunded',true);
end $$;

create or replace function public.start_ai_mechanic_case(p_vehicle_id uuid,p_category text,p_issue_text text,p_image_count integer default 0) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_vehicle public.saved_vehicles%rowtype; v_profile public.vehicle_profiles%rowtype; v_case_id uuid; v_has_vehicle boolean:=false;
begin
  if v_user_id is null then raise insufficient_privilege using message='Sign in to use Biismo AI.'; end if;
  if length(trim(coalesce(p_issue_text,'')))<1 or length(p_issue_text)>3000 then raise exception 'Enter a vehicle question up to 3,000 characters.'; end if;
  if coalesce(p_image_count,0) not between 0 and 3 then raise exception 'Attach up to 3 photos.'; end if;
  if p_vehicle_id is not null then
    select * into v_vehicle from public.saved_vehicles where id=p_vehicle_id and user_id=v_user_id;
    if found then v_has_vehicle:=true; select * into v_profile from public.vehicle_profiles where user_id=v_user_id and registration=v_vehicle.registration; end if;
  end if;
  insert into public.ai_mechanic_cases(user_id,vehicle_id,registration,category,title,credit_cost)
  values(v_user_id,case when v_has_vehicle then v_vehicle.id end,case when v_has_vehicle then v_vehicle.registration end,left(coalesce(nullif(trim(p_category),''),'General vehicle question'),80),left(trim(p_issue_text),90),0)
  returning id into v_case_id;
  insert into public.ai_mechanic_messages(case_id,user_id,role,content,image_count) values(v_case_id,v_user_id,'user',trim(p_issue_text),coalesce(p_image_count,0));
  return jsonb_build_object('caseId',v_case_id,'vehicle',case when v_has_vehicle then jsonb_build_object('id',v_vehicle.id,'registration',v_vehicle.registration,'make',v_vehicle.make,'model',v_vehicle.model,'colour',v_vehicle.colour,'taxStatus',v_vehicle.tax_status,'taxDueDate',v_vehicle.tax_due_date,'motStatus',v_vehicle.mot_status,'motExpiryDate',v_vehicle.mot_expiry_date,'mileage',coalesce(v_profile.current_mileage,v_vehicle.last_mileage),'nickname',v_profile.nickname,'serviceDueDate',v_profile.service_due_date,'serviceDueMileage',v_profile.service_due_mileage) else null end);
end $$;

create or replace function public.delete_my_ai_mechanic_case(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise insufficient_privilege using message='Sign in to remove a Biismo AI chat.'; end if;
  update public.ai_mechanic_cases set user_deleted_at=coalesce(user_deleted_at,now()),user_deleted_reason=coalesce(user_deleted_reason,'user_removed'),updated_at=now()
  where id=p_case_id and user_id=v_user_id and user_deleted_at is null;
  if not found then raise exception 'Biismo AI chat not found.'; end if;
  return jsonb_build_object('deleted',true,'caseId',p_case_id);
end $$;

create or replace function public.list_ai_mechanic_cases() returns jsonb
language sql security definer set search_path=''
as $$
  select coalesce(jsonb_agg(x order by x->>'updatedAt' desc),'[]'::jsonb)
  from (select jsonb_build_object('id',c.id,'vehicleId',c.vehicle_id,'registration',c.registration,'category',c.category,'title',c.title,'status',c.status,'createdAt',c.created_at,'updatedAt',c.updated_at) x
        from public.ai_mechanic_cases c where c.user_id=auth.uid() and c.user_deleted_at is null and c.status in ('active','closed') order by c.updated_at desc limit 100) s;
$$;

revoke all on function public.get_biismo_entitlements() from public, anon;
revoke all on function public.purchase_ai_question_pack() from public, anon;
revoke all on function public.reserve_ai_mechanic_question(uuid) from public, anon;
revoke all on function public.consume_ai_mechanic_question(uuid) from public, anon;
revoke all on function public.refund_ai_mechanic_question(uuid) from public, anon;
revoke all on function public.start_ai_mechanic_case(uuid,text,text,integer) from public, anon;
revoke all on function public.delete_my_ai_mechanic_case(uuid) from public, anon;
revoke all on function public.list_ai_mechanic_cases() from public, anon;

grant execute on function public.get_biismo_entitlements() to authenticated;
grant execute on function public.purchase_ai_question_pack() to authenticated;
grant execute on function public.reserve_ai_mechanic_question(uuid) to authenticated;
grant execute on function public.consume_ai_mechanic_question(uuid) to authenticated;
grant execute on function public.refund_ai_mechanic_question(uuid) to authenticated;
grant execute on function public.start_ai_mechanic_case(uuid,text,text,integer) to authenticated;
grant execute on function public.delete_my_ai_mechanic_case(uuid) to authenticated;
grant execute on function public.list_ai_mechanic_cases() to authenticated;
