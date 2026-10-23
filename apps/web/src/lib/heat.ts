// Kept apart from overview.ts, which loads @claudio/core at runtime: the browser needs only this.

/** Intensity 0–4 of a heatmap cell, relative to the busiest week of its row (like GitHub's quartiles). */
export function level(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
	if (count <= 0 || max <= 0) return 0;
	const q = count / max;
	return q > 0.75 ? 4 : q > 0.5 ? 3 : q > 0.25 ? 2 : 1;
}
