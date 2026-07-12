-- ============================================================
-- Add a second platform superadmin (dev partner). Same allowlist-by-email
-- mechanism as 0022: is_platform_admin() matches the caller's CONFIRMED
-- auth.users email to a row here. Declan just needs to sign up + confirm with
-- this email and he gets the platform console (provision/approve), above org roles.
-- No self-promotion path exists — this insert is the only way in.
-- ============================================================

insert into platform_admins (email) values ('declanmulligan19@gmail.com')
  on conflict do nothing;
