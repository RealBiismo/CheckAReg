-- BIISMO REG staff roles: Owner > Admin > Moderator > User.
-- Moderators are read-only for account/search/credit insight and may add internal support notes.

create table if not exists private.app_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists private.staff_support_notes (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  staff_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists staff_support_notes_target_created_idx
  on private.staff_support_notes(target_user_id, created_at desc);

alter table private.app_moderators enable row level security;
alter table private.staff_support_notes enable row level security;
revoke all on private.app_moderators from public, anon, authenticated;
revoke all on private.staff_support_notes from public, anon, authenticated;

create or replace function public.get_staff_role()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_email text; v_role text:='user';
begin
  if v_id is null then raise insufficient_privilege using message='Sign in to continue.'; end if;
  select lower(email) into v_email from auth.users where id=v_id;
  if v_email='cybzerohq@gmail.com' then v_role:='owner';
  elsif exists(select 1 from private.app_admins where user_id=v_id) then v_role:='admin';
  elsif exists(select 1 from private.app_moderators where user_id=v_id) then v_role:='moderator'; end if;
  return jsonb_build_object('role',v_role,'isOwner',v_role='owner','isAdmin',v_role in('owner','admin'),'isModerator',v_role='moderator','hasStaffAccess',v_role in('owner','admin','moderator'));
end $$;
revoke execute on function public.get_staff_role() from public,anon;
grant execute on function public.get_staff_role() to authenticated;

create or replace function public.owner_set_moderator(p_target_email text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_email text; v_target uuid; v_target_email text;
begin
  select lower(email) into v_email from auth.users where id=v_id;
  if v_id is null or v_email<>'cybzerohq@gmail.com' then raise insufficient_privilege using message='Only the BIISMO REG owner can manage moderators.'; end if;
  select id,lower(email) into v_target,v_target_email from auth.users where lower(email)=lower(trim(p_target_email)) and email_confirmed_at is not null limit 1;
  if v_target is null then raise no_data_found using message='No verified BIISMO REG account was found for that email.'; end if;
  if v_target_email='cybzerohq@gmail.com' or exists(select 1 from private.app_admins where user_id=v_target) then raise invalid_parameter_value using message='Owner/admin accounts cannot be changed to moderator.'; end if;
  if p_enabled then insert into private.app_moderators(user_id,added_by) values(v_target,v_id) on conflict(user_id) do nothing;
  else delete from private.app_moderators where user_id=v_target; end if;
  return jsonb_build_object('email',v_target_email,'moderator',p_enabled);
end $$;
revoke execute on function public.owner_set_moderator(text,boolean) from public,anon;
grant execute on function public.owner_set_moderator(text,boolean) to authenticated;

create or replace function public.owner_list_staff()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=auth.uid(); v_email text; v_items jsonb;
begin
  select lower(email) into v_email from auth.users where id=v_id;
  if v_id is null or v_email<>'cybzerohq@gmail.com' then raise insufficient_privilege using message='Only the BIISMO REG owner can view staff management.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.role,x.email),'[]'::jsonb) into v_items from (
    select lower(u.email) email,'admin'::text role,u.created_at from private.app_admins a join auth.users u on u.id=a.user_id where lower(u.email)<>'cybzerohq@gmail.com'
    union all
    select lower(u.email),'moderator',m.created_at from private.app_moderators m join auth.users u on u.id=m.user_id
  ) x;
  return jsonb_build_object('owner','cybzerohq@gmail.com','staff',v_items);
end $$;
revoke execute on function public.owner_list_staff() from public,anon;
grant execute on function public.owner_list_staff() to authenticated;

create or replace function public.staff_add_support_note(p_target_email text,p_note text,p_flag boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_staff uuid:=auth.uid(); v_target uuid; v_note text:=trim(coalesce(p_note,'')); v_id uuid;
begin
  if v_staff is null or not (exists(select 1 from private.app_admins where user_id=v_staff) or exists(select 1 from private.app_moderators where user_id=v_staff)) then raise insufficient_privilege using message='Staff access required.'; end if;
  if length(v_note) not between 1 and 500 then raise invalid_parameter_value using message='Support notes must be between 1 and 500 characters.'; end if;
  select id into v_target from auth.users where lower(email)=lower(trim(p_target_email)) and email_confirmed_at is not null limit 1;
  if v_target is null then raise no_data_found using message='No verified BIISMO REG account was found for that email.'; end if;
  insert into private.staff_support_notes(target_user_id,staff_user_id,note,flagged) values(v_target,v_staff,v_note,coalesce(p_flag,false)) returning id into v_id;
  return jsonb_build_object('id',v_id,'saved',true,'flagged',coalesce(p_flag,false));
end $$;
revoke execute on function public.staff_add_support_note(text,text,boolean) from public,anon;
grant execute on function public.staff_add_support_note(text,text,boolean) to authenticated;

create or replace function public.staff_get_support_notes(p_target_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_staff uuid:=auth.uid(); v_target uuid; v_items jsonb;
begin
  if v_staff is null or not (exists(select 1 from private.app_admins where user_id=v_staff) or exists(select 1 from private.app_moderators where user_id=v_staff)) then raise insufficient_privilege using message='Staff access required.'; end if;
  select id into v_target from auth.users where lower(email)=lower(trim(p_target_email)) limit 1;
  if v_target is null then raise no_data_found using message='No verified BIISMO REG account was found for that email.'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into v_items from (
    select n.id,n.note,n.flagged,n.created_at,lower(u.email) staff_email from private.staff_support_notes n join auth.users u on u.id=n.staff_user_id where n.target_user_id=v_target order by n.created_at desc limit 20
  ) x;
  return v_items;
end $$;
revoke execute on function public.staff_get_support_notes(text) from public,anon;
grant execute on function public.staff_get_support_notes(text) to authenticated;

-- Existing get_search_allowance/admin_get_user_credits/admin_get_dashboard functions are updated
-- in production to recognise private.app_moderators for read-only staff access.
-- Existing credit, ban and push mutation functions intentionally continue checking only
-- private.app_admins, so moderator mutation attempts are rejected server-side.
