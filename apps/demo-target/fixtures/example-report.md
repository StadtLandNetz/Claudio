# Claudio Review: PR #17 Fahrten: Neue Fahrt anlegen und Suche in der Fahrtenliste

**Änderungen nötig** (Status: completed, strictness: normal)

## Zusammenfassung

**Urteil:** PR #17 sollte nicht gemergt werden. Von den 6 Akzeptanzkriterien sind 2 erfüllt, 3 nicht erfüllt, und 1 ließ sich nicht prüfen. Die Suche ist durch einen Serverfehler (HTTP 500) unbrauchbar.

**Zusammenfassung**

Ich habe den Code in `src/server.mjs` gelesen und die Kriterien als Todo-Liste angelegt. Dann habe ich im Browser als Disponent die Fahrtenliste geöffnet, das Formular geprüft und eine Fahrt mit Datum 2020-01-01 gespeichert. Danach habe ich die Suche aufgerufen, mich als Admin angemeldet und einen POST mit leeren Feldern abgeschickt.

- **Button "Neue Fahrt" (erfüllt):** Er ist in der Liste vorhanden und führt zum Formular `/trips/new`. Der Klick per Tool schlug technisch fehl, deshalb habe ich die URL direkt aufgerufen. Im Code ist der Button verlinkt.
- **Felder und Pflichtfelder (nicht erfüllt):** Das Feld "Fahrzeug" fehlt komplett. Fahrten werden immer mit `vehicle: null` gespeichert und in der Liste mit "-" angezeigt. Von und Nach haben nur einen Placeholder und kein Label.
- **Datum nicht in der Vergangenheit (nicht erfüllt):** 2020-01-01 wurde ohne Fehlermeldung gespeichert, weder im Browser noch auf dem Server geprüft.
- **Speichern, Liste und Erfolgsmeldung (erfüllt):** "Fahrt #3 angelegt." erscheint und die Zeile steht in der Liste, allerdings ohne Fahrzeug.
- **Suche (nicht erfüllt, Blocker):** Der Filter ruft `t.vehicle.toLowerCase()` auf, aber neue Fahrten haben `vehicle = null`. Sobald eine solche Fahrt existiert, liefert jede Suche HTTP 500. Im Browser habe ich das mit `?q=mia` bestätigt. Eine Suche vor dem Anlegen habe ich nicht gemacht.
- **Server ohne Validierung:** Ein POST mit leeren Feldern hat Fahrt #4 angelegt. Die Rollenprüfung sitzt nur im GET-Handler, nicht im POST.
- **Konsole:** Jeder Aufruf von `/trips` erzeugt `console.error("TripList: deprecated prop 'rows' used")`. Dazu kommt ein favicon-404.
- **Suchbegriff und Fahrgastdaten:** Sie werden ohne Escaping ausgegeben, was reflektiertes und gespeichertes XSS ermöglicht. Das habe ich nur im Code gesehen, nicht im Browser ausgenutzt.
- **Formular-UX:** Der Submit-Button heißt "Senden" statt "Speichern", und es gibt keine Fehlerdarstellung am Feld.
- **Verbesserungsideen:**
  - Fahrzeug als Auswahlfeld mit Pflicht ergänzen.
  - Datum clientseitig mit `min=heute` und serverseitig prüfen, Fehler am Feld anzeigen.
  - Suche `null`-sicher machen (`t.vehicle?.toLowerCase()`).
  - Alle Ausgaben escapen.
  - Meldung nach dem Speichern aussagekräftiger formulieren.

**Affected areas:**
- Fahrtenliste `/trips`: Suche (500-Fehler), Erfolgsmeldung, Konsolenfehler.
- Formular `/trips/new`: Felder, Validierung, Labels, Rollenprüfung.
- `POST /trips/new`: keine Validierung, `vehicle` immer `null`.
- Übersicht `/dashboard`: lädt unverändert, kein Fehler festgestellt.

**Nicht getestet:**
- **Rollenbeschränkung:** Es gibt nur die Rollen Disponent und Admin, beide dürfen anlegen. Den Negativfall konnte ich nicht prüfen.
- **Suche vor dem Anlegen:** Das Verhalten mit den ursprünglichen Seed-Daten habe ich nicht gemessen.
- **XSS:** Nicht im Browser ausprobiert.
- **Aufräumen:** Meine Testdaten sind Fahrt #3 (`claudio-review-pr17-20261010-135737-slu9 Past`) und die leere Fahrt #4. Sie liegen nur im Speicher und verschwinden beim Neustart des Servers.

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | Button "Neue Fahrt" in der Fahrtenliste öffnet ein Formular | erfüllt | Button vorhanden (Link-Button auf /trips/new); Formular öffnet. Klick per Tool scheiterte technisch, daher Navigation direkt; im Code verlinkt. |
| 2 | Felder Fahrgast, Datum, Uhrzeit, Von, Nach, Fahrzeug; Pflicht: Fahrgast, Datum, Uhrzeit, Fahrzeug | nicht erfüllt | Fahrzeugfeld fehlt komplett; Von/Nach nur Placeholder ohne Label. Fahrt wird mit Fahrzeug "-" gespeichert. |
| 3 | Datum in der Vergangenheit → Fehlermeldung am Feld | nicht erfüllt | 2020-01-01 wurde ohne Fehlermeldung gespeichert. |
| 4 | Nach Speichern erscheint Fahrt in Liste und Erfolgsmeldung | erfüllt | Meldung "Fahrt #3 angelegt." und Zeile in Liste vorhanden (aber Fahrzeug leer, siehe AC2). |
| 5 | Fahrtenliste nach Fahrgast oder Fahrzeug durchsuchbar | nicht erfüllt | Sobald eine Fahrt ohne Fahrzeug existiert (jede neu angelegte), liefert jede Suche mit Text HTTP 500 (null.toLowerCase). Zuvor nicht getestet, da Suche mit q=mia erst danach erfolgte; Code-Analyse zeigt gleichen Fehler. |
| 6 | Nur Disponenten und Admins dürfen Fahrten anlegen | nicht testbar | Nur die Rollen dispatcher und admin stehen zur Verfügung, beide dürfen. Negativfall nicht prüfbar; Code prüft Rolle nur beim GET, nicht beim POST (Hinweis). |

