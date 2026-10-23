let seq = 0;

/**
 * A short explanation in a small bubble above the element (below when there is no
 * room), on hover and on keyboard focus; elements that do nothing else toggle it on
 * click, so it works on touch screens too. The bubble lives in the top layer, so
 * scrolling containers and dialogs do not clip it, and it is only created when first
 * shown, so even hundreds of ticks on a timeline cost nothing. Use it instead of `title`.
 */
export function tooltip(node: HTMLElement, text: string | null | undefined) {
	let content = text ?? '';
	let tip: HTMLDivElement | null = null;
	// A tag or badge only explains; a button or link has its own click.
	const passive = !node.matches('a, button, input, select, textarea, summary, [role="button"], [role="slider"]');
	const label = node.getAttribute('aria-label');
	// Screen readers get the text right away, without the bubble having to exist.
	const labels = !label && passive && !node.textContent?.trim();
	if (labels) node.setAttribute('aria-label', content);

	let timer = 0;
	let open = false;

	function create(): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'tooltip';
		el.id = `tip-${++seq}`;
		el.setAttribute('role', 'tooltip');
		if (typeof el.showPopover === 'function') el.popover = 'manual';
		else el.hidden = true;
		document.body.append(el);
		if (!node.hasAttribute('aria-describedby')) node.setAttribute('aria-describedby', el.id);
		return el;
	}
	function place(el: HTMLDivElement) {
		const r = node.getBoundingClientRect();
		const t = el.getBoundingClientRect();
		const gap = 6;
		let top = r.top - t.height - gap;
		if (top < 8) top = r.bottom + gap;
		const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
		el.style.top = `${Math.round(top)}px`;
		el.style.left = `${Math.round(left)}px`;
	}
	function show() {
		if (open || !content || !node.isConnected) return;
		tip ??= create();
		tip.textContent = content;
		open = true;
		if (typeof tip.showPopover === 'function') tip.showPopover();
		else tip.hidden = false;
		place(tip);
		tip.classList.add('on');
		window.addEventListener('scroll', hide, { capture: true, passive: true, once: true });
	}
	function hide() {
		clearTimeout(timer);
		if (!open || !tip) return;
		open = false;
		tip.classList.remove('on');
		if (typeof tip.hidePopover === 'function') tip.hidePopover();
		else tip.hidden = true;
	}
	function later(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		clearTimeout(timer);
		timer = window.setTimeout(show, 300);
	}
	function focus() {
		if (node.matches(':focus-visible')) show();
	}
	function click() {
		if (!passive) return hide();
		if (open) hide();
		else show();
	}
	function key(e: KeyboardEvent) {
		if (e.key === 'Escape') hide();
	}

	node.addEventListener('pointerenter', later);
	node.addEventListener('pointerleave', hide);
	node.addEventListener('focus', focus);
	node.addEventListener('blur', hide);
	node.addEventListener('click', click);
	node.addEventListener('keydown', key);

	return {
		update(next: string | null | undefined) {
			content = next ?? '';
			if (labels) node.setAttribute('aria-label', content);
			if (!tip) return;
			tip.textContent = content;
			if (!content) hide();
			else if (open) place(tip);
		},
		destroy() {
			hide();
			node.removeEventListener('pointerenter', later);
			node.removeEventListener('pointerleave', hide);
			node.removeEventListener('focus', focus);
			node.removeEventListener('blur', hide);
			node.removeEventListener('click', click);
			node.removeEventListener('keydown', key);
			if (tip && node.getAttribute('aria-describedby') === tip.id) node.removeAttribute('aria-describedby');
			tip?.remove();
		}
	};
}
