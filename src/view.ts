import { ItemView, Notice, Platform, WorkspaceLeaf } from 'obsidian';
// @ts-ignore
import * as gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import type SemanticHologramPlugin from './main';
import type { HologramTool, RelTypeEntry } from './settings';
import type { SemanticHologramSettings } from './settings';
import type { RelationEdge, RelationScan } from './relations';
import { inScopePath, scanRelations } from './relations';
import { computeNodeStats, isEvidenceType, readNodeMetas, scanGravitas } from './gravitas';
import type { GravitasScan } from './gravitas';

export const VIEW_TYPE_HOLOGRAM = 'semantic-hologram-view';

export interface GraphNode {
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
	gravitasDisplay: number;
	gravitasReal: number;
	confidenceLocal: number;
	confidenceInherited: number;
	confidenceTotal: number;
	nodeType: string;
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

export interface SearchIndexEntry {
	path: string;
	label: string;
	nodeType: string;
	nodeTypeName: string;
	nodeTypeDesc: string;
	relIds: string[];
	relDescs: string[];
	content: string;
	confidenceTotal: number;
	gravitasDisplay: number;
}

/** Shared node-preview content: the same card shape everywhere (graph hover, search hover). */
export interface NodePreviewModel {
	label: string;
	path: string;
	typeName: string;
	confidencePct: number;
	gravitasPct: number;
	contentSnippet: string;
	content: string;
}

export function buildNodePreviewModel(
	node: { label: string; path: string; nodeType: string; confidenceTotal: number; gravitasDisplay: number; content?: string },
	settings: SemanticHologramSettings,
): NodePreviewModel {
	const typeEntry = settings.nodeTypes.find((t) => t.id === node.nodeType);
	return {
		label: node.label,
		path: node.path,
		typeName: typeEntry ? typeEntry.name : node.nodeType,
		confidencePct: Math.round(node.confidenceTotal * 100),
		gravitasPct: Math.round(node.gravitasDisplay * 100),
		contentSnippet: node.content ? (node.content.slice(0, 150) + (node.content.length > 150 ? '...' : '')) : '',
		content: node.content ?? '',
	};
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

const CANDIDATE_COLOR = '#9B5DE5';

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
	private searchIndex: Map<string, SearchIndexEntry> = new Map();
	private faces: number[][] = [];
	private loadingNotice: Notice | null = null;
	private raf = 0;
	private settled = false;
	private settleCount = 0;
	private layoutFrames = 0;
	private scale = 1;
	private pressedKeys = new Set<string>();
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
	private autoRotating: 'off' | 'cw' | 'ccw' = 'off';
	private rotM: number[] = [
		0,  1,  0,
	   -1,  0,  0,
		0,  0,  1
	];
	private rotateStartRotM: number[] = [
		0,  1,  0,
	   -1,  0,  0,
		0,  0,  1
	];
	private rotateStartSpin = 0;
	private totalSpin = 0;
	private buildSeq = 0;
	private rotCx = 0;
	private rotCy = 0;
	private rotCz = 0;
	private rotating = false;
	private rotateStartX = 0;
	private rotateStartY = 0;
	private lastRotX = 0;
	private lastRotY = 0;
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
	private candidateNodes: Set<string> = new Set();
	private lastSearchPickPath: string | null = null;
	private isRecording = false;
	private isEncoding = false;
	private recordingFrames: ImageData[] = [];
	private recordingSpinStart = 0;
	private recordingProgressEl: HTMLElement | null = null;

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

	private multiplyMatrices(A: number[], B: number[]): number[] {
		const out = new Array(9);
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				out[i * 3 + j] =
					(A[i * 3 + 0] ?? 0) * (B[0 * 3 + j] ?? 0) +
					(A[i * 3 + 1] ?? 0) * (B[1 * 3 + j] ?? 0) +
					(A[i * 3 + 2] ?? 0) * (B[2 * 3 + j] ?? 0);
			}
		}
		return out;
	}

	private getRotationMatrixAboutAxis(axis: [number, number, number], delta: number): number[] {
		const len = Math.hypot(axis[0] ?? 0, axis[1] ?? 0, axis[2] ?? 0);
		if (len < 1e-6) {
			return [1, 0, 0, 0, 1, 0, 0, 0, 1];
		}
		const ux = (axis[0] ?? 0) / len;
		const uy = (axis[1] ?? 0) / len;
		const uz = (axis[2] ?? 0) / len;

		const c = Math.cos(delta);
		const s = Math.sin(delta);
		const t = 1 - c;

		return [
			c + ux * ux * t,     ux * uy * t - uz * s,  ux * uz * t + uy * s,
			uy * ux * t + uz * s, c + uy * uy * t,     uy * uz * t - ux * s,
			uz * ux * t - uy * s, uz * uy * t + ux * s, c + uz * uz * t
		];
	}

	private rotateAboutAxis(axis: [number, number, number], delta: number): void {
		const R = this.getRotationMatrixAboutAxis(axis, delta);
		this.rotM = this.multiplyMatrices(R, this.rotM);
	}

	private rotatePoint(
		x: number,
		y: number,
		z: number,
		cx = 0,
		cy = 0,
		cz = 0,
	): { x: number; y: number; z: number } {
		const px = x - cx;
		const py = y - cy;
		const pz = z - cz;
		const m = this.rotM;
		const x2 = (m[0] ?? 0) * px + (m[1] ?? 0) * py + (m[2] ?? 0) * pz;
		const y2 = (m[3] ?? 0) * px + (m[4] ?? 0) * py + (m[5] ?? 0) * pz;
		const z2 = (m[6] ?? 0) * px + (m[7] ?? 0) * py + (m[8] ?? 0) * pz;
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
		const px = x - cx;
		const py = y - cy;
		const pz = z - cz;
		// Transpose of rotM is inverse for orthogonal rotation matrix
		const m = this.rotM;
		const x2 = (m[0] ?? 0) * px + (m[3] ?? 0) * py + (m[6] ?? 0) * pz;
		const y2 = (m[1] ?? 0) * px + (m[4] ?? 0) * py + (m[7] ?? 0) * pz;
		const z2 = (m[2] ?? 0) * px + (m[5] ?? 0) * py + (m[8] ?? 0) * pz;
		return { x: x2 + cx, y: y2 + cy, z: z2 + cz };
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

	public zoomIn(): void {
		if (!this.canvas) return;
		const sx = this.canvas.clientWidth / 2;
		const sy = this.canvas.clientHeight / 2;
		const factor = 1.25; 
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;
		this.autoFitCooldown = PHYS.fitCooldown;
	}

	public zoomOut(): void {
		if (!this.canvas) return;
		const sx = this.canvas.clientWidth / 2;
		const sy = this.canvas.clientHeight / 2;
		const factor = 1 / 1.25; 
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;
		this.autoFitCooldown = PHYS.fitCooldown;
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

		const zoomControls = container.createDiv({ cls: 'sh-map-zoom-controls' });
		const btnIn = zoomControls.createEl('button', { text: '+', cls: 'sh-map-zoom-btn' });
		btnIn.title = 'Zoom In';
		btnIn.addEventListener('click', () => this.zoomIn());

		const btnFit = zoomControls.createEl('button', { text: '⌖', cls: 'sh-map-zoom-btn' });
		btnFit.title = 'Fit to View';
		btnFit.addEventListener('click', () => this.fitToView());

		const btnOut = zoomControls.createEl('button', { text: '−', cls: 'sh-map-zoom-btn' });
		btnOut.title = 'Zoom Out';
		btnOut.addEventListener('click', () => this.zoomOut());

		this.canvas = container.createEl('canvas', { cls: 'sh-graph-canvas', attr: { tabindex: '0' } });
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
		window.addEventListener('keydown', this.onKeyDown, true);
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
		window.removeEventListener('keydown', this.onKeyDown, true);
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
		makeBtn('Auto-rotate', () => {
			const nextMode: 'off' | 'cw' | 'ccw' =
				this.autoRotating === 'off' ? 'cw' : this.autoRotating === 'cw' ? 'ccw' : 'off';
			this.autoRotating = nextMode;
			const label = nextMode === 'off' ? 'Rotation off' : nextMode === 'cw' ? 'CW rotation' : 'CCW rotation';
			this.showToast(label);
		});
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

	public focusSearchInput(): void {
		const searchInput = document.querySelector('.sh-search-input') as HTMLInputElement | null;
		if (searchInput) {
			searchInput.focus();
			searchInput.select();
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

	private getSpectrumColor(value: number, alpha = 1.0): string {
		const clamped = Math.max(0, Math.min(1, value));
		let r = 0;
		let g = 0;
		let b = 0;
		if (clamped <= 0.5) {
			r = 255;
			g = Math.round((clamped / 0.5) * 255);
		} else {
			r = Math.round((1 - (clamped - 0.5) / 0.5) * 255);
			g = 255;
		}
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
		if (!incremental && !this.loadingNotice) {
			this.loadingNotice = new Notice('Loading hologram…', 0);
		}
		const allFiles = this.app.vault.getMarkdownFiles();
		const files = allFiles.filter((f) => this.isInScope(f.path));
		const resolved = this.app.metadataCache.resolvedLinks;
		const settings = this.plugin.settings;

		const existing = new Map<string, number>();
		this.nodes.forEach((n, i) => existing.set(n.path, i));

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
			settings.defaultRelStrength,
			(path) => this.isInScope(path),
		);
		const gscan = await scanGravitas(files, this.app.vault, this.app.metadataCache, (path) => this.isInScope(path));
		// A newer build may have started while we were reading; drop stale results.
		if (buildSeq !== this.buildSeq) {
			return;
		}

		const metas = readNodeMetas(files, this.app.metadataCache, settings.defaultConfidence);
		const stats = computeNodeStats(metas, scan.edges, gscan.edges, settings.sourceKinds, settings.defaultConfidence);

		const nodes: GraphNode[] = [];
		const index = new Map<string, number>();
		const stOf = (path: string) => stats.get(path);

        // Pre-fetch all file contents
        const contentMap = new Map<string, string>();
        await Promise.all(files.map(async (f) => {
            try {
                contentMap.set(f.path, await this.app.vault.cachedRead(f));
            } catch {
                contentMap.set(f.path, '');
            }
        }));

		for (const f of files) {
			const meta = metas.get(f.path);
			if (meta && isEvidenceType(meta.nodeType)) {
				continue;
			}
			const oldIdx = existing.get(f.path);
			const st = stOf(f.path);
			const gd = st?.gravitasDisplay ?? 0;
			const gr = st?.gravitasReal ?? 0;
			const cl = st?.confidenceLocal ?? settings.defaultConfidence;
			const ci = st?.confidenceInherited ?? 0;
			const ct = st?.confidenceTotal ?? cl;
			let node: GraphNode;
			if (oldIdx !== undefined && incremental && this.nodes[oldIdx]) {
				node = this.nodes[oldIdx]!;
				node.gravitasDisplay = gd;
				node.gravitasReal = gr;
				node.confidenceLocal = cl;
				node.confidenceInherited = ci;
				node.confidenceTotal = ct;
				node.nodeType = meta?.nodeType ?? 'concept';
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
					gravitasDisplay: gd,
					gravitasReal: gr,
					confidenceLocal: cl,
					confidenceInherited: ci,
					confidenceTotal: ct,
					nodeType: meta?.nodeType ?? 'concept',
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

		// Zero-gravitas nodes float: their relationships carry effective strength
		// zero, so those pairs get the weakest (longest) rest length.
		for (const l of links) {
			const aNode = nodes[l.a]!;
			const bNode = nodes[l.b]!;
			if (aNode.gravitasDisplay <= 0 || bNode.gravitasDisplay <= 0) {
				l.strength = 0;
				l.restLen = settings.edgeMaxLength;
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

		// Populate initial synchronous search index so search works immediately
		const initialIndex = new Map<string, SearchIndexEntry>();
		for (const node of nodes) {
			const type = settings.nodeTypes.find((t) => t.id === node.nodeType);
			initialIndex.set(node.path, {
				path: node.path,
				label: node.label,
				nodeType: node.nodeType,
				nodeTypeName: type?.name ?? node.nodeType,
				nodeTypeDesc: type?.description ?? '',
				relIds: [],
				relDescs: [],
				content: contentMap.get(node.path) ?? '',
				confidenceTotal: node.confidenceTotal,
				gravitasDisplay: node.gravitasDisplay,
			});
		}
		this.searchIndex = initialIndex;

		this.searchIndex = await this.buildSearchIndex(nodes, scan, gscan, contentMap);
		if (buildSeq !== this.buildSeq) {
			return;
		}

		this.loadingNotice?.hide();
		this.loadingNotice = null;
		this.nodes = nodes;
		this.links = links;
		this.calculateFaces();
		console.log(`[SH] buildGraph: nodes=${nodes.length} links=${links.length} faces=${this.faces.length} settled=${this.settled}`);
		if (!incremental) {
			this.settled = false;
			this.settleCount = 0;
			this.layoutFrames = 0;
			this.selected.clear();
			this.fitToView();
		}
	}

	/** Per-node search cart: label/path/type/relationship/content for the controls search box. */
	private async buildSearchIndex(
		nodes: GraphNode[],
		scan: RelationScan,
		gscan: GravitasScan,
        contentMap: Map<string, string>
	): Promise<Map<string, SearchIndexEntry>> {
		const settings = this.plugin.settings;
		const nodeTypes = settings.nodeTypes;
		const relTypes = settings.relTypes;
		const index = new Map<string, SearchIndexEntry>();

		const relIdsByPath = new Map<string, Set<string>>();
		for (const e of scan.edges) {
			const a = relIdsByPath.get(e.source) ?? new Set<string>();
			a.add(e.relId);
			relIdsByPath.set(e.source, a);
			const b = relIdsByPath.get(e.target) ?? new Set<string>();
			b.add(e.relId);
			relIdsByPath.set(e.target, b);
		}
		for (const e of gscan.edges) {
			for (const p of [e.source, e.target]) {
				const s = relIdsByPath.get(p) ?? new Set<string>();
				s.add('gravitas');
				relIdsByPath.set(p, s);
			}
		}

		for (const node of nodes) {
			const type = nodeTypes.find((t) => t.id === node.nodeType);
			const relIds = relIdsByPath.get(node.path) ?? new Set<string>();
			index.set(node.path, {
				path: node.path,
				label: node.label,
				nodeType: node.nodeType,
				nodeTypeName: type?.name ?? node.nodeType,
				nodeTypeDesc: type?.description ?? '',
				relIds: [...relIds],
				relDescs: [...relIds]
					.map((id) => relTypes.find((r) => r.id === id)?.description ?? '')
					.filter((d) => d),
				content: contentMap.get(node.path) ?? '',
				confidenceTotal: node.confidenceTotal,
				gravitasDisplay: node.gravitasDisplay,
			});
		}
		return index;
	}

	private async readNodeContent(path: string): Promise<string> {
		try {
			const f = this.app.vault.getFileByPath(path);
			return f ? await this.app.vault.cachedRead(f) : '';
		} catch {
			return '';
		}
	}

	/** Closed triangles of interconnected nodes, deduplicated. */
	private calculateFaces(): void {
		const adjacency = new Map<number, Set<number>>();
		for (const l of this.links) {
			if (!adjacency.has(l.a)) adjacency.set(l.a, new Set());
			if (!adjacency.has(l.b)) adjacency.set(l.b, new Set());
			adjacency.get(l.a)!.add(l.b);
			adjacency.get(l.b)!.add(l.a);
		}

		const faces: number[][] = [];
		const seenFaces = new Set<string>();

		for (const [nodeA, neighbors] of adjacency) {
			for (const nodeB of neighbors) {
				if (nodeB <= nodeA) continue;
				const common = [...neighbors].filter(n => adjacency.get(nodeB)?.has(n));
				for (const nodeC of common) {
					if (nodeC <= nodeB) continue;
					const face = [nodeA, nodeB, nodeC].sort((a, b) => a - b);
					const key = face.join(',');
					if (!seenFaces.has(key)) {
						seenFaces.add(key);
						faces.push(face);
					}
				}
			}
		}
		this.faces = faces;
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
		if (this.isRecording) {
			console.log('[SH] loop: isRecording=true, calling captureFrame');
			this.captureFrame();
		}
		this.raf = requestAnimationFrame(this.loop);
	};

	public async startRecording(): Promise<void> {
		console.log('[SH] startRecording called, is3D:', this.is3D);
		if (!this.is3D) {
			this.showToast('Recording only supported in 3D mode');
			return;
		}
		this.isRecording = true;
		this.isEncoding = false;
		this.recordingFrames = [];
		this.recordingSpinStart = this.totalSpin;
		this.showToast('Recording 3D rotation...');

		if (!this.recordingProgressEl) {
			console.log('[SH] Creating recordingProgressEl and attaching to document.body');
			this.recordingProgressEl = document.body.createDiv({ cls: 'sh-recording-progress' });
		}
		this.recordingProgressEl.style.cssText = 'display: block !important; visibility: visible !important;';
		console.log('[SH] progress bar set to display block');
		this.updateProgressUI(0, 1257);

		// Write status file for MCP
		const statusPath = '.hologram-status.json';
		const statusData = JSON.stringify({ status: 'recording', timestamp: Date.now() });
		
        // Use adapter directly to overwrite reliably
        await (this.app.vault.adapter as any).write(statusPath, statusData);
	}

	private updateProgressUI(current: number, total: number): void {
		if (!this.recordingProgressEl) return;
		const pct = Math.min(100, Math.round((current / total) * 100));
		this.recordingProgressEl.innerHTML = `
			<div class="sh-progress-bar-title">Generating GIF: ${pct}%</div>
			<div class="sh-progress-bar-track"><div class="sh-progress-bar-fill" style="width: ${pct}%"></div></div>
		`;
	}

	private captureFrame(): void {
		if (!this.canvas || !this.ctx) return;
		
		// Capture every 2nd frame to reduce size and frame count
		if (this.recordingFrames.length % 2 === 0) {
			const targetWidth = 800;
			const aspect = this.canvas.height / this.canvas.width;
			const targetHeight = Math.round(targetWidth * aspect);

			const offscreen = document.createElement('canvas');
			offscreen.width = targetWidth;
			offscreen.height = targetHeight;
			const offCtx = offscreen.getContext('2d');
			if (offCtx) {
				offCtx.drawImage(this.canvas, 0, 0, targetWidth, targetHeight);
				const imageData = offCtx.getImageData(0, 0, targetWidth, targetHeight);
				this.recordingFrames.push(imageData as any);
			}
		}

		const totalExpected = 1257;
		this.updateProgressUI(this.recordingFrames.length, totalExpected / 2);

		// Stop after one full rotation (approx 2π / 0.005)
		if (Math.abs(this.totalSpin - this.recordingSpinStart) >= Math.PI * 2 || this.recordingFrames.length >= totalExpected / 2) {
			this.stopAndEncode();
		}
	}

	private stopAndEncode(): void {
		this.isRecording = false;
		this.isEncoding = true;
		if (this.recordingProgressEl) {
			this.recordingProgressEl.innerHTML = `<div class="sh-progress-bar-title">Encoding GIF... Please wait</div>`;
		}
		this.showToast('Encoding GIF...');

		// Run encoding asynchronously
		setTimeout(async () => {
			try {
				const gif = GIFEncoder();

				this.recordingFrames.forEach((frame, i) => {
					const data = frame.data;
					const fWidth = frame.width;
					const fHeight = frame.height;
					const palette = quantize(data, 256);
					const index = applyPalette(data, palette);
					
					const opts: any = { palette, delay: 10 };
					if (i === 0) opts.repeat = 0;
					
					gif.writeFrame(index, fWidth, fHeight, opts);
				});

				gif.finish();
				const buffer = gif.bytes();
				const blob = new Blob([buffer], { type: 'image/gif' });
				const url = URL.createObjectURL(blob);

				const folderName = 'HologramCaptures';
				const vault = this.app.vault;
				if (!vault.getAbstractFileByPath(folderName)) {
					await vault.createFolder(folderName);
				}

				const fileName = `${folderName}/hologram-${Date.now()}.gif`;
				const arrayBuffer = await blob.arrayBuffer();
                
                // Ensure unique filename
                let finalFileName = fileName;
                let counter = 1;
                while (vault.getAbstractFileByPath(finalFileName)) {
                    finalFileName = `${folderName}/hologram-${Date.now()}-${counter++}.gif`;
                }
                
				await vault.createBinary(finalFileName, arrayBuffer);

				this.showToast(`Saved GIF to ${finalFileName}`);

				// Write status file for MCP
				const statusPath = '.hologram-status.json';
				const statusData = JSON.stringify({ status: 'success', path: finalFileName, timestamp: Date.now() });
				await (vault.adapter as any).write(statusPath, statusData);

				if (this.recordingProgressEl) {
					this.recordingProgressEl.innerHTML = `
						<div class="sh-progress-bar-title">Saved to ${finalFileName}</div>
						<div class="sh-preview-container"><img class="sh-gif-preview" src="${url}" /></div>
						<div class="sh-progress-actions">
							<button class="sh-dismiss-progress-btn">Close</button>
						</div>
					`;
					this.recordingProgressEl.querySelector('.sh-dismiss-progress-btn')?.addEventListener('click', () => {
						this.recordingProgressEl!.style.display = 'none';
					});
					
					// Open the file in a new leaf/pane
					await this.app.workspace.openLinkText(fileName, '', true);
				}
			} catch (err) {
				console.error('[SH] GIF encoding error:', err);
				this.showToast('GIF encoding failed');
				
				// Write error status
				const statusPath = '.hologram-status.json';
				const statusData = JSON.stringify({ status: 'error', error: String(err), timestamp: Date.now() });
				await (this.app.vault.adapter as any).write(statusPath, statusData);

				if (this.recordingProgressEl) {
					this.recordingProgressEl.style.display = 'none';
				}
			} finally {
				this.isEncoding = false;
			}
		}, 50);
	}

	private relativeTrackballAxis(sx: number, sy: number): [number, number, number] {
		const fx = this.rotM[2] ?? 0;
		const fy = this.rotM[5] ?? 0;
		const fz = this.rotM[8] ?? 0;
		const ax = -fz * sy;
		const ay = fz * sx;
		const az = fx * sy - fy * sx;
		const len = Math.hypot(ax, ay, az);
		if (len < 1e-6) {
			return Math.abs(sy) < Math.abs(sx) ? [0, 1, 0] : [1, 0, 0];
		}
		return [ax / len, ay / len, az / len];
	}

	private step(): void {
		// Handle continuous keyboard panning / rotation
		const activeView = this.app.workspace.activeLeaf?.view;
		const pluginPaneActive =
			activeView === this ||
			activeView?.getViewType() === 'semantic-hologram-controls';
		if (this.pressedKeys.size > 0 && pluginPaneActive) {
			const panSpeed = 5 / this.viewScale;
			const rotSpeed = 0.01;
			const isShift = this.shiftDown;

			if (this.pressedKeys.has('ArrowLeft')) {
				if (isShift) {
					const delta = -rotSpeed;
					if (this.plugin.settings.rotationMode === 'relative') {
						this.rotateAboutAxis(this.relativeTrackballAxis(-1, 0), rotSpeed);
					} else {
						this.rotateAboutAxis([0, 1, 0], delta);
					}
					this.totalSpin += delta;
				} else {
					this.viewX += panSpeed;
				}
			}
			if (this.pressedKeys.has('ArrowRight')) {
				if (isShift) {
					const delta = rotSpeed;
					if (this.plugin.settings.rotationMode === 'relative') {
						this.rotateAboutAxis(this.relativeTrackballAxis(1, 0), rotSpeed);
					} else {
						this.rotateAboutAxis([0, 1, 0], delta);
					}
					this.totalSpin += delta;
				} else {
					this.viewX -= panSpeed;
				}
			}
			if (this.pressedKeys.has('ArrowUp')) {
				if (isShift) {
					const delta = rotSpeed;
					if (this.plugin.settings.rotationMode === 'relative') {
						this.rotateAboutAxis(this.relativeTrackballAxis(0, -1), rotSpeed);
					} else {
						this.rotateAboutAxis([1, 0, 0], delta);
					}
				} else {
					this.viewY += panSpeed;
				}
			}
			if (this.pressedKeys.has('ArrowDown')) {
				if (isShift) {
					const delta = -rotSpeed;
					if (this.plugin.settings.rotationMode === 'relative') {
						this.rotateAboutAxis(this.relativeTrackballAxis(0, 1), rotSpeed);
					} else {
						this.rotateAboutAxis([1, 0, 0], delta);
					}
				} else {
					this.viewY -= panSpeed;
				}
			}
			this.autoFitCooldown = PHYS.fitCooldown;
		}

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

		if (this.autoRotating === 'ccw' && this.nodes.length > 0) {
			this.rotateAboutAxis([0, 1, 0], -0.005);
			this.totalSpin -= 0.005;
		} else if (this.autoRotating === 'cw' && this.nodes.length > 0) {
			this.rotateAboutAxis([0, 1, 0], 0.005);
			this.totalSpin += 0.005;
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
		// Pin rotation center to the node centroid so it doesn't shift between
		// fitToView and draw().  originFollowView=false prevents draw() from
		// overwriting rotCx/rotCy/rotCz every frame.
		let cx = 0;
		let cy = 0;
		for (const node of this.nodes) {
			cx += node.x;
			cy += node.y;
		}
		cx /= this.nodes.length;
		cy /= this.nodes.length;
		this.rotCx = cx;
		this.rotCy = cy;
		this.rotCz = 0;
		this.originFollowView = false;
		// Bounding box in rotated space — uses the same rotC* that draw() will use.
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
		const m = 0.08;
		this.viewScale = Math.min(
			PHYS.zoomMax,
			Math.max(
				PHYS.zoomMin,
				Math.min((w * (1 - 2 * m)) / spanX, (h * (1 - 2 * m)) / spanY),
			),
		);
		this.viewX = (minX + maxX) / 2 - w / (2 * this.viewScale);
		this.viewY = (minY + maxY) / 2 - h / (2 * this.viewScale);
		console.log(`[SH] fitToView: nodes=${this.nodes.length} canvas=${w}x${h} rotC=(${this.rotCx.toFixed(1)},${this.rotCy.toFixed(1)},${this.rotCz.toFixed(1)}) view=(${this.viewX.toFixed(1)},${this.viewY.toFixed(1)}) scale=${this.viewScale.toFixed(3)}`);
	}

	private resetView(): void {
		this.rotM = [
			0,  1,  0,
		   -1,  0,  0,
			0,  0,  1
		];
		this.totalSpin = 0;
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

	private getDistances(start: number): Map<number, number> {
		const distances = new Map<number, number>();
		const queue: number[] = [start];
		distances.set(start, 0);

		// Build adjacency list
		const adj = new Map<number, number[]>();
		for (const l of this.links) {
			if (!adj.has(l.a)) adj.set(l.a, []);
			if (!adj.has(l.b)) adj.set(l.b, []);
			adj.get(l.a)!.push(l.b);
			adj.get(l.b)!.push(l.a);
		}

		while (queue.length > 0) {
			const u = queue.shift()!;
			const d = distances.get(u)!;
			if (d >= this.plugin.settings.hoverDepth) continue;

			for (const v of adj.get(u) ?? []) {
				if (!distances.has(v)) {
					distances.set(v, d + 1);
					queue.push(v);
				}
			}
		}
		return distances;
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

		// Calculate highlighted nodes if hovering
		const distances = this.hoverIndex >= 0 && this.plugin.settings.hoverDepth > 0 ? this.getDistances(this.hoverIndex) : undefined;
		const highlighted = distances ? new Set(distances.keys()) : new Set<number>();

		if (this.is3D) {
			const R = this.worldR();
			const rotated = this.nodes.map((n) => this.rotatePoint(n.x, n.y, n.z, this.rotCx, this.rotCy, this.rotCz));
			const maxAbsZ = Math.max(...rotated.map(p => Math.abs(p.z)), 1);

			if (this.plugin.settings.facesEnabled && this.faces.length > 0) {
				const renderables: { type: 'face'; face: number[]; z: number }[] = [];
				for (const face of this.faces) {
					const z = (rotated[face[0]!]!.z + rotated[face[1]!]!.z + rotated[face[2]!]!.z) / 3;
					renderables.push({ type: 'face', face, z });
				}
				renderables.sort((a, b) => a.z - b.z);
				ctx.fillStyle = this.withAlpha(this.plugin.settings.facesColor, this.plugin.settings.facesOpacity);
				for (const item of renderables) {
					const pA = rotated[item.face[0]!]!;
					const pB = rotated[item.face[1]!]!;
					const pC = rotated[item.face[2]!]!;
					ctx.beginPath();
					ctx.moveTo(this.toScreenX(pA.x), this.toScreenY(pA.y));
					ctx.lineTo(this.toScreenX(pB.x), this.toScreenY(pB.y));
					ctx.lineTo(this.toScreenX(pC.x), this.toScreenY(pC.y));
					ctx.closePath();
					ctx.fill();
				}
			}

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
				const isHighlighted = this.hoverIndex === i || highlighted.has(i);
const isCandidate = this.candidateNodes.has(node.path);
			const isFaded = this.hoverIndex >= 0 && !isHighlighted;
			const isSpecial = node.pinned || node.selected || isHighlighted || isCandidate;
			const r = this.nodeScreenRadius(node, p, maxAbsZ) * (isHighlighted ? 1.4 : 1.0);
				const viewSettings = this.plugin.settings;
				const grav = node.gravitasDisplay;
				const halo = node.confidenceTotal;
				let alpha = isFaded ? 0.15 : (isSpecial ? 0.9 : (0.45 + depth * 0.55));
				if (viewSettings.showGravitasColor && !isFaded && !isSpecial) {
					alpha = 0.35 + depth * 0.4;
				}

				const typeEntry = viewSettings.nodeTypes.find((t) => t.id === node.nodeType);
				const baseColor = typeEntry?.color ?? this.nodeColor;
				const nodeColor = viewSettings.showGravitasColor ? this.getSpectrumColor(grav, alpha) : baseColor;

				if (viewSettings.showConfidenceHalo && !isFaded) {
					ctx.beginPath();
					ctx.arc(sx, sy, r * 1.25, 0, Math.PI * 2);
					ctx.strokeStyle = isCandidate
						? this.withAlpha(CANDIDATE_COLOR, 0.9)
						: this.getSpectrumColor(halo, Math.max(0.7, halo));
					ctx.lineWidth = 2.5;
					ctx.stroke();
				}

				ctx.fillStyle = isFaded
					? this.withAlpha(isCandidate ? CANDIDATE_COLOR : baseColor, 0.15)
					: (isCandidate
						? CANDIDATE_COLOR
						: (isSpecial ? baseColor : this.withAlpha(nodeColor, alpha)));
				if (isSpecial && !isCandidate) {
					ctx.beginPath();
					ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
					ctx.strokeStyle = baseColor;
					ctx.lineWidth = 1.5;
					ctx.stroke();
				}
				ctx.beginPath();
				ctx.arc(sx, sy, r, 0, Math.PI * 2);
				ctx.fill();
			}

			for (const { p, i } of order) {
				const node = this.nodes[i]!;
				const normZ = p.z / maxAbsZ;
				let scale: number;
				if (normZ <= 0) {
					scale = 0.25 + (normZ + 1) * 0.75;
				} else {
					scale = 1.0 + normZ * 1.0;
				}
				const fontSize = Math.max(6, Math.round(10 * scale));
				ctx.font = `${fontSize}px var(--font-interface)`;
				ctx.fillStyle = this.withAlpha(this.labelColor, 0.35 + ((p.z + R) / (2 * R || 1)) * 0.65);
				ctx.fillText(node.label, this.toScreenX(p.x) + this.nodeScreenRadius(node, p, maxAbsZ) + 3, this.toScreenY(p.y));
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
				const normZA = ra.z / maxAbsZ;
				const normZB = rb.z / maxAbsZ;
				const edgeNormZ = (normZA + normZB) / 2;
				this.strokeArrowLine(
					this.toScreenX(ra.x),
					this.toScreenY(ra.y),
					this.nodeScreenRadius(a, ra, maxAbsZ),
					this.toScreenX(rb.x),
					this.toScreenY(rb.y),
					this.nodeScreenRadius(b, rb, maxAbsZ),
					l,
					this.edgeStroke(l, sel, highlighted, distances, edgeNormZ),
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
			const i = this.nodes.indexOf(node);
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			const isHighlighted = this.hoverIndex === i || highlighted.has(i);
			const isCandidate = this.candidateNodes.has(node.path);
			const isFaded = this.hoverIndex >= 0 && !isHighlighted;
			const isSpecial = node.pinned || node.selected || isHighlighted || isCandidate;
			const r = Math.max(3, node.radius * this.viewScale * (isHighlighted ? 1.5 : 1.0));
			
			const viewSettings = this.plugin.settings;
			const grav = node.gravitasDisplay;
			const halo = node.confidenceTotal;
			let alpha = 0.92;

			const typeEntry = viewSettings.nodeTypes.find((t) => t.id === node.nodeType);
			const baseColor = typeEntry?.color ?? this.nodeColor;
			const nodeColor = viewSettings.showGravitasColor ? this.getSpectrumColor(grav, alpha) : baseColor;

			if (viewSettings.showConfidenceHalo && !isFaded) {
				ctx.beginPath();
				ctx.arc(sx, sy, r * 1.25, 0, Math.PI * 2);
				ctx.strokeStyle = isCandidate
					? this.withAlpha(CANDIDATE_COLOR, 0.9)
					: this.getSpectrumColor(halo, Math.max(0.7, halo));
				ctx.lineWidth = 2.5;
				ctx.stroke();
			}

			ctx.fillStyle = isFaded
				? this.withAlpha(isCandidate ? CANDIDATE_COLOR : baseColor, 0.15)
				: (isCandidate
					? CANDIDATE_COLOR
					: (isSpecial ? baseColor : this.withAlpha(nodeColor, alpha)));
			if (isSpecial && !isCandidate) {
				ctx.beginPath();
				ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
				ctx.strokeStyle = baseColor;
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
					this.edgeStroke(l, sel, highlighted, distances),

			);
		}
		this.drawLiveSelection();
		this.drawSelectionArea();
		this.drawOriginIndicator();
		this.drawHoverTooltip();
		this.updateCursor();
	}

	private drawHoverTooltip(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) {
			return;
		}
		if (!this.pointerInside || this.hoverIndex < 0) {
			return;
		}
		if (this.rotating || this.panning || this.pinnedIndex >= 0 || this.selecting || this.selectMode || this.groupDragging) {
			return;
		}
		const node = this.nodes[this.hoverIndex];
		if (!node) {
			return;
		}

		const cs = getComputedStyle(this.contentEl);
		const fontFamily = cs.getPropertyValue('--font-interface').trim() || cs.fontFamily;
		const labelFont = `600 12px ${fontFamily}`;
		const bodyFont = `10px ${fontFamily}`;

		const entry = this.searchIndex.get(node.path);
		const preview = buildNodePreviewModel(
			{ ...node, content: entry?.content },
			this.plugin.settings,
		);
		const typeName = preview.typeName;
		const meta =
			(typeName ? typeName + ' · ' : '') +
			`Confidence ${preview.confidencePct}%` +
			` · Gravitas ${preview.gravitasPct}%`;
		const pathText = preview.path.length > 64 ? preview.path.slice(0, 61) + '...' : preview.path;

		const lines: Array<{ text: string; font: string; dim?: boolean }> = [
			{ text: preview.label, font: labelFont },
			{ text: pathText, font: bodyFont, dim: true },
			{ text: meta, font: bodyFont },
			{ text: preview.contentSnippet, font: bodyFont, dim: true },
		];

		const padX = 10;
		const padY = 8;
		const lineH = 15;
		let boxW = 0;
		for (const l of lines) {
			ctx.font = l.font;
			boxW = Math.max(boxW, ctx.measureText(l.text).width);
		}
		const boxH = lines.length * lineH + padY * 2;
		boxW += padX * 2;

		const rect = canvas.getBoundingClientRect();
		let x = this.pointerX - rect.left + 14;
		let y = this.pointerY - rect.top + 16;
		if (x + boxW > rect.width - 8) {
			x = this.pointerX - rect.left - boxW - 12;
		}
		if (y + boxH > rect.height - 8) {
			y = this.pointerY - rect.top - boxH - 14;
		}
		x = Math.max(4, x);
		y = Math.max(4, y);

		ctx.save();
		ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
		ctx.shadowBlur = 10;
		const bg = cs.getPropertyValue('--background-primary').trim() || '#1e1e1e';
		const border = cs.getPropertyValue('--background-modifier-border').trim() || '#555';
		ctx.fillStyle = bg;
		this.roundRect(ctx, x, y, boxW, boxH, 6);
		ctx.fill();
		ctx.shadowBlur = 0;
		ctx.strokeStyle = border;
		ctx.lineWidth = 1;
		this.roundRect(ctx, x, y, boxW, boxH, 6);
		ctx.stroke();

		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (let i = 0; i < lines.length; i++) {
			const l = lines[i];
			if (!l) {
				continue;
			}
			ctx.font = l.font;
			ctx.globalAlpha = l.dim ? 0.65 : 1;
			ctx.fillStyle = cs.color || '#ccc';
			ctx.fillText(l.text, x + padX, y + padY + i * lineH + lineH / 2);
		}
		ctx.globalAlpha = 1;
		ctx.restore();
	}

	private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	private nodeScreenRadius(node: GraphNode, p: { x: number; y: number; z: number }, R: number): number {
		if (this.is3D) {
			const depth = (p.z + R) / (2 * R || 1);
			const minScale = 0.25;
			const maxScale = 2.0;
			const scale = minScale + depth * (maxScale - minScale);
			return Math.max(2, node.radius * this.viewScale * scale);
		}
		return Math.max(3, node.radius * this.viewScale);
	}

	private edgeStroke(link: GraphLink, selCount: number, highlightedNodes?: Set<number>, distances?: Map<number, number>, edgeDepth?: number): string {
		const hasHighlight = highlightedNodes !== undefined && highlightedNodes.size > 0;
		let baseAlpha = 1.0;
		if (this.is3D && edgeDepth !== undefined) {
			baseAlpha = 0.25 + edgeDepth * 0.75;
		}
		if (!hasHighlight) {
			if (selCount === 1) return this.withAlpha(link.edgeColor, Math.min(0.35, baseAlpha * 0.5));
			return this.withAlpha(link.edgeColor, baseAlpha);
		}
		const bothIn = highlightedNodes!.has(link.a) && highlightedNodes!.has(link.b);
		if (!bothIn) return this.withAlpha(link.edgeColor, Math.min(0.25, baseAlpha * 0.3));
		const da = distances?.get(link.a);
		const db = distances?.get(link.b);
		if (da === undefined || db === undefined) return this.withAlpha(link.edgeColor, Math.min(0.25, baseAlpha * 0.3));
		const minD = Math.min(da, db);
		const diff = Math.abs(da - db);
		if (diff === 1 && minD < this.plugin.settings.hoverDepth) return this.withAlpha(link.edgeColor, baseAlpha);
		if (diff === 0 && minD === 0) return this.withAlpha(link.edgeColor, baseAlpha);
		return this.withAlpha(link.edgeColor, Math.min(0.25, baseAlpha * 0.3));
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

		if (this.is3D) {
			const cx = w / 2;
			const cy = h - 35;
			const rx = 20;
			const ry = 7;

			// Draw X-Z plane rotation track ellipse at bottom center (fixed screen space, no zoom scaling)
			ctx.save();
			ctx.strokeStyle = this.withAlpha(this.nodeColor, 0.85);
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
			ctx.stroke();

			// Draw orbiting node on the X-Z track (driven by rotY rotation around Y axis)
			const dotSx = cx + rx * Math.cos(-this.totalSpin);
			const dotSy = cy + ry * Math.sin(-this.totalSpin);
			const dotRadius = 4.5;

			ctx.fillStyle = this.nodeColor;
			ctx.beginPath();
			ctx.arc(dotSx, dotSy, dotRadius, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = this.withAlpha(this.nodeColor, 0.8);
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.restore();
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
			this.rotateStartRotM = [...this.rotM];
			this.rotateStartSpin = this.totalSpin;
			this.lastRotX = 0;
			this.lastRotY = 0;
			this.autoFitCooldown = PHYS.fitCooldown;
			this.touchGesture = 'rotate';
			return;
		}

		const idx = this.hitTest(e);
		this.touchTappedNode = idx;

		if (tool === 'select') {
			this.selecting = true;
			this.toggleIndex = idx;
			this.clearOnUp = idx < 0 && (this.selected.size > 0 || this.candidateNodes.size > 0);
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
		this.clearOnUp = this.selected.size > 0 || this.candidateNodes.size > 0;
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
			const dxNow = e.clientX - this.rotateStartX;
			const dyNow = e.clientY - this.rotateStartY;
			const ddx = dxNow - this.lastRotX;
			const ddy = dyNow - this.lastRotY;
			this.lastRotX = dxNow;
			this.lastRotY = dyNow;
			const scale = 0.005;
			if (this.plugin.settings.rotationMode === 'relative') {
				this.rotateAboutAxis(this.relativeTrackballAxis(ddx, ddy), Math.hypot(ddx, ddy) * scale);
			} else {
				this.rotateAboutAxis([0, 1, 0], ddx * scale);
				this.rotateAboutAxis([1, 0, 0], -ddy * scale);
			}
			this.totalSpin += ddx * scale;
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
			this.rotateStartRotM = [...this.rotM];
			this.rotateStartSpin = this.totalSpin;
			this.lastRotX = 0;
			this.lastRotY = 0;
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
			this.clearOnUp = this.toggleIndex < 0 && (this.selected.size > 0 || this.candidateNodes.size > 0);
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
			this.clearOnUp = this.selected.size > 0 || this.candidateNodes.size > 0;
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
			const dxNow = e.clientX - this.rotateStartX;
			const dyNow = e.clientY - this.rotateStartY;
			const ddx = dxNow - this.lastRotX;
			const ddy = dyNow - this.lastRotY;
			this.lastRotX = dxNow;
			this.lastRotY = dyNow;
			const scale = 0.005;
			if (this.plugin.settings.rotationMode === 'relative') {
				this.rotateAboutAxis(this.relativeTrackballAxis(ddx, ddy), Math.hypot(ddx, ddy) * scale);
			} else {
				this.rotateAboutAxis([0, 1, 0], ddx * scale);
				this.rotateAboutAxis([1, 0, 0], -ddy * scale);
			}
			this.totalSpin += ddx * scale;
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
		this.candidateNodes.clear();
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
		this.candidateNodes.clear();
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
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !e.repeat) {
				e.preventDefault();
				for (let i = 0; i < this.nodes.length; i++) {
					this.selected.add(i);
				}
				this.showToast(`Selected all ${this.nodes.length} nodes`);
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.repeat) {
				e.preventDefault();
				this.focusSearchInput();
				return;
			}
			return;
		}
		const target = e.target as HTMLElement | null;
		const tag = target?.tagName;
		const inp = target as HTMLInputElement;
		const isCheckbox = tag === 'INPUT' && inp?.type === 'checkbox';
		const inTypingContext =
			tag === 'TEXTAREA' || !!target?.isContentEditable || (tag === 'INPUT' && !isCheckbox);
		if (inTypingContext) {
			return;
		}
		const activeView = this.app.workspace.activeLeaf?.view;
		if (activeView !== this && activeView?.getViewType() !== 'semantic-hologram-controls') {
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
		} else if (key === 'f' && e.shiftKey) {
			this.fitToView();
		} else if (key === 'f' && !e.repeat) {
			this.plugin.settings.facesEnabled = !this.plugin.settings.facesEnabled;
			void this.plugin.saveSettings();
			this.showToast(this.plugin.settings.facesEnabled ? 'Faces on' : 'Faces off');
		} else if (key === 'r' && e.shiftKey) {
			this.resetView();
		} else if (key === 'r' && !e.repeat) {
			const nextMode: 'off' | 'cw' | 'ccw' =
				this.autoRotating === 'off' ? 'cw' : this.autoRotating === 'cw' ? 'ccw' : 'off';
			this.autoRotating = nextMode;
			const label = nextMode === 'off' ? 'Rotation off' : nextMode === 'cw' ? 'CW rotation' : 'CCW rotation';
			this.showToast(label);
		} else if (key === 'g' && !e.repeat) {
			console.log('[SH] g key pressed, isRecording:', this.isRecording, 'isEncoding:', this.isEncoding);
			if (this.isRecording || this.isEncoding) {
				this.showToast('GIF generation in progress');
			} else {
				this.startRecording();
			}
		} else if (key === 's' && !e.repeat) {
			this.selectMode = true;
			this.selectDragOccurred = false;
			this.updateCursor();
		} else if (e.key.startsWith('Arrow')) {
			e.preventDefault();
			this.pressedKeys.add(e.key);
		} else if (e.key === ' ' && !e.repeat && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') {
			if (this.autoRotating !== 'off') {
				e.preventDefault();
				this.autoRotating = 'off';
				this.showToast('Rotation off');
			}
		}

	};

	private selectHovered(): void {
		let pivot = this.hoverIndex;
		if (pivot < 0 && this.lastSearchPickPath) {
			const found = this.nodes.findIndex((n) => n.path === this.lastSearchPickPath);
			pivot = found >= 0 ? found : -1;
		}
		if (pivot < 0) return;
		const toSelect: number[] = [pivot];
		if (this.plugin.settings.hoverDepth > 0) {
			const d = this.getDistances(pivot);
			for (const idx of d.keys()) if (idx !== pivot) toSelect.push(idx);
		}
		const allAlready = toSelect.every((i) => this.selected.has(i));
		if (allAlready) {
			for (const i of toSelect) {
				const n = this.nodes[i];
				if (n) n.selected = false;
				this.selected.delete(i);
			}
		} else {
			for (const i of toSelect) {
				const n = this.nodes[i];
				if (!n) continue;
				n.selected = true;
				this.selected.add(i);
			}
		}
		this.updateCursor();
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
		console.log(`[SH] centerSelectedOnOrigin: rotC=(${tx.toFixed(1)},${ty.toFixed(1)},${tz.toFixed(1)}) view=(${this.viewX.toFixed(1)},${this.viewY.toFixed(1)}) scale=${this.viewScale.toFixed(3)}`);
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
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+f</span><span class="sh-help-desc">focus search</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">c</span><span class="sh-help-desc">center hovered node on rotation origin</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+a</span><span class="sh-help-desc">select all nodes</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">f</span><span class="sh-help-desc">toggle faces (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+f</span><span class="sh-help-desc">fit graph to view</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">r</span><span class="sh-help-desc">cycle rotation: off → clockwise → counter-clockwise</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+r</span><span class="sh-help-desc">reset (fit to view, rotation to 0)</span></div>' +
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
		} else if (e.key.startsWith('Arrow')) {
			this.pressedKeys.delete(e.key);
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

		// If hovering over a node, change max depth instead of zooming
		if (this.hoverIndex >= 0) {
			const delta = dy > 0 ? -1 : 1;
			const newDepth = Math.max(0, Math.min(5, this.plugin.settings.maxDepth + delta));
			void this.plugin.setMaxDepth(newDepth);
			this.showToast(`Max Depth: ${newDepth}`);
			return;
		}

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
				const depthScale = this.plugin.settings.depthBase + depth * 0.9;
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

	setCandidateNodes(paths: string[]): void {
		this.candidateNodes = new Set(paths);
		if (paths.length > 0) {
			this.lastSearchPickPath = paths[paths.length - 1] ?? null;
		}
		const node = this.nodes.find((n) => paths.length > 0 && n.path === paths[paths.length - 1]);
		if (node) {
			this.viewX = node.x - (this.canvas?.clientWidth ?? 0) / (2 * this.viewScale);
			this.viewY = node.y - (this.canvas?.clientHeight ?? 0) / (2 * this.viewScale);
		}
		this.requestRedraw();
	}

	toggleCandidateNode(path: string): void {
		if (this.candidateNodes.has(path)) {
			this.candidateNodes.delete(path);
			if (this.lastSearchPickPath === path) {
				this.lastSearchPickPath = null;
			}
		} else {
			this.candidateNodes.add(path);
			this.lastSearchPickPath = path;
		}
		this.requestRedraw();
	}

	clearCandidateNodes(): void {
		if (this.candidateNodes.size === 0) {
			return;
		}
		this.candidateNodes.clear();
		this.requestRedraw();
	}

	getCandidateNodes(): ReadonlySet<string> {
		return this.candidateNodes;
	}

	/** Searchable per-node metadata for the controls search box. */
	getSearchIndex(): Map<string, SearchIndexEntry> {
		return this.searchIndex;
	}

	/** Move keyboard focus onto the graph canvas so hotkeys (e.g. `c`) respond. */
	focusGraph(): void {
		(this.canvas ?? this.contentEl).focus();
	}

	requestRedraw(): void {
		this.settled = false;
	}

	showLevelTooltip(show: boolean): void {
		// Implement later
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
			rotM: this.rotM.map(v => Math.round(v * 1000) / 1000),
			totalSpin: Math.round(this.totalSpin * 1000) / 1000,
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