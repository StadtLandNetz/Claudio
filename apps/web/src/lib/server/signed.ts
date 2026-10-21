import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretKey } from '@claudio/db';

/**
 * Signed links to single screenshots, for places that cannot sign in (a GitHub
 * issue shows its images through GitHub's image proxy). A link opens exactly one
 * evidence image of one run and nothing else; it works as long as the image is kept.
 */
const sign = (runId: string, path: string) =>
	createHmac('sha256', Buffer.concat([secretKey(), Buffer.from(':public-evidence')]))
		.update(`${runId}\n${path}`)
		.digest('base64url')
		.slice(0, 32);

export const isEvidencePath = (path: string) => /^evidence\/[\w.-]+\.(png|jpe?g|webp)$/i.test(path);

export function publicEvidenceUrl(baseUrl: string, runId: string, path: string): string | null {
	if (!isEvidencePath(path)) return null;
	return `${baseUrl}/public/runs/${runId}/${path.split('/').map(encodeURIComponent).join('/')}?sig=${sign(runId, path)}`;
}

export function verifyEvidenceSignature(runId: string, path: string, sig: string | null): boolean {
	if (!sig || !isEvidencePath(path)) return false;
	const want = Buffer.from(sign(runId, path));
	const got = Buffer.from(sig);
	return want.length === got.length && timingSafeEqual(want, got);
}
