import { ItemView, Platform, WorkspaceLeaf } from 'obsidian';
import type SemanticHologramPlugin from './main';
import type { HologramTool, RelTypeEntry } from './settings';
import type { RelationEdge } from './relations';
import { inScopePath, scanRelations } from './relations';

export const VIEW_TYPE_HOLOGRAM = 'semantic-hologram-view';

interface GraphNode {
	path: string;
	label: string;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	homeX: number;
	homeY: number;
	homeZ: number;
	radius: number;
	pinned: boolean;
	selected: boolean;
	homeSet: boolean;
}

interface GraphLink {
	a: number;
	b: number;
	restLen: number;
	dir: 'ab' | 'ba' | 'both';
	strength: number;
	typed: boolean;
	edgeColor: string;
}

const PHYS = {
	repulsion: 900,
	spring: 0.02,
	restLength: 150,
	homeSpring: 0.02,
	center: 0.0008,
	damping: 0.85,
	maxSpeed: 8,
	cellSize: 170,
	settleEnergy: 0.0016,
	settleFrames: 30,
	fitEveryFrame: 45,
	fitCooldown: 90,
	forceSettleFrames: 1800,
	zoomMin: 0.03,
	zoomMax: 8,
	zoomSpeed: 0.002,
	baseSize: 400,
};

const WHITE_EDGE = '#DDDDDD';

const ICON_ROTATE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="3.6" ry="9"/></svg>';
const ICON_GRAB =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>';
const ICON_HOVER =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-11.39 11.39-2.51L3 3z"/></svg>';
const ICON_SELECT_2D =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="1" stroke-dasharray="4 3"/></svg>';
const ICON_SELECT_3D =
	'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c1-8 8-10 14-7"/><path d="M20 17c-2 5-9 6-14 2"/><path d="M3 14c1 6 8 8 12 4"/><path d="M17 7v14M17 7c1-2 4-3 5-2"/></svg>';
const ICON_MODE_2D =
	'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="2"/></svg>';
const ICON_MODE_3D =
	'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/></svg>';
const ICON_TOOL_NAVIGATE =
	'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>';
const ICON_TOOL_SELECT =
	'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-11.39 11.39-2.51L3 3z" fill="currentColor"/></svg>';

export class SemanticHologramView extends ItemView {
	plugin: SemanticHologramPlugin;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private modeBanner: HTMLElement | null = null;
	private nodes: GraphNode[] = [];
	private links: GraphLink[] = [];
	private raf = 0;
	private settled = false;
	private settleCount = 0;
	private layoutFrames = 0;
	private scale = 1;
	private panning = false;
	private panStartX = 0;
	private panStartY = 0;
	private panViewX = 0;
	private panViewY = 0;
	private autoFitCooldown = 0;
	private viewX = 0;
	private viewY = 0;
	private viewScale = 1;
	private pinnedIndex = -1;
	private pointerDown = false;
	private downX = 0;
	private downY = 0;
	private selected = new Set<number>();
	private selecting = false;
	private selectMode = false;
	private selectDragOccurred = false;
	private selectAnchorX = 0;
	private selectAnchorY = 0;
	private selectCurX = 0;
	private selectCurY = 0;
	private selectLasso: Array<{ x: number; y: number }> = [];
	private groupDragging = false;
	private groupStartX = 0;
	private groupStartY = 0;
	private groupOrigins = new Map<number, { x: number; y: number; z: number }>();
	private clearOnUp = false;
	private toggleIndex = -1;
	private nodeColor = 'rgba(124, 111, 246, 1)';
	private edgeColor = 'rgba(180, 180, 180, 0.6)';
	private labelColor = 'rgba(180, 180, 180, 0.75)';
	private hoverIndex = -1;
	private resizeObserver: ResizeObserver | null = null;
	private rotX = 0;
	private rotY = 0;
	private rotZ = -Math.PI / 2;
	private buildSeq = 0;
	private rotCx = 0;
	private rotCy = 0;
	private rotCz = 0;
	private rotating = false;
	private rotateStartX = 0;
	private rotateStartY = 0;
	private rotateStartRotX = 0;
	private rotateStartRotY = 0;
	private cursorOverlay: HTMLElement | null = null;
	private helpOverlay: HTMLElement | null = null;
	private toastEl: HTMLElement | null = null;
	private pointerX = 0;
	private pointerY = 0;
	private pointerInside = false;
	private shiftDown = false;
	private originFollowView = true;
	private touch = false;
	private toolDock: HTMLElement | null = null;
	private actionBar: HTMLElement | null = null;
	private pointers = new Map<number, { x: number; y: number }>();
	private pinchDist = 1;
	private pinchStartScale = 1;
	private pinchStartViewX = 0;
	private pinchStartViewY = 0;
	private pinchMidX = 0;
	private pinchMidY = 0;
	private touchDownX = 0;
	private touchDownY = 0;
	private touchTappedNode = -1;
	private touchGesture: 'none' | 'pan' | 'pin' | 'group' | 'select' | 'rotate' = 'none';

	constructor(leaf: WorkspaceLeaf, plugin: SemanticHologramPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HOLOGRAM;
	}

	getDisplayText(): string {
		return 'Semantic Hologram';
	}

	getIcon(): string {
		return 'waypoints';
	}

	private get is3D(): boolean {
		return this.plugin.settings.hologramMode === '3d';
	}

	private get tool(): HologramTool {
		return this.plugin.settings.hologramTool;
	}

	private viewCenterWorld(): { x: number; y: number; z: number } {
		const w = this.canvas?.clientWidth ?? 1;
		const h = this.canvas?.clientHeight ?? 1;
		return {
			x: this.viewX + w / (2 * this.viewScale),
			y: this.viewY + h / (2 * this.viewScale),
			z: 0,
		};
	}

	private rotatePoint(
		x: number,
		y: number,
		z: number,
		cx = 0,
		cy = 0,
		cz = 0,
	): { x: number; y: number; z: number } {
		const cosZ = Math.cos(this.rotZ);
		const sinZ = Math.sin(this.rotZ);
		const cosX = Math.cos(this.rotX);
		const sinX = Math.sin(this.rotX);
		const cosY = Math.cos(this.rotY);
		const sinY = Math.sin(this.rotY);
		const px = x - cx;
		const py = y - cy;
		const pz = z - cz;
		// Roll about the view axis first: maps world +x to screen-up when
		// rotZ = -90°, so at rest x points up, y points right, z stays out.
		const xr = px * cosZ - py * sinZ;
		const yr = px * sinZ + py * cosZ;
		const zr = pz;
		const y1 = yr * cosX - zr * sinX;
		const z1 = yr * sinX + zr * cosX;
		const x1 = xr;
		const x2 = x1 * cosY + z1 * sinY;
		const z2 = -x1 * sinY + z1 * cosY;
		const y2 = y1;
		return { x: x2 + cx, y: y2 + cy, z: z2 + cz };
	}

	private inverseRotate(
		x: number,
		y: number,
		z: number,
		cx = 0,
		cy = 0,
		cz = 0,
	): { x: number; y: number; z: number } {
		const cosY = Math.cos(this.rotY);
		const sinY = Math.sin(this.rotY);
		const cosX = Math.cos(this.rotX);
		const sinX = Math.sin(this.rotX);
		const cosZ = Math.cos(this.rotZ);
		const sinZ = Math.sin(this.rotZ);
		const px = x - cx;
		const py = y - cy;
		const pz = z - cz;
		const x1 = px * cosY - pz * sinY;
		const z1 = px * sinY + pz * cosY;
		const y1 = py;
		const y0 = y1 * cosX + z1 * sinX;
		const z0 = -y1 * sinX + z1 * cosX;
		const x0 = x1;
		const xf = x0 * cosZ + y0 * sinZ;
		const yf = -x0 * sinZ + y0 * cosZ;
		return { x: xf + cx, y: yf + cy, z: z0 + cz };
	}

	setMode(mode: '2d' | '3d'): void {
		if (this.modeBanner) {
			this.modeBanner.innerHTML = mode === '3d' ? ICON_MODE_3D : ICON_MODE_2D;
			this.modeBanner.classList.toggle('is-3d', mode === '3d');
		}
		if (this.toolDock && mode === '2d' && this.tool === 'rotate') {
			void this.plugin.setTool('navigate');
		}
		this.updateToolDock();
		this.updateCursor();
	}

	setTool(tool: HologramTool): void {
		this.updateToolDock();
		this.updateCursor();
	}

	fitToViewPublic(): void {
		this.fitToView();
	}

	rebuildGraph(): Promise<void> {
		return this.buildGraph(false);
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('sh-view');
		this.touch = Platform.isMobile || window.matchMedia('(pointer: coarse)').matches;
		if (this.touch) {
			container.addClass('sh-touch');
		}

		this.modeBanner = container.createDiv({ cls: 'sh-mode-banner sh-mode-indicator' });
		this.modeBanner.title = 'Toggle 2D / 3D mode';
		this.modeBanner.addEventListener('click', () => {
			const next = this.is3D ? '2d' : '3d';
			void this.plugin.setMode(next);
		});
		this.setMode(this.plugin.settings.hologramMode);

		this.cursorOverlay = container.createDiv({ cls: 'sh-cursor-overlay' });
		this.cursorOverlay.setAttribute('aria-hidden', 'true');
		this.cursorOverlay.innerHTML =
			'<div class="sh-cursor-crosshair"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 1.5v4M9 12.5v4M1.5 9h4M12.5 9h4"/><circle cx="9" cy="9" r="0.9" fill="currentColor" stroke="none"/></svg></div>' +
			'<div class="sh-cursor-icon"></div>';
		this.cursorOverlay.style.display = 'none';

		this.canvas = container.createEl('canvas', { cls: 'sh-graph-canvas' });
		this.ctx = this.canvas.getContext('2d');
		if (!this.ctx) {
			return;
		}

		if (this.touch) {
			this.buildToolDock();
			this.buildActionBar();
		}

		this.readColors();

		this.canvas.addEventListener('pointerdown', this.onPointerDown);
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerup', this.onPointerUp);
		this.canvas.addEventListener('pointerleave', this.onPointerLeave);
		this.canvas.addEventListener('pointercancel', this.onPointerUp);
		this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.canvas);
		this.resize();

		void this.buildGraph();

		this.registerEvent(
			this.app.metadataCache.on('resolved', () => this.buildGraph(true)),
		);

