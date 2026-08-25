---
id: vault-and-trail-weather
title: Vault secret and trail weather
summary: How the weather card uses HORIZON_WEATHER_KEY and what visitors see.
kind: playbook
tags: secrets, weather, vault
---

# Vault secret and trail weather

## Secret name

The demo reads **`HORIZON_WEATHER_KEY`** from the Antinode secrets vault. Site owners add it under **Manage → Secrets**. The value is an API key or token your weather provider expects; the demo uses Open-Meteo (no key required for forecast URLs) but still demonstrates vault access.

## Weather card behavior

1. Visitor signs in.
2. App loads the secret via `antinode.getSecret('HORIZON_WEATHER_KEY')`.
3. Destination field (default **Mount Tamalpais**) is geocoded, then current conditions are shown on the trail card.
4. **Refresh weather** reloads the secret and fetches again.

## Vault status chip

- **Vault ready** — secret loaded; weather can run.
- **Missing** — add `HORIZON_WEATHER_KEY` on the tenant, then refresh.
- **Rate limited** — wait a minute and try again.

## Journal entries

Entries are **not** stored on Antinode servers — they live in browser `localStorage`. Skills that list entries read that local list through the demo API shim.
