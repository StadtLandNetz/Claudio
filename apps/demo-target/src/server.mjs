// Minimal "Disposition" app: login, trip list, trip creation. Contains deliberate bugs
// that a review must find (see fixtures/pr-context.json for the PR under review).
import { createServer } from "node:http";

const USERS = { "dispo@example.test": { password: "dispo", role: "dispatcher", name: "Dana Dispo" }, "admin@example.test": { password: "admin", role: "admin", name: "Alex Admin" } };
const sessions = new Map();
let trips = [
  { id: 1, passenger: "Mia Muster", date: "2026-10-12", time: "07:30", from: "Hauptstr. 1", to: "Grundschule Nord", vehicle: "SLN-1" },
  { id: 2, passenger: "Ben Beispiel", date: "2026-10-12", time: "13:15", from: "Grundschule Nord", to: "Hauptstr. 1", vehicle: "SLN-1" },
];

const page = (title, body, user) => `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title} · Dispo Demo</title>
<style>body{font-family:system-ui;margin:0;background:#f6f7f9;color:#222}header{background:#1f3a5f;color:#fff;padding:12px 24px;display:flex;gap:24px;align-items:center}header a{color:#fff}main{padding:24px;max-width:960px}table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #ddd;padding:8px;text-align:left}label{display:block;margin:8px 0 4px}input,select{padding:6px;width:260px}button{background:#1f3a5f;color:#fff;border:0;padding:8px 14px;border-radius:4px}.err{color:#b00020}.ok{color:#0a7a2a}.btn-secondary{background:#999}</style></head>
<body><header><strong>Dispo Demo</strong><a href="/dashboard">Übersicht</a><a href="/trips">Fahrten</a>${user ? `<span style="margin-left:auto">${user.name} (${user.role})</span><a href="/logout">Abmelden</a>` : ""}</header><main>${body}</main></body></html>`;

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").map((c) => c.trim().split("=")).filter((p) => p[0]));
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  return sid ? sessions.get(sid) : undefined;
}
function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(new URLSearchParams(b))); });
}
function redirect(res, to) { res.statusCode = 302; res.setHeader("location", to); res.end(); }
function html(res, s, status = 200) { res.statusCode = status; res.setHeader("content-type", "text/html; charset=utf-8"); res.end(s); }
function json(res, data, status = 200) { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data)); }

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const user = currentUser(req);
  const p = url.pathname;

  if (p === "/" ) return redirect(res, user ? "/dashboard" : "/login");
  if (p === "/login" && req.method === "GET") {
    return html(res, page("Anmelden", `<h1>Anmelden</h1>${url.searchParams.get("error") ? `<p class="err" role="alert">E-Mail oder Passwort falsch.</p>` : ""}<form method="post" action="/login"><label>E-Mail</label><input name="email" type="email" autocomplete="username" required><label>Passwort</label><input name="password" type="password" autocomplete="current-password" required><p><button type="submit">Anmelden</button></p></form>`));
  }
  if (p === "/login" && req.method === "POST") {
    const b = await readBody(req);
    const u = USERS[b.get("email") ?? ""];
    if (!u || u.password !== b.get("password")) return redirect(res, "/login?error=1");
    const sid = Math.random().toString(36).slice(2);
    sessions.set(sid, u);
    res.setHeader("set-cookie", `sid=${sid}; Path=/; HttpOnly`);
    return redirect(res, "/dashboard");
  }
  if (p === "/logout") { res.setHeader("set-cookie", "sid=; Path=/; Max-Age=0"); return redirect(res, "/login"); }
  if (!user) return redirect(res, "/login");

  if (p === "/dashboard") {
    return html(res, page("Übersicht", `<h1>Übersicht</h1><p>Heute: ${trips.filter((t) => t.date === "2026-10-12").length} Fahrten.</p><p><a href="/trips">Zu den Fahrten</a></p><script>fetch('/api/stats').then(r=>r.json()).then(s=>console.log('stats',s))</script>`, user));
  }
  if (p === "/api/stats") return json(res, { trips: trips.length });
  if (p === "/trips" && req.method === "GET") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    // BUG 1: the new search filter throws on trips without a vehicle (null.toLowerCase) → 500
    let rows;
    try {
      rows = trips.filter((t) => !q || t.passenger.toLowerCase().includes(q) || t.vehicle.toLowerCase().includes(q));
    } catch (e) {
      return html(res, page("Fehler", `<h1>Interner Fehler</h1><pre>${e.message}</pre>`, user), 500);
    }
    const created = url.searchParams.get("created");
    return html(res, page("Fahrten", `<h1>Fahrten</h1>${created ? `<p class="ok">Fahrt #${created} angelegt.</p>` : ""}
<form method="get" action="/trips"><label>Suche (Fahrgast oder Fahrzeug)</label><input name="q" value="${q}"> <button type="submit">Filtern</button></form>
<p><a href="/trips/new"><button type="button">Neue Fahrt</button></a></p>
<table><thead><tr><th>#</th><th>Fahrgast</th><th>Datum</th><th>Uhrzeit</th><th>Von</th><th>Nach</th><th>Fahrzeug</th></tr></thead><tbody>
${rows.map((t) => `<tr><td>${t.id}</td><td>${t.passenger}</td><td>${t.date}</td><td>${t.time}</td><td>${t.from}</td><td>${t.to}</td><td>${t.vehicle ?? "-"}</td></tr>`).join("")}
</tbody></table><script>console.error("TripList: deprecated prop 'rows' used");</script>`, user));
  }
  if (p === "/trips/new" && req.method === "GET") {
    if (user.role !== "dispatcher" && user.role !== "admin") return html(res, page("Verboten", "<h1>Kein Zugriff</h1>", user), 403);
    // BUG 2 (UX): no field labels for Von/Nach, button says "Senden", no vehicle field although AC requires it, date accepts past dates
    return html(res, page("Neue Fahrt", `<h1>Neue Fahrt</h1><form method="post" action="/trips/new">
<label>Fahrgast</label><input name="passenger" required>
<label>Datum</label><input name="date" type="date" required>
<label>Uhrzeit</label><input name="time" type="time" required>
<input name="from" placeholder="Von"> <input name="to" placeholder="Nach">
<p><button type="submit">Senden</button> <a href="/trips"><button type="button" class="btn-secondary">Zurück</button></a></p></form>`, user));
  }
  if (p === "/trips/new" && req.method === "POST") {
    const b = await readBody(req);
    const trip = { id: trips.length + 1, passenger: b.get("passenger") ?? "", date: b.get("date") ?? "", time: b.get("time") ?? "", from: b.get("from") ?? "", to: b.get("to") ?? "", vehicle: null };
    // BUG 3: server does not validate; empty passenger is accepted when the browser validation is bypassed
    trips.push(trip);
    return redirect(res, `/trips?created=${trip.id}`);
  }
  if (p === "/api/trips") return json(res, trips);
  return html(res, page("404", "<h1>Seite nicht gefunden</h1>", user), 404);
});

const port = Number(process.env.PORT ?? 4310);
server.listen(port, "127.0.0.1", () => console.log(`demo target on http://127.0.0.1:${port} (dispo@example.test/dispo, admin@example.test/admin)`));
