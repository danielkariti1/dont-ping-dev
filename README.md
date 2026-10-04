# DON'T PING DEV 🚨

**Can the Agent handle it?** is a seven-question, phone-first booth game. Players scan a QR code, decide whether to **ASK THE AGENT** or **PING A DEV**, and appear on a shared leaderboard.

The project has two modes:

| Mode | Score storage | Good for |
| --- | --- | --- |
| Local demo | The current browser's `localStorage` | Previewing the game on one machine |
| Booth mode | Supabase Postgres, through the `game-api` Edge Function | A real event with many phones and one shared winner |

The production score is calculated by the Edge Function. The phone never gets permission to insert or edit leaderboard rows directly.

This checkout is already connected to the live Supabase backend in `config.js`. The included key is a browser-safe publishable key—not a database password or server key—and local games currently write to the clean `tech-market-2026-live` leaderboard. The earlier integration-test score remains isolated under `tech-market-2026`.

## What is included

- `index.html` — the phone game
- `leaderboard.html` — the live booth display and QR code
- `config.js` — public event and Supabase settings
- `questions.js` — the browser's demo question bank
- `supabase/migrations/202610040001_create_game_tables.sql` — tables, constraints, and row-level security
- `supabase/functions/game-api/` — authoritative questions, score calculation, and leaderboard API
- `.github/workflows/pages.yml` — tests and GitHub Pages deployment
- `tests/` — dependency-free checks and the safe Pages packaging script

## 1. Preview it locally

No package installation is needed for the frontend.

1. Open a terminal in this `dont-ping-dev` directory.
2. Start a small local web server:

   ```powershell
   py -m http.server 8765
   ```

   If `py` is not available, use `python -m http.server 8765`.

