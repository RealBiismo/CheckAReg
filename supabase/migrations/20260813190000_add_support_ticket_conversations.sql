-- Turn support tickets into secure two-way conversations.

create table if not exists public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  sender_type text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_sender_type_check
    check (sender_type in ('user', 'staff')),
  constraint support_ticket_messages_message_check
    check (char_length(trim(message)) between 1 and 2000)
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages(ticket_id, created_at, id);
create index if not exists support_ticket_messages_sender_id_idx
  on public.support_ticket_messages(sender_id);

alter table public.support_ticket_messages enable row level security;

drop policy if exists "Ticket participants read messages" on public.support_ticket_messages;
create policy "Ticket participants read messages"
on public.support_ticket_messages for select to authenticated
using (
  exists (
    select 1 from public.support_tickets ticket
    where ticket.id = ticket_id
      and ticket.user_id = (select auth.uid())
  )
  or (select public.is_app_staff())
);

drop policy if exists "Users reply to their open tickets" on public.support_ticket_messages;
create policy "Users reply to their open tickets"
on public.support_ticket_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and sender_type = 'user'
  and exists (
    select 1 from public.support_tickets ticket
    where ticket.id = ticket_id
      and ticket.user_id = (select auth.uid())
      and ticket.status <> 'closed'
  )
);

revoke all on public.support_ticket_messages from public, anon, authenticated;
grant select on public.support_ticket_messages to authenticated;
grant insert (ticket_id, sender_id, sender_type, message)
  on public.support_ticket_messages to authenticated;
grant usage, select on sequence public.support_ticket_messages_id_seq to authenticated;

create or replace function public.touch_support_ticket_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.support_tickets
  set updated_at = now(),
      status = case
        when new.sender_type = 'user' and status in ('waiting_on_user', 'resolved') then 'open'
        else status
      end,
      resolved_at = case
        when new.sender_type = 'user' and status in ('waiting_on_user', 'resolved') then null
        else resolved_at
      end
  where id = new.ticket_id;
  return new;
end;
$$;

drop trigger if exists support_ticket_message_touches_ticket on public.support_ticket_messages;
create trigger support_ticket_message_touches_ticket
after insert on public.support_ticket_messages
for each row execute function public.touch_support_ticket_from_message();

create or replace function public.seed_support_ticket_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.support_ticket_messages (ticket_id, sender_id, sender_type, message, created_at)
  values (new.id, new.user_id, 'user', new.description, new.created_at);
  return new;
end;
$$;

drop trigger if exists support_ticket_seeds_conversation on public.support_tickets;
create trigger support_ticket_seeds_conversation
after insert on public.support_tickets
for each row execute function public.seed_support_ticket_conversation();

-- Preserve existing reports and staff replies as the first conversation messages.
insert into public.support_ticket_messages (ticket_id, sender_id, sender_type, message, created_at)
select ticket.id, ticket.user_id, 'user', ticket.description, ticket.created_at
from public.support_tickets ticket
where not exists (
  select 1 from public.support_ticket_messages message
  where message.ticket_id = ticket.id and message.sender_type = 'user'
);

insert into public.support_ticket_messages (ticket_id, sender_id, sender_type, message, created_at)
select ticket.id, ticket.responded_by, 'staff', ticket.staff_response, coalesce(ticket.responded_at, ticket.updated_at)
from public.support_tickets ticket
where ticket.staff_response is not null
  and not exists (
    select 1 from public.support_ticket_messages message
    where message.ticket_id = ticket.id and message.sender_type = 'staff'
  );