		this.loop();
	}

	onClose(): Promise<void> {
		cancelAnimationFrame(this.raf);
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.canvas) {
			this.canvas.removeEventListener('pointerdown', this.onPointerDown);
			this.canvas.removeEventListener('pointermove', this.onPointerMove);
			this.canvas.removeEventListener('pointerup', this.onPointerUp);
			this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
			this.canvas.removeEventListener('pointercancel', this.onPointerUp);
			this.canvas.removeEventListener('wheel', this.onWheel);
		}
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.contentEl.empty();
		return Promise.resolve();
	}

	private buildToolDock(): void {
		if (!this.contentEl) {
			return;
		}
		const dock = this.contentEl.createDiv({ cls: 'sh-tool-dock' });
		this.toolDock = dock;

		const makeBtn = (tool: HologramTool, label: string): void => {
			const btn = dock.createDiv({ cls: 'sh-tool-btn', attr: { role: 'button', tabindex: '0' } });
			btn.setAttr('data-tool', tool);
			btn.title = label;
			if (tool === 'navigate') {
				btn.innerHTML = ICON_TOOL_NAVIGATE;
			} else if (tool === 'select') {
				btn.innerHTML = ICON_TOOL_SELECT;
			} else {
				btn.innerHTML = ICON_ROTATE;
			}
			btn.addEventListener('click', () => {
				void this.plugin.setTool(tool);
			});
		};
		makeBtn('navigate', 'Navigate / pan / move');
		makeBtn('select', 'Select');
		makeBtn('rotate', 'Rotate (3D)');
		this.updateToolDock();
	}

	private buildActionBar(): void {
		if (!this.contentEl) {
			return;
		}
		const bar = this.contentEl.createDiv({ cls: 'sh-action-bar' });
		this.actionBar = bar;

		const makeBtn = (label: string, fn: () => void): void => {
			const btn = bar.createDiv({ cls: 'sh-action-btn', attr: { role: 'button', tabindex: '0' } });
			btn.setText(label);
			btn.addEventListener('click', () => fn());
		};
		makeBtn('Fit', () => this.fitToView());
		makeBtn('Reset', () => this.resetView());
		makeBtn('Center', () => this.centerSelectedOnOrigin());
		makeBtn('Help', () => this.toggleHelp());
	}

	private updateToolDock(): void {
		if (!this.toolDock) {
			return;
		}
		this.toolDock.querySelectorAll('.sh-tool-btn').forEach((el) => {
			el.classList.toggle('is-active', el.getAttribute('data-tool') === this.tool);
		});
		const rotateBtn = this.toolDock.querySelector('.sh-tool-btn[data-tool="rotate"]');
		if (rotateBtn) {
			rotateBtn.classList.toggle('is-hidden', !this.is3D);
		}
	}

	private toggleHelp(): void {
		if (this.helpOverlay) {
			this.hideHelp();
		} else {
			this.showHelp();
		}
	}

	private readColors(): void {
		const cs = getComputedStyle(document.body);
		const accent = cs.getPropertyValue('--interactive-accent').trim();
		const text = cs.getPropertyValue('--text-normal').trim();
		const faint = cs.getPropertyValue('--text-faint').trim();
		if (accent) {
			this.nodeColor = accent;
		}
		if (text) {
			this.labelColor = this.withAlpha(text, 0.78);
		}
		if (faint) {
			this.edgeColor = this.withAlpha(faint, 0.55);
		}
	}

	private withAlpha(rgb: string, alpha: number): string {
		const hex = rgb.match(/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/);
		if (hex) {
			return `rgba(${parseInt(hex[1]!, 16)}, ${parseInt(hex[2]!, 16)}, ${parseInt(hex[3]!, 16)}, ${alpha})`;
		}
		const m = rgb.match(/\d+/g);
		if (!m || m.length < 3) {
			return rgb;
		}
		return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
	}

	private resize(): void {
		if (!this.canvas || !this.ctx) {
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w === 0 || h === 0) {
			return;
		}
		this.canvas.width = Math.round(w * dpr);
		this.canvas.height = Math.round(h * dpr);
		this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.updateCursor();
		this.scale = Math.max(0.6, Math.min(w, h) / PHYS.baseSize);
		if (this.settled) {
			this.fitToView();
		}
	}

	private async buildGraph(incremental = false): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const files = allFiles.filter((f) => this.isInScope(f.path));
		const resolved = this.app.metadataCache.resolvedLinks;
		const settings = this.plugin.settings;

		const existing = new Map<string, number>();
		this.nodes.forEach((n, i) => existing.set(n.path, i));

		const nodes: GraphNode[] = [];
		const index = new Map<string, number>();
		for (const f of files) {
			const oldIdx = existing.get(f.path);
			let node: GraphNode;
			if (oldIdx !== undefined && incremental) {
				node = this.nodes[oldIdx]!;
			} else {
				node = {
					path: f.path,
					label: f.basename,
					x: 0,
					y: 0,
					z: 0,
					vx: 0,
					vy: 0,
					vz: 0,
					homeX: 0,
					homeY: 0,
					homeZ: 0,
					radius: 4,
					pinned: false,
					selected: false,
					homeSet: false,
				};
			}
			index.set(f.path, nodes.length);
			nodes.push(node);
		}

		const n = nodes.length;
		const R = n > 0 ? this.worldR() : 400;
		nodes.forEach((node, i) => {
			if (!node.homeSet) {
				const angle = (i / Math.max(1, n)) * Math.PI * 2;
				const rad = R * 0.45 * (0.6 + Math.random() * 0.4);
				node.x = Math.cos(angle) * rad;
				node.y = Math.sin(angle) * rad;
				node.z = (Math.random() - 0.5) * R * 0.5;
				node.homeX = node.x;
				node.homeY = node.y;
				node.homeZ = node.z;
				node.homeSet = true;
				node.vx = 0;
				node.vy = 0;
				node.vz = 0;
			}
		});

		const knownIds = new Set<string>();
		const relById = new Map<string, RelTypeEntry>();
		for (const rt of settings.relTypes) {
			knownIds.add(rt.id);
			relById.set(rt.id, rt);
		}

		const buildSeq = ++this.buildSeq;
		const scan = await scanRelations(
			files,
			this.app.vault,
			this.app.metadataCache,
			knownIds,
			(path) => this.isInScope(path),
		);
		// A newer build may have started while we were reading; drop stale results.
		if (buildSeq !== this.buildSeq) {
			return;
		}

		const links: GraphLink[] = [];
		const covered = new Set<string>();

		// Aggregate typed relations per node pair.
		const pairEdges = new Map<string, RelationEdge[]>();
		for (const e of scan.edges) {
			const srcIdx = index.get(e.source);
			const dstIdx = index.get(e.target);
			if (srcIdx === undefined || dstIdx === undefined || srcIdx === dstIdx) {
				continue;
			}
			if (!relById.get(e.relId)?.enabled) {
				continue;
			}
			const a = Math.min(srcIdx, dstIdx);
			const b = Math.max(srcIdx, dstIdx);
			const key = `${a}|${b}`;
			const arr = pairEdges.get(key) ?? [];
			arr.push(e);
			pairEdges.set(key, arr);
		}

		// Color rule: all same type -> that type's color; mixed types -> white.
		for (const [key, edges] of pairEdges) {
			const [aRaw, bRaw] = key.split('|');
			const a = Number(aRaw);
			const b = Number(bRaw);
			const relIds = edges.map((e) => e.relId);
			const ids = new Set(relIds);
			const colored = ids.size === 1 ? (relById.get(relIds[0]!)?.color ?? WHITE_EDGE) : WHITE_EDGE;

			let hasAB = false;
			let hasBA = false;
			let sum = 0;
			for (const e of edges) {
				const srcIdx = index.get(e.source)!;
				const dstIdx = index.get(e.target)!;
				if (srcIdx === a && dstIdx === b) {
					hasAB = true;
				} else {
					hasBA = true;
				}
				sum += e.strength;
			}
			const strength = sum / edges.length;
			links.push({
				a,
				b,
				restLen: this.restLengthFor(strength),
				dir: hasAB && hasBA ? 'both' : hasAB ? 'ab' : 'ba',
				strength,
				typed: true,
				edgeColor: colored,
			});
			covered.add(key);
		}

		// Plain wikilinks become white double arrows unless a typed relation
		// already covers the same pair.
		const seen = new Set(covered);
		for (const f of files) {
			const srcIdx = index.get(f.path);
			if (srcIdx === undefined) {
				continue;
			}
			const targets = resolved[f.path];
			if (!targets) {
				continue;
			}
			for (const targetPath of Object.keys(targets)) {
				const dstIdx = index.get(targetPath);
				if (dstIdx === undefined || dstIdx === srcIdx) {
					continue;
				}
				const key = srcIdx < dstIdx ? `${srcIdx}|${dstIdx}` : `${dstIdx}|${srcIdx}`;
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				links.push({
					a: Math.min(srcIdx, dstIdx),
					b: Math.max(srcIdx, dstIdx),
					restLen: this.restLengthFor(0.5),
					dir: 'both',
					strength: 0.5,
					typed: false,
					edgeColor: WHITE_EDGE,
				});
			}
		}

		const degree = new Array<number>(nodes.length).fill(0);
		for (const l of links) {
			degree[l.a] = (degree[l.a] ?? 0) + 1;
			degree[l.b] = (degree[l.b] ?? 0) + 1;
		}
		const maxDeg = Math.max(1, ...degree);
		nodes.forEach((node, i) => {
			node.radius = 3 + Math.min(7, Math.sqrt(degree[i] ?? 0) * 2.2 * Math.sqrt(maxDeg) / Math.sqrt(maxDeg));
		});

		this.nodes = nodes;
		this.links = links;
		if (!incremental) {
			this.settled = false;
			this.settleCount = 0;
			this.layoutFrames = 0;
			this.selected.clear();
		}
	}

	/** Stronger relationships are shorter: lerp(max, min, strength). */
	private restLengthFor(strength: number): number {
		const { edgeMinLength, edgeMaxLength } = this.plugin.settings;
		const s = Math.max(0, Math.min(1, strength));
		return edgeMaxLength - s * (edgeMaxLength - edgeMinLength);
	}

	/** A path is in hologram scope if it lives under Holograms/ or declares hologram-node. */
	private isInScope(path: string): boolean {
		return inScopePath(path, this.app.vault, this.app.metadataCache);
	}

	private worldR(): number {
		const n = Math.max(1, this.nodes.length);
		const w = this.canvas?.clientWidth ?? 400;
		const h = this.canvas?.clientHeight ?? 300;
		this.scale = Math.max(0.6, Math.min(w, h) / PHYS.baseSize);
		const span = Math.ceil(Math.sqrt(n)) * PHYS.restLength * this.scale;
		return Math.max(PHYS.baseSize * this.scale, span * 1.05);
	}

	private loop = (): void => {
		this.step();
		this.draw();
		this.raf = requestAnimationFrame(this.loop);
	};

	private step(): void {
		const { nodes, links } = this;
		const R = this.worldR();
		const is3D = this.is3D;

		if (is3D) {
			this.applyRepulsion3D();
		} else {
			this.applyRepulsion();
		}

		if (this.settled) {
			for (const node of nodes) {
				if (node.pinned || node.selected) {
					continue;
				}
				node.vx += (node.homeX - node.x) * PHYS.homeSpring;
				node.vy += (node.homeY - node.y) * PHYS.homeSpring;
				if (is3D) {
					node.vz += (node.homeZ - node.z) * PHYS.homeSpring;
				}
				node.vx += (0 - node.x) * PHYS.center;
				node.vy += (0 - node.y) * PHYS.center;
				if (is3D) {
					node.vz += (0 - node.z) * PHYS.center;
				}
			}
		} else {
			if (is3D) {
				this.applySprings3D();
				this.applyCenter3D();
			} else {
				this.applySprings();
				this.applyCenter();
			}
		}

		let energy = 0;
		for (const node of nodes) {
			if (node.pinned || node.selected) {
				continue;
			}
			node.vx *= PHYS.damping;
			node.vy *= PHYS.damping;
			if (is3D) {
				node.vz *= PHYS.damping;
			}
			const sp = is3D
				? Math.hypot(node.vx, node.vy, node.vz)
				: Math.hypot(node.vx, node.vy);
			if (sp > PHYS.maxSpeed) {
				const k = PHYS.maxSpeed / sp;
				node.vx *= k;
				node.vy *= k;
				if (is3D) {
					node.vz *= k;
				}
			}
			node.x += node.vx;
			node.y += node.vy;
			if (is3D) {
				node.z += node.vz;
			}
			node.x = Math.min(R, Math.max(-R, node.x));
			node.y = Math.min(R, Math.max(-R, node.y));
			if (is3D) {
				node.z = Math.min(R, Math.max(-R, node.z));
			}
			energy += node.vx * node.vx + node.vy * node.vy + (is3D ? node.vz * node.vz : 0);
		}

		if (!this.settled) {
			this.layoutFrames++;
			const avg = energy / Math.max(1, nodes.length);
			const avgEdge = this.avgEdgeLength();
			const restLen = (this.links.reduce((s, l) => s + l.restLen, 0) / Math.max(1, this.links.length)) * this.scale;
			const spread = links.length === 0 || avgEdge >= restLen * 0.7;
			const timedOut = this.layoutFrames >= PHYS.forceSettleFrames;
			if ((avg < PHYS.settleEnergy && spread) || timedOut) {
				this.settleCount++;
				if (this.settleCount > PHYS.settleFrames) {
					for (const node of nodes) {
						node.homeX = node.x;
						node.homeY = node.y;
						if (this.is3D) {
							node.homeZ = node.z;
						}
					}
					this.settled = true;
					this.fitToView();
				}
			} else {
				this.settleCount = 0;
			}

			if (this.autoFitCooldown > 0) {
				this.autoFitCooldown--;
			} else if (this.layoutFrames % PHYS.fitEveryFrame === 0) {
				this.fitToView();
			}
		}
	}

	private avgEdgeLength(): number {
		if (this.links.length === 0) {
			return 0;
		}
		let total = 0;
		const is3D = this.is3D;
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			total += is3D
				? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
				: Math.hypot(b.x - a.x, b.y - a.y);
		}
		return total / this.links.length;
	}

	private toScreenX(x: number): number {
		return (x - this.viewX) * this.viewScale;
	}

	private toScreenY(y: number): number {
		return (y - this.viewY) * this.viewScale;
	}

	private toWorldX(sx: number): number {
		return sx / this.viewScale + this.viewX;
	}

	private toWorldY(sy: number): number {
		return sy / this.viewScale + this.viewY;
	}

	private fitToView(): void {
		const canvas = this.canvas;
		if (!canvas || this.nodes.length === 0) {
			return;
		}
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		if (this.is3D) {
			for (const node of this.nodes) {
				const r = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
				minX = Math.min(minX, r.x - node.radius);
				minY = Math.min(minY, r.y - node.radius);
				maxX = Math.max(maxX, r.x + node.radius);
				maxY = Math.max(maxY, r.y + node.radius);
			}
		} else {
			for (const node of this.nodes) {
				minX = Math.min(minX, node.x - node.radius);
				minY = Math.min(minY, node.y - node.radius);
				maxX = Math.max(maxX, node.x + node.radius);
				maxY = Math.max(maxY, node.y + node.radius);
			}
		}
		const spanX = Math.max(1, maxX - minX);
		const spanY = Math.max(1, maxY - minY);
		// 8% margin on background on every side.
		const m = 0.08;
		this.viewScale = Math.min(
			PHYS.zoomMax,
			Math.max(
				PHYS.zoomMin,
				Math.min((w * (1 - 2 * m)) / spanX, (h * (1 - 2 * m)) / spanY),
			),
		);
		// Center the content in the viewport.
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		this.viewX = cx - w / (2 * this.viewScale);
		this.viewY = cy - h / (2 * this.viewScale);
		this.originFollowView = true;
		const c = this.viewCenterWorld();
		this.rotCx = c.x;
		this.rotCy = c.y;
		this.rotCz = 0;
	}

	private resetView(): void {
		this.rotX = 0;
		this.rotY = 0;
		this.rotZ = -Math.PI / 2;
		this.fitToView();
	}

	private updateCursor(): void {
		if (!this.canvas) {
			return;
		}
		const active = this.selecting || this.groupDragging || this.selectMode;
		const rotate = this.is3D && (this.rotating || (this.shiftDown && !active));
		const pinned = this.pinnedIndex >= 0;
		const hover = this.hoverIndex >= 0 && !rotate && !pinned && !active;
		this.canvas.style.cursor = 'none';
		if (!this.cursorOverlay || !this.pointerInside) {
			return;
		}
		this.cursorOverlay.classList.remove('sh-mode-pan', 'sh-mode-rotate', 'sh-mode-pin', 'sh-mode-pointer');
		let icon = '';
		if (active) {
			icon = this.is3D ? ICON_SELECT_3D : ICON_SELECT_2D;
		} else if (rotate) {
			this.cursorOverlay.classList.add('sh-mode-rotate');
			icon = ICON_ROTATE;
		} else if (pinned) {
			this.cursorOverlay.classList.add('sh-mode-pin');
			icon = ICON_GRAB;
		} else if (hover) {
			this.cursorOverlay.classList.add('sh-mode-pointer');
			icon = ICON_HOVER;
		} else if (this.selected.size > 0) {
			icon = this.is3D ? ICON_SELECT_3D : ICON_SELECT_2D;
		} else {
			this.cursorOverlay.classList.add('sh-mode-pan');
		}
		const iconDiv = this.cursorOverlay.querySelector('.sh-cursor-icon') as HTMLElement | null;
		if (iconDiv) {
			iconDiv.innerHTML = icon;
		}
		const rect = this.contentEl.getBoundingClientRect();
		const x = this.pointerX - rect.left;
		const y = this.pointerY - rect.top;
		this.cursorOverlay.style.transform = `translate(${x}px, ${y}px)`;
		this.cursorOverlay.style.display = 'block';
	}

	private applyRepulsion(): void {
		const { nodes } = this;
		const cellSize = PHYS.cellSize * this.scale;
		const grid = new Map<number, number[]>();
		const cellOf = (x: number, y: number): number => {
			const cx = Math.floor(x / cellSize);
			const cy = Math.floor(y / cellSize);
			return cx * 100000 + cy;
		};
		nodes.forEach((node, i) => {
			const key = cellOf(node.x, node.y);
			const arr = grid.get(key);
			if (arr) {
				arr.push(i);
			} else {
				grid.set(key, [i]);
			}
		});

		for (const i of nodes.keys()) {
			const a = nodes[i]!;
			if (a.pinned || a.selected) {
				continue;
			}
			const cx = Math.floor(a.x / cellSize);
			const cy = Math.floor(a.y / cellSize);
			for (let ox = -1; ox <= 1; ox++) {
				for (let oy = -1; oy <= 1; oy++) {
					const arr = grid.get((cx + ox) * 100000 + (cy + oy));
					if (!arr) {
						continue;
					}
					for (const j of arr) {
						if (j <= i) {
							continue;
						}
						const b = nodes[j]!;
						if (b.pinned || b.selected) {
							continue;
						}
						const dx = b.x - a.x;
						const dy = b.y - a.y;
						const d = Math.hypot(dx, dy);
						if (d < 0.001 || d > cellSize) {
							continue;
						}
						const f = (PHYS.repulsion * this.scale * (1 - d / cellSize)) / d;
						const fx = (dx / d) * f;
						const fy = (dy / d) * f;
						a.vx -= fx;
						a.vy -= fy;
						b.vx += fx;
						b.vy += fy;
					}
				}
			}
		}
	}

	private applySprings(): void {
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			if (a.pinned || a.selected || b.pinned || b.selected) {
				continue;
			}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.hypot(dx, dy) || 0.001;
			const f = PHYS.spring * (d - l.restLen * this.scale);
			const fx = (dx / d) * f;
			const fy = (dy / d) * f;
			a.vx += fx;
			a.vy += fy;
			b.vx -= fx;
			b.vy -= fy;
		}
	}

	private applyCenter(): void {
		for (const node of this.nodes) {
			if (node.pinned || node.selected) {
				continue;
			}
			node.vx += (0 - node.x) * PHYS.center;
			node.vy += (0 - node.y) * PHYS.center;
		}
	}

	private applyRepulsion3D(): void {
		const { nodes } = this;
		const cellSize = PHYS.cellSize * this.scale;
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			if (a.pinned || a.selected) {
				continue;
			}
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				if (b.pinned || b.selected) {
					continue;
				}
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const dz = b.z - a.z;
				const d = Math.hypot(dx, dy, dz);
				if (d < 0.001 || d > cellSize) {
					continue;
				}
				const f = (PHYS.repulsion * this.scale * (1 - d / cellSize)) / d;
				const fx = (dx / d) * f;
				const fy = (dy / d) * f;
				const fz = (dz / d) * f;
				a.vx -= fx;
				a.vy -= fy;
				a.vz -= fz;
				b.vx += fx;
				b.vy += fy;
				b.vz += fz;
			}
		}
	}

	private applySprings3D(): void {
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			if (a.pinned || a.selected || b.pinned || b.selected) {
				continue;
			}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dz = b.z - a.z;
			const d = Math.hypot(dx, dy, dz) || 0.001;
			const f = PHYS.spring * (d - l.restLen * this.scale);
			const fx = (dx / d) * f;
			const fy = (dy / d) * f;
			const fz = (dz / d) * f;
			a.vx += fx;
			a.vy += fy;
			a.vz += fz;
			b.vx -= fx;
			b.vy -= fy;
			b.vz -= fz;
		}
	}

	private applyCenter3D(): void {
		for (const node of this.nodes) {
			if (node.pinned || node.selected) {
				continue;
			}
			node.vx += (0 - node.x) * PHYS.center;
			node.vy += (0 - node.y) * PHYS.center;
			node.vz += (0 - node.z) * PHYS.center;
		}
	}

	private draw(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) {
			return;
		}
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w === 0 || h === 0) {
			return;
		}
		ctx.clearRect(0, 0, w, h);

		const c = this.viewCenterWorld();
		if (this.originFollowView) {
			this.rotCx = c.x;
			this.rotCy = c.y;
			this.rotCz = c.z;
		}

		if (this.is3D) {
			const R = this.worldR();
			const rotated = this.nodes.map((n) => this.rotatePoint(n.x, n.y, n.z, this.rotCx, this.rotCy, this.rotCz));

			const order = rotated
				.map((p, i) => ({ p, i }))
				.sort((a, b) => a.p.z - b.p.z);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'middle';
			for (const { p, i } of order) {
				const node = this.nodes[i]!;
				const sx = this.toScreenX(p.x);
				const sy = this.toScreenY(p.y);
				const depth = (p.z + R) / (2 * R || 1);
				const depthScale = 0.55 + depth * 0.9;
				const r = Math.max(2, node.radius * this.viewScale * depthScale);
				const alpha = 0.45 + depth * 0.55;
				ctx.fillStyle =
					node.pinned || node.selected || this.hoverIndex === i
						? this.nodeColor
						: this.withAlpha(this.nodeColor, alpha);
				if (node.pinned || node.selected) {
					ctx.beginPath();
					ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
					ctx.strokeStyle = this.nodeColor;
					ctx.lineWidth = 1.5;
					ctx.stroke();
				}
				ctx.beginPath();
				ctx.arc(sx, sy, r, 0, Math.PI * 2);
				ctx.fill();
			}

			ctx.font = '10px var(--font-interface)';
			for (const { p, i } of order) {
				const node = this.nodes[i]!;
				ctx.fillStyle = this.withAlpha(this.labelColor, 0.35 + ((p.z + R) / (2 * R || 1)) * 0.65);
				ctx.fillText(node.label, this.toScreenX(p.x) + node.radius + 3, this.toScreenY(p.y));
			}

			// Edges are drawn in the foreground so arrowheads stay visible over nodes.
			ctx.lineWidth = 1;
			for (const l of this.links) {
				const a = this.nodes[l.a];
				const b = this.nodes[l.b];
				const ra = rotated[l.a];
				const rb = rotated[l.b];
				if (!a || !b || !ra || !rb) {
					continue;
				}
				const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
				this.strokeArrowLine(
					this.toScreenX(ra.x),
					this.toScreenY(ra.y),
					this.nodeScreenRadius(a, ra, R),
					this.toScreenX(rb.x),
					this.toScreenY(rb.y),
					this.nodeScreenRadius(b, rb, R),
					l,
					this.edgeStroke(l, sel),
				);
			}
			this.drawLiveSelection();
			this.drawSelectionArea();
			this.drawOriginIndicator();
			return;
		}

		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (const node of this.nodes) {
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			const r = Math.max(3, node.radius * this.viewScale);
			ctx.fillStyle = node.pinned || node.selected || this.hoverIndex === this.nodes.indexOf(node)
				? this.nodeColor
				: this.withAlpha(this.nodeColor, 0.92);
			if (node.pinned || node.selected) {
				ctx.beginPath();
				ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
				ctx.strokeStyle = this.nodeColor;
				ctx.lineWidth = 1.5;
				ctx.stroke();
			}
			ctx.beginPath();
			ctx.arc(sx, sy, r, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.font = '10px var(--font-interface)';
		for (const node of this.nodes) {
			ctx.fillStyle = this.labelColor;
			ctx.fillText(node.label, this.toScreenX(node.x) + node.radius + 3, this.toScreenY(node.y));
		}
		// Edges are drawn in the foreground so arrowheads stay visible over nodes.
		ctx.lineWidth = 1;
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
			this.strokeArrowLine(
				this.toScreenX(a.x),
				this.toScreenY(a.y),
				this.nodeScreenRadius(a, a, 1),
				this.toScreenX(b.x),
				this.toScreenY(b.y),
				this.nodeScreenRadius(b, b, 1),
				l,
				this.edgeStroke(l, sel),
			);
		}
		this.drawLiveSelection();
		this.drawSelectionArea();
		this.drawOriginIndicator();
		this.updateCursor();
	}

	private nodeScreenRadius(node: GraphNode, p: { x: number; y: number; z: number }, R: number): number {
		if (this.is3D) {
			const depth = (p.z + R) / (2 * R || 1);
			return Math.max(2, node.radius * this.viewScale * (0.55 + depth * 0.9));
		}
		return Math.max(3, node.radius * this.viewScale);
	}

	private edgeStroke(link: GraphLink, selCount: number): string {
		if (selCount === 0) {
			return link.edgeColor;
		}
		if (selCount === 1) {
			return this.withAlpha(link.edgeColor, 0.35);
		}
		return this.withAlpha(link.edgeColor, 0.7);
	}

	private strokeArrowLine(
		x1: number,
		y1: number,
		r1: number,
		x2: number,
		y2: number,
		r2: number,
		link: GraphLink,
		stroke: string,
	): void {
		const ctx = this.ctx;
		if (!ctx) {
			return;
		}
		const dx = x2 - x1;
		const dy = y2 - y1;
		const d = Math.hypot(dx, dy);
		if (d < 0.001) {
			return;
		}
		const ux = dx / d;
		const uy = dy / d;
		const sx = x1 + ux * r1;
		const sy = y1 + uy * r1;
		const ex = x2 - ux * r2;
		const ey = y2 - uy * r2;
		ctx.save();
		ctx.strokeStyle = stroke;
		ctx.fillStyle = stroke;
		ctx.lineWidth = 1.4;
		ctx.beginPath();
		ctx.moveTo(sx, sy);
		ctx.lineTo(ex, ey);
		ctx.stroke();
		const headLen = 7;
		const headHalf = 3.5;
		const drawHead = (px: number, py: number, hx: number, hy: number): void => {
			ctx.beginPath();
			ctx.moveTo(px + hx * headLen, py + hy * headLen);
			ctx.lineTo(px - hy * headHalf + hx * 2, py + hx * headHalf + hy * 2);
			ctx.lineTo(px + hy * headHalf + hx * 2, py - hx * headHalf + hy * 2);
			ctx.closePath();
			ctx.fill();
		};
		if (link.dir === 'ab' || link.dir === 'both') {
			drawHead(ex, ey, ux, uy);
		}
		if (link.dir === 'ba' || link.dir === 'both') {
			drawHead(sx, sy, -ux, -uy);
		}
		ctx.restore();
	}

	private drawLiveSelection(): void {
		if (!this.selecting || !this.ctx || !this.canvas) {
			return;
		}
		const ctx = this.ctx;
		ctx.save();
		ctx.setLineDash([5, 4]);
		ctx.strokeStyle = this.nodeColor;
		ctx.fillStyle = this.withAlpha(this.nodeColor, 0.08);
		ctx.lineWidth = 1.2;
		if (this.is3D) {
			ctx.beginPath();
			this.selectLasso.forEach((p, i) => {
				if (i === 0) {
					ctx.moveTo(p.x, p.y);
				} else {
					ctx.lineTo(p.x, p.y);
				}
			});
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		} else {
			const x1 = Math.min(this.selectAnchorX, this.selectCurX);
			const y1 = Math.min(this.selectAnchorY, this.selectCurY);
			const x2 = Math.max(this.selectAnchorX, this.selectCurX);
			const y2 = Math.max(this.selectAnchorY, this.selectCurY);
			ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
			ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
		}
		ctx.restore();
	}

	private selectionBounds(): { x1: number; y1: number; x2: number; y2: number } | null {
		if (this.selected.size === 0) {
			return null;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const i of this.selected) {
			const node = this.nodes[i];
			if (!node) {
				continue;
			}
			let sx: number;
			let sy: number;
			if (this.is3D) {
				const r = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
				sx = this.toScreenX(r.x);
				sy = this.toScreenY(r.y);
			} else {
				sx = this.toScreenX(node.x);
				sy = this.toScreenY(node.y);
			}
			minX = Math.min(minX, sx);
			minY = Math.min(minY, sy);
			maxX = Math.max(maxX, sx);
			maxY = Math.max(maxY, sy);
		}
		const pad = 6;
		return { x1: minX - pad, y1: minY - pad, x2: maxX + pad, y2: maxY + pad };
	}

	private drawSelectionArea(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) {
			return;
		}
		const b = this.selectionBounds();
		if (!b) {
			return;
		}
		ctx.save();
		ctx.setLineDash([5, 4]);
		ctx.strokeStyle = this.nodeColor;
		ctx.lineWidth = 1.2;
		ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
		ctx.setLineDash([]);
		const hx = b.x1 - 12;
		const hy = b.y1 - 12;
		ctx.fillStyle = this.withAlpha(this.nodeColor, 0.18);
		ctx.strokeRect(hx, hy, 14, 14);
		ctx.fillRect(hx, hy, 14, 14);
		ctx.fillStyle = this.nodeColor;
		ctx.fillRect(hx + 5, hy + 5, 4, 4);
		ctx.fillRect(hx + 5, hy + 2, 4, 2);
		ctx.fillRect(hx + 2, hy + 5, 2, 4);
		ctx.fillRect(hx + 10, hy + 5, 2, 4);
		ctx.fillRect(hx + 5, hy + 10, 4, 2);
		ctx.fillRect(hx + 5, hy + 12, 4, 2);
		ctx.restore();
	}

	private selectionHandleHit(e: PointerEvent): boolean {
		if (!this.canvas) {
			return false;
		}
		const b = this.selectionBounds();
		if (!b) {
			return false;
		}
		const rect = this.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const hx = b.x1 - 12;
		const hy = b.y1 - 12;
		return x >= hx - 4 && x <= hx + 18 && y >= hy - 4 && y <= hy + 18;
	}

	private drawOriginIndicator(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas || !this.plugin.settings.showRotationCenter) {
			return;
		}
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		let ix = w / 2;
		let iy = h / 2;
		if (!this.originFollowView) {
			ix = this.toScreenX(this.rotCx);
			iy = this.toScreenY(this.rotCy);
		}
		const s = 13;
		ctx.lineWidth = 1.25;
		ctx.strokeStyle = this.withAlpha(this.labelColor, 0.85);
		ctx.fillStyle = this.withAlpha(this.labelColor, 0.92);
		ctx.font = '9px var(--font-interface)';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';

		const drawAxis = (ax: number, ay: number, label: string): void => {
			const len = Math.hypot(ax, ay);
			if (len < 0.001) {
				ctx.beginPath();
				ctx.arc(ix, iy, 1.5, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillText(label, ix + 3, iy - 6);
				return;
			}
			const ex = (ax / len) * s;
			const ey = (ay / len) * s;
			ctx.beginPath();
			ctx.moveTo(ix, iy);
			ctx.lineTo(ix + ex, iy + ey);
			ctx.stroke();
			const lx = ix + ex + (Math.abs(ax) < Math.abs(ay) ? 3 : Math.sign(ax) * 3 + 2);
			const ly = iy + ey + (Math.abs(ay) < Math.abs(ax) ? -6 : Math.sign(ay) * 3 - 2);
			ctx.fillText(label, lx, ly);
		};

		if (this.is3D) {
			const rx = this.rotatePoint(1, 0, 0, 0, 0, 0);
			const ry = this.rotatePoint(0, 1, 0, 0, 0, 0);
			const rz = this.rotatePoint(0, 0, 1, 0, 0, 0);
			drawAxis(rx.x, rx.y, 'x');
			drawAxis(ry.x, ry.y, 'y');
			drawAxis(rz.x, rz.y, 'z');
		} else {
			drawAxis(1, 0, 'x');
			drawAxis(0, 1, 'y');
		}
	}

	/* ── Touch handlers ─────────────────────────────────────────── */

	private touchCancelGesture(): void {
		if (this.pinnedIndex >= 0) {
			const n = this.nodes[this.pinnedIndex];
			if (n) {
				n.pinned = false;
			}
			this.pinnedIndex = -1;
		}
		this.selecting = false;
		this.selectLasso = [];
		this.groupDragging = false;
		this.groupOrigins.clear();
		this.rotating = false;
		this.panning = false;
		this.clearOnUp = false;
		this.toggleIndex = -1;
		this.touchGesture = 'none';
	}

	private touchPinchStart(): void {
		this.touchCancelGesture();
		const pts = [...this.pointers.values()];
		if (pts.length < 2) {
			return;
		}
		const p0 = pts[0]!;
		const p1 = pts[1]!;
		this.pinchDist = Math.hypot(p0.x - p1.x, p0.y - p1.y) || 1;
		this.pinchStartScale = this.viewScale;
		this.pinchStartViewX = this.viewX;
		this.pinchStartViewY = this.viewY;
		this.pinchMidX = (p0.x + p1.x) / 2;
		this.pinchMidY = (p0.y + p1.y) / 2;
	}

	private touchPinchUpdate(): void {
		const pts = [...this.pointers.values()];
		if (pts.length < 2) {
			return;
		}
		const p0 = pts[0]!;
		const p1 = pts[1]!;
		const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y) || 1;
		const midX = (p0.x + p1.x) / 2;
		const midY = (p0.y + p1.y) / 2;
		const factor = dist / this.pinchDist;
		const worldX = this.toWorldX(midX);
		const worldY = this.toWorldY(midY);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.pinchStartScale * factor));
		this.viewX = worldX - midX / this.viewScale;
		this.viewY = worldY - midY / this.viewScale;
		this.autoFitCooldown = PHYS.fitCooldown;
	}

	private touchStart(e: PointerEvent): void {
		const rect = this.canvas?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		this.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
		this.canvas?.setPointerCapture(e.pointerId);
		if (this.pointers.size >= 2) {
			this.touchPinchStart();
			return;
		}
		this.pointerDown = true;
		this.downX = e.clientX;
		this.downY = e.clientY;
		this.touchDownX = e.clientX;
		this.touchDownY = e.clientY;

		const tool = this.tool;
		if (tool === 'rotate' && this.is3D) {
			this.rotating = true;
			this.rotateStartX = e.clientX;
			this.rotateStartY = e.clientY;
			this.rotateStartRotX = this.rotX;
			this.rotateStartRotY = this.rotY;
			this.autoFitCooldown = PHYS.fitCooldown;
			this.touchGesture = 'rotate';
			return;
		}

		const idx = this.hitTest(e);
		this.touchTappedNode = idx;

		if (tool === 'select') {
			this.selecting = true;
			this.toggleIndex = idx;
			this.clearOnUp = idx < 0 && this.selected.size > 0;
			this.selectAnchorX = e.clientX - rect.left;
			this.selectAnchorY = e.clientY - rect.top;
			this.selectCurX = this.selectAnchorX;
			this.selectCurY = this.selectAnchorY;
			this.selectLasso = [{ x: this.selectAnchorX, y: this.selectAnchorY }];
			this.touchGesture = 'select';
			return;
		}

		// navigate
		if (this.selectionHandleHit(e)) {
			this.groupDragging = true;
			this.groupStartX = e.clientX;
			this.groupStartY = e.clientY;
			this.groupOrigins.clear();
			for (const i of this.selected) {
				const n = this.nodes[i];
				if (n) {
					this.groupOrigins.set(i, { x: n.x, y: n.y, z: n.z });
				}
			}
			this.touchGesture = 'group';
			return;
		}
		if (idx >= 0) {
			const node = this.nodes[idx];
			if (node && node.selected) {
				this.groupDragging = true;
				this.groupStartX = e.clientX;
				this.groupStartY = e.clientY;
				this.groupOrigins.clear();
				for (const i of this.selected) {
					const n = this.nodes[i];
					if (n) {
						this.groupOrigins.set(i, { x: n.x, y: n.y, z: n.z });
					}
				}
				this.hoverIndex = idx;
				this.touchGesture = 'group';
				return;
			}
			this.pinnedIndex = idx;
			if (node) {
				node.pinned = true;
				node.vx = 0;
				node.vy = 0;
				if (this.is3D) {
					node.vz = 0;
				}
			}
			this.touchGesture = 'pin';
			return;
		}
		this.panning = true;
		this.clearOnUp = this.selected.size > 0;
		this.panStartX = e.clientX;
		this.panStartY = e.clientY;
		this.panViewX = this.viewX;
		this.panViewY = this.viewY;
		this.autoFitCooldown = PHYS.fitCooldown;
		this.touchGesture = 'pan';
	}

	private touchMoveEvent(e: PointerEvent): void {
		const rect = this.canvas?.getBoundingClientRect();
		if (!rect) {
			return;
		}
		this.pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
		if (this.pointers.size >= 2) {
			this.touchPinchUpdate();
			return;
		}
		if (this.touchGesture === 'none') {
			return;
		}
		if (this.selecting) {
			this.selectCurX = e.clientX - rect.left;
			this.selectCurY = e.clientY - rect.top;
			this.selectLasso.push({ x: this.selectCurX, y: this.selectCurY });
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.groupDragging) {
			const dx = e.clientX - this.groupStartX;
			const dy = e.clientY - this.groupStartY;
			this.moveSelectedGroup(dx, dy);
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.rotating) {
			const dx = e.clientX - this.rotateStartX;
			const dy = e.clientY - this.rotateStartY;
			this.rotY = this.rotateStartRotY + dx * 0.005;
			this.rotX = Math.max(
				-Math.PI / 2 + 0.05,
				Math.min(Math.PI / 2 - 0.05, this.rotateStartRotX - dy * 0.005),
			);
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.pinnedIndex >= 0) {
			const node = this.nodes[this.pinnedIndex];
			if (!node || !this.canvas) {
				return;
			}
			if (this.is3D) {
				const sx = e.clientX - rect.left;
				const sy = e.clientY - rect.top;
				const rOld = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
				const desiredRx = this.toWorldX(sx);
				const desiredRy = this.toWorldY(sy);
				const inv = this.inverseRotate(desiredRx, desiredRy, rOld.z, this.rotCx, this.rotCy, this.rotCz);
				node.x = inv.x;
				node.y = inv.y;
				node.z = inv.z;
				node.vx = 0;
				node.vy = 0;
				node.vz = 0;
			} else {
				node.x = this.toWorldX(e.clientX - rect.left);
				node.y = this.toWorldY(e.clientY - rect.top);
				node.vx = 0;
				node.vy = 0;
			}
			return;
		}
		if (this.panning) {
			this.viewX = this.panViewX - (e.clientX - this.panStartX) / this.viewScale;
			this.viewY = this.panViewY - (e.clientY - this.panStartY) / this.viewScale;
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
	}

	private touchEnd(e: PointerEvent): void {
		this.pointers.delete(e.pointerId);
		if (this.pointers.size >= 1 && this.touchGesture === 'none') {
			// Was pinching and one finger lifted — don't start new gesture
			if (this.pointers.size < 2) {
				// Pinch ended; do nothing until all fingers up
			}
			return;
		}
		if (this.pointers.size > 0) {
			return;
		}
		// All fingers up
		const moved = Math.hypot(e.clientX - this.touchDownX, e.clientY - this.touchDownY);
		const tap = moved < 8;
		if (this.selecting) {
			if (tap && this.toggleIndex >= 0) {
				this.toggleNodeSelection(this.toggleIndex);
			} else if (tap && this.clearOnUp) {
				this.clearSelection();
			} else if (!tap) {
				this.finishSelection();
			}
			this.selecting = false;
			this.toggleIndex = -1;
			this.selectLasso = [];
			this.clearOnUp = false;
		} else if (this.groupDragging) {
			this.groupDragging = false;
			this.groupOrigins.clear();
		} else if (this.rotating) {
			this.rotating = false;
		} else if (this.pinnedIndex >= 0) {
			const node = this.nodes[this.pinnedIndex];
			if (node) {
				node.pinned = false;
			}
			if (tap) {
				this.openNode(this.pinnedIndex);
			}
			this.pinnedIndex = -1;
		} else if (this.panning) {
			if (tap && this.clearOnUp) {
				this.clearSelection();
			}
			this.clearOnUp = false;
		}
		this.panning = false;
		this.pointerDown = false;
		this.touchGesture = 'none';
	}

	/* ── Pointer event handlers ─────────────────────────────────── */

	private onPointerDown = (e: PointerEvent): void => {
		if (this.touch) {
			this.touchStart(e);
			return;
		}
		this.pointerX = e.clientX;
		this.pointerY = e.clientY;
		this.shiftDown = e.shiftKey;
		const rect = this.canvas?.getBoundingClientRect();
		if (this.is3D && (e.shiftKey || e.button === 1)) {
			this.rotating = true;
			this.pointerDown = true;
			this.downX = e.clientX;
			this.downY = e.clientY;
			this.rotateStartX = e.clientX;
			this.rotateStartY = e.clientY;
			this.rotateStartRotX = this.rotX;
			this.rotateStartRotY = this.rotY;
			this.canvas?.setPointerCapture(e.pointerId);
			this.autoFitCooldown = PHYS.fitCooldown;
			this.hoverIndex = -1;
			return;
		}
		if (this.selectMode) {
			this.selecting = true;
			this.selectDragOccurred = true;
			this.downX = e.clientX;
			this.downY = e.clientY;
			this.toggleIndex = this.hitTest(e);
			this.clearOnUp = this.toggleIndex < 0 && this.selected.size > 0;
			this.selectAnchorX = e.clientX - (rect?.left ?? 0);
			this.selectAnchorY = e.clientY - (rect?.top ?? 0);
			this.selectCurX = this.selectAnchorX;
			this.selectCurY = this.selectAnchorY;
			this.selectLasso = [{ x: this.selectAnchorX, y: this.selectAnchorY }];
			this.canvas?.setPointerCapture(e.pointerId);
			this.pointerDown = true;
			return;
		}
		if (this.selectionHandleHit(e)) {
			this.groupDragging = true;
			this.groupStartX = e.clientX;
			this.groupStartY = e.clientY;
			this.groupOrigins.clear();
			for (const i of this.selected) {
				const n = this.nodes[i];
				if (n) {
					this.groupOrigins.set(i, { x: n.x, y: n.y, z: n.z });
				}
			}
			this.canvas?.setPointerCapture(e.pointerId);
			this.pointerDown = true;
			return;
		}
		this.pointerDown = true;
		this.downX = e.clientX;
		this.downY = e.clientY;
		const idx = this.hitTest(e);
		if (e.ctrlKey) {
			this.toggleIndex = idx;
			return;
		}
		if (idx >= 0) {
			const node = this.nodes[idx];
			if (node && node.selected) {
				this.groupDragging = true;
				this.groupStartX = e.clientX;
				this.groupStartY = e.clientY;
				this.groupOrigins.clear();
				for (const i of this.selected) {
					const n = this.nodes[i];
					if (n) {
						this.groupOrigins.set(i, { x: n.x, y: n.y, z: n.z });
					}
				}
				this.canvas?.setPointerCapture(e.pointerId);
				this.hoverIndex = idx;
				return;
			}
			this.pinnedIndex = idx;
			if (node) {
				node.pinned = true;
				node.vx = 0;
				node.vy = 0;
				if (this.is3D) {
					node.vz = 0;
				}
			}
			this.canvas?.setPointerCapture(e.pointerId);
		} else {
			this.panning = true;
			this.clearOnUp = this.selected.size > 0;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panViewX = this.viewX;
			this.panViewY = this.viewY;
			this.canvas?.setPointerCapture(e.pointerId);
			this.autoFitCooldown = PHYS.fitCooldown;
		}
		this.hoverIndex = idx;
	};

	private onPointerMove = (e: PointerEvent): void => {
		if (this.touch) {
			this.touchMoveEvent(e);
			return;
		}
		this.pointerX = e.clientX;
		this.pointerY = e.clientY;
		this.pointerInside = true;
		this.shiftDown = e.shiftKey;
		this.updateCursor();
		if (this.selecting) {
			const rect = this.canvas?.getBoundingClientRect();
			if (!rect) {
				return;
			}
			this.selectCurX = e.clientX - rect.left;
			this.selectCurY = e.clientY - rect.top;
			this.selectLasso.push({ x: this.selectCurX, y: this.selectCurY });
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.groupDragging) {
			const dx = e.clientX - this.groupStartX;
			const dy = e.clientY - this.groupStartY;
			this.moveSelectedGroup(dx, dy);
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.rotating) {
			const dx = e.clientX - this.rotateStartX;
			const dy = e.clientY - this.rotateStartY;
			this.rotY = this.rotateStartRotY + dx * 0.005;
			this.rotX = Math.max(
				-Math.PI / 2 + 0.05,
				Math.min(Math.PI / 2 - 0.05, this.rotateStartRotX - dy * 0.005),
			);
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		if (this.pinnedIndex >= 0) {
			const node = this.nodes[this.pinnedIndex];
			if (!node || !this.canvas) {
				return;
			}
			const rect = this.canvas.getBoundingClientRect();
			if (this.is3D) {
				const sx = e.clientX - rect.left;
				const sy = e.clientY - rect.top;
				const rOld = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
				const desiredRx = this.toWorldX(sx);
				const desiredRy = this.toWorldY(sy);
				const inv = this.inverseRotate(desiredRx, desiredRy, rOld.z, this.rotCx, this.rotCy, this.rotCz);
				node.x = inv.x;
				node.y = inv.y;
				node.z = inv.z;
				node.vx = 0;
				node.vy = 0;
				node.vz = 0;
			} else {
				node.x = this.toWorldX(e.clientX - rect.left);
				node.y = this.toWorldY(e.clientY - rect.top);
				node.vx = 0;
				node.vy = 0;
			}
			return;
		}
		if (this.panning) {
			this.viewX = this.panViewX - (e.clientX - this.panStartX) / this.viewScale;
			this.viewY = this.panViewY - (e.clientY - this.panStartY) / this.viewScale;
			this.autoFitCooldown = PHYS.fitCooldown;
			return;
		}
		this.hoverIndex = this.hitTest(e);
		this.updateCursor();
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (this.touch) {
			this.touchEnd(e);
			return;
		}
		this.pointerX = e.clientX;
		this.pointerY = e.clientY;
		if (this.selecting) {
			const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
			if (moved >= 6) {
				this.finishSelection();
			} else if (this.toggleIndex >= 0) {
				this.toggleNodeSelection(this.toggleIndex);
			} else if (this.clearOnUp) {
				this.clearSelection();
			}
			this.selecting = false;
			this.toggleIndex = -1;
			this.selectLasso = [];
			this.pointerDown = false;
			this.clearOnUp = false;
			this.updateCursor();
			return;
		}
		if (this.groupDragging) {
			this.groupDragging = false;
			this.groupOrigins.clear();
			this.pointerDown = false;
			this.updateCursor();
			return;
		}
		if (this.rotating) {
			this.rotating = false;
			this.pointerDown = false;
			this.panning = false;
		} else {
			const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
			if (this.toggleIndex >= 0) {
				if (moved < 6 && this.toggleIndex >= 0) {
					this.toggleNodeSelection(this.toggleIndex);
				}
				this.toggleIndex = -1;
			} else if (this.pinnedIndex >= 0) {
				const node = this.nodes[this.pinnedIndex];
				if (node) {
					node.pinned = false;
				}
				if (moved < 6) {
					this.openNode(this.pinnedIndex);
				}
				this.pinnedIndex = -1;
			}
			if (this.clearOnUp && moved < 6) {
				this.clearSelection();
			}
			this.clearOnUp = false;
			this.pointerDown = false;
			this.panning = false;
		}
		this.updateCursor();
	};

	private toggleNodeSelection(i: number): void {
		const node = this.nodes[i];
		if (!node) {
			return;
		}
		if (this.selected.has(i)) {
			this.selected.delete(i);
			node.selected = false;
		} else {
			this.selected.add(i);
			node.selected = true;
		}
		this.updateCursor();
	}

	private clearSelection(): void {
		for (const i of this.selected) {
			const node = this.nodes[i];
			if (node) {
				node.selected = false;
			}
		}
		this.selected.clear();
		this.updateCursor();
	}

	private finishSelection(): void {
		this.clearSelection();
		if (!this.canvas) {
			return;
		}
		if (this.is3D) {
			this.finishLasso();
		} else {
			this.finishBox();
		}
	}

	private finishBox(): void {
		const x1 = Math.min(this.selectAnchorX, this.selectCurX);
		const y1 = Math.min(this.selectAnchorY, this.selectCurY);
		const x2 = Math.max(this.selectAnchorX, this.selectCurX);
		const y2 = Math.max(this.selectAnchorY, this.selectCurY);
		this.nodes.forEach((node, i) => {
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			if (sx >= x1 && sx <= x2 && sy >= y1 && sy <= y2) {
				this.selected.add(i);
				node.selected = true;
			}
		});
		this.updateCursor();
	}

	private finishLasso(): void {
		const poly = this.selectLasso;
		if (poly.length < 3) {
			return;
		}
		this.nodes.forEach((node, i) => {
			const r = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
			const sx = this.toScreenX(r.x);
			const sy = this.toScreenY(r.y);
			if (this.pointInPolygon(sx, sy, poly)) {
				this.selected.add(i);
				node.selected = true;
			}
		});
		this.updateCursor();
	}

	private pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
		let inside = false;
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const pi = poly[i];
			const pj = poly[j];
			if (!pi || !pj) {
				continue;
			}
			const intersect =
				pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
			if (intersect) {
				inside = !inside;
			}
		}
		return inside;
	}

	private moveSelectedGroup(dxScreen: number, dyScreen: number): void {
		const vs = this.viewScale;
		const dsx = dxScreen / vs;
		const dsy = dyScreen / vs;
		for (const i of this.selected) {
			const node = this.nodes[i];
			const orig = this.groupOrigins.get(i);
			if (!node || !orig) {
				continue;
			}
			if (this.is3D) {
				const inv = this.inverseRotate(dsx, dsy, 0, 0, 0, 0);
				node.x = orig.x + inv.x;
				node.y = orig.y + inv.y;
				node.z = orig.z + inv.z;
			} else {
				node.x = orig.x + dsx;
				node.y = orig.y + dsy;
			}
			node.vx = 0;
			node.vy = 0;
			node.vz = 0;
		}
	}

	private onPointerLeave = (): void => {
		this.hoverIndex = -1;
		this.pointerInside = false;
		if (this.cursorOverlay) {
			this.cursorOverlay.style.display = 'none';
		}
		if (this.canvas) {
			this.canvas.style.cursor = 'default';
		}
	};

	private onKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Shift') {
			this.shiftDown = true;
			this.updateCursor();
			return;
		}
		if (e.ctrlKey || e.metaKey || e.altKey) {
			return;
		}
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
			return;
		}
		if (this.app.workspace.getActiveViewOfType(SemanticHologramView) !== this) {
			return;
		}
		const key = e.key.toLowerCase();
		if (e.key === 'PrintScreen' && !e.repeat) {
			e.preventDefault();
			void this.takeScreenshot();
		} else if (key === 'h' && !e.repeat) {
			e.preventDefault();
			this.showHelp();
		} else if (key === 'c') {
			this.centerSelectedOnOrigin();
		} else if (key === 'f') {
			this.fitToView();
		} else if (key === 'r') {
			this.resetView();
		} else if (key === 's' && !e.repeat) {
			this.selectMode = true;
			this.selectDragOccurred = false;
			this.updateCursor();
		}
	};

	private selectHovered(): void {
		if (this.hoverIndex >= 0) {
			this.toggleNodeSelection(this.hoverIndex);
		}
	}

	private centerSelectedOnOrigin(): void {
		if (!this.canvas) {
			return;
		}
		let tx = 0;
		let ty = 0;
		let tz = 0;
		if (this.selected.size > 0) {
			let count = 0;
			for (const i of this.selected) {
				const n = this.nodes[i];
				if (!n) {
					continue;
				}
				tx += n.x;
				ty += n.y;
				tz += n.z;
				count++;
			}
			if (count === 0) {
				return;
			}
			tx /= count;
			ty /= count;
			tz /= count;
		} else {
			const idx = this.hoverIndex >= 0 ? this.hoverIndex : this.pinnedIndex >= 0 ? this.pinnedIndex : -1;
			if (idx < 0) {
				return;
			}
			const node = this.nodes[idx];
			if (!node) {
				return;
			}
			tx = node.x;
			ty = node.y;
			tz = node.z;
		}
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w === 0 || h === 0) {
			return;
		}
		this.viewX = tx - w / (2 * this.viewScale);
		this.viewY = ty - h / (2 * this.viewScale);
		this.originFollowView = false;
		this.rotCx = tx;
		this.rotCy = ty;
		this.rotCz = tz;
		this.autoFitCooldown = PHYS.fitCooldown;
	}

	private async takeScreenshot(): Promise<void> {
		if (!this.canvas || !this.contentEl) {
			return;
		}
		const cursorOverlay = this.cursorOverlay;
		const helpOverlay = this.helpOverlay;
		if (cursorOverlay) {
			cursorOverlay.style.display = 'none';
		}
		if (helpOverlay) {
			helpOverlay.style.display = 'none';
		}
		this.contentEl.addClass('sh-screenshot-flash');
		await new Promise((resolve) => setTimeout(resolve, 130));
		let blob: Blob | null = null;
		try {
			blob = await new Promise<Blob | null>((resolve) =>
				this.canvas?.toBlob((b) => resolve(b), 'image/png'),
			);
		} finally {
			this.contentEl.removeClass('sh-screenshot-flash');
			if (cursorOverlay) {
				cursorOverlay.style.display = '';
			}
			if (helpOverlay) {
				helpOverlay.style.display = '';
			}
		}
		if (!blob) {
			this.showToast('Screenshot failed');
			return;
		}
		try {
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			this.showToast('Screenshot copied to clipboard');
		} catch {
			this.showToast('Could not copy to clipboard');
		}
	}

	private showToast(text: string): void {
		this.hideToast();
		if (!this.contentEl) {
			return;
		}
		const toast = this.contentEl.createDiv({ cls: 'sh-toast' });
		toast.setText(text);
		this.toastEl = toast;
		window.setTimeout(() => this.hideToast(), 1500);
	}

	private hideToast(): void {
		if (this.toastEl) {
			this.toastEl.remove();
			this.toastEl = null;
		}
	}

	private showHelp(): void {
		if (this.helpOverlay || !this.contentEl) {
			return;
		}
		const el = this.contentEl.createDiv({ cls: 'sh-help-popup' });
		el.innerHTML =
			'<div class="sh-help-title">Semantic Hologram</div>' +
			'<div class="sh-help-row"><span class="sh-help-key">h</span><span class="sh-help-desc">show / hide help</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">c</span><span class="sh-help-desc">center hovered node on rotation origin</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">f</span><span class="sh-help-desc">fit graph to view</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">r</span><span class="sh-help-desc">reset (fit to view, rotation to 0)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">s</span><span class="sh-help-desc">hold: box/lasso select, tap: select hovered node</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">PrtSc</span><span class="sh-help-desc">copy screenshot to clipboard</span></div>' +
			'<div class="sh-help-section">Mouse</div>' +
			'<div class="sh-help-row"><span class="sh-help-key">drag</span><span class="sh-help-desc">pan background / move node / move selection</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+drag</span><span class="sh-help-desc">3D rotate (3D mode only)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">s + drag</span><span class="sh-help-desc">box select (2D) / lasso select (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+click</span><span class="sh-help-desc">toggle node selection</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">middle-drag</span><span class="sh-help-desc">3D rotate</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">scroll</span><span class="sh-help-desc">zoom to cursor</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">click bg</span><span class="sh-help-desc">clear selection</span></div>' +
			'<div class="sh-help-section">Modes</div>' +
			'<div class="sh-help-desc">2D canvas / 3D projected — toggle via the upper-left icon or side panel.</div>';
		this.helpOverlay = el;
	}

	private hideHelp(): void {
		if (this.helpOverlay) {
			this.helpOverlay.remove();
			this.helpOverlay = null;
		}
	}

	private onKeyUp = (e: KeyboardEvent): void => {
		if (e.key === 'Shift') {
			this.shiftDown = false;
			this.updateCursor();
		}
		if (e.key === 'h') {
			this.hideHelp();
		}
		if (e.key.toLowerCase() === 's') {
			this.selectMode = false;
			if (!this.selectDragOccurred) {
				this.selectHovered();
			}
			if (this.selecting) {
				this.finishSelection();
				this.selecting = false;
				this.selectLasso = [];
				this.pointerDown = false;
				this.clearOnUp = false;
			}
			this.updateCursor();
		}
	};

	private onWheel = (e: WheelEvent): void => {
		e.preventDefault();
		const canvas = this.canvas;
		if (!canvas) {
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const dy = Math.max(-100, Math.min(100, e.deltaY));
		const factor = Math.exp(-dy * PHYS.zoomSpeed);
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;
		this.autoFitCooldown = PHYS.fitCooldown;
	};

	private hitTest(e: PointerEvent): number {
		if (!this.canvas) {
			return -1;
		}
		const rect = this.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		let best = -1;
		let bestD = Infinity;
		if (this.is3D) {
			this.nodes.forEach((node, i) => {
				const r = this.rotatePoint(node.x, node.y, node.z, this.rotCx, this.rotCy, this.rotCz);
				const sx = this.toScreenX(r.x);
				const sy = this.toScreenY(r.y);
				const depth = (r.z + this.worldR()) / (2 * this.worldR() || 1);
				const depthScale = 0.55 + depth * 0.9;
				const rad = Math.max(2, node.radius * this.viewScale * depthScale);
				const sd = Math.hypot(sx - x, sy - y);
				if (sd < rad + 6 && sd < bestD) {
					bestD = sd;
					best = i;
				}
			});
			return best;
		}
		this.nodes.forEach((node, i) => {
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			const r = Math.max(3, node.radius * this.viewScale);
			const d = Math.hypot(node.x - this.toWorldX(x), node.y - this.toWorldY(y));
			const sd = Math.hypot(sx - x, sy - y);
			if (sd < r + 6 && d < bestD) {
				bestD = d;
				best = i;
			}
		});
		return best;
	}

	private openNode(idx: number): void {
		const node = this.nodes[idx];
		if (!node) {
			return;
		}
		void this.app.workspace.openLinkText(node.label, '');
	}

	async dumpGraphState(): Promise<string> {
		const dir = this.plugin.manifest.dir ?? '.obsidian/plugins/semantic-hologram';
		const path = `${dir}/graph-state.json`;
		const state = {
			settled: this.settled,
			layoutFrames: this.layoutFrames,
			scale: this.scale,
			viewScale: this.viewScale,
			viewX: this.viewX,
			viewY: this.viewY,
			canvas: {
				width: this.canvas?.clientWidth ?? 0,
				height: this.canvas?.clientHeight ?? 0,
				dpr: window.devicePixelRatio,
			},
			mode: this.plugin.settings.hologramMode,
			rotX: Math.round(this.rotX * 1000) / 1000,
			rotY: Math.round(this.rotY * 1000) / 1000,
			nodeCount: this.nodes.length,
			linkCount: this.links.length,
			avgEdgeLength: Math.round(this.avgEdgeLength() * 10) / 10,
			restLengthScaled:
				Math.round((this.links.reduce((s, l) => s + l.restLen, 0) / Math.max(1, this.links.length)) * this.scale * 10) / 10,
			worldR: Math.round(this.worldR() * 10) / 10,
			settleEnergy: PHYS.settleEnergy,
			forceSettleFrames: PHYS.forceSettleFrames,
			nodes: this.nodes.slice(0, 200).map((n) => ({
				path: n.path,
				x: Math.round(n.x * 10) / 10,
				y: Math.round(n.y * 10) / 10,
				z: Math.round(n.z * 10) / 10,
				homeX: Math.round(n.homeX * 10) / 10,
				homeY: Math.round(n.homeY * 10) / 10,
				homeZ: Math.round(n.homeZ * 10) / 10,
				radius: Math.round(n.radius * 10) / 10,
				pinned: n.pinned,
			})),
			links: this.links.slice(0, 200).map((l) => ({
				a: l.a,
				b: l.b,
				dir: l.dir,
				typed: l.typed,
				restLen: Math.round(l.restLen * 10) / 10,
			})),
		};
		await this.app.vault.adapter.write(path, JSON.stringify(state, null, 2));
		return path;
	}
}