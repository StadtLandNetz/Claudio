# Claudio: Plan für den automatisierten User-Review-Agenten

> Stand: Phase 0 umgesetzt (CLI `claudio review`, Playwright-Treiber, Claudio-Tools, Demo-Target). Phase 1 und der Review-Teil von Phase 5 umgesetzt: `packages/db` (MySQL/Drizzle, AES-GCM-Secrets), `apps/worker` (Job-Polling, Abbruch, Live-Events), `apps/web` (SvelteKit 3: GitHub-OAuth-Login, Repos aus GitHub, Rollen, Review starten, Live-Verlauf per SSE, Report mit Evidenz, Findings bestätigen/verwerfen, Strenge nachträglich). Abweichung: Login über eine GitHub **OAuth App** statt GitHub App; Reviews nutzen das Token der startenden Person. Phase 2 umgesetzt: Repo-Analyse mit `code-scanner`-Subagent und Browser-Rundgang durch den Orchestrator, Wissensbasis aus fünf Markdown-Dokumenten (overview, modules, routes, app-map, notes) pro Analyse in MySQL (`knowledge_docs`), inkrementelles Update über die GitHub-Compare-API, Veraltet-Anzeige gegen den Branch-Head, Wissensbasis in jedem Review (klein: im Prompt, groß: als Dateien). Abweichungen: kein Schreiben nach `.claudio/` im Zielrepo (nur DB und Run-Verzeichnis); der Rundgang läuft sequenziell im Orchestrator statt mit parallelen `tester`-Agents, weil sich alle Agents eines Runs einen Browser teilen; Aktualisierung bei Merge auf main noch manuell (Webhook folgt mit Phase 5). Phase 3 umgesetzt: drei Prüf-Subagenten (`ac-verifier`, `regression-tester`, `ux-reviewer`) ab Budget standard, sequenziell wegen des gemeinsamen Browsers; Live-Vorschau per CDP-Screencast (`runDir/live.jpg`, in der UI als MJPEG); PR-Kommentar mit Link auf den Review, nachträglich aus der UI mit gewählter Strenge und ohne verworfene Findings; Markdown-Bericht in jeder Ausführlichkeit. Phase 4 umgesetzt: Test-Scripts (`test_scripts`, `test_runs`) mit eigener Schritt-DSL in `core/testing.ts`; Aufzeichnung über das Claudio-Tool `test_step` (Claudio führt jeden Schritt selbst mit Playwright aus, das Modell bekommt nur `snapshot`, den Accessibility-Tree), Replay ohne Modell, Selbstheilung ab dem gebrochenen Schritt mit neuer Version und Finding, `judge` als eigene SDK-Session mit Structured Output, Determinismus-Grad als Vorschlag der Aufzeichnung, Läufe einzeln, als Suite oder mit PR-Reviews, Vergleich zweier Läufe. Abweichung vom Plan: kein Playwright-MCP in Testläufen, damit Aufzeichnung und Replay garantiert dieselben Aktionen ausführen. Phase 5 umgesetzt: Repo-Webhook (per Klick über die GitHub-API angelegt, HMAC-Secret pro Repo, verschlüsselt), Auslöser Kommentar `/claudio review`, Label `claudio-review` und automatisch bei PR-Push (je Repo schaltbar), Wissensbasis-Update bei Push auf den Default-Branch, URL-Vorlagen pro Repo, Commit-Status „Claudio“ (pending, dann success/failure/error inkl. Regressionstests), PR-Kommentar nach Abschluss der Tests, Lernen aus verworfenen Findings (Lektionen pro Repo im Prompt). Abweichung: kein eigener Bot-Account; automatische Läufe nutzen das Token der Person, die den Webhook eingerichtet hat. Offen: Chrome-Live-Modus über das SDK, Produktionsbetrieb (Server, HTTPS).

## Kontext

Stadt.Land.Netz prüft Feature-Branches heute manuell: ein Reviewer liest das Ticket, verifiziert die Acceptance Criteria im Browser, bewertet UX/UI, schaut sich den geänderten Code an, leitet daraus betroffene Stellen ab und testet diese auf Regressionen. Claudio soll diesen Prozess weitgehend automatisieren. Das Repo `StadtLandNetz/Claudio` ist leer (nur README), wir starten auf der grünen Wiese.

## Getroffene Entscheidungen

