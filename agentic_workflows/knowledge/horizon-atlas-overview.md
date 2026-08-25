---
id: horizon-atlas-overview
title: Horizon Atlas overview
summary: Weekend trail journal demo — sign-in, vault weather, and amAIra chat.
kind: product
tags: onboarding, demo, horizon-atlas
---

# Horizon Atlas

Horizon Atlas is a **static weekend trail journal** built on Antinode. Visitors sign in with Google, save ridge notes locally, load trail weather using a vault API key, and chat with embedded **amAIra**.

## What visitors can do

- **Sign in** — unlock the journal workspace and amAIra chat.
- **Save trail notes** — destination, date, and a short body; stored in the browser (up to 20 recent entries).
- **Refresh weather** — uses the tenant secret `HORIZON_WEATHER_KEY` from the Antinode vault (Open-Meteo geocoding + forecast).
- **Open amAIra** — floating chat button after sign-in; supports Agentic Workflows skills and knowledge.

## Agentic Workflows on this site

- **Knowledge** — product copy like this document grounds answers in how the demo works.
- **Skills** — API actions such as `horizon-describe-session` and `horizon-list-entries` return live JSON from the page.

When users ask about “my session”, “current destination”, or “recent entries”, prefer **horizon-describe-session** or **horizon-list-entries** instead of guessing.

## Support tone

Keep answers friendly and outdoorsy. This is a demo — if vault weather is missing, remind them to add `HORIZON_WEATHER_KEY` under Manage → Secrets.
