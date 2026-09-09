import { ItemView, WorkspaceLeaf } from 'obsidian';
import type SemanticHologramPlugin from './main';

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
	homeSet: boolean;
}

interface GraphLink {
	a: number;
	b: number;
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
	private nodeColor = 'rgba(124, 111, 246, 1)';
	private edgeColor = 'rgba(180, 180, 180, 0.6)';
	private labelColor = 'rgba(180, 180, 180, 0.75)';
	private hoverIndex = -1;
	private resizeObserver: ResizeObserver | null = null;
	private rotX = 0;
	private rotY = 0;
	private rotating = false;
	private rotateStartX = 0;
	private rotateStartY = 0;
	private rotateStartRotX = 0;
	private rotateStartRotY = 0;

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

	private rotatePoint(x: number, y: number, z: number): { x: number; y: number; z: number } {
		const cosX = Math.cos(this.rotX);
		const sinX = Math.sin(this.rotX);
		const cosY = Math.cos(this.rotY);
		const sinY = Math.sin(this.rotY);
		const y1 = y * cosX - z * sinX;
		const z1 = y * sinX + z * cosX;
		const x1 = x;
		const x2 = x1 * cosY + z1 * sinY;
		const z2 = -x1 * sinY + z1 * cosY;
		const y2 = y1;
		return { x: x2, y: y2, z: z2 };
	}

	private inverseRotate(x: number, y: number, z: number): { x: number; y: number; z: number } {
		const cosY = Math.cos(this.rotY);
		const sinY = Math.sin(this.rotY);
		const cosX = Math.cos(this.rotX);
		const sinX = Math.sin(this.rotX);
		const x1 = x * cosY - z * sinY;
		const z1 = x * sinY + z * cosY;
		const y1 = y;
		const y0 = y1 * cosX + z1 * sinX;
		const z0 = -y1 * sinX + z1 * cosX;
		const x0 = x1;
		return { x: x0, y: y0, z: z0 };
	}

	setMode(mode: '2d' | '3d'): void {
		if (this.modeBanner) {
			this.modeBanner.setText(
				mode === '3d' ? '3D — Shift+drag to rotate · drag to pan · scroll to zoom' : '',
			);
			this.modeBanner.toggleClass('is-3d', mode === '3d');
		}
	}

	fitToViewPublic(): void {
		this.fitToView();
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('sh-view');

		this.modeBanner = container.createDiv({ cls: 'sh-mode-banner' });
		this.setMode(this.plugin.settings.hologramMode);

		this.canvas = container.createEl('canvas', { cls: 'sh-graph-canvas' });
		this.ctx = this.canvas.getContext('2d');
		if (!this.ctx) {
			return;
		}

		this.readColors();

		this.canvas.addEventListener('pointerdown', this.onPointerDown);
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerup', this.onPointerUp);
		this.canvas.addEventListener('pointerleave', this.onPointerUp);
		this.canvas.addEventListener('pointercancel', this.onPointerUp);
		this.canvas.addEventListener('wheel', this.onWheel, { passive: false });

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.canvas);
		this.resize();