| Thema | Entscheidung |
|---|---|
| Laufzeit | Lokal / eigene Server, **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, TypeScript). Managed Agents vorerst nicht. |
| Anthropic-Auth | API-Key aus der Console für unbeaufsichtigte Runs (Kosten pro Run messbar). Der Live-Modus mit Chrome-Extension braucht laut Doku ein Abo-Login (Pro/Max/Team/Enterprise) auf dem Entwickler-Rechner. Beides wird unterstützt. |
| Browser | **Zwei Treiber hinter einer Abstraktion.** (1) **Playwright MCP** (`@playwright/mcp`) für unbeaufsichtigte Runs: headless, isoliert, Accessibility-Snapshots, Console, Network, Screenshots, Tracing, Storage-State. Optional headed mit Live-Vorschau in der Claudio-UI. (2) **Claude-Chrome-Extension** als **Live-Modus**: läuft über Claude Code auf dem Entwickler-Rechner in sichtbarem Chrome, man kann zusehen und eingreifen. Beide nutzen dieselben Agent-Definitionen, Skills und Claudio-Tools. |
| Stack | TypeScript-Monorepo (pnpm), SvelteKit für UI + API, MySQL (Drizzle ORM), ein Worker-Prozess für Runs. |
| Zielapps | Beliebige Webapps, zuerst SvelteKit. Login per Secrets, Rechte über App-Rollen. |
| PR-Instanz | URL wird beim Trigger angegeben (Pflichtfeld). URL-Templates pro Repo als spätere Erweiterung. |
| Testdaten | Keine Annahmen über Testdaten. Agent legt benötigte Daten selbst an, markiert sie (`claudio-<runId>`) und dokumentiert sie. |
| Ticket-Quelle | GitHub Issues (Verknüpfung über PR-Body, `closes #123`, Branch-Name). |
| Reports | Eigene Oberfläche. Im PR nur ein Kommentar mit TL;DR und Link. |
| Budget | Option pro Run (Stufen), nicht fest. |
| "Gleiches Ergebnis" | Pro Script wird beim ersten Run ein Determinismus-Grad festgelegt (deterministisch / semi / explorativ). Verglichen werden Funktionsergebnisse, nicht Pixel. |

## Architektur

### Monorepo-Struktur

```
claudio/
  apps/
    web/            SvelteKit: UI + API-Routen (Repos, Runs, Reports, Trigger, Secrets, Settings)
    worker/         Run-Executor: pollt Jobs aus MySQL, startet Agent-Runs, schreibt Ergebnisse
  packages/
    db/             Drizzle-Schema + Migrationen (MySQL), Repository-Funktionen
    core/           Domänentypen, Finding/Expectation-Schemas (zod), Budget-Stufen, Report-Rendering
    agent/          Agent-SDK-Runner, Hooks, Kostenzähler, Treiber-Auswahl (playwright | chrome)
    browser/        Browser-Treiber: Playwright-MCP-Wiring, Chrome-Extension-Launcher, Claudio-Tools
                    (login_as, evidence, network/console) als eigenständiger stdio-MCP-Server
  .claude/
    agents/         Subagent-Definitionen als Markdown (von SDK und Claude Code CLI gleichermaßen geladen)
    skills/         Review-, Explorer-, Script-Skills (dito)
  .mcp.json         Claudio-Tool-Server + Playwright für den CLI-Live-Modus
    forge/          GitHub (Octokit) und GitLab (REST v4) hinter einem Interface `Forge`: PR/MR-Diff, Issues, Kommentare, Status, Webhooks, Deployments, OAuth
    knowledge/      Lese-/Schreibzugriff auf die Repo-Wissensbasis (.claudio/ im Zielrepo + DB-Spiegel)
  docs/
    ARCHITECTURE.md
```

### Domänenmodell (MySQL)

- **Repo**: Provider (`github`/`gitlab`), Pfad (`owner/name` bzw. `gruppe/…/projekt`), bei GitLab die Projekt-ID, Default-Branch, Status der Analyse.
- **RepoSecret**: Name, verschlüsselter Wert (AES-GCM, Key aus Env), Rolle (z.B. `admin`, `dispatcher`). Werte verlassen den Worker nie Richtung Modell.
- **KnowledgeBase** (pro Repo, versioniert nach Commit): Code-Notizen, Modulkarte, Index Route/Screen zu Dateien, App-Map (Screens, Flows, Rollen, Soll-Verhalten), Agent-Notizen aus früheren Runs.
- **Review**: PR-Nummer, Branch, Instanz-URL, Verbosity, Strictness, Budget-Stufe, Status, Kosten, TL;DR.
- **TestScript**: Name, NL-Beschreibung, strukturierte Erwartung, Determinismus-Grad, kompilierte Schritte (Cache), Rollen.
- **Run**: Typ (analysis / review / script), Bezug, Status, Logs, Kosten, Session-ID des SDK.
- **Finding**: Run, Kategorie (AC, Regression, UX, UI, Console, Network, Security), Severity, Titel, Beschreibung, Schritte, Status (vorgeschlagen / bestätigt / verworfen).
- **Evidence**: Finding oder Run, Typ (Screenshot, Trace, HAR-Ausschnitt, Console-Dump), Dateipfad.

