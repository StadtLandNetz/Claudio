import { startSignIn } from '#lib/server/oauth-flow.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies, locals }) => startSignIn('github', url, cookies, locals.user);