## Findings

### Blockierend (4)

### [Blocker] Suche in Fahrtenliste → HTTP 500, sobald eine Fahrt ohne Fahrzeug existiert

_network_ · http://127.0.0.1:4310/trips?q=mia

Filter ruft t.vehicle.toLowerCase() auf; neu angelegte Fahrten haben vehicle=null.

**Schritte**
1. Fahrt anlegen
2. /trips?q=mia aufrufen

**Erwartet:** Gefilterte Liste
**Beobachtet:** 500 Interner Fehler

**Evidenz:** [Suche liefert 500 nach Anlegen einer Fahrt ohne Fahrzeug](evidence/E4-Suche_liefert_500_nach_Anlegen_einer_Fahrt_ohne_Fahrzeug.png)

### [Major] Formular hat kein Pflichtfeld "Fahrzeug"

_acceptance_ · http://127.0.0.1:4310/trips/new

Fahrzeug wird weder abgefragt noch gespeichert (immer null, Anzeige "-").

**Erwartet:** Pflichtfeld Fahrzeug
**Beobachtet:** Feld fehlt

**Evidenz:** [Formular Neue Fahrt: kein Fahrzeugfeld, keine Labels Von/Nach](evidence/E2-Formular_Neue_Fahrt_kein_Fahrzeugfeld_keine_Labels_Von_Nach.png), [Vergangenes Datum akzeptiert, Fahrt ohne Fahrzeug, Erfolgsmeldung](evidence/E3-Vergangenes_Datum_akzeptiert_Fahrt_ohne_Fahrzeug_Erfolgsmeld.png)

### [Major] Datum in der Vergangenheit wird ohne Fehlermeldung akzeptiert

_acceptance_ · http://127.0.0.1:4310/trips/new

2020-01-01 wurde gespeichert; weder Client- noch Server-Prüfung.

**Erwartet:** Fehlermeldung am Datumsfeld
**Beobachtet:** Fahrt angelegt

**Evidenz:** [Vergangenes Datum akzeptiert, Fahrt ohne Fahrzeug, Erfolgsmeldung](evidence/E3-Vergangenes_Datum_akzeptiert_Fahrt_ohne_Fahrzeug_Erfolgsmeld.png)

### [Major] Keine serverseitige Validierung; leere Fahrt anlegbar

_other_ · http://127.0.0.1:4310/trips/new

POST /trips/new mit leeren Feldern legte Fahrt #4 an. Rollenprüfung fehlt außerdem im POST-Handler.

**Erwartet:** Ablehnung mit Fehlermeldung
**Beobachtet:** Leerer Datensatz in Liste

**Evidenz:** [Liste mit leerer Fahrt #4 (Server ohne Validierung) und Fahrt #3](evidence/E6-Liste_mit_leerer_Fahrt_4_Server_ohne_Validierung_und_Fahrt_3.png)

### Nicht blockierend (3)

### [Minor] Formular: Von/Nach ohne Labels, Button "Senden", ID-Meldung wenig informativ

_ux_ · http://127.0.0.1:4310/trips/new

Von/Nach nur Placeholder, inkonsistent zu Labels der übrigen Felder; Submit heißt "Senden" statt "Speichern"; Erfolgsmeldung "Fahrt #3 angelegt." ohne Details. Keine Fehlerdarstellung vorgesehen.

**Evidenz:** [Formular Neue Fahrt: kein Fahrzeugfeld, keine Labels Von/Nach](evidence/E2-Formular_Neue_Fahrt_kein_Fahrzeugfeld_keine_Labels_Von_Nach.png)

### [Minor] Konsolenfehler auf /trips: "deprecated prop 'rows' used"; favicon 404

_console_ · http://127.0.0.1:4310/trips

Jeder Aufruf der Fahrtenliste erzeugt console.error.

**Evidenz:** [Fahrtenliste mit Suche und Button](evidence/E1-Fahrtenliste_mit_Suche_und_Button.png)

### [Minor] Suchbegriff unescaped im value-Attribut (reflektiertes XSS)

_security_ · http://127.0.0.1:4310/trips

Im Code wird q ohne Escaping in value="${q}" ausgegeben; Fahrgast/Von/Nach ebenfalls ungeescaped in der Tabelle (gespeichertes XSS). Nur per Code-Review festgestellt, nicht im Browser ausgenutzt.

## Kosten

| USD | Input tokens | Output tokens | Turns | Browser steps | Duration |
|---|---|---|---|---|---|
| 0.38 | 720368 | 7421 | 34 | 8 | 61s |

## Notes

- 2026-10-10T13:57:45.138Z login_as(dispatcher) ok → http://127.0.0.1:4310/dashboard
- 2026-10-10T13:57:57.226Z login_as(admin) ok → http://127.0.0.1:4310/dashboard
- 2026-10-10T13:58:04.460Z Angelegt: Fahrt #3 (claudio-review-pr17-20261010-135737-slu9 Past, 2020-01-01) und Fahrt #4 (leerer Datensatz via POST). In-Memory-Daten, bitte Server neu starten zum Aufräumen.
