---
name: adaptive-browser-testing
description: How to test an unfamiliar web application without relying on prepared test data: discovering structure, creating and tracking your own data, handling SvelteKit apps, and keeping within the step budget.
---

# Adaptive browser testing

## Discover before acting
- Start from the page after login. Snapshot, note the main navigation, and only open the areas related to the change.
- Read empty states and placeholder texts: they tell you what the app expects.
- When a flow needs an existing record (a passenger for a trip, a vehicle for a tour), check whether one exists; otherwise create one first and note it.

## Your own test data
- Name everything you create `claudio-<runId>-<purpose>` so people can find and delete it. Use plausible but clearly synthetic values (no real names or addresses).
- Record each created record with `note` (type, name, where). Do not delete data unless the test requires it; cleanup is a human decision.
- Never change settings that affect other users (tenant settings, user roles, integrations) unless the acceptance criteria require it. If they do, revert afterwards and note it.

## SvelteKit specifics
- Navigation is client-side: after clicking a link, wait for the snapshot to show the new content rather than relying on a full page load.
- Forms often use progressive enhancement: a submit may not reload the page. Check the result in the snapshot and in `get_network` (look for the POST and its status).
- Server load errors show as error pages or toasts; check `get_console` for hydration warnings after navigating to a changed route.
- Pending states can be brief; if a check depends on them, say that you could not observe them rather than asserting they are missing.

## Budget discipline
- Each browser tool call is a step. Plan the list first, then execute. Avoid re-snapshotting a page you have not changed.
- Combine checks: one visit to a list screen can verify sorting, filtering and the new column.
- When the step budget warning arrives, stop exploring, record what you have, and write the summary.

## Evidence
- Screenshot the moment that proves the point: validation message visible, success toast visible, wrong value highlighted.
- One evidence id can back several findings or criteria; reuse it instead of taking the same screenshot twice.
