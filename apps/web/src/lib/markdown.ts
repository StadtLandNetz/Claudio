import { Marked } from 'marked';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Markdown from the model; raw HTML is shown as text, links open in a new tab. */
const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		html: ({ text }) => escape(text),
		link({ href, tokens }) {
			const label = this.parser.parseInline(tokens);
			if (!/^https?:\/\//i.test(href)) return label;
			return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
		},
		image: ({ text }) => escape(text)
	}
});

export function renderMarkdown(md: string): string {
	return marked.parse(md, { async: false });
}