Findings werden immer vollständig gespeichert. **Strictness** ist ein Severity-Schwellenwert (welche Findings blockieren und in den TL;DR kommen). **Verbosity** steuert nur das Rendering des Reports. Beides ist nachträglich umschaltbar.

### Agenten (Agent SDK `agents`-Option, ein `query()` pro Run)

| Agent | Modell | Aufgabe |
|---|---|---|
| Orchestrator (Haupt-Query) | `claude-opus-5-5` | Plant, delegiert, fasst zusammen. |
| `code-scanner` | Sonnet 5.5 | Liest das Zielrepo (Read/Glob/Grep), schreibt Modulkarte und Routen-Index. |
| `explorer` | Sonnet 5.5 | Klickt durch die App, baut die Todo-Liste der Screens/Funktionen in einer Datei. |
| `tester` | Sonnet 5.5 | Arbeitet Todo-Einträge ab, dokumentiert Soll-Verhalten (App-Map). Mehrfach parallel spawnbar. |
| `impact-analyst` | Opus 5.5 | Diff + Routen-Index → betroffene Screens und Flows. |
| `ac-verifier` | Opus 5.5 | Prüft jedes Acceptance Criterion im Browser, mit Evidenz. |
| `regression-tester` | Sonnet 5.5 | Prüft betroffene Screens gegen App-Map-Soll. |
| `ux-reviewer` | Opus 5.5 | Konsistenz, Usability, Verbesserungsvorschläge auf Screenshot-Basis. |
| `judge` | Opus 5.5, Structured Output | Vergleicht Script-Ergebnis gegen Erwartung, unabhängig vom Tester-Kontext. |
| `reporter` | Sonnet 5.5, read-only | Erzeugt Report und TL;DR aus den strukturierten Findings. |

Budget-Stufen (Option pro Run) setzen Modell-Tier der Worker, `effort`, `maxTurns`, maximale Browser-Schritte und ein Kosten-Limit. Der Worker summiert `usage` aus den SDK-Messages und bricht bei Überschreitung sauber ab (Teilreport bleibt erhalten).

### Browser-Schicht (`packages/browser`)

**Grundsatz:** Agent-Definitionen, Skills und Prompts sind treiberneutral ("nutze die verfügbaren Browser-Tools"). Sie liegen als Dateien in `.claude/agents` und `.claude/skills`, damit das Agent SDK (über `settingSources`) und die Claude Code CLI dieselben Definitionen laden. Die Claudio-Tools laufen als eigenständiger stdio-MCP-Server, den beide Wege einbinden.

**Treiber 1: Playwright (unbeaufsichtigt, Standard)**
- Playwright MCP per stdio: `--isolated --storage-state <runDir>/state.json`, standardmäßig `--headless`. Ein Browser-Profil pro Run, keine geteilten Profile.
- Option "headed": sichtbares Fenster auf dem Worker-Rechner. Zusätzlich Live-Vorschau in der Claudio-UI: der Worker streamt den jeweils letzten Screenshot und den aktuellen Agent-Schritt per SSE. So kann man von überall zusehen, ohne Extension.
- `disallowedTools: ["mcp__playwright__browser_run_code_unsafe"]`.
- `PreToolUse`-Hook auf `^mcp__playwright__`: Host-Allowlist (nur Instanz-URL des Runs), kein `javascript:`-Navigieren, Schrittzähler fürs Budget.

**Treiber 2: Chrome-Extension (Live-Modus zum Zusehen und Eingreifen)**
- Läuft auf dem Entwickler-Rechner. Claudio erzeugt einen Run-Auftrag (Prompt, Kontext, Run-ID) und startet Claude Code mit Chrome-Integration gegen das Claudio-Projekt (`.claude/`, `.mcp.json`). Der Entwickler sieht die Aktionen live in Chrome und kann pausieren oder selbst eingreifen (z.B. Login, CAPTCHA).
- Ergebnisse (Findings, Evidence) fließen über die Claudio-Tools zurück in die DB, so dass der Report identisch aussieht.
- Einschränkungen laut Doku: nur sichtbares Chrome, kein WSL, Abo-Login statt API-Key, Network-Logs nicht dokumentiert. Findings aus dem Live-Modus werden entsprechend gekennzeichnet.
- Spike-Punkt: ob das SDK den Chrome-Modus über `extraArgs` durchreicht. Falls nicht, startet der Worker die CLI als Kindprozess und liest die Ergebnisse über den Claudio-MCP-Server und die Session-Transkripte.

