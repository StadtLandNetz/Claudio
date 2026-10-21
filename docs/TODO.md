# Claudio: offene Punkte

Aufwand grob: S (Tage), M (ein bis zwei Wochen), L (mehr).

## Als Nächstes

- [x] **Delta-Re-Review mit Fix-Verifikation** (M). Beim erneuten Review eines PRs bekommt der Agent die Findings des letzten Reviews samt Bewertung und den Diff seit dem zuletzt geprüften Commit. Ergebnis: „F2 behoben, F5 weiterhin offen, neu: …“, auch im PR-Kommentar. Eigenes, günstigeres Budget-Profil „Nachprüfung“ (Sonnet, kleines Turn-Limit).
- [x] **Kriterien-Vorschau vor dem Lauf** (S). Ein Vorschritt ohne Browser schlägt die Akzeptanzkriterien aus Issue und PR vor; die Person korrigiert oder ergänzt sie, dann startet der Lauf. Dazu Zusatzanweisungen pro Review (gibt es bisher nur für Analysen).
- [ ] **Staging als Baseline für Regressionen** (M). Die `defaultInstanceUrl` als Vergleich: weicht ein Flow auf der PR-Instanz von Staging ab, ist es eine Regression, sonst ein Altfehler.
- [x] **Benachrichtigungen** (S). Slack pro Repo erledigt (Takeover, Review-Kurzergebnis, Tests, Analysen, Automatisierungen). Offen: Teams/E-Mail.

## Features

- [x] **Mobile Viewport** (S). Zweiter Durchgang der geänderten Screens in Smartphone-Breite.
- [ ] **Deterministische Zusatzprüfungen** (S bis M). axe-core auf geänderten Screens, kaputte Links, visueller Vergleich gegen die Screenshots der Wissensbasis.
- [ ] **Testsuite-Pflege** (M). Zeitpläne (z. B. nächtlich gegen Staging), Trend pro Test, Flakiness-Statistik.
- [ ] **Regressionstests gezielt auswählen** (S). Statt aller `runInReviews`-Tests nur die, deren Schritte betroffene Routen berühren.
- [x] **Finding → GitHub-Issue** (S). Ein Klick legt aus einem bestätigten Finding ein Issue mit Schritten, Erwartung und Screenshot an.
- [ ] **Testdaten aufräumen** (S). Liste der angelegten `claudio-<runId>-…`-Datensätze pro Lauf mit „erledigt“-Haken, optional ein Aufräum-Lauf.
- [x] **Bot-Identität über eine GitHub App** (M). Kommentare und Webhook-Läufe unabhängig vom Token einer Person.
- [x] **Kostendeckel** (S). Monatsbudget pro Repo mit Warnung und Stopp.

## Claudio klüger machen

- [ ] **Impact-Analyse berechnen** (M). Import-Graph des Checkouts: geänderte Datei → Importeure → Route. Das Modell ordnet die Kandidaten nur noch nach Risiko. Dieselbe Rechnung wählt die Regressionstests aus.
- [ ] **Strukturierte Wissensbasis** (M bis L). Pro Screen URL-Muster, Rollen, Pflichtfelder, Validierungstexte und Baseline-Screenshot als Daten, nicht nur als Markdown.
- [ ] **Tests aus der Analyse vorschlagen** (S). Die Analyse legt für die wichtigsten Kernflows Testbeschreibungen an, die eine Person freigibt.
- [ ] **Lernen in beide Richtungen** (M). Auch bestätigte Findings auswerten; Qualitätsansicht „bestätigt vs. verworfen“ je Kategorie und Schweregrad; daraus Strenge und Prompt-Hinweise pro Repo kalibrieren.
- [ ] **Flaky-Tests erkennen** (S). Fehlgeschlagenes Replay einmal wiederholen, Wiederholungsquote speichern; Judge-Schwelle aus der Historie kalibrieren statt fest 0,5.
- [x] **Rückfragen jenseits von CAPTCHAs** (S). `request_human_help` mit Benachrichtigung und Antwortfeld in der UI, damit der Agent bei unklaren Kriterien fragt statt „nicht testbar“ zu notieren.
