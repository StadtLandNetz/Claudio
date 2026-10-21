import { describe, expect, it } from 'vitest';
import { parseNotes } from '../src/lib/notes.js';

describe('parseNotes', () => {
	it('reads one note per line with its time, joining continuation lines', () => {
		const text = [
			'- 2026-10-13T19:15:37.713Z Impact-Analyse: Betroffen /trips.',
			'- 2026-10-13T19:16:11.416Z Testdaten: Fahrt #16 angelegt',
			'  (leerer Fahrgast, Server antwortet 302).',
			'not a note',
			'- nonsense without a time',
			'- 2026-10-13T19:21:08.336Z Wissensbasis stimmt.'
		].join('\n');
		expect(parseNotes(text)).toEqual([
			{ at: '2026-10-13T19:15:37.713Z', text: 'Impact-Analyse: Betroffen /trips.' },
			{ at: '2026-10-13T19:16:11.416Z', text: 'Testdaten: Fahrt #16 angelegt\n(leerer Fahrgast, Server antwortet 302).' },
			{ at: '2026-10-13T19:21:08.336Z', text: 'Wissensbasis stimmt.' }
		]);
	});
	it('copes with empty input', () => {
		expect(parseNotes('')).toEqual([]);
		expect(parseNotes(undefined)).toEqual([]);
	});
});
