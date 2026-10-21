<script module lang="ts">
	/** Small line icons, drawn on a 16px grid with a 1.5px stroke. */
	const PATHS = {
		overview: 'M1.5 9h3l1.2 2h4.6l1.2-2h3M4.3 3.5h7.4a1 1 0 0 1 .9.6l1.9 4.9v3a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5V9l1.9-4.9a1 1 0 0 1 .9-.6z',
		costs: 'M2.5 5.5A1.5 1.5 0 0 1 4 4h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 12H4a1.5 1.5 0 0 1-1.5-1.5zM2.5 7.5h11',
		repos: 'M3.5 3A1.5 1.5 0 0 1 5 1.5h7.5v11H5A1.5 1.5 0 0 0 3.5 14zM3.5 12.5A1.5 1.5 0 0 1 5 11h7.5',
		plus: 'M8 3.5v9M3.5 8h9',
		external: 'M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2.5h4v4M13.5 2.5 7.5 8.5',
		sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
		moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z',
		monitor: 'M1.5 4A1.5 1.5 0 0 1 3 2.5h10A1.5 1.5 0 0 1 14.5 4v6a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 10zM5.5 14h5',
		check: 'M3 8.5l3 3 7-7',
		x: 'M4 4l8 8M12 4l-8 8',
		chevron: 'M6 3.5 10.5 8 6 12.5',
		search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
		play: 'M5 3.25v9.5L12.5 8z',
		pause: 'M5.5 3.5v9M10.5 3.5v9',
		'skip-back': 'M3.5 3.5v9M12.5 3.75 6 8l6.5 4.25z',
		'skip-forward': 'M12.5 3.5v9M3.5 3.75 10 8l-6.5 4.25z',
		film: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M5.5 3.5v9M10.5 3.5v9'
	} as const;

	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
	viewBox="0 0 16 16"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d={PATHS[name]} />
</svg>
