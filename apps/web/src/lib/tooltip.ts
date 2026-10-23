let seq = 0;

/**
 * A short explanation in a small bubble above the element (below when there is no
 * room), on hover and on keyboard focus; elements that do nothing else toggle it on
 * click, so it works on touch screens too. The bubble lives in the top layer, so
 * scrolling containers and dialogs do not clip it. Use it instead of `title`.
 */
export function tooltip(node: HTMLElement, text: string | null | undefined) {
	let content = text ?? '';
	const tip = document.createElement('div');
	tip.className = 'tooltip';
	tip.id = `tip-${++seq}`;
	tip.setAttribute('role', 'tooltip');
	tip.textContent = content;
	const popover = typeof tip.showPopover === 'function';
	if (popover) tip.popover = 'manual';
	else tip.hidden = true;
	document.body.append(tip);
	if (!node.hasAttribute('aria-describedby')) node.setAttribute('aria-describedby', tip.id);
	// A tag or badge only explains; a button or link has its own click.
	const passive = !node.matches('a, button, input, select, textarea, summary, [role="button"]');

	let timer = 0;
	let open = false;

	function place() {
		const r = node.getBoundingClientRect();
		const t = tip.getBoundingClientRect();
		const gap = 6;
		let top = r.top - t.height - gap;
		if (top < 8) top = r.bottom + gap;
		const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
		tip.style.top = `${Math.round(top)}px`;
		tip.style.left = `${Math.round(left)}px`;
	}
	function show() {
		if (open || !content || !node.isConnected) return;
		open = true;
		if (popover) tip.showPopover();
		else tip.hidden = false;
		place();
		tip.classList.add('on');
		window.addEventListener('scroll', hide, { capture: true, passive: true, once: true });
	}
	function hide() {
		clearTimeout(timer);
		if (!open) return;
		open = false;
		tip.classList.remove('on');
		if (popover) tip.hidePopover();
		else tip.hidden = true;
	}
	function later(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		clearTimeout(timer);
		timer = window.setTimeout(show, 350);
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
			tip.textContent = content;
			if (!content) hide();
			else if (open) place();
		},
		destroy() {
			hide();
			node.removeEventListener('pointerenter', later);
			node.removeEventListener('pointerleave', hide);
			node.removeEventListener('focus', focus);
			node.removeEventListener('blur', hide);
			node.removeEventListener('click', click);
			node.removeEventListener('keydown', key);
			if (node.getAttribute('aria-describedby') === tip.id) node.removeAttribute('aria-describedby');
			tip.remove();
		}
	};
}
