# Supabase

Future server-side Supabase client factories and data access belong here.
`@supabase/supabase-js` is installed, but no client is initialized yet.

Copy the API's `.env.example` to `.env.local` when configuring a project.
The public URL and anon key are placeholders; both can remain empty today.
Keep future service-role or secret keys in server-only modules and unprefixed
API environment variables. Never import this directory from the mobile app or
shared contracts package. Add session-aware clients when auth is actually built.
