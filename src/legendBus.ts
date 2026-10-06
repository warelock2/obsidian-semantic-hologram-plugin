/**
 * Order-independent notification that the graph finished (re)building.
 *
 * The controls panel shows scan counts derived from the graph, and it used to
 * read them once at render time. Opening the panel while the graph was still
 * loading therefore left it showing zeros and a "scan degenerate" warning,
 * with no way to clear them short of toggling a checkbox.
 *
 * The first attempt fixed that by having the panel reach through to the graph
 * view and subscribe to it. That does not work, because it is order-dependent:
 * at the panel's `onOpen` there is usually no graph view yet, so there is
 * nothing to subscribe to, and the later re-subscribe raced the graph's own
 * asynchronous build. Measured afterwards: zero callbacks registered, and the
 * panel looked correct only because an unrelated `layout-change` re-render
 * happened to rescue it.
 *
 * So the dependency is inverted. Panels subscribe here at load, when they
 * cannot know whether a graph view exists yet, and the graph broadcasts when
 * it is done. Registering is therefore always possible and never racy.
 *
 * Its own module so that `view.ts` and `controlsView.ts` can both use it
 * without importing each other — `main.ts` imports both, so an edge between
 * them would close a cycle.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe function. */
export function subscribeLegendRefresh(fn: Listener): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/** Tell every live panel the graph changed. Never throws at the caller. */
export function notifyLegendRefresh(): void {
	for (const fn of [...listeners]) {
		try {
			fn();
		} catch (err) {
			console.error('[SH] legend refresh listener failed:', err);
		}
	}
}