# Reframe

Draw what you're building, answer a short interview about it, get a prompt your coding agent (Claude Code, Codex, Cursor…) can build from. Live at [reframe-liard.vercel.app](https://reframe-liard.vercel.app). Design and decisions: [`docs/DESIGN.md`](docs/DESIGN.md).

The canvas is the whole window (Excalidraw, themed with the app's own tokens). Everything else floats over it: ☰ for drawings, export, model & key, theme, sign-in and shortcuts; the drawing's name and **✦ Generate prompt** top-right; the interview panel, the drawings list, search and the shape library as floating cards. Works on phones (the panel goes full-screen, options are tap-sized).

## Local development

```bash
pnpm install
pnpm convex          # terminal 1 — logs in, creates a dev deployment, pushes convex/
pnpm dev             # terminal 2 — Next.js on http://localhost:3000
```

`pnpm convex` writes `CONVEX_DEPLOYMENT` and `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Add the `.site` origin yourself (see `.env.example`):

```
NEXT_PUBLIC_CONVEX_SITE_URL=https://<deployment>.convex.site
```

Then set the deployment's own env:

```bash
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set SITE_URL http://localhost:3000
```

Open the app, draw (or *Load an example drawing*), click **✦ Generate prompt**, paste an API key when the panel asks (it stays in your browser), then **Start the interview**.

## Scripts

| Command | What |
|---|---|
| `pnpm test` | Serializer unit tests over `fixtures/*.excalidraw` |
| `pnpm dump-graph fixtures/x.excalidraw` | Print what the model sees for a drawing |
| `pnpm eval [fixture] [--brief]` | Interview evals: simulated author + judge (needs `ANTHROPIC_API_KEY` in env or `.env.local`) |
| `pnpm build` | Static export to `out/` |

## Sign-in with GitHub / Google (optional)

Visitors are signed in anonymously; a provider lets them keep projects across devices. Buttons appear only when a provider's credentials are set on the Convex deployment.

1. Create an OAuth app. The callback URL is on the **Convex** origin, not the app's:
   `https://<deployment>.convex.site/api/auth/callback/github` (or `/google`).
2. `npx convex env set GITHUB_CLIENT_ID … && npx convex env set GITHUB_CLIENT_SECRET …` (same for `GOOGLE_*`).

Use separate OAuth apps for the dev and prod deployments.

## Deploy (Vercel + Convex prod)

1. `npx convex deploy` once locally to create the prod deployment, then in the Convex dashboard set `BETTER_AUTH_SECRET`, `SITE_URL=https://<your-vercel-domain>`, and any OAuth credentials.
2. In Vercel: import the repo, framework Next.js, and set
   - Build command: `npx convex deploy --cmd 'pnpm build'`
   - Env `CONVEX_DEPLOY_KEY` (Convex dashboard → Settings → Deploy keys, production)
   - Env `NEXT_PUBLIC_CONVEX_SITE_URL=https://<prod-deployment>.convex.site`

   `convex deploy --cmd` pushes `convex/` to prod and injects `NEXT_PUBLIC_CONVEX_URL` into the build.
3. Update `SITE_URL` (and OAuth callback origins) whenever the Vercel domain changes.

Gotchas seen on the first deploy:

- Set `BETTER_AUTH_SECRET` **before** the first request reaches the prod deployment. Better Auth encrypts its signing key with whatever secret is live at that moment; changing the secret afterwards makes every token request fail with "Failed to decrypt private key". Recovery: dashboard → Data → component `betterAuth` → table `jwks` → delete the row.
- `npx convex env set` takes a literal value; `$(openssl …)` only expands in bash. From cmd:
  `for /f "usebackq" %s in (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`) do npx convex env set --prod BETTER_AUTH_SECRET %s`
- Google's Branding page requires a privacy-policy URL before the app can be published; `/privacy` exists for that.

### Going-to-production checklist (OAuth)

- [x] Register a **prod** GitHub OAuth app with callback `https://<prod-deployment>.convex.site/api/auth/callback/github`; set `GITHUB_CLIENT_ID/SECRET` on the prod Convex deployment.
- [x] Register a **prod** Google OAuth client (same Google Cloud project is fine — the consent screen is shared): redirect URI `https://<prod-deployment>.convex.site/api/auth/callback/google`, JavaScript origins `https://<prod-deployment>.convex.site` and `https://<your-app>.vercel.app`; set `GOOGLE_CLIENT_ID/SECRET` on prod.
- [x] Google consent screen: click **Publish app** and confirm. Until then it is in Testing mode and only listed test users can sign in — on the live site too. With only the `openid`/`email`/`profile` scopes Better Auth requests, no verification review is needed; it takes effect immediately.
- [ ] Projects are capped at `MAX_PROJECTS_PER_USER` (`convex/projects.ts`) since scene/PNG storage is billed to the deployment; adjust before launch if needed.
