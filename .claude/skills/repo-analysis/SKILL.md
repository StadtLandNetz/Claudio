---
name: repo-analysis
description: How to build and update Claudio's knowledge base for a repository: what each document contains, how to walk the app efficiently, and how to keep the documents useful for later pull-request reviews.
---

# Repository analysis

## What the knowledge base is for
Later PR reviews read it to answer two questions fast: "which screens does this diff touch?" (routes.md) and "how should those screens behave?" (app-map.md). Write for that reader. A reviewer agent with a 30-turn budget should find the entry for a screen in one Read.

## Documents
- overview.md: purpose and users of the app, stack, domain objects and how they relate, roles and what each may do, login, navigation structure. One page.
- modules.md: table of directories and key files with their responsibility; shared components and helpers called out.
- routes.md: one bullet per URL path → implementing files, shared dependencies, required role. Keep paths exact; this list is matched against PR diffs.
- app-map.md: one section per screen (format in the task prompt). Record validation messages and button labels verbatim. Record what happens after success (redirect, toast, list refresh).
- notes.md: test data, created records, quirks, uncovered areas.

## Walking the app
- One visit per screen; combine checks. Take a snapshot, act, take a snapshot only when the page changed.
- Probe validation with empty or obviously invalid input instead of creating records. Create a record only when the flow after saving cannot be seen otherwise, and name it `claudio-<runId>-<purpose>`.
- Check every role at least on the start page and the main navigation; role differences are high-value information.
- Record the date and number formats the app uses (e.g. TT.MM.JJJJ).

## Updates
- Start from the existing documents. Keep entries that still hold, edit the ones that changed, add new screens, and mark removed ones as removed rather than silently dropping them.
- Prefer `write_knowledge` with mode "replace" for modules.md and routes.md after editing them, and targeted rewrites of app-map.md (read it, change the affected sections, write it back).
