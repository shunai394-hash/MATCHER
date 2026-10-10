# Ingestion operator access

The scan endpoint can call supplier APIs and write to Supabase, so it is restricted to an operator session.

## Production setup

1. Open the MATCHER project in Vercel and choose **Settings → Environment Variables**.
2. Add `MATCHER_INGESTION_ADMIN_TOKEN` for **Production**. Use a cryptographically random value with at least 32 characters. Generate it locally; do not paste it into chat, issues, logs, or source control.
3. Redeploy Production so the serverless functions receive the variable.
4. Open the site and enter the same token in the **運用者認証** field. The server validates it and sets an HTTP-only, Secure (in production), SameSite=Strict cookie with an eight-hour lifetime. The browser does not persist the token.
5. Verify that an unauthenticated `POST /api/ingestion/scan` returns `401 INGESTION_AUTH_REQUIRED`, and that authenticated scans work.

If the variable is missing or shorter than 32 characters, scans fail closed with `503 INGESTION_AUTH_NOT_CONFIGURED`. Do not weaken this fallback to public access.

## Local token generation

Run this locally and copy the output directly into your local environment configuration:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Never commit the generated value.
