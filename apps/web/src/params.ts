// Not '@claudio/core': the build loads this file with plain Node, which cannot follow core's imports.
import { parseRepoPath } from '@claudio/core/repo-path';
import type { ParamMatcher } from '@sveltejs/kit/params';
import { z } from 'zod';

export const params = {
	/** owner/name for GitHub, gitlab/<group>/…/<project> for GitLab; anything else is not a repository page. */
	repo: z.string().refine((path) => parseRepoPath(path) !== null)
} satisfies Record<string, ParamMatcher>;
