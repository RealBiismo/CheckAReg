-- Low-risk database hardening found during the Check A Reg reliability sweep.

create index if not exists ai_question_reservations_case_id_idx
  on private.ai_question_reservations(case_id);
create index if not exists app_moderators_added_by_idx
  on private.app_moderators(added_by);
create index if not exists staff_support_notes_staff_user_id_idx
  on private.staff_support_notes(staff_user_id);
create index if not exists ai_mechanic_cases_vehicle_id_idx
  on public.ai_mechanic_cases(vehicle_id);
create index if not exists ai_mechanic_messages_user_id_idx
  on public.ai_mechanic_messages(user_id);

drop policy if exists ai_mechanic_cases_select_own on public.ai_mechanic_cases;
create policy ai_mechanic_cases_select_own
  on public.ai_mechanic_cases for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ai_mechanic_messages_select_own on public.ai_mechanic_messages;
create policy ai_mechanic_messages_select_own
  on public.ai_mechanic_messages for select to authenticated
  using (user_id = (select auth.uid()));