**Claudio-Tools (eigener MCP-Server, von beiden Treibern genutzt):**
  - `login_as(role)`: Playwright-Treiber: führt ein pro Repo gespeichertes Login-Rezept aus (Playwright direkt, nicht über das Modell), schreibt Storage-State, liefert nur "eingeloggt als Rolle X" zurück. Beim ersten Mal lässt der Agent sich den Login-Flow zeigen und speichert das Rezept, Credentials bleiben im Worker. Chrome-Treiber: nutzt die Login-Session des Entwicklers; auf Login-Seiten pausiert der Agent, der Mensch loggt ein.
  - `capture_evidence(label)`: Screenshot + aktueller Snapshot in das Run-Verzeichnis, gibt Evidence-ID zurück.
  - `get_console(filter)`, `get_network(filter)`: gefilterte Sichten auf Console und Requests (Fehler, 4xx/5xx, bestimmte Endpunkte), gekürzt, damit der Kontext klein bleibt.
  - `assert_request(pattern, expectation)`: deterministische Prüfung eines Netzwerk-Calls.
  - `note(text)` / `todo_add` / `todo_next`: strukturiertes Arbeitsgedächtnis für Explorer/Tester (Datei im Run-Verzeichnis).
- Nach jedem Run: Playwright-Trace und HAR ins Run-Verzeichnis, verknüpft mit Findings.

### Pipelines

1. **Repo-Analyse** (manuell gestartet, später bei Merge auf main): Zielrepo klonen (flach) → `code-scanner` → `explorer` baut Todo → mehrere `tester` arbeiten ab → Orchestrator schreibt App-Map und Notizen. Ergebnis landet in `.claudio/` (Markdown, diffbar) und als Spiegel in der DB.
2. **PR-Review** (Trigger aus UI mit PR-Nummer + Instanz-URL + Optionen): PR-Diff und verknüpfte Issues laden → AC extrahieren → `impact-analyst` → parallel `ac-verifier`, `regression-tester`, `ux-reviewer` → `reporter` → Findings + Evidence speichern → TL;DR-Kommentar in den PR.
3. **Test-Scripts**: NL-Script + Erwartung anlegen. Erster Run: Tester führt aus, dokumentiert Ablauf, speichert kompilierte Schritte und schlägt Determinismus-Grad vor. Folgeruns: deterministische Schritte laufen ohne Modell (Playwright-Replay), Modell greift nur ein, wenn ein Schritt bricht (self-healing, wird als Finding dokumentiert). `judge` bewertet das Ergebnis gegen die Erwartung mit Structured Output (`passed`, `deviations[]`, `confidence`).

### GitHub- und GitLab-Anbindung

Beide Provider laufen gleichzeitig in einer Instanz. `packages/forge` kapselt sie hinter dem Interface `Forge` (eine Instanz pro Provider und Token); Web, Worker und Agent kennen nur dieses Interface. Der Provider steht an `users` und `repos`; Konten sehen nur Repos ihres Providers.

- **Login**: OAuth App (GitHub) bzw. OAuth-Application mit Scope `api` (GitLab). GitLab-Tokens laufen nach zwei Stunden ab und werden mit dem Refresh-Token erneuert; ein Refresh-Token gilt nur einmal, deshalb erneuert pro Person immer nur ein Prozess, und ein paralleler Gewinner wird übernommen (`packages/db/src/tokens.ts`).
- **Rechte**: GitHub-Permissions bzw. GitLab-Rollen (Reporter = lesen, Developer = schreiben, Maintainer = Admin), 15 Minuten gecacht.
- **Bot-Identität**: GitHub App bzw. ein GitLab-Nutzer mit Personal Access Token (`GITLAB_BOT_TOKEN`); ohne sie schreibt Claudio mit dem Token der Person.
- **Ergebnis**: Commit-Status „Claudio“ und ein Review, das bei Blockern Änderungen anfordert (GitLab: Draft-Note + `bulk_publish` mit `reviewer_state`, sonst normaler Kommentar).
- **Automatisierung**: Webhook pro Repo (`/webhooks/github` mit HMAC-Signatur, `/webhooks/gitlab` mit Secret-Token), Trigger per Kommentar `/claudio review`, Label `claudio-review`, Push, Deployment (GitLab: Environment-Ordner wie `review/*`) und Push auf den Default-Branch.

