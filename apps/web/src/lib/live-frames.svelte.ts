/**
 * Polls a run's live frame endpoint and swaps the image only once a frame has
 * fully loaded, so the view never flickers. Stops when the component unmounts.
 */
export function liveFrames(src: () => string, intervalMs = 300) {
	const state = $state({ url: null as string | null, failed: false });
	$effect(() => {
		const base = src();
		let stopped = false;
		let n = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const next = (delay: number) => (timer = setTimeout(load, delay));
		function load() {
			if (stopped) return;
			const img = new Image();
			img.onload = () => {
				if (stopped) return;
				state.url = img.src;
				state.failed = false;
				next(intervalMs);
			};
			// 204 (no frame yet) and network errors both land here; retry a little slower.
			img.onerror = () => next(1000);
			img.src = `${base}?t=${Date.now()}-${n++}`;
		}
		load();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
	return state;
}
