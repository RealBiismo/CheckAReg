create index if not exists user_ban_audit_admin_created_idx
on private.user_ban_audit (admin_id, created_at desc);
