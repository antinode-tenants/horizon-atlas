# Agentic Workflows — Horizon Atlas starters

Upload these files in **Websites → Manage → Agentic Workflows** on your Horizon Atlas tenant.

## Knowledge (`.md`)

Upload each file under **Knowledge**:

| File | Purpose |
| --- | --- |
| `knowledge/horizon-atlas-overview.md` | What the demo app is and how visitors use it |
| `knowledge/vault-and-trail-weather.md` | Vault secret name, weather card, and trail journal tips |

## Skills (`.json`)

Upload each file under **Skills**:

| File | Slash command | What it does |
| --- | --- | --- |
| `skills/horizon-describe-session.json` | `/horizon-describe-session` | Returns live destination, entry count, vault + weather snapshot |
| `skills/horizon-list-entries.json` | `/horizon-list-entries` | Lists recent trail journal entries |

After upload, open amAIra on the signed-in site and try:

- `/horizon-describe-session`
- “What’s my current destination and how many entries do I have?”
- `/horizon-list-entries`

Each skill response includes a `note` field stating that these are **dummy demo skills for illustration only**.

## How the API skills work on a static site

Horizon Atlas is hosted on GitHub Pages — there is no backend server. The skills call paths under `/api/horizon-atlas/` on your site origin. `app.js` includes a small **fetch shim** that answers those routes from in-browser state (journal entries, weather card, vault status).

When you build your own product, replace these paths with real API routes on your server. Keep the same skill JSON shape (`kind: api`, `invoke.path`, optional `tags` like `auto_refresh`).

## Also wire in your app

1. Mount amAIra: `antinode.ai.mount('#antinode-ai')`
2. After journal or weather state changes, call `antinode.ai.notifyContextChanged('#antinode-ai')` so conversational skills stay fresh (already wired in this demo’s `app.js`).
