# Nexui auth: setup checklist and original implementation plan

Authentication is implemented. This document retains the original setup decisions
and implementation plan; statements below about the pre-auth scaffold are historical.
For current code behavior, see [Authentication](../architecture/authentication.md).

## Context

Nexui needs user accounts. Right now `POST /api/intent` (`apps/api/src/app/api/intent/route.ts`) has no authentication, and CORS is `*`. The Expo app (`apps/mobile`) has no concept of a user. The goal is Supabase Auth on **iOS and Android**, with the API deployed on **Vercel**.

**Rollout, revised 2026-09-23:**

- **v1:** email one-time code and Google.
- **Fast-follow (v1.1):** Apple. Apple is processing the Apple Developer Program enrollment (individual), which takes 1–3 days. Apple setup and code move to Part C, so nothing in v1 waits on Apple.

Decisions already made:

- **Email:** a 6-digit code that the user types in, not a clickable link. Supabase's "magic link" API sends it, and we change the email template so it shows the code.
- **Google, and Apple later:** use each platform's built-in sign-in sheet, which returns an ID token that we pass to `supabase.auth.signInWithIdToken`.
- **Web:** not in scope.

What waiting on Apple enrollment means:

- **iOS testing uses the Simulator only** until enrollment finishes. EAS builds for a physical iPhone need a paid Apple account to sign them; Simulator builds don't. Android builds work on a physical device right away.
- **No App Store / TestFlight submission until Apple ships.** App Store Guideline 4.8 says that an app offering Google sign-in on iOS must also offer Sign in with Apple, or an equivalent privacy-preserving option. v1 is therefore for internal testing on iOS. On Android, Play internal testing is fine.
- **Bundle ID is chosen now, registered later.** The Google iOS client only needs the bundle ID as text, so choosing it now is enough.

Current repo facts that affect setup:

- `apps/mobile/app.json` has `scheme: "nexui"` but **no `ios.bundleIdentifier` or `android.package`**.
- The app appears to run in Expo Go. Native Google sign-in **does not work in Expo Go**, so you need an EAS development build.
- `@supabase/supabase-js` is already a dependency of the API. `apps/api/src/lib/supabase/README.md` is the placeholder for server code.

---

## Part A: v1 manual steps (can do now, no Apple account needed)

Record every 📋 value; A9 collects them.

### A1. Pick your permanent app identifiers

- 📋 **iOS bundle ID** and **Android package name**, e.g. `ai.nexui.app`. Use the same string on both platforms. It becomes permanent once registered. Reverse-DNS IDs don't require owning the domain.
- Keep the URL scheme `nexui`.

### A2. Supabase projects

1. Create **two** projects, `nexui-dev` and `nexui-prod`, in a region near your Vercel function region (e.g. `us-east-1` next to `iad1`).
2. In each project, open **Settings → API Keys** and record:
   - 📋 Project URL
   - 📋 **Publishable key** (`sb_publishable_…`)
   - 📋 **Secret key** (`sb_secret_…`, server only)
     Create the new keys if only the old `anon`/`service_role` keys exist.
3. In **Settings → JWT Keys**, switch to **asymmetric signing keys (ES256)**.
4. In **Authentication → Sign In / Providers**, turn on "Allow new users to sign up" and "Confirm email".
5. In **Authentication → URL Configuration**:
   - Site URL: `nexui://`
   - Redirect URLs: `nexui://**`

### A3. Email OTP (code) setup

**No domain yet (decided 2026-09-23).** v1 sends from a provider's sandbox sender. The trade-off is that email codes reach only you, so other testers sign in with Google until a domain is bought.

