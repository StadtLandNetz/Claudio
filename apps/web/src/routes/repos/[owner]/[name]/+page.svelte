<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import OutcomeBadge from '#lib/components/OutcomeBadge.svelte';
	import KnowledgeView from '#lib/components/KnowledgeView.svelte';
	import ReviewTable from '#lib/components/ReviewTable.svelte';
	import StatusBadge from '#lib/components/StatusBadge.svelte';
	import {
		ANALYSIS_BUDGET_LABEL,
		BUDGET_LABEL,
		DETERMINISM_LABEL,
		STRICTNESS_LABEL,
		MODE_LABEL,
		TEST_BUDGET_LABEL,
		formatDate,
		formatUsd,
		isActive
	} from '#lib/labels.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const tabs = [
		{ id: 'pulls', label: 'Pull Requests' },
		{ id: 'reviews', label: 'Reviews' },
		{ id: 'tests', label: 'Tests' },
		{ id: 'knowledge', label: 'Wissen' },
		{ id: 'settings', label: 'Einstellungen' }
	] as const;

	const ready = $derived(data.repo.dataConfirmed && data.roles.length > 0);
	const saved = $derived(form && 'saved' in form ? form.saved : null);
	const runningAnalysis = $derived(data.analyses.find((a) => isActive(a.status)));
	let analyzing = $state(false);
	let runningTests = $state(false);

	// Suite progress refreshes itself while runs are pending.
	const batchActive = $derived(data.batch?.some((r) => isActive(r.status)) ?? false);
	$effect(() => {
		if (!batchActive) return;
		const t = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(t);
	});
	const formError = (name: string) => (form && 'error' in form && form.form === name ? form.error : null);
</script>

<svelte:head><title>{data.repo.fullName} · Claudio</title></svelte:head>

<h1>{data.repo.fullName}</h1>

