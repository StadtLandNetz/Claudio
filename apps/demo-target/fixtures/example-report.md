# Claudio Review: PR #17 Fahrten: Neue Fahrt anlegen und Suche in der Fahrtenliste

**Änderungen nötig** (Status: completed, strictness: normal)

## Zusammenfassung

**Urteil:** PR #17 sollte nicht gemergt werden. Drei von sechs Akzeptanzkriterien sind nicht erfüllt, und die neue Suche bricht mit einem Serverfehler ab, sobald jemand über das neue Formular eine Fahrt angelegt hat.

**Zusammenfassung**

Was funktioniert: Der Button „Neue Fahrt“ öffnet das Formular. Nach dem Speichern erscheint die Fahrt mit Erfolgsmeldung in der Liste, getestet als Disponent und als Admin. Ohne Anmeldung leitet die App beim Anlegen auf den Login um. Mit den beiden vorhandenen Fahrten lieferte die Suche nach Fahrgast und Fahrzeug zunächst richtige Ergebnisse.

Das Formular hat aber kein Feld „Fahrzeug“, deshalb wird jede neue Fahrt ohne Fahrzeug gespeichert. Die Suche verkraftet das nicht: Ab der ersten neuen Fahrt endet sie mit HTTP 500 („Interner Fehler“). Seit einer Fahrt mit leerem Fahrgast scheitert sogar jede Suche, egal mit welchem Begriff. Daneben fehlt die Prüfung auf Daten in der Vergangenheit, und der Server prüft die Eingaben überhaupt nicht. Eingaben werden außerdem ungeprüft als HTML in die Liste geschrieben, wodurch fremder Code eingeschleust werden kann (Stored XSS).

Wichtigste Beobachtungen:
- **Blocker:** Die Suche liefert HTTP 500, sobald eine Fahrt ohne Fahrzeug existiert. Die interne Fehlermeldung wird dem Nutzer angezeigt (F1).
- **Major:** Das Pflichtfeld „Fahrzeug“ fehlt im Formular (F3).
- **Major:** Ein Datum in der Vergangenheit wird ohne Fehlermeldung gespeichert (F2).
- **Major:** Der Server prüft die Eingaben nicht. Eine Fahrt ohne Fahrgast, Datum und Uhrzeit wurde gespeichert (F5).
- **Major (Sicherheit):** Fahrgast, Von und Nach werden ohne HTML-Escaping in die Liste geschrieben; das ist im Browser nachgewiesen. Laut Code gilt das auch für den Suchbegriff im Suchfeld (F4).
- **Minor:** Von und Nach haben keine Beschriftung, die übrigen Beschriftungen sind nicht mit ihren Feldern verknüpft, und der Button heißt „Senden“ (F6). Der Suchbegriff wird kleingeschrieben zurück ins Feld gesetzt (F7). Bei jedem Aufruf der Liste erscheint ein Konsolenfehler (F8).

**Affected areas:**
- Fahrtenliste `/trips`: neue Suche, Erfolgsmeldung und Button „Neue Fahrt“
- Formular „Neue Fahrt“ `GET /trips/new`
- Speichern einer Fahrt `POST /trips/new`: Validierung und Rechteprüfung
- Fahrtenliste als Anzeige aller Fahrten, über die sich eingeschleuster Code auswirkt

**Nicht oder nur eingeschränkt getestet**
- **Rechte für weitere Rollen:** Die Instanz hat nur Disponent und Admin, deshalb ließ sich nicht prüfen, ob andere Rollen abgewiesen werden. Im Code prüft nur der Formularaufruf die Rolle, das Speichern nicht.
- **Code im Suchbegriff:** Im Browser ließ sich das nicht vorführen, weil die Suche inzwischen immer mit 500 abbricht. Der Befund stützt sich hier auf den Code.