3. Open [http://localhost:8765/](http://localhost:8765/) for the game.
4. Open [http://localhost:8765/leaderboard.html](http://localhost:8765/leaderboard.html) for the booth screen.

The live backend allows both `http://localhost:8765` and `http://127.0.0.1:8765`. Because `config.js` already contains the live Edge Function URL, this preview runs in booth mode and its scores are shared across devices. Use a new `eventId` for rehearsals if you do not want test scores mixed into the event leaderboard.

For a single-browser demo with no shared score, temporarily make `edgeFunctionUrl` an empty string. Restore the live value before publishing. In demo mode, scores stay in that browser's `localStorage`; another phone will not see them.

To run the automated checks with Node.js 18 or newer:

```powershell
node --test tests/*.test.mjs
```

## 2. Reuse or recreate the shared Supabase backend

The current backend is already deployed, migrated, and connected. Follow this section only when recreating it, moving it to another Supabase project, or updating the database/function code.

Create a project at [database.new](https://database.new/). Keep the project reference shown in **Project Settings → General**; it is the short identifier used in the commands below.

For a company booth, the Supabase Free plan should normally be ample: it currently includes a 500 MB database and 500,000 Edge Function calls per month. Free projects with low activity over a seven-day period may be paused, so resume the project and run the dry test shortly before the event. Check the [current billing limits](https://supabase.com/docs/guides/platform/billing-on-supabase) and [project-pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing) before launch.

### Apply the database migration

The easiest no-CLI option is:

1. In the Supabase dashboard, open **SQL Editor**.
2. Create a new query.
3. Copy the complete contents of `supabase/migrations/202610040001_create_game_tables.sql` into it.
4. Run the query once.

The repeatable CLI option is:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migration creates `game_sessions` and `game_answers`, enables Row Level Security, and gives browser roles no direct table access.

### Deploy the Edge Function

From the same directory:

```powershell
npx supabase functions deploy game-api --project-ref YOUR_PROJECT_REF
```

Supabase automatically provides the function with its project URL and server-side key. Do **not** copy a secret key or legacy `service_role` key into `config.js`, GitHub, or a phone.

### Allow the game website origin

Set the exact origins that may call the function. An origin contains the scheme and hostname, but not a page path. For example, the origin for `https://daniel.github.io/dont-ping-dev/` is `https://daniel.github.io`.

The live project currently allows these three origins:

- `http://127.0.0.1:8765`
- `http://localhost:8765`
- `https://danielkariti1.github.io`

To reproduce that allowlist on a replacement project:

```powershell
npx supabase secrets set ALLOWED_ORIGINS="http://127.0.0.1:8765,http://localhost:8765,https://danielkariti1.github.io" --project-ref YOUR_PROJECT_REF
```

For a different GitHub account, replace the GitHub origin with `https://YOUR_GITHUB_NAME.github.io`. If the booth will use a custom domain, add that exact origin too. Redeploying is not required after changing an Edge Function secret.

## 3. Connect the browser to Supabase

`config.js` is already connected to the live project. When connecting a replacement project or a fork, update it using this shape:

```js
window.DPD_CONFIG = Object.freeze({
  eventId: "tech-market-2026-live",
  eventName: "Tech Market 2026",
  roundSeconds: 7,
  questionCount: 7,
  feedbackDelayMs: 1450,
  leaderboardPollMs: 5000,
  leaderboardSize: 20,
  edgeFunctionUrl: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/game-api",
  supabaseAnonKey: "YOUR_PUBLISHABLE_OR_LEGACY_ANON_KEY",
  gameUrl: "https://danielkariti1.github.io/dont-ping-dev/"
});
```

Find the browser-safe publishable key in **Supabase Dashboard → Project Settings → API Keys**. A legacy `anon` key also works. These browser keys are intentionally public; their permissions are controlled by the backend. A secret key and a `service_role` key are never browser-safe.

Configuration notes:

- `eventId` is the score partition. Use 2–40 lowercase letters, digits, or hyphens, beginning with a letter or digit.
- Change `eventId` for each competition, for example `tech-market-morning` and `tech-market-afternoon`.
- The current `gameUrl` is fixed to `https://danielkariti1.github.io/dont-ping-dev/`, so the booth QR always opens the hosted phone game. Change it if the repository name or deployment URL changes.
- A blank `edgeFunctionUrl` intentionally returns the app to single-browser demo mode.

## 4. Publish on GitHub Pages

Make `dont-ping-dev` the root of a GitHub repository, then commit and push it to the `main` branch. For example:

```powershell
git init
git add .
git commit -m "Launch DON'T PING DEV booth game"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

In the GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **GitHub Actions** as the source.
3. Open the **Actions** tab and wait for **Test and deploy the game** to finish.

The included workflow tests the question bank and references, creates a public-only artifact, and deploys it. It deliberately leaves `supabase/`, `tests/`, and documentation out of the website artifact.

The resulting pages are:

- Game: `https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/`
- Booth screen: `https://YOUR_GITHUB_NAME.github.io/YOUR_REPOSITORY/leaderboard.html`

Put the booth screen on the large display. Its QR code points players to `gameUrl`; the plain link remains available if the QR library is blocked by the venue network.

## 5. Run a booth dry run

Test from the actual venue network before the event:

1. Open the leaderboard on the booth computer and keep that tab awake.
2. Scan the QR with at least two different phones—ideally one on Wi-Fi and one on cellular data.
3. Complete one strong and one weak game; verify both appear and are sorted correctly.
4. Try the same player and team name twice. The first official attempt is kept for that event.
5. Let one question time out and verify the round continues.
6. Refresh both the phone and leaderboard pages.
7. Check browser audio permissions. Sound begins only after the player presses **START**, which satisfies normal mobile autoplay rules.
8. Test again on the event morning. A quiet free Supabase project may need a moment to become active.

If every device says demo mode, `edgeFunctionUrl` is blank or the deployed `config.js` is stale. If the game reports a network/CORS error, confirm `ALLOWED_ORIGINS` contains the page's exact origin and that `gameUrl` uses the correct repository path.

## Scoring and winner rules

Every official round contains the same seven questions—one from each category—in a shuffled order. The backend is the authority that validates every answer and calculates the score.

The leaderboard sorts by:

1. More correct answers
2. Shorter total duration
3. Earlier completion time

The result titles are:

| Correct | Title |
| ---: | --- |
| 7 | Legendary Developer Bodyguard |
| 6 | Developer Protector |
| 4–5 | Context-Switch Defender |
| 2–3 | Recovering Pinger |
| 0–1 | Serial Developer Pinger |

The phone shows seven seconds. The server allows a small transport grace window, then marks a late response wrong even if someone modifies the browser UI.

One normalized player/team identity gets one official session per `eventId`. A different spelling can still look like a different person, so for a prize event have a booth host confirm the winner's display name. This is strong protection against accidental or casual score editing, not identity verification for a high-stakes contest.

The product message is: **stop using developers as a search engine**. Questions involving implementation, production incidents, risk acceptance, or accountable decisions still belong with humans.

## Start a fresh leaderboard

The safest reset is to change `eventId` in `config.js` and deploy again. The old results remain available in Supabase but no longer appear in the new event.

If you intentionally want to permanently erase one event, first inspect the count in Supabase SQL Editor:

```sql
select count(*)
from public.game_sessions
where event_id = 'tech-market-2026-live';
```

Then, only after verifying the exact event ID, run:

```sql
delete from public.game_sessions
where event_id = 'tech-market-2026-live';
```

Related answers are deleted automatically by the foreign key's `on delete cascade`. This deletion cannot be undone unless you have a backup.

## Fairness, privacy, and security

- Use the same `eventId`, seven categories, timer, and deployed version for every competitor.
- Keep the booth network and device charging situation consistent where possible; duration is a tie-breaker and network latency can have a small effect.
- Ask for a display name and optional team only. Do not enter customer names, transaction data, account data, or production identifiers.
- Scores and display names are stored in the selected Supabase region. Follow company approval and retention rules for external services.
- The public frontend key is acceptable in `config.js`; a secret or `service_role` key is not.
- CORS limits normal browser origins but is not authentication. The function also validates question sequence and computes every official score server-side.
- Row Level Security and grants block browsers from writing the database directly.
- The GitHub Pages packaging step excludes the server function source from the public artifact.
- The local demo question file contains the same answers, so a determined player can inspect the public page source. Treat this as a fun booth competition, not a high-stakes or prize-money identity system.
- Delete the event rows after the winner is confirmed if the data no longer needs to be retained.

## Useful official documentation

- [Supabase database migrations](https://supabase.com/docs/guides/local-development/database-migrations)
- [Deploying Supabase Edge Functions](https://supabase.com/docs/guides/functions/deploy)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [GitHub Pages with a custom Actions workflow](https://docs.github.com/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
