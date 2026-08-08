# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Noticed is a Next.js (App Router) web app that helps someone stay in touch with the people they love. The user talks or types about their week; an LLM extracts the people and details mentioned and stores them. Periodically the app surfaces one person and a small, specific, free gesture worth doing for them (never a to do list, never a scripted message).

## Commands

```
npm install       # install dependencies
npm run dev        # start dev server at http://localhost:3000
npm run build       # production build
npm run start       # run the production build
```

There is no lint script, no test suite, and no `next.config.js` in this repo currently.

## Environment

Copy `.env.local.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase project the app persists to.
- `ANTHROPIC_API_KEY` — server-only, used by `app/api/engine/route.js`. Never referenced from client code.

## Architecture

The whole app is essentially three files:

- **`app/page.js`** — a single client component (`"use client"`) that is the entire UI: sign in/sign up, onboarding ("threshold"), the capture view ("Keep"), the daily gesture view ("Today"), and the people list/editor. Gating order on load is: wait for `authChecked` → if no `session`, show the sign in/sign up screen → wait for that user's data to load (`loaded`) → if `!db.onboarded`, show the threshold slides → normal app. All view state is local React state; there is no router/multi-page navigation, no component library, and styling is done with inline JS style objects (`S = {...}`) defined at the top of the render, not CSS files or a CSS-in-JS library. `components/` exists but is currently empty — if the page is split up, this is where pieces would go.
- **`app/api/engine/route.js`** — the only server route. It proxies prompts to the Anthropic Messages API, trying a list of models in order (`MODELS` array) and falling back to the next on error, since `POST` requests here must not leak the API key to the browser. Callers (`page.js`'s `ask()`) always send a single freeform `prompt` string and expect the reply's text content back as `{ raw }`; the caller is responsible for JSON-parsing `raw` itself (with a regex-based recovery pass if the model wraps JSON in prose/backticks).
- **`lib/supabase.js`** — accounts and persistence. Login is real Supabase Auth (email + password): `signUp`/`signIn`/`signOut`/`getSession`/`onAuthChange` wrap `supabase.auth.*`. Each signed-in user's app state is stored as a single JSON blob in the `noticed_state` Supabase table, keyed by `user_key` (which now holds their `auth.uid()`, not a browser-generated id). `loadState`/`saveState` read and upsert that whole blob. Privacy is enforced at the database level via Row Level Security — see `supabase/rls_policies.sql`, which must be run once against the Supabase project (SQL Editor) for the policies to take effect; without it the anon key can technically read any row.

### State shape

The persisted `db` object (see `useState` in `page.js`) has the shape:

```
{ people: [...], weeks: [...], gesture: null|{...}, restedOn: null|"YYYY-MM-DD", user: null|string, onboarded: bool }
```

- `people[]` — each person has `id`, `name`, `label` (nickname), `who`, `carries`, `loves`, `threads[]` (verbatim true things, capped at 30), `birthday`, `last` (ISO timestamp of last contact), `upcoming[]` ({what, when}), `hardDates[]` ({what, date}, e.g. anniversaries of hard things).
- `weeks[]` — raw log of everything the user has ever told the app (`{at, text}`), append only.
- `gesture` — today's surfaced person + suggestion from the engine, cleared once acted on or dismissed.

### The two LLM calls

Both live in `page.js` and go through `ask()` (which POSTs to `/api/engine` and JSON-parses the reply):

1. **`keep()`** — takes freeform speech/text about the user's week, asks the engine to extract/update people (matching to existing people by name where obvious), merges the result into `db.people`.
2. **`summon()`** — given one person (chosen by `pick()`, a local scoring heuristic over drift/birthdays/upcoming events/hard-date anniversaries, no LLM involved in the choice itself), asks the engine for a specific, costless, non-scripted gesture to do for them.

Prompts intentionally instruct the model to never write sendable messages for the user, never use hyphens/dashes, and keep things specific and human rather than generic reminders — preserve this tone/constraint set if you touch these prompts.

`pick()` runs once per day per signed-in session (gated by `asked.current` + `db.gesture?.date`/`db.restedOn` checks in the `useEffect` in `page.js`) — it is not a cron job or server-side scheduler.

### Voice input

Capture supports the Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`) for dictation, with a plain `<textarea>` fallback when unsupported (`supported` state, checked once on mount).