**Testdaten:** Ich habe die Fahrten #3 bis #6 angelegt, erkennbar am Präfix `claudio-review-pr17-20261010-183117-7fng`; Fahrt #4 hat absichtlich einen leeren Fahrgast. Solange sie bestehen, liefert jede Suche HTTP 500. Die App kann keine Fahrten löschen, deshalb verschwinden sie erst, wenn der Server neu gestartet wird.

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|---|---|---|
| 1 | In der Fahrtenliste gibt es einen Button "Neue Fahrt", der ein Formular öffnet. | erfüllt | Button "Neue Fahrt" über der Tabelle vorhanden, Klick öffnet /trips/new mit Formular. |
| 2 | Das Formular hat die Felder Fahrgast, Datum, Uhrzeit, Von, Nach und Fahrzeug. Fahrgast, Datum, Uhrzeit und Fahrzeug sind Pflichtfelder. | nicht erfüllt | Feld Fahrzeug fehlt komplett (F3). Fahrgast/Datum/Uhrzeit sind nur clientseitig über required Pflicht, ein leeres Absenden blieb im Browser auf der Seite. Serverseitig gibt es keine Prüfung (F5). |
| 3 | Das Datum darf nicht in der Vergangenheit liegen; sonst erscheint eine Fehlermeldung am Feld. | nicht erfüllt | 2026-10-01 (heute 2026-10-10) wurde ohne Fehlermeldung gespeichert (F2). |
| 4 | Nach dem Speichern erscheint die neue Fahrt in der Liste und eine Erfolgsmeldung wird angezeigt. | erfüllt | Als Disponent (#3) und als Admin (#6) geprüft: Weiterleitung auf die Liste, neue Zeile sichtbar, Meldung "Fahrt #n angelegt.". Fahrzeug bleibt dabei "-" (F3). |
| 5 | Die Fahrtenliste lässt sich nach Fahrgast oder Fahrzeug durchsuchen. | nicht erfüllt | Mit den Bestandsdaten funktionierte die Suche nach Fahrgast und Fahrzeug (E1, E2). Sobald eine über das Formular angelegte Fahrt (Fahrzeug null) existiert, endet die Suche mit HTTP 500 (F1). Seit einer Fahrt mit leerem Fahrgast scheitert jede nicht-leere Suche. |
| 6 | Nur Disponenten und Admins dürfen Fahrten anlegen. | erfüllt | Disponent und Admin können anlegen. Ohne Anmeldung werden GET und POST /trips/new auf /login umgeleitet, es entstand keine Fahrt (per /api/trips geprüft). Einschränkung: Andere Rollen gibt es in der Instanz nicht. POST /trips/new hat keine eigene Rollenprüfung (nur GET), das würde bei weiteren Rollen zur Lücke. |

## Findings

### Blockierend (5)

### [Blocker] Suche in der Fahrtenliste liefert HTTP 500, sobald eine Fahrt ohne Fahrzeug existiert

_acceptance_ · http://127.0.0.1:4310/trips?q=mia · AC: Die Fahrtenliste lässt sich nach Fahrgast oder Fahrzeug durchsuchen.

Über das neue Formular angelegte Fahrten haben immer vehicle = null (kein Fahrzeugfeld). Der neue Suchfilter ruft t.vehicle.toLowerCase() ohne Null-Prüfung auf (src/server.mjs:60). Jede Suche, deren Begriff nicht schon beim Fahrgast dieser Fahrt trifft, endet daher mit "Interner Fehler – Cannot read properties of null (reading 'toLowerCase')". Da jede neue Fahrt dieses Problem auslöst, ist die Suche nach der ersten angelegten Fahrt praktisch unbenutzbar. Zusätzlich wird die interne Fehlermeldung dem Nutzer angezeigt.

**Schritte**
1. Als Disponent einloggen
2. Fahrten > Neue Fahrt, Pflichtfelder ausfüllen, Senden
3. In der Fahrtenliste nach "mia" suchen (vorher funktionierte das)

**Erwartet:** Fahrt #1 Mia Muster wird gefunden; Fahrten ohne Fahrzeug werden einfach nicht gematcht.
**Beobachtet:** HTTP 500, Seite "Interner Fehler" mit JS-Fehlermeldung.

**Evidenz:** [Suche nach Fahrgast "mia" (vor Anlegen neuer Fahrten)](evidence/E1-Suche_nach_Fahrgast_mia_vor_Anlegen_neuer_Fahrten_.png), [Suche "mia" nach Anlegen einer Fahrt: HTTP 500](evidence/E5-Suche_mia_nach_Anlegen_einer_Fahrt_HTTP_500.png)

### [Major] Datum in der Vergangenheit wird ohne Fehlermeldung gespeichert

_acceptance_ · http://127.0.0.1:4310/trips/new · AC: Das Datum darf nicht in der Vergangenheit liegen; sonst erscheint eine Fehlermeldung am Feld.

Das Datumsfeld hat kein min-Attribut und der Server prüft das Datum nicht. Eine Fahrt mit Datum 2026-10-01 (heute: 2026-10-10) wurde gespeichert und als Fahrt #3 in der Liste angezeigt.

**Schritte**
1. Neue Fahrt öffnen
2. Fahrgast, Datum 2026-10-01, Uhrzeit 08:00 eingeben
3. Senden

**Erwartet:** Fehlermeldung am Feld Datum, Fahrt wird nicht gespeichert.
**Beobachtet:** Fahrt wird gespeichert, Erfolgsmeldung "Fahrt #3 angelegt."

**Evidenz:** [Fahrt mit Vergangenheitsdatum gespeichert](evidence/E4-Fahrt_mit_Vergangenheitsdatum_gespeichert.png)

### [Major] Pflichtfeld "Fahrzeug" fehlt im Formular "Neue Fahrt"

_acceptance_ · http://127.0.0.1:4310/trips/new · AC: Das Formular hat die Felder Fahrgast, Datum, Uhrzeit, Von, Nach und Fahrzeug.

Das Formular enthält nur Fahrgast, Datum, Uhrzeit, Von, Nach. Ein Fahrzeugfeld existiert nicht; der Server setzt vehicle immer auf null, in der Liste erscheint "-". Damit kann eine Fahrt nicht vollständig angelegt werden, und genau diese Fahrten lösen den 500-Fehler der Suche aus.

**Erwartet:** Pflichtfeld Fahrzeug im Formular.
**Beobachtet:** Kein Fahrzeugfeld, Fahrzeug immer leer.

**Evidenz:** [Formular Neue Fahrt](evidence/E3-Formular_Neue_Fahrt.png), [Fahrt mit Vergangenheitsdatum gespeichert](evidence/E4-Fahrt_mit_Vergangenheitsdatum_gespeichert.png)

### [Major] Kein HTML-Escaping: Eingaben aus "Neue Fahrt" werden als HTML in der Fahrtenliste gerendert (Stored XSS)

_security_ · http://127.0.0.1:4310/trips

Fahrgast, Von und Nach werden ungefiltert in die Tabelle der Fahrtenliste eingesetzt (src/server.mjs:69). Ein Fahrgast mit Markup &lt;i id="claudio-xss"&gt;…&lt;/i&gt; erscheint als echtes &lt;i&gt;-Element im DOM. Damit kann jeder, der Fahrten anlegen darf, Skripte einschleusen, die bei allen anderen Nutzern der Fahrtenliste laufen. Gleiches gilt laut Code für den Suchbegriff q, der unescaped in das value-Attribut des Suchfelds geschrieben wird (Reflected XSS); im Browser konnte das nicht vorgeführt werden, weil die Suche derzeit mit 500 abbricht (F1).

**Schritte**
1. Fahrt mit Fahrgast <i id="claudio-xss">Test</i> anlegen
2. Fahrtenliste öffnen
3. document.getElementById('claudio-xss') existiert / Text wird kursiv dargestellt

**Erwartet:** Eingaben werden HTML-kodiert und als Text angezeigt.
**Beobachtet:** Markup wird als HTML interpretiert.

**Evidenz:** [Liste mit leerer Fahrt #4 und HTML-injizierter Fahrt #5](evidence/E6-Liste_mit_leerer_Fahrt_4_und_HTML-injizierter_Fahrt_5.png)

### [Major] Keine serverseitige Validierung: Fahrt ohne Fahrgast, Datum und Uhrzeit wird gespeichert

_acceptance_ · http://127.0.0.1:4310/trips/new · AC: Fahrgast, Datum, Uhrzeit und Fahrzeug sind Pflichtfelder.

POST /trips/new prüft weder Pflichtfelder noch Datum. Die Pflichtfelder werden nur über das HTML-Attribut required im Browser erzwungen. Ein direkter POST mit leerem Fahrgast, Datum und Uhrzeit wurde als Fahrt #4 gespeichert. Diese leere Fahrt sorgt außerdem dafür, dass jede Suche mit 500 abbricht (siehe F1).

**Schritte**
1. Eingeloggt POST /trips/new mit passenger=&date=&time= senden
2. Fahrtenliste öffnen

**Erwartet:** Server lehnt ab und zeigt Feldfehler an.
**Beobachtet:** Redirect auf /trips?created=4, leere Zeile in der Liste.

**Evidenz:** [Liste mit leerer Fahrt #4 und HTML-injizierter Fahrt #5](evidence/E6-Liste_mit_leerer_Fahrt_4_und_HTML-injizierter_Fahrt_5.png), [Suche "claudio" ebenfalls HTTP 500](evidence/E7-Suche_claudio_ebenfalls_HTTP_500.png)

### Nicht blockierend (4)

### [Minor] Formular "Neue Fahrt": Von/Nach ohne Labels, Labels nicht mit Feldern verknüpft, Button heißt "Senden"

_ux_ · http://127.0.0.1:4310/trips/new

Von und Nach haben nur Platzhalter und stehen nebeneinander statt wie die anderen Felder untereinander mit Label. Die Labels Fahrgast/Datum/Uhrzeit sind nicht per for/id verknüpft (input.labels.length = 0), Screenreader nennen die Felder nicht, und ein Klick aufs Label setzt keinen Fokus. Der Absenden-Button heißt "Senden", passender für das Anlegen wäre "Speichern" bzw. "Fahrt anlegen". Pflichtfelder sind nicht markiert. "Neue Fahrt" und "Zurück" sind <button>-Elemente innerhalb von <a>, was ungültiges HTML ist.

**Erwartet:** Alle Felder mit verknüpftem Label, Pflichtfelder markiert, eindeutiger Button-Text.
**Beobachtet:** Siehe Beschreibung.

**Evidenz:** [Formular Neue Fahrt](evidence/E3-Formular_Neue_Fahrt.png)

### [Minor] Suchbegriff wird nach dem Filtern kleingeschrieben im Suchfeld angezeigt

_ux_ · http://127.0.0.1:4310/trips?q=SLN-1

Nach der Suche nach "SLN-1" steht im Suchfeld "sln-1", weil der bereits kleingeschriebene Wert zurückgeschrieben wird. Das Verhalten ist funktional unkritisch, irritiert aber, gerade bei Kennzeichen.

**Erwartet:** Eingegebener Begriff bleibt unverändert stehen.
**Beobachtet:** Begriff wird kleingeschrieben angezeigt.

**Evidenz:** [Suche nach Fahrzeug "SLN-1"](evidence/E2-Suche_nach_Fahrzeug_SLN-1_.png)

### [Minor] Konsolenfehler "TripList: deprecated prop 'rows' used" bei jedem Aufruf der Fahrtenliste

_console_ · http://127.0.0.1:4310/trips

Bei jedem Laden von /trips wird console.error("TripList: deprecated prop 'rows' used") ausgegeben (Inline-Script in src/server.mjs:70). Ob die Zeile aus diesem PR stammt, geht aus dem gekürzten Diff nicht eindeutig hervor; sie steht im geänderten Block.

**Erwartet:** Keine Fehler in der Konsole.
**Beobachtet:** Fehler bei jedem Aufruf der Liste.

**Evidenz:** [Suche nach Fahrgast "mia" (vor Anlegen neuer Fahrten)](evidence/E1-Suche_nach_Fahrgast_mia_vor_Anlegen_neuer_Fahrten_.png), [Admin legt gültige Fahrt #6 an](evidence/E8-Admin_legt_g_ltige_Fahrt_6_an.png)

### [Vorschlag] Erfolgsmeldung zeigt nur interne ID und wird nicht als Statusmeldung ausgezeichnet

_ux_ · http://127.0.0.1:4310/trips?created=6

"Fahrt #6 angelegt." nennt nur die ID statt z. B. Fahrgast/Datum, und der Absatz hat kein role="status". Beim Neuladen bleibt die Meldung stehen, weil sie aus dem Parameter ?created= stammt, und sie lässt sich mit beliebigen Werten fälschen, z. B. ?created=999.

**Evidenz:** [Admin legt gültige Fahrt #6 an](evidence/E8-Admin_legt_g_ltige_Fahrt_6_an.png)

## Kosten

| USD | Input tokens | Output tokens | Turns | Browser steps | Duration |
|---|---|---|---|---|---|
| 1.17 | 2441034 | 16586 | 75 | 29 | 194s |

## Notes

- 2026-10-10T18:31:29.224Z login_as(dispatcher) ok → http://127.0.0.1:4310/dashboard
- 2026-10-10T18:31:29.240Z Code-Analyse: Nur src/server.mjs geändert. Betroffen: GET /trips (Suche, Erfolgsmeldung, Button), GET/POST /trips/new (neu). Kein HTML-Escaping in Liste und Suchfeld; POST /trips/new ohne Server-Validierung und ohne Rollenprüfung; Fahrzeugfeld fehlt, vehicle=null.
- 2026-10-10T18:32:02.817Z Angelegt: Fahrt #3 "claudio-review-pr17-20261010-183117-7fng Vergangen" (Datum 2026-10-01, Vergangenheit) – wurde ohne Fehlermeldung gespeichert.
- 2026-10-10T18:32:36.737Z Angelegt per direktem POST: Fahrt #4 (Fahrgast leer, Datum/Uhrzeit leer, Von="claudio-review-pr17-20261010-183117-7fng-leer") und Fahrt #5 (Fahrgast mit HTML-Markup <i id="claudio-xss">claudio-review-pr17-20261010-183117-7fng html</i>).
- 2026-10-10T18:33:07.207Z login_as(admin) ok → http://127.0.0.1:4310/dashboard
- 2026-10-10T18:33:18.511Z Angelegt als Admin: Fahrt #6 "claudio-review-pr17-20261010-183117-7fng Admin" (2026-11-15 10:30, Rathaus → Bahnhof).
- 2026-10-10T18:33:31.564Z login_as(dispatcher) ok → http://127.0.0.1:4310/dashboard