1. **SMTP provider: Resend sandbox.** Create a Resend account with the email address you'll test with, then create an API key. You don't need to verify a domain or add DNS records.
   - 📋 Host `smtp.resend.com`, port `465`, username `resend`, password = the API key
   - 📋 Sender address `onboarding@resend.dev`, sender name `Nexui`
   - Limitation: the sandbox sender only delivers to the email address that owns the Resend account.
   - To test with several addresses, use a **Mailtrap Email Sandbox** inbox instead (`sandbox.smtp.mailtrap.io`, port `2525`, credentials from the inbox's SMTP settings). Mailtrap accepts mail to any address and shows it in its web inbox instead of delivering it.
   - Don't use Supabase's built-in sender. It only sends to members of your Supabase org and allows about 2 emails an hour.
2. In Supabase **Authentication → Emails → SMTP Settings**, enable custom SMTP with those values. Only `nexui-dev` needs it now.
3. In **Templates**, edit **Magic Link** and **Confirm signup** so each shows `{{ .Token }}` instead of `{{ .ConfirmationURL }}`, e.g.
   `<h2>Your Nexui code</h2><p>{{ .Token }}</p><p>Expires in 10 minutes.</p>`
4. In **Rate Limits**, raise the email limits now that you use your own SMTP.
5. In **Sign In / Providers → Email**, set **Email OTP Length** to `6` and the expiry to e.g. 600 s. New projects default to 8 digits, which the app rejects.

**When you buy a domain (before external email testers or launch):**

- Verify the domain in Resend (SPF, DKIM and DMARC records).
- Change the sender to e.g. `auth@<domain>` in both Supabase projects and configure SMTP in `nexui-prod`.
- The code doesn't change, because SMTP lives entirely in Supabase.

### A4. Google Cloud: Google sign-in (native, iOS and Android)

1. console.cloud.google.com → create the project `nexui`.
2. **Google Auth Platform → Branding / OAuth consent screen**:
   - User type: External.
   - Scopes: `openid`, `email` and `profile` only.
   - Add yourself as a test user.
   - Leave the homepage, privacy policy and authorized domain fields blank. The app stays in **Testing** mode, which allows up to 100 test users.
   - **Publish to Production** waits for a domain, because Google requires those URLs on a domain you verify. `*.vercel.app` can't be verified.
3. **Clients → Create client**:
   - **Web application.** Supabase and the mobile `webClientId` use it. 📋 Client ID and 📋 secret.
   - **iOS**, with your bundle ID. This works without Apple enrollment. 📋 Client ID and 📋 reversed client ID.
   - **Android**, with your package name plus a SHA-1. Create one Android client per signing key:
     - The EAS dev keystore (after A5).
     - The Play App Signing key (later).
4. In Supabase **Auth → Providers → Google**:
   - Enable it.
   - Client IDs: paste the **web, iOS and Android** IDs, comma-separated, **web ID first**.
   - Paste the web client secret.
   - Enable "Skip nonce check" only if iOS sign-in fails with a nonce error.

### A5. Expo / EAS

1. Create an expo.dev account. Run `npm i -g eas-cli`, then `eas login`.
2. The code phase adds `eas.json`. Its `development` profile builds for the **iOS Simulator** (`ios.simulator: true`) and for Android devices.
3. Run `eas build --profile development --platform android`. Get the keystore's SHA-1 from `eas credentials`, then create the Android OAuth client (A4.3).
4. Run `eas build --profile development --platform ios`. This Simulator build doesn't need Apple credentials.
5. From then on, use `pnpm dev:mobile` with the installed dev build, not Expo Go.

### A6. Vercel (API)

1. Import the repo:
   - Root Directory `apps/api`, framework Next.js.
   - Install command `pnpm install`.
   - Node 24.
2. Environment variables:
   - Production: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` from **prod**.
   - Preview and Development: the same two from **dev**.
   - Also copy over `AI_PROVIDER`, `AI_GATEWAY_API_KEY`, `NEXUI_INTENT_MODEL` and `NEXUI_INTENT_TIMEOUT_MS`.
   - Add `SUPABASE_SECRET_KEY` for account deletion.
3. 📋 Production API URL.

### A7. Legal and store prerequisites

- Privacy policy URL and terms URL. These are deferred until you buy a domain. Google needs them to publish the consent screen, and App Store Connect needs them to submit. Internal testing works without them.
- Play Console: create the app when you're near release, then add the Play App Signing SHA-1 Android client.
- App Store Connect: deferred to Part C.

### A8. Checks before starting on code

- Use Supabase **Auth → Users → "Send magic link"** to email yourself (the Resend account's address). It should arrive from `onboarding@resend.dev`, or in the Mailtrap inbox, and show a 6-digit code.
- Email and Google are enabled in `nexui-dev`. `nexui-prod` can wait until you have a domain. Apple stays **disabled** for now.

### A9. Hand-off: values the code phase needs

| Value                                 | Where it goes                             |
| ------------------------------------- | ----------------------------------------- |
| Bundle ID / package name              | `app.config.ts`                           |
| Supabase URL + publishable key (dev)  | `apps/mobile/.env`, `apps/api/.env.local` |
| Supabase URL + publishable key (prod) | EAS env (production), Vercel Production   |
| Supabase secret key (dev)             | `apps/api/.env.local` only                |
| Google web client ID                  | mobile `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| Google iOS client ID + reversed ID    | mobile env + google-signin config plugin  |
| Vercel prod URL                       | EAS production `EXPO_PUBLIC_API_URL`      |

---

## Part B: v1 code phase (email code + Google)

1. **Shared contracts** (`packages/types/src/index.ts`): Zod schemas for the email-code request and verification inputs, plus `authErrorSchema`.
2. **Mobile**
   - Convert `app.json` to `app.config.ts`. Add the bundle ID and package name, and the `@react-native-google-signin/google-signin` and `expo-secure-store` plugins. **No Apple plugin or entitlement yet.**
   - Add `eas.json`, with the iOS Simulator setting in the `development` profile.
   - Add `src/lib/supabase.ts`: a Supabase client that stores the session in secure-store, with `autoRefreshToken` and an AppState start/stop for refreshing.
   - Add `src/stores/use-session-store.ts` (Zustand) listening to `onAuthStateChange`.
   - Routes:
     - `(auth)/sign-in.tsx`: email field and Google button, laid out so an equally prominent Apple button can go next to Google later.
     - `(auth)/verify.tsx`: code entry.
     - Move `index.tsx` into an `(app)` group guarded in `_layout.tsx`.
   - Email flow: `signInWithOtp({ email })`, then `verifyOtp({ email, token, type: 'email' })`.
   - Google flow: `GoogleSignin.signIn()`, then `signInWithIdToken({ provider: 'google', token: idToken })`.
   - `src/lib/api.ts`: attach a Bearer token to `classifyIntent`. On a 401, refresh once and retry.
   - Add sign-out and delete-account controls. Deletion is required by App Store rules, so it ships in v1.
3. **API**
   - `src/lib/supabase/verify-request.ts`: verify the Bearer token with `supabase.auth.getClaims(token)` and return `{ userId, email }` or a 401.
   - `api/intent/route.ts`: require auth. Add `Authorization` to the CORS allowed headers.
   - `api/health` stays public.
   - `api/account/route.ts` (`DELETE`): delete the user through the admin API with the secret key.
   - Update both `.env.example` files.
4. **Tests** (`tests/*.test.mjs`, `pnpm test`): cover verify-request with valid, missing, malformed and expired tokens, and check that the intent route returns 401 without a token.

### v1 verification

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check`.
- `curl` the intent route without a token and expect 401; with a valid token, expect 200. `/api/health` should still return `{"status":"ok"}`.
- On the iOS Simulator and an Android device, test the email code and Google end to end, and check that the users appear in Supabase.
- The session persists after the app is killed. Sign-out returns to sign-in. Delete-account removes the user.

---

## Part C: Apple fast-follow (after enrollment is approved)

### C1. Manual steps

1. Wait for the enrollment confirmation email. 📋 **Team ID** (top right of the developer portal).
2. **Identifiers → +**: register the App ID with the bundle ID from A1 and tick **Sign in with Apple**.
3. In Supabase **Auth → Providers → Apple**, in both projects: enable it and put the **bundle ID** in "Client IDs". Native iOS needs no Services ID or secret.
4. Register your iPhone with `eas device:create`. The next iOS device build lets EAS manage certificates and profiles.
5. Create the App Store Connect app record with the same bundle ID.
6. Apple sign-in on Android stays out of scope. It would need a Services ID, a `.p8` key, and a client secret that expires every 6 months.

### C2. Code

- Add the `expo-apple-authentication` plugin and set `ios.usesAppleSignIn: true` in `app.config.ts`.
- Add a `device` profile to `eas.json` (or turn off the simulator flag) for physical-iPhone builds.
- On iOS only, add the Apple button with the same prominence as Google.
  - Flow: `AppleAuthentication.signInAsync` with a SHA-256-hashed nonce, then `signInWithIdToken({ provider: 'apple', token, nonce })`.
  - Save the full name to the user metadata on the first sign-in, because Apple sends it only once.
- No API changes. `verify-request` is provider-agnostic.

### C3. Verification and release gate

- Test Apple sign-in end to end on a physical iPhone and the Simulator.
- Signing in with Google and then Apple using the same email links both to one user. A Hide My Email address creates a separate user, which is expected.
- Only after this: TestFlight and App Store submission.