<nav class="tabs" aria-label="Bereiche">
	{#each tabs as t (t.id)}
		<a href="?tab={t.id}" aria-current={data.tab === t.id ? 'page' : undefined}>
			{t.label}
			{#if t.id === 'reviews' && data.reviews.length}<span class="count">{data.reviews.length}</span>{/if}
			{#if t.id === 'tests' && data.tests.length}<span class="count">{data.tests.length}</span>{/if}
			{#if t.id === 'settings' && !ready}<span class="dot" title="Einrichtung unvollständig"></span>{/if}
			{#if t.id === 'knowledge' && data.knowledge?.stale}<span class="dot" title="Wissensbasis veraltet"></span>{/if}
		</a>
	{/each}
</nav>

{#if data.tab === 'pulls'}
	{#if !ready}
		<p class="notice">
			Bevor Claudio Pull Requests prüfen kann, fehlen noch
			{#if !data.repo.dataConfirmed && data.roles.length === 0}die Datenschutz-Bestätigung und mindestens eine Rolle{:else if !data.repo.dataConfirmed}die Datenschutz-Bestätigung{:else}Zugangsdaten für mindestens eine Rolle{/if}.
			<a href="?tab=settings">Einstellungen öffnen</a>
		</p>
	{/if}
	{#if data.pullsError}
		<p class="notice error">{data.pullsError}</p>
	{:else if data.pulls.length === 0}
		<p class="muted">Keine offenen Pull Requests.</p>
	{:else}
		<ul class="pulls sheet">
			{#each data.pulls as pr (pr.number)}
				<li>
					<div class="pr">
						<a href={pr.url} target="_blank" rel="noopener noreferrer" class="title">#{pr.number} {pr.title}</a>
						<span class="faint">
							{pr.headRef}{pr.author ? `, von ${pr.author}` : ''}, aktualisiert {formatDate(pr.updatedAt)}
							{#if pr.draft}<span class="tag">Entwurf</span>{/if}
							{#if pr.fixture}<span class="tag">Demo-Fixture</span>{/if}
						</span>
					</div>
					{#if ready}
						<a class="btn small primary" href="/reviews/new?repo={encodeURIComponent(data.repo.fullName)}&pr={pr.number}">Review starten</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{:else if data.tab === 'tests'}
	{#if data.batch}
		{@const done = data.batch.filter((r) => !isActive(r.status)).length}
		<section class="batch">
			<h2>Suite-Lauf</h2>
			<p class="muted">
				{done} von {data.batch.length} Tests fertig{#if done === data.batch.length}:
					{data.batch.filter((r) => r.outcome === 'passed').length} bestanden,
					{data.batch.filter((r) => r.outcome === 'failed').length} fehlgeschlagen{/if}.
			</p>
			<div class="sheet table">
				<table class="list">
					<thead><tr><th>Test</th><th>Ergebnis</th><th>Art</th><th class="num">Kosten</th></tr></thead>
					<tbody>
						{#each data.batch as run (run.id)}
							<tr>
								<td><a href="/test-runs/{run.id}">{run.scriptName}</a></td>
								<td><OutcomeBadge status={run.status} outcome={run.outcome} healed={run.healed} /></td>
								<td>{run.mode ? MODE_LABEL[run.mode] : '–'}</td>
								<td class="num">{formatUsd(run.costUsd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	{#if data.tests.length}
		<div class="sheet table">
			<table class="list">
				<thead>
					<tr><th>Test</th><th>Art</th><th class="num">Schritte</th><th>Letzter Lauf</th><th>Bei Reviews</th></tr>
				</thead>
				<tbody>
					{#each data.tests as test (test.id)}
						<tr>
							<td><a href="/tests/{test.id}">{test.name}</a></td>
							<td>{test.determinism ? DETERMINISM_LABEL[test.determinism] : 'Noch nicht aufgezeichnet'}</td>
							<td class="num">{test.stepCount || '–'}</td>
							<td>
								{#if test.lastStatus}
									<OutcomeBadge status={test.lastStatus} outcome={test.lastOutcome} healed={test.lastHealed} />
									<span class="faint">{formatDate(test.lastRunAt)}</span>
								{:else}–{/if}
							</td>
							<td>{test.runInReviews ? 'Ja' : 'Nein'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<section class="empty-kb">
			<h2>Noch keine Tests</h2>
			<p class="muted">
				Beschreibe einen Ablauf und was am Ende stimmen muss. Beim ersten Lauf führt Claudio ihn im Browser aus und zeichnet die Schritte
				auf. Danach laufen sie ohne Modell in Sekunden, auch automatisch bei jedem PR-Review.
			</p>
		</section>
	{/if}

	{#if data.tests.length && !data.activeTestRuns}
		<details class="sheet analyze" open={!!formError('runTests')}>
			<summary><strong>Alle Tests ausführen</strong></summary>
			<form method="POST" action="?/runTests" class="fields" onsubmit={() => (runningTests = true)}>
				{#if formError('runTests')}<p class="notice error" role="alert">{formError('runTests')}</p>{/if}
				<label class="field">
					<span>Adresse der Instanz</span>
					<input type="url" name="instanceUrl" required value={data.repo.defaultInstanceUrl} placeholder="https://staging.example.de" />
				</label>
				<label class="field">
					<span>Budget pro Test</span>
					<select name="budget">
						{#each Object.entries(TEST_BUDGET_LABEL) as [value, label] (value)}
							<option {value} selected={value === 'quick'}>{label}</option>
						{/each}
					</select>
					<small>Gilt nur, wenn ein Test aufgezeichnet, repariert oder bewertet werden muss. Reine Wiedergaben kosten nichts.</small>
				</label>
				<div class="actions">
					<button class="btn primary" type="submit" disabled={runningTests}>{runningTests ? 'Wird eingereiht …' : `${data.tests.length} Tests ausführen`}</button>
				</div>
			</form>
		</details>
	{:else if data.activeTestRuns}
		<p class="notice">{data.activeTestRuns} Testläufe warten oder laufen gerade.</p>
	{/if}

	<details class="sheet analyze" open={data.tests.length === 0 || !!formError('createTest')}>
		<summary><strong>Neuer Test</strong></summary>
		<form method="POST" action="?/createTest" class="fields">
			{#if formError('createTest')}<p class="notice error" role="alert">{formError('createTest')}</p>{/if}
			<label class="field">
				<span>Name</span>
				<input type="text" name="name" required placeholder="Fahrt anlegen" />
			</label>
			<label class="field">
				<span>Ablauf</span>
				<textarea name="description" rows="3" required placeholder="Als Disponent eine Fahrt für morgen anlegen: Fahrgast, Uhrzeit 08:30, von Rathaus nach Schule."></textarea>
				<small>So, wie du es einer Kollegin erklären würdest. Claudio legt eindeutige Testdaten selbst an.</small>
			</label>
			<label class="field">
				<span>Erwartetes Ergebnis</span>
				<textarea name="expectation" rows="2" required placeholder="Nach dem Speichern erscheint eine Erfolgsmeldung und die Fahrt steht mit allen Angaben in der Liste."></textarea>
			</label>
			<fieldset>
				<legend>Rollen</legend>
				<div class="options">
					{#each data.roles as role (role.name)}
						<label class="check"><input type="checkbox" name="roles" value={role.name} /> <span>{role.name}</span></label>
					{/each}
				</div>
			</fieldset>
			<fieldset>
				<legend>Andere Websites</legend>
				<label class="field">
					<span>Weitere erlaubte Hosts</span>
					<input type="text" name="allowedHosts" placeholder="google.com, login.example.de" />
					<small>Standardmäßig bleibt der Test auf der Instanz. Hier eingetragene Hosts darf er zusätzlich öffnen; mehrere mit Komma trennen, Subdomains sind mit erlaubt.</small>
				</label>
				<label class="check">
					<input type="checkbox" name="allowAnyHost" />
					<span>Beliebige Websites erlauben <span class="faint">Nur für Tests, die bewusst im offenen Web arbeiten. Große Suchmaschinen zeigen automatisierten Browsern oft ein Captcha.</span></span>
				</label>
			</fieldset>
			<label class="check">
				<input type="checkbox" name="runInReviews" checked />
				<span>Bei jedem PR-Review als Regressionstest mitlaufen lassen</span>
			</label>
			<div class="actions"><button class="btn primary" type="submit">Test anlegen</button></div>
		</form>
	</details>
{:else if data.tab === 'knowledge'}
	{#if runningAnalysis}
		<p class="notice">
			Eine Analyse {runningAnalysis.status === 'queued' ? 'wartet auf den Worker' : 'läuft gerade'}.
			<a href="/analyses/{runningAnalysis.id}">Verlauf ansehen</a>
		</p>
	{/if}

	{#if data.knowledge}
		<div class="kb-head">
			<p>
				Stand: Commit <code>{data.knowledge.commitSha.slice(0, 7)}</code>{data.knowledge.branch ? ` auf ${data.knowledge.branch}` : ''},
				analysiert {formatDate(data.knowledge.analyzedAt)} von {data.knowledge.startedBy}.
				<a href="/analyses/{data.knowledge.analysisId}">Lauf ansehen</a>
			</p>
			{#if data.knowledge.stale}
				<p class="notice">
					Seit der Analyse hat sich {data.knowledge.branch} geändert (jetzt <code>{data.knowledge.headSha?.slice(0, 7)}</code>). Aktualisiere die
					Wissensbasis, damit Reviews vom aktuellen Stand ausgehen. Ein Update prüft nur, was sich geändert hat.
				</p>
			{/if}
			{#if !data.knowledge.complete}
				<p class="notice">Die letzte Analyse wurde nicht vollständig abgeschlossen. Die Dokumente können Lücken haben.</p>
			{/if}
		</div>
		<KnowledgeView docs={data.knowledge.docs} />
		<p class="faint kb-use">Jeder Review dieses Repositorys bekommt diese Wissensbasis mit.</p>
	{:else if !runningAnalysis}
		<section class="empty-kb">
			<h2>Noch keine Wissensbasis</h2>
			<p class="muted">
				Bei einer Analyse liest Claudio den Code und geht die laufende App Bildschirm für Bildschirm durch. Heraus kommen fünf Dokumente:
				Überblick, Module, Routen, App-Karte mit dem erwarteten Verhalten jedes Bildschirms und Notizen. Reviews nutzen sie, um betroffene
				Bereiche schneller zu finden und Abweichungen vom bisherigen Verhalten zu erkennen.
			</p>
		</section>
	{/if}

	{#if !runningAnalysis}
		{#if !ready}
			<p class="notice">
				Für eine Analyse braucht Claudio Rollen und die Datenschutz-Bestätigung. <a href="?tab=settings">Einstellungen öffnen</a>
			</p>
		{:else}
			<details class="sheet analyze" open={!data.knowledge || !!formError('analyze')}>
				<summary><strong>{data.knowledge ? 'Wissensbasis aktualisieren' : 'Analyse starten'}</strong></summary>
				<form method="POST" action="?/analyze" class="fields" onsubmit={() => (analyzing = true)}>
					{#if formError('analyze')}<p class="notice error" role="alert">{formError('analyze')}</p>{/if}
					<label class="field">
						<span>Adresse einer laufenden Instanz</span>
						<input type="url" name="instanceUrl" required value={data.repo.defaultInstanceUrl} placeholder="https://staging.example.de" />
						<small>Am besten der Stand des Hauptbranches, z. B. Staging. Der Browser bleibt auf diesem Host.</small>
					</label>
					<fieldset>
						<legend>Rollen</legend>
						<div class="options">
							{#each data.roles as role (role.name)}
								<label class="check"><input type="checkbox" name="roles" value={role.name} checked /> <span>{role.name}</span></label>
							{/each}
						</div>
						<small>Claudio schaut sich die App mit jeder gewählten Rolle an.</small>
					</fieldset>
					<div class="grid">
						<label class="field">
							<span>Budget</span>
							<select name="budget">
								{#each Object.entries(ANALYSIS_BUDGET_LABEL) as [value, label] (value)}
									<option {value} selected={value === (data.knowledge ? 'quick' : 'standard')}>{label}</option>
								{/each}
							</select>
						</label>
					</div>
					<label class="field">
						<span>Zusätzliche Anweisungen (optional)</span>
						<textarea name="extraInstructions" rows="2" placeholder="z. B. Den Abrechnungsbereich auslassen."></textarea>
					</label>
					<div class="actions">
						<button class="btn primary" type="submit" disabled={analyzing}>
							{analyzing ? 'Wird eingereiht …' : data.knowledge ? 'Wissensbasis aktualisieren' : 'Analyse starten'}
						</button>
					</div>
				</form>
			</details>
		{/if}
	{/if}

	{#if data.analyses.length}
		<section class="history">
			<h2>Bisherige Analysen</h2>
			<div class="sheet table">
				<table class="list">
					<thead>
						<tr><th>Gestartet</th><th>Status</th><th>Commit</th><th class="num">Dokumente</th><th class="num">Kosten</th></tr>
					</thead>
					<tbody>
						{#each data.analyses as an (an.id)}
							<tr>
								<td><a href="/analyses/{an.id}">{formatDate(an.createdAt)}</a> <span class="faint">von {an.startedBy}</span></td>
								<td><StatusBadge status={an.status} /></td>
								<td>{#if an.commitSha}<code>{an.commitSha.slice(0, 7)}</code>{:else}–{/if}</td>
								<td class="num">{an.docCount || '–'}</td>
								<td class="num">{formatUsd(an.costUsd)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
{:else if data.tab === 'reviews'}
	{#if data.reviews.length}
		<section class="sheet table"><ReviewTable reviews={data.reviews} showRepo={false} /></section>
	{:else}
		<p class="muted">Für dieses Repository gibt es noch keine Reviews.</p>
	{/if}
{:else}
	{#if data.isNew}
		<p class="notice ok">Repository hinzugefügt. Lege jetzt fest, als wer Claudio sich in der App anmeldet.</p>
	{/if}

	<section class="part">
		<div class="intro">
			<h2>Allgemein</h2>
			<p class="muted">Hinweise für den Agenten und wo die Instanzen der Pull Requests laufen.</p>
		</div>
		<form method="POST" action="?/settings" use:enhance={() => ({ update }) => update({ reset: false })} class="sheet fields">
			{#if formError('settings')}<p class="notice error" role="alert">{formError('settings')}</p>{/if}
			<label class="field">
				<span>Hinweise zur App</span>
				<textarea name="notes" rows="4" placeholder="Fachbegriffe, Hauptobjekte, Datumsformat, heikle Bereiche">{data.repo.notes}</textarea>
				<small>Claudio liest das vor jedem Review. Gut sind Domänenbegriffe und bekannte Eigenheiten.</small>
			</label>
			<label class="field">
				<span>Standard-URL der Instanz</span>
				<input type="url" name="defaultInstanceUrl" value={data.repo.defaultInstanceUrl} placeholder="https://pr-123.preview.example.de" />
				<small>Wird beim Start eines Reviews vorgeschlagen und lässt sich dort ändern.</small>
			</label>
			<label class="field">
				<span>Weitere erlaubte Hosts</span>
				<input type="text" name="extraAllowedHosts" value={data.repo.extraAllowedHosts.join(', ')} placeholder="auth.example.de, login.example.com" />
				<small>Der Browser darf nur die Instanz besuchen und diese Hosts, z. B. einen Login-Anbieter. Mehrere mit Komma trennen; Subdomains sind mit erlaubt, ganze URLs werden auf den Host gekürzt. Gilt für Reviews, Analysen und alle Tests.</small>
			</label>
			<label class="check">
				<input type="checkbox" name="dataConfirmed" checked={data.repo.dataConfirmed} />
				<span>
					Die geprüften Instanzen enthalten nur Testdaten.
					<span class="faint">Screenshots und Seiteninhalte gehen an Anthropic. Ohne diese Bestätigung startet Claudio keinen Review.</span>
				</span>
			</label>
			<div class="actions">
				<button class="btn primary" type="submit">Einstellungen speichern</button>
				{#if saved === 'settings'}<span class="ok" role="status">Gespeichert</span>{/if}
			</div>
		</form>
	</section>

	<section class="part">
		<div class="intro">
			<h2>Automatisierung</h2>
			<p class="muted">Reviews direkt aus GitHub starten und das Ergebnis am Pull Request anzeigen.</p>
		</div>
		<div class="fields">
			<form method="POST" action="?/automation" use:enhance={() => ({ update }) => update({ reset: false })} class="sheet fields">
				{#if formError('automation')}<p class="notice error" role="alert">{formError('automation')}</p>{/if}
				<label class="field">
					<span>URL-Vorlage der PR-Instanzen</span>
					<input type="text" name="instanceUrlTemplate" value={data.automation.instanceUrlTemplate} placeholder="https://pr-{'{pr}'}.preview.example.de" />
					<small>Platzhalter: {'{pr}'} Nummer, {'{branch_slug}'} Branch als URL-Teil, {'{branch}'}, {'{sha}'}. Ohne Vorlage startet GitHub keine Reviews.</small>
				</label>
				<fieldset>
					<legend>Review starten bei</legend>
					<label class="check"><input type="checkbox" name="onComment" checked={data.automation.onComment} /> <span>Kommentar <code>/claudio review</code> im PR <span class="faint">(optional mit quick, standard oder thorough)</span></span></label>
					<label class="check"><input type="checkbox" name="onLabel" checked={data.automation.onLabel} /> <span>Label <code>claudio-review</code> am PR</span></label>
					<label class="check"><input type="checkbox" name="onPush" checked={data.automation.onPush} /> <span>Jedem neuen und aktualisierten PR <span class="faint">(außer Entwürfen; kostet pro Push)</span></span></label>
				</fieldset>
				<label class="check"><input type="checkbox" name="commitStatus" checked={data.automation.commitStatus} /> <span>Ergebnis als GitHub-Status „Claudio“ am Commit setzen <span class="faint">(per Branch-Schutz als Pflicht-Check nutzbar)</span></span></label>
				<label class="check"><input type="checkbox" name="analyzeOnMerge" checked={data.automation.analyzeOnMerge} /> <span>Wissensbasis nach jedem Push auf {data.repo.defaultBranch ?? 'den Hauptbranch'} aktualisieren <span class="faint">(gegen die Standard-URL)</span></span></label>
				<fieldset>
					<legend>Automatische Reviews</legend>
					<div class="options">
						{#each data.roles as role (role.name)}
							<label class="check"><input type="checkbox" name="autoRoles" value={role.name} checked={data.autoReview.roles.includes(role.name)} /> <span>{role.name}</span></label>
						{/each}
					</div>
					<div class="grid">
						<label class="field">
							<span>Budget</span>
							<select name="autoBudget">
								{#each Object.entries(BUDGET_LABEL) as [value, label] (value)}<option {value} selected={data.autoReview.budget === value}>{label}</option>{/each}
							</select>
						</label>
						<label class="field">
							<span>Strenge</span>
							<select name="autoStrictness">
								{#each Object.entries(STRICTNESS_LABEL) as [value, label] (value)}<option {value} selected={data.autoReview.strictness === value}>{label}</option>{/each}
							</select>
						</label>
					</div>
					<label class="check"><input type="checkbox" name="autoComment" checked={data.autoReview.postComment} /> <span>Kurzfassung als Kommentar in den PR schreiben</span></label>
					<label class="check"><input type="checkbox" name="autoTests" checked={data.autoReview.runTests} /> <span>Regressionstests mitlaufen lassen</span></label>
				</fieldset>
				<div class="actions">
					<button class="btn primary" type="submit">Automatisierung speichern</button>
					{#if saved === 'automation'}<span class="ok" role="status">Gespeichert</span>{/if}
				</div>
			</form>

			<div class="sheet fields hook">
				<h3>Webhook</h3>
				{#if formError('webhook')}<p class="notice error" role="alert">{formError('webhook')}</p>{/if}
				{#if data.webhook}
					<p>
						<span class="dot-ok" class:bad={data.webhook.ok === false}></span>
						Eingerichtet (ID {data.webhook.id}). <span class="faint">{data.webhook.status}</span>
					</p>
				{:else}
					<p class="muted">Noch nicht eingerichtet. Claudio legt den Webhook mit deinem GitHub-Zugang an; dafür brauchst du Admin-Rechte am Repository. Automatische Läufe laufen danach in deinem Namen.</p>
				{/if}
				<p class="faint">Ziel: <code>{data.webhookUrl}</code></p>
				{#if data.localBaseUrl}
					<p class="notice">
						GitHub kann <code>localhost</code> nicht erreichen. Setze <code>PUBLIC_BASE_URL</code> auf eine öffentliche Adresse (Server oder Tunnel wie cloudflared), bevor du den Webhook einrichtest.
					</p>
				{/if}
				<div class="actions">
					<form method="POST" action="?/installWebhook" use:enhance>
						<button class="btn {data.webhook ? '' : 'primary'}" type="submit">{data.webhook ? 'Neu einrichten' : 'Webhook einrichten'}</button>
					</form>
					{#if data.webhook}
						<form method="POST" action="?/removeWebhook" use:enhance>
							<button class="btn danger" type="submit">Entfernen</button>
						</form>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>Rollen</h2>
			<p class="muted">
				Benutzerkonten, mit denen Claudio sich anmeldet. Die Zugangsdaten werden verschlüsselt gespeichert und nie an das Modell
				gegeben.
			</p>
		</div>
		<div class="roles">
			{#if formError('role')}<p class="notice error" role="alert">{formError('role')}</p>{/if}
			{#each data.roles as role (role.name)}
				<details class="sheet role">
					<summary>
						<strong>{role.name}</strong>
						<span class="faint">{role.description || 'ohne Beschreibung'}, {role.username}</span>
						{#if saved === `role:${role.name}`}<span class="ok" role="status">Gespeichert</span>{/if}
					</summary>
					{@render roleForm(role)}
					<form method="POST" action="?/deleteRole" class="delete">
						<input type="hidden" name="name" value={role.name} />
						<button class="btn small danger" type="submit">Rolle löschen</button>
					</form>
				</details>
			{/each}
			<details class="sheet role" open={data.roles.length === 0}>
				<summary><strong>Neue Rolle</strong></summary>
				{@render roleForm(null)}
			</details>
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>Gelernte Entscheidungen</h2>
			<p class="muted">Entstehen, wenn jemand ein Finding mit Begründung verwirft. Jeder spätere Review bekommt sie als „gewollt, nicht melden“ mit.</p>
		</div>
		<div>
			{#if data.lessons.length}
				<ul class="lessons sheet">
					{#each data.lessons as lesson (lesson.reviewId + lesson.findingId)}
						<li>
							<div>
								<p>{lesson.text}</p>
								<span class="faint"><a href="/reviews/{lesson.reviewId}">Review #{lesson.reviewId}</a>, {lesson.by}, {formatDate(lesson.at)}</span>
							</div>
							<form method="POST" action="?/removeLesson" use:enhance>
								<input type="hidden" name="reviewId" value={lesson.reviewId} />
								<input type="hidden" name="findingId" value={lesson.findingId} />
								<button class="btn small" type="submit">Vergessen</button>
							</form>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted">Noch keine.</p>
			{/if}
		</div>
	</section>

	<section class="part">
		<div class="intro">
			<h2>Entfernen</h2>
			<p class="muted">Nimmt das Repository aus Claudio heraus. Auf GitHub ändert sich nichts.</p>
		</div>
		<form method="POST" action="?/remove" class="fields">
			{#if formError('remove')}<p class="notice error" role="alert">{formError('remove')}</p>{/if}
			<div><button class="btn danger" type="submit">Repository entfernen</button></div>
		</form>
	</section>
{/if}

{#snippet roleForm(role: (typeof data.roles)[number] | null)}
	<form method="POST" action="?/role" use:enhance={() => ({ update }) => update({ reset: !role })} class="fields">
		<div class="grid">
			<label class="field">
				<span>Name</span>
				<input type="text" name="name" value={role?.name ?? ''} readonly={!!role} required placeholder="dispatcher" />
			</label>
			<label class="field">
				<span>Beschreibung</span>
				<input type="text" name="description" value={role?.description ?? ''} placeholder="Disponent: plant Fahrten" />
			</label>
			<label class="field">
				<span>Benutzername</span>
				<input type="text" name="username" value={role?.username ?? ''} autocomplete="off" required={!role} />
			</label>
			<label class="field">
				<span>Passwort</span>
				<input
					type="password"
					name="password"
					autocomplete="new-password"
					required={!role}
					placeholder={role ? 'Unverändert lassen' : ''}
				/>
			</label>
			<label class="field">
				<span>Login-Pfad</span>
				<input type="text" name="loginPath" value={role?.loginPath ?? '/login'} />
			</label>
			<label class="field">
				<span>Erfolgreich, wenn URL enthält</span>
				<input type="text" name="successUrlContains" value={role?.successUrlContains ?? ''} placeholder="/dashboard" />
			</label>
		</div>
		<label class="field">
			<span>Login-Rezept (optional)</span>
			<textarea name="recipe" rows="3" class="code" placeholder={'[{ "action": "goto", "url": "/login" }, …]'}>{role?.recipe ?? ''}</textarea>
			<small>Nur nötig, wenn die automatische Anmeldung das Formular nicht findet. $USER und $PASSWORD werden ersetzt.</small>
		</label>
		<div class="actions"><button class="btn primary" type="submit">{role ? 'Rolle speichern' : 'Rolle anlegen'}</button></div>
	</form>
{/snippet}

<style>
	h1 {
		word-break: break-word;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin: 1.25rem 0 1.5rem;
		border-bottom: 1px solid var(--rule);
		overflow-x: auto;
	}
	.tabs a {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.55rem 0.8rem;
		color: var(--ink-2);
		font-weight: 600;
		text-decoration: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		white-space: nowrap;
	}
	.tabs a[aria-current='page'] {
		color: var(--ink);
		border-color: var(--petrol);
	}
	.count {
		font-size: 0.75rem;
		background: var(--sunken);
		border-radius: 999px;
		padding: 0 0.45rem;
	}
	.dot {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--major);
	}
	.notice {
		margin-bottom: 1rem;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pulls li {
		display: flex;
		align-items: center;
		gap: 0.75rem 1rem;
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--rule);
		flex-wrap: wrap;
	}
	.pulls li:last-child {
		border-bottom: 0;
	}
	.pr {
		flex: 1;
		min-width: 14rem;
		display: grid;
	}
	.pr .title {
		font-weight: 700;
		color: var(--ink);
	}
	.tag {
		font-size: 0.75rem;
		border: 1px solid var(--rule-strong);
		border-radius: 999px;
		padding: 0 0.45rem;
		margin-left: 0.35rem;
	}
	.table {
		padding: 0.25rem 0.5rem;
	}
	.part {
		display: grid;
		grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
		gap: 1.5rem 2.5rem;
		padding: 1.75rem 0;
		border-top: 1px solid var(--rule);
	}
	.part:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	.intro p {
		margin-top: 0.35rem;
		font-size: 0.9375rem;
	}
	.fields {
		display: grid;
		gap: 1rem;
	}
	form.sheet,
	.sheet.hook {
		padding: 1.25rem;
	}
	.hook > p,
	.hook .notice {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 1rem;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.ok {
		color: var(--pass);
		font-weight: 600;
		font-size: 0.875rem;
	}
	.roles {
		display: grid;
		gap: 0.6rem;
		align-content: start;
	}
	.role summary {
		cursor: pointer;
		padding: 0.8rem 1rem;
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.role[open] summary {
		border-bottom: 1px solid var(--rule);
	}
	.role > form {
		padding: 1rem;
	}
	.role .delete {
		padding-top: 0;
	}
	.code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8125rem;
	}
	input[readonly] {
		background: var(--sunken);
		color: var(--ink-2);
	}
	.hook h3 {
		font-size: 1rem;
	}
	.dot-ok {
		display: inline-block;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--pass);
		margin-right: 0.3rem;
	}
	.dot-ok.bad {
		background: var(--block);
	}
	.lessons {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lessons li {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--rule);
	}
	.lessons li:last-child {
		border-bottom: 0;
	}
	.kb-head {
		display: grid;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.kb-head .notice {
		margin: 0;
	}
	.kb-use {
		margin-top: 0.75rem;
	}
	.empty-kb {
		display: grid;
		gap: 0.5rem;
		max-width: 46rem;
		margin-bottom: 1.25rem;
	}
	.analyze {
		margin-top: 1.5rem;
		max-width: 46rem;
	}
	.analyze summary {
		padding: 0.8rem 1rem;
		cursor: pointer;
	}
	.analyze[open] summary {
		border-bottom: 1px solid var(--rule);
	}
	.analyze form {
		padding: 1.25rem;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.4rem;
	}
	legend {
		font-weight: 600;
		font-size: 0.9375rem;
		margin-bottom: 0.4rem;
		padding: 0;
	}
	fieldset small {
		color: var(--ink-3);
		font-size: 0.8125rem;
	}
	.options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.batch {
		display: grid;
		gap: 0.6rem;
		margin-bottom: 2rem;
	}
	.history {
		margin-top: 2rem;
		display: grid;
		gap: 0.75rem;
	}
	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.875em;
	}
	@media (max-width: 760px) {
		.part {
			grid-template-columns: 1fr;
		}
	}
</style>
