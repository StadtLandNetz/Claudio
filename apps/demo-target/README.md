# Demo target

A deliberately buggy mini dispatch app used to verify Claudio end to end without a real repository or deployment.

```sh
node apps/demo-target/src/server.mjs          # http://127.0.0.1:4310
export DEMO_DISPATCHER_USER=dispo@example.test DEMO_DISPATCHER_PASSWORD=dispo
export DEMO_ADMIN_USER=admin@example.test DEMO_ADMIN_PASSWORD=admin
pnpm claudio review --repo vanderlars/dispo-demo --pr 17 --url http://127.0.0.1:4310 \
  --pr-context apps/demo-target/fixtures/pr-context.json --repo-dir apps/demo-target \
  --config apps/demo-target/claudio.config.json --role dispatcher --budget quick
```

Bugs a good review must find (see `fixtures/pr-context.json` for the PR and issue):

1. Search in the trip list returns HTTP 500 once a trip without a vehicle exists (every trip created through the new form).
2. The new form lacks the required vehicle field, allows past dates, has unlabeled Von/Nach inputs and a button labelled "Senden" instead of "Speichern".
3. The server does not validate required fields.
4. The trip list logs a console error on every load.

Bot check fixture: `/geschuetzt` redirects to `/pruefung` ("Ich bin kein Roboter") until a person confirms it. It is not a bug to find; it exercises Claudio's human takeover.