		this.buildGraph();

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
			this.canvas.removeEventListener('pointerleave', this.onPointerUp);
			this.canvas.removeEventListener('pointercancel', this.onPointerUp);
			this.canvas.removeEventListener('wheel', this.onWheel);
		}
		this.contentEl.empty();
		return Promise.resolve();
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
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.scale = Math.max(0.6, Math.min(w, h) / PHYS.baseSize);
		if (this.settled) {
			this.fitToView();
		}
	}

	private buildGraph(incremental = false): void {
		const files = this.app.vault.getMarkdownFiles();
		const resolved = this.app.metadataCache.resolvedLinks;

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

		const links: GraphLink[] = [];
		const seen = new Set<string>();
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
				links.push({ a: srcIdx, b: dstIdx });
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
		}
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
				if (node.pinned) {
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
			if (node.pinned) {
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
			const restLen = PHYS.restLength * this.scale;
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
		if (w === 0 || h === 0) {
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		if (this.is3D) {
			for (const node of this.nodes) {
				const r = this.rotatePoint(node.x, node.y, node.z);
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
			if (a.pinned) {
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
						if (b.pinned) {
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
			if (a.pinned || b.pinned) {
				continue;
			}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.hypot(dx, dy) || 0.001;
			const f = PHYS.spring * (d - PHYS.restLength * this.scale);
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
			if (node.pinned) {
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
			if (a.pinned) {
				continue;
			}
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				if (b.pinned) {
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
			if (a.pinned || b.pinned) {
				continue;
			}
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const dz = b.z - a.z;
			const d = Math.hypot(dx, dy, dz) || 0.001;
			const f = PHYS.spring * (d - PHYS.restLength * this.scale);
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
			if (node.pinned) {
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

		if (this.is3D) {
			const R = this.worldR();
			const rotated = this.nodes.map((n) => this.rotatePoint(n.x, n.y, n.z));
			ctx.strokeStyle = this.edgeColor;
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (const l of this.links) {
				const a = rotated[l.a];
				const b = rotated[l.b];
				if (!a || !b) {
					continue;
				}
				ctx.moveTo(this.toScreenX(a.x), this.toScreenY(a.y));
				ctx.lineTo(this.toScreenX(b.x), this.toScreenY(b.y));
			}
			ctx.stroke();

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
					node.pinned || this.hoverIndex === i
						? this.nodeColor
						: this.withAlpha(this.nodeColor, alpha);
				if (node.pinned) {
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
			return;
		}

		ctx.strokeStyle = this.edgeColor;
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			ctx.moveTo(this.toScreenX(a.x), this.toScreenY(a.y));
			ctx.lineTo(this.toScreenX(b.x), this.toScreenY(b.y));
		}
		ctx.stroke();

		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (const node of this.nodes) {
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			const r = Math.max(3, node.radius * this.viewScale);
			ctx.fillStyle = node.pinned || this.hoverIndex === this.nodes.indexOf(node)
				? this.nodeColor
				: this.withAlpha(this.nodeColor, 0.92);
			if (node.pinned) {
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
	}

	private onPointerDown = (e: PointerEvent): void => {
		if (this.is3D && e.shiftKey) {
			this.rotating = true;
			this.pointerDown = true;
			this.downX = e.clientX;
			this.downY = e.clientY;
			this.rotateStartX = e.clientX;
			this.rotateStartY = e.clientY;
			this.rotateStartRotX = this.rotX;
			this.rotateStartRotY = this.rotY;
			this.canvas?.setPointerCapture(e.pointerId);
			if (this.canvas) {
				this.canvas.style.cursor = 'grabbing';
			}
			this.autoFitCooldown = PHYS.fitCooldown;
			this.hoverIndex = -1;
			return;
		}
		const idx = this.hitTest(e);
		this.pointerDown = true;
		this.downX = e.clientX;
		this.downY = e.clientY;
		if (idx >= 0) {
			this.pinnedIndex = idx;
			const node = this.nodes[idx];
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
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panViewX = this.viewX;
			this.panViewY = this.viewY;
			this.canvas?.setPointerCapture(e.pointerId);
			if (this.canvas) {
				this.canvas.style.cursor = 'grabbing';
			}
			this.autoFitCooldown = PHYS.fitCooldown;
		}
		this.hoverIndex = idx;
	};

	private onPointerMove = (e: PointerEvent): void => {
		if (this.rotating) {
			const dx = e.clientX - this.rotateStartX;
			const dy = e.clientY - this.rotateStartY;
			this.rotY = this.rotateStartRotY + dx * 0.005;
			this.rotX = Math.max(
				-Math.PI / 2 + 0.05,
				Math.min(Math.PI / 2 - 0.05, this.rotateStartRotX + dy * 0.005),
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
				const rOld = this.rotatePoint(node.x, node.y, node.z);
				const desiredRx = this.toWorldX(sx);
				const desiredRy = this.toWorldY(sy);
				const inv = this.inverseRotate(desiredRx, desiredRy, rOld.z);
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
		if (this.canvas) {
			this.canvas.style.cursor = this.hoverIndex >= 0 ? 'pointer' : 'grab';
		}
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (this.rotating) {
			this.rotating = false;
			this.pointerDown = false;
			this.panning = false;
			if (this.canvas) {
				this.canvas.style.cursor = 'default';
			}
			return;
		}
		const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
		if (this.pinnedIndex >= 0) {
			const node = this.nodes[this.pinnedIndex];
			if (node) {
				node.pinned = false;
			}
			if (moved < 6) {
				this.openNode(this.pinnedIndex);
			}
			this.pinnedIndex = -1;
		}
		this.pointerDown = false;
		this.panning = false;
		if (this.canvas) {
			this.canvas.style.cursor = 'default';
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
				const r = this.rotatePoint(node.x, node.y, node.z);
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
			restLengthScaled: Math.round(PHYS.restLength * this.scale * 10) / 10,
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
			links: this.links.slice(0, 200).map((l) => ({ a: l.a, b: l.b })),
		};
		await this.app.vault.adapter.write(path, JSON.stringify(state, null, 2));
		return path;
	}
}