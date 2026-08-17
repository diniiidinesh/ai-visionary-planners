# Make AI provider selection reachable from the profile menu

Today the AI Settings page exists at `/ai-settings` with Provider and Model dropdowns for both search and summarization, but nothing in the app links to it — that's why it looks like there's no option. `AIConfigManager` already reads those saved preferences and picks the matching API key server-side.

## What will change

1. **Profile menu entry** — the avatar dropdown in the Search header gets an "AI Settings" item (above Sign out) that navigates to `/ai-settings`. Available to every signed-in user.
2. **Active provider indicator** — the AI Settings page shows a small read-only status line per section: which provider/model is currently in effect and whether a key for that provider is configured, so the choice isn't a blind one.
3. **Clearer copy** — a short note on the page explaining that keys are managed centrally at the project level; users choose the provider, not the key value. No key input fields are added (per your earlier decision to keep them out of the UI).
4. **Back navigation** — the existing back arrow returns to `/search`.

## Not included

- Per-user API key entry fields (still hidden).
- Embeddings still use the Lovable gateway regardless of this setting; changing that needs a full re-index and can be a separate task.

## Technical notes

- `src/pages/Search.tsx`: add a `DropdownMenuItem` with a settings icon calling `navigate("/ai-settings")`.
- `src/pages/AISettings.tsx`: add a key-availability badge fed by a lightweight status call, plus explanatory copy. Route already registered in `src/App.tsx`.
- A small edge function (or an addition to an existing one) returns booleans only — whether `OPENAI_API_KEY` / `GOOGLE_API_KEY` are set, and whether a per-user vault key exists — never key values.
