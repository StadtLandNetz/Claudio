import { finishSignIn } from '#lib/server/oauth-flow.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies, locals }) => finishSignIn('github', url, cookies, locals.user);