create or replace function public.staff_list_support_tickets(
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_items jsonb;
begin
  if not public.is_app_staff() then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;
  if v_status is not null and v_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise invalid_parameter_value using message = 'Choose a valid ticket status.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.updated_at desc), '[]'::jsonb)
  into v_items
  from (
    select ticket.id, lower(account.email) as email, ticket.category, ticket.subject,
      ticket.registration, ticket.screenshot_path as "screenshotPath", ticket.page_url as "pageUrl",
      ticket.user_agent as "userAgent", ticket.status, ticket.created_at, ticket.updated_at,
      ticket.resolved_at as "resolvedAt",
      (select count(*) from public.support_ticket_messages message where message.ticket_id = ticket.id) as "messageCount",
      (select max(message.created_at) from public.support_ticket_messages message where message.ticket_id = ticket.id) as "lastMessageAt"
    from public.support_tickets ticket
    join auth.users account on account.id = ticket.user_id
    where v_status is null or ticket.status = v_status
    order by ticket.updated_at desc
    limit v_limit
  ) item;

  return jsonb_build_object('tickets', v_items);
end;
$$;

create or replace function public.staff_get_support_thread(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket jsonb;
  v_messages jsonb;
begin
  if not public.is_app_staff() then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;

  select jsonb_build_object(
    'id', ticket.id,
    'email', lower(account.email),
    'category', ticket.category,
    'subject', ticket.subject,
    'registration', ticket.registration,
    'screenshotPath', ticket.screenshot_path,
    'pageUrl', ticket.page_url,
    'userAgent', ticket.user_agent,
    'status', ticket.status,
    'createdAt', ticket.created_at,
    'updatedAt', ticket.updated_at
  )
  into v_ticket
  from public.support_tickets ticket
  join auth.users account on account.id = ticket.user_id
  where ticket.id = p_ticket_id;

  if v_ticket is null then
    raise no_data_found using message = 'That support ticket no longer exists.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', message.id,
    'senderType', message.sender_type,
    'message', message.message,
    'createdAt', message.created_at
  ) order by message.created_at, message.id), '[]'::jsonb)
  into v_messages
  from public.support_ticket_messages message
  where message.ticket_id = p_ticket_id;

  return jsonb_build_object('ticket', v_ticket, 'messages', v_messages);
end;
$$;

create or replace function public.staff_update_support_ticket(
  p_ticket_id uuid,
  p_status text,
  p_response text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid := auth.uid();
  v_status text := trim(coalesce(p_status, ''));
  v_response text := nullif(trim(coalesce(p_response, '')), '');
begin
  if not public.is_app_staff() then
    raise insufficient_privilege using message = 'Check A Reg staff access is required.';
  end if;
  if v_status not in ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed') then
    raise invalid_parameter_value using message = 'Choose a valid ticket status.';
  end if;
  if v_response is not null and char_length(v_response) > 2000 then
    raise invalid_parameter_value using message = 'Replies must be 2,000 characters or fewer.';
  end if;

  update public.support_tickets
  set status = v_status,
      staff_response = coalesce(v_response, staff_response),
      responded_by = case when v_response is null then responded_by else v_staff_id end,
      responded_at = case when v_response is null then responded_at else now() end,
      resolved_at = case when v_status in ('resolved', 'closed') then coalesce(resolved_at, now()) else null end
  where id = p_ticket_id;

  if not found then
    raise no_data_found using message = 'That support ticket no longer exists.';
  end if;

  if v_response is not null then
    insert into public.support_ticket_messages (ticket_id, sender_id, sender_type, message)
    values (p_ticket_id, v_staff_id, 'staff', v_response);
  end if;

  return jsonb_build_object('updated', true, 'id', p_ticket_id, 'status', v_status);
end;
$$;

revoke execute on function public.touch_support_ticket_from_message() from public, anon, authenticated;
revoke execute on function public.seed_support_ticket_conversation() from public, anon, authenticated;
revoke execute on function public.staff_get_support_thread(uuid) from public, anon;
grant execute on function public.staff_get_support_thread(uuid) to authenticated;

revoke execute on function public.staff_list_support_tickets(text, integer) from public, anon;
revoke execute on function public.staff_update_support_ticket(uuid, text, text) from public, anon;
grant execute on function public.staff_list_support_tickets(text, integer) to authenticated;
grant execute on function public.staff_update_support_ticket(uuid, text, text) to authenticated;
