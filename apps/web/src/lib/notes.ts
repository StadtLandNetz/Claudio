export type RunNote = { at: string; text: string };

/**
 * The agent's working notes as the run store writes them into the report:
 * one `- <ISO time> text` line per note, continuation lines indented.
 */
export function parseNotes(text: string | null | undefined): RunNote[] {
	const out: RunNote[] = [];
	for (const line of (text ?? '').split('\n')) {
		const m = line.match(/^- (\d{4}-\d{2}-\d{2}T\S+) (.*)$/);
		if (m) out.push({ at: m[1]!, text: m[2]!.trim() });
		else if (out.length && /^\s+\S/.test(line)) out[out.length - 1]!.text += `\n${line.trim()}`;
	}
	return out.filter((n) => n.text && Number.isFinite(Date.parse(n.at)));
}
