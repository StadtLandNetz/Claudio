import type { Locale } from '#lib/i18n/index.js';
import type { SessionUser } from '#lib/server/auth.js';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			locale: Locale;
		}
	}
}

export {};
