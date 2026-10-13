import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** Liveness/readiness for Kubernetes: the app answers and reaches the database. Public, no data. */
export const GET: RequestHandler = async () => {
	try {
		await db().execute(sql`SELECT 1`);
		return json({ ok: true });
	} catch (err) {
		return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 503 });
	}
};