### Oberfläche (SvelteKit)

Repos verwalten, Secrets (Rolle → Credentials), Analyse starten und Wissensbasis einsehen, Review starten (PR, URL, Verbosity, Strictness, Budget), Run-Status live (SSE), Report mit Findings, Evidenz und Bestätigen/Verwerfen, Test-Scripts anlegen und Runs vergleichen.

## Phasen

### Phase 0: Spike (zuerst, ohne UI)
Ziel: Machbarkeit, Qualität und Kosten pro Review messen.
- Monorepo-Gerüst (pnpm, TypeScript, `packages/agent`, `packages/browser`).
- CLI-Skript `claudio review --repo --pr --url --role --driver playwright|chrome`: lädt PR + Issue, startet eine Agent-Session mit dem gewählten Treiber, `login_as`, `capture_evidence`, schreibt Report als Markdown in `runs/<id>/`.
- Ergebnis: ein echter PR aus eurem Hauptprodukt mit beiden Treibern reviewt, Kosten und Dauer protokolliert.
- Nebenbei prüfen: parallele `query()`-Aufrufe im selben Prozess (laut Doku nicht spezifiziert), sonst ein Prozess pro Run. Und: läuft der Chrome-Modus über das SDK (`extraArgs`) oder nur über die CLI als Kindprozess?

### Phase 1: Fundament
`packages/db` (Schema, Migrationen), `apps/worker` (Job-Polling, Run-Verzeichnisse, Kostenzähler, Budget-Abbruch), Secrets-Verschlüsselung, GitHub-App-Client.

### Phase 2: Repo-Analyse
`code-scanner`, `explorer`/`tester`-Paar, App-Map-Format, `.claudio/`-Ablage, Aktualisierung bei neuem Commit auf main.

### Phase 3: PR-Review
Impact-Analyse über Routen-Index, AC-Extraktion, drei Prüfagenten, Findings/Evidence-Modell, Verbosity/Strictness, TL;DR-Kommentar.

### Phase 4: Test-Scripts
Erwartungs-Schema, erster Run mit Dokumentation, kompilierte Schritte, Replay, self-healing, `judge`, Run-Vergleich.

### Phase 5: Oberfläche und Bot
SvelteKit-UI für alles oben, Live-Status, Bestätigen/Verwerfen von Findings mit Rückfluss in die Notizen, Bot-Reviewer per Webhook, URL-Templates pro Repo.

## Verifikation

- Phase 0: ein Review gegen eine reale Instanz, manuell geprüft: stimmen AC-Bewertung, betroffene Screens, Findings? Kosten unter der gewählten Budget-Stufe?
- Unit-Tests (vitest) für Schemas, Budget-Logik, Finding-Filter, Login-Rezept-Replay.
- Integrationstest mit einer kleinen SvelteKit-Demo-App im Repo (`apps/demo-target`) mit Login, Rollen und absichtlichen Bugs: Analyse, Review und ein Script müssen die eingebauten Bugs finden. Dient auch als Regressionssuite für Claudio selbst.
- Jeder Run hinterlässt Trace, HAR, Console-Dump und SDK-Session-ID, damit ein Mensch nachvollziehen kann, was der Agent getan hat.

## Risiken und offene Punkte

- Parallelität von `query()` im selben Prozess ist nicht dokumentiert. Fallback: Kindprozess pro Run.
- Chrome-Extension ist für CLI und VS Code dokumentiert, nicht für das SDK. Der Live-Modus ist daher an einen Entwickler-Rechner mit Abo-Login gebunden und läuft nicht parallel. Für Zusehen ohne diese Einschränkung gibt es die Live-Vorschau des Playwright-Treibers.
- Zwei Treiber bedeuten zwei Tool-Vokabulare. Prompts bleiben treiberneutral; treiberspezifische Hinweise kommen aus einem kleinen Präfix, das der Runner je nach Treiber einfügt.
- Login-Flows mit 2FA oder CAPTCHA lassen sich nicht automatisieren. Secrets-Modell sieht pro Rolle optional einen vorab erzeugten Storage-State vor.
- Datenschutz: Snapshots und Screenshots gehen an Anthropic. Nur Instanzen mit synthetischen Daten reviewen. Wird in der UI pro Repo als Bestätigung abgefragt.
- Testdaten-Adaptivität kostet Tokens: der Agent muss erst herausfinden, was existiert. Die App-Map aus der Analyse reduziert das ab dem zweiten Run.
- SvelteKit-Hydration und Client-Navigation: Snapshots müssen nach `networkidle` erfolgen. Playwright MCP wartet selbst, eigene Tools müssen es auch tun.
