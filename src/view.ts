import { App, ItemView, Modal, Notice, Platform, TFile, TextComponent, WorkspaceLeaf } from 'obsidian';
// @ts-ignore
import * as gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import type SemanticHologramPlugin from './main';
import type { HologramTool, RelTypeEntry } from './settings';
import type { SemanticHologramSettings } from './settings';
import type { RelationEdge, RelationScan } from './relations';
import { findRelationsSection, formatStrength, inScopePath, scanRelations } from './relations';
import { addRelation, removeRelation } from './reviewCommon';
import { computeNodeStats, isEvidenceType, readNodeMetas, scanGravitas } from './gravitas';
import { ReviewConnectionsModal } from './review';
import type { GravitasScan } from './gravitas';

export const VIEW_TYPE_HOLOGRAM = 'semantic-hologram-view';

export interface UndoAction {
	undo(): void;
	redo(): void;
}

export class HistoryStack {
	private undoStack: UndoAction[] = [];
	private redoStack: UndoAction[] = [];

	push(action: UndoAction): void {
		this.undoStack.push(action);
		if (this.undoStack.length > 10) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	undo(): void {
		const action = this.undoStack.pop();
		if (action) {
			action.undo();
			this.redoStack.push(action);
		}
	}

	redo(): void {
		const action = this.redoStack.pop();
		if (action) {
			action.redo();
			this.undoStack.push(action);
		}
	}
}

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

interface Relation {
	type: string;
	strength: number;
	/** Note that authored the relation line, when this is an authored relation. */
	authoredFrom?: string;
	/** Verbatim authored line, used to remove the relation from its note. */
	raw?: string;
	/** Semantic source/target note paths, for direction display. */
	source?: string;
	target?: string;
}

interface GraphLink {
	a: number;
	b: number;
	restLen: number;
	dir: 'ab' | 'ba' | 'both';
	relations: Relation[];
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
	// Dolly bounds for the 3D trackball rig. There is no independent zoom in
	// 3D: the projection scale is derived from the standoff distance, so these
	// bound magnification directly (see docs section 5).
	dollyMin: 125,
	dollyMax: 33333,
	dollySpeed: 0.004,
	dollyStep: 1.25,
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
	private historyStack = new HistoryStack();
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
	private currentElevation: number = 0;
	private currentAzimuth: number = 0;

	get elevation(): number {
		return this.currentElevation;
	}

	get azimuth(): number {
		return this.currentAzimuth;
	}
	private panViewY = 0;
	private panRotCx = 0;
	private panRotCy = 0;
	private panRotCz = 0;
	/** Persistent depth component of the camera's rotation center; panning needs it to move the view in pure screen space. */
	private camZ = 0;
	private panCamZ = 0;
	private autoFitCooldown = 0;
	private userAdjustedView = false;
	private viewX = 0;
	private viewY = 0;
	private viewScale = 1;
	private target: [number, number, number] = [0, 0, 0];
	private distance = 1000;
	private panTarget: [number, number, number] = [0, 0, 0];
	private baseCameraDistance = 1000;
	private cameraDistance = 1000;
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
	private hideEdgeTooltip(): void {
		if (this.hideEdgeTooltipTimer) {
			window.clearTimeout(this.hideEdgeTooltipTimer);
			this.hideEdgeTooltipTimer = null;
		}
		if (this.edgeTooltipEl) {
			this.edgeTooltipEl.remove();
			this.edgeTooltipEl = null;
		}
		this.flushPendingEdgeRefresh();
	}

	private flushPendingEdgeRefresh(): void {
		if (!this.pendingEdgeRefresh) {
			return;
		}
		this.pendingEdgeRefresh = false;
		void this.plugin.refreshGraphs();
	}

	private drawEdgeTooltip(edge: GraphLink): void {
		if (this.hideEdgeTooltipTimer) {
			window.clearTimeout(this.hideEdgeTooltipTimer);
			this.hideEdgeTooltipTimer = null;
		}
		if (!this.edgeTooltipEl) {
			this.edgeTooltipEl = document.createElement('div');
			this.edgeTooltipEl.className = 'sh-node-preview-card';
			this.edgeTooltipEl.style.position = 'absolute';
			this.edgeTooltipEl.style.zIndex = '1000';
			
			// Position only upon creation
			this.edgeTooltipEl.style.left = `${this.pointerX + 15}px`;
			this.edgeTooltipEl.style.top = `${this.pointerY + 15}px`;

			// Mouse bridge: persistent when hovering over the card
			this.edgeTooltipEl.addEventListener('mouseenter', () => {
				this.edgeTooltipEl?.classList.add('is-hovering');
				// Cancel any pending hide scheduled when the pointer left the edge,
				// otherwise the card is removed while the pointer sits on it.
				if (this.hideEdgeTooltipTimer) {
					window.clearTimeout(this.hideEdgeTooltipTimer);
					this.hideEdgeTooltipTimer = null;
				}
			});
			this.edgeTooltipEl.addEventListener('mouseleave', () => {
				this.edgeTooltipEl?.classList.remove('is-hovering');
				this.flushPendingEdgeRefresh();
			});
			document.body.appendChild(this.edgeTooltipEl);
		}

		const nA = this.nodes[edge.a];
		const nB = this.nodes[edge.b];
		if (!nA || !nB) return;
		const labelOfPath = (path: string | undefined, fallback: string): string =>
			path ? (this.nodes.find((n) => n.path === path)?.label ?? path) : fallback;

		let html = `<div style="font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 4px;">${nA.label} ↔ ${nB.label}</div>`;

		if (edge.relations.length === 0) {
			html += '<div style="padding: 4px;">No relationships.</div>';
		} else {
			edge.relations.forEach((rel, index) => {
				const directed = !!(rel.source && rel.target);
				const dirText = directed
					? `${labelOfPath(rel.source, nA.label)} → ${labelOfPath(rel.target, nB.label)}`
					: `${nA.label} ↔ ${nB.label}`;
				const deletable = !!(rel.raw && rel.authoredFrom && rel.raw.trim().startsWith('-'));
				const button = deletable
					? `<button class="sh-delete-rel" data-index="${index}" title="Remove this relationship from ${rel.authoredFrom}" style="cursor: pointer; background: transparent; border: none; font-weight: bold; opacity: 0.6;">×</button>`
					: '';
				html += `
					<div style="display: flex; justify-content: space-between; align-items: center; margin: 4px 0; padding: 2px 4px; border-radius: 4px; background: var(--background-secondary);">
						<span style="font-size: 0.9em;">${dirText} · ${rel.type} (${rel.strength.toFixed(2)})</span>
						${button}
					</div>
				`;
			});
		}

		this.edgeTooltipEl.innerHTML = html;
		
		this.edgeTooltipEl.querySelectorAll('.sh-delete-rel').forEach(btn => {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				const index = parseInt((btn as HTMLElement).dataset.index ?? '-1', 10);
				void this.deleteRelation(edge, index);
			});
		});
	}

	private async deleteRelation(edge: GraphLink, index: number): Promise<void> {
		const rel = edge.relations[index];
		if (!rel?.raw || !rel.authoredFrom || !rel.raw.trim().startsWith('-')) {
			this.showToast('No authored relationship line to remove');
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(rel.authoredFrom);
		if (!(file instanceof TFile)) {
			this.showToast(`Delete failed: ${rel.authoredFrom} not found`);
			return;
		}
		try {
			await removeRelation(this.plugin, file, rel.raw);
			edge.relations.splice(index, 1);
			this.pendingEdgeRefresh = true;
			if (edge.relations.length === 0) {
				this.hideEdgeTooltip();
			} else {
				this.drawEdgeTooltip(edge);
			}
			this.showToast(`Removed '${rel.type}' (${formatStrength(rel.strength)})`);
		} catch (err) {
			this.showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private selectLasso: Array<{ x: number; y: number }> = [];
	private groupDragging = false;
	private groupStartX = 0;
	private groupStartY = 0;
	private groupOrigins = new Map<number, { x: number; y: number; z: number }>();
	private groupStartCentroid: { x: number; y: number; z: number } | null = null;

	private lastRestDistance = 0;
	private dragSplitHandled = false;
	private splitPromptOpen = false;
	private clearOnUp = false;
	private toggleIndex = -1;
	private nodeColor = 'rgba(124, 111, 246, 1)';
	private edgeColor = 'rgba(180, 180, 180, 0.6)';
	private labelColor = 'rgba(180, 180, 180, 0.75)';
	private hoverIndex = -1;
	private activePreviewCard: HTMLElement | null = null;
	private ctrlPressed = false;
	private edgeDraggingSourceNode: GraphNode | null = null;
	private hoveredEdge: GraphLink | null = null;
	private edgeTooltipEl: HTMLElement | null = null;
	private hideEdgeTooltipTimer: number | null = null;
	private pendingEdgeRefresh = false;
	private resizeObserver: ResizeObserver | null = null;
	private autoRotating: 'off' | 'cw' | 'ccw' = 'off';
	private rotM: number[] = [
		1, 0, 0,
		0, 1, 0,
		0, 0, 1
	];
	private rotateStartRotM: number[] = [
		1, 0, 0,
		0, 1, 0,
		0, 0, 1
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

	private getEyePosition(): [number, number, number] {
		// Forward vector is the third row of the rotation matrix (m6, m7, m8)
		const fx = this.rotM[6] ?? 0;
		const fy = this.rotM[7] ?? 0;
		const fz = this.rotM[8] ?? 1;

		// Camera eye is T - R * F
		return [
			this.target[0] - this.cameraDistance * fx,
			this.target[1] - this.cameraDistance * fy,
			this.target[2] - this.cameraDistance * fz,
		];
	}

	private updateCameraMatrix(): void {
		// Gram-Schmidt re-orthonormalization to prevent drift over time
		const m = this.rotM;
		let rx = m[0] ?? 1, ry = m[1] ?? 0, rz = m[2] ?? 0;
		let ux = m[3] ?? 0, uy = m[4] ?? 1, uz = m[5] ?? 0;

		const rLen = Math.hypot(rx, ry, rz) || 1;
		rx /= rLen; ry /= rLen; rz /= rLen;

		const proj = rx * ux + ry * uy + rz * uz;
		ux -= proj * rx; uy -= proj * ry; uz -= proj * rz;
		const uLen = Math.hypot(ux, uy, uz) || 1;
		ux /= uLen; uy /= uLen; uz /= uLen;

		const fx = ry * uz - rz * uy;
		const fy = rz * ux - rx * uz;
		const fz = rx * uy - ry * ux;

		this.rotM = [
			rx, ry, rz,
			ux, uy, uz,
			fx, fy, fz,
		];
		this.updateAnglesFromMatrix();
	}

	private viewCenterWorld(): { x: number; y: number; z: number } {

		const w = this.canvas?.clientWidth ?? 1;
		const h = this.canvas?.clientHeight ?? 1;
		const camX = this.viewX + w / (2 * this.viewScale);
		const camY = this.viewY + h / (2 * this.viewScale);
		const camZ = 0;
		const m = this.rotM;
		return {
			x: camX + (m[2] ?? 0) * this.cameraDistance,
			y: camY + (m[5] ?? 0) * this.cameraDistance,
			z: camZ + (m[8] ?? 0) * this.cameraDistance,
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
		return { x: x2, y: y2, z: z2 };
	}

	private inverseRotate(
		x: number,
		y: number,
		z: number,
		cx = 0,
		cy = 0,
		cz = 0,
	): { x: number; y: number; z: number } {
		// Transpose of rotM is inverse for orthogonal rotation matrix
		const m = this.rotM;
		const x2 = (m[0] ?? 0) * x + (m[3] ?? 0) * y + (m[6] ?? 0) * z;
		const y2 = (m[1] ?? 0) * x + (m[4] ?? 0) * y + (m[7] ?? 0) * z;
		const z2 = (m[2] ?? 0) * x + (m[5] ?? 0) * y + (m[8] ?? 0) * z;
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

	private dolly(factor: number): void {
		// 3D has no zoom control: magnification is derived from the standoff
		// distance, so the only way to change it is to travel the assembly along
		// the line of sight. Because F is orthogonal to the screen plane, the
		// focal point's screen position is invariant under this motion, which is
		// precisely why the magnification is always centred on it (docs 5.3-5.4).
		if (!this.is3D || !Number.isFinite(factor) || factor <= 0) {
			return;
		}

		const fx = this.rotM[6] ?? 0;
		const fy = this.rotM[7] ?? 0;
		const fz = this.rotM[8] ?? 0;

		const prev = this.cameraDistance;
		const next = Math.max(PHYS.dollyMin, Math.min(PHYS.dollyMax, prev / factor));
		if (next === prev) {
			return;
		}

		// Travel the assembly along -d * F, where d is the change in standoff.
		// Magnifying shrinks d below zero, so the focal point advances deeper
		// into the graph rather than retreating out of it.
		const d = next - prev;
		this.target[0] = this.clampFocal(-d * fx, 0);
		this.target[1] = this.clampFocal(-d * fy, 1);
		this.target[2] = this.clampFocal(-d * fz, 2);

		this.cameraDistance = next;
		this.viewScale = this.baseCameraDistance / next;
		this.updateCameraMatrix();
	}

	/** Keep the focal point from being dollied clean out of the scene. */
	private clampFocal(value: number, axis: 0 | 1 | 2): number {
		let extent = 0;
		for (const node of this.nodes) {
			const v = axis === 0 ? node.x : axis === 1 ? node.y : node.z;
			extent = Math.max(extent, Math.abs(v));
		}
		const limit = (extent > 0 ? extent : PHYS.baseSize) * 3;
		return Math.max(-limit, Math.min(limit, value));
	}

	public zoomIn(): void {
		if (this.is3D) {
			this.dolly(PHYS.dollyStep);
			this.markViewAdjusted();
			return;
		}
		if (!this.canvas) return;
		const sx = this.canvas.clientWidth / 2;
		const sy = this.canvas.clientHeight / 2;
		const factor = 1.25; 
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.cameraDistance = this.baseCameraDistance / this.viewScale;
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;
		this.markViewAdjusted();
	}

	public zoomOut(): void {
		if (this.is3D) {
			this.dolly(1 / PHYS.dollyStep);
			this.markViewAdjusted();
			return;
		}
		if (!this.canvas) return;
		const sx = this.canvas.clientWidth / 2;
		const sy = this.canvas.clientHeight / 2;
		const factor = 1 / 1.25; 
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.cameraDistance = this.baseCameraDistance / this.viewScale;
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;
		this.markViewAdjusted();
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
		if (this.settled && !this.userAdjustedView) {
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
				relations: edges.map((e) => ({
					type: e.relId,
					strength: e.strength,
					authoredFrom: e.authoredFrom,
					raw: e.raw,
					source: e.source,
					target: e.target,
				})),
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
					relations: [{ type: 'default', strength: 0.5 }],
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
		for (const i of this.selected) {
			const nd = this.nodes[i];
			if (nd) {
				nd.selected = true;
			}
		}
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
			const rotSpeed = 3; // degrees per step
			const isShift = this.shiftDown;

			const m = this.rotM;
			const horiz = this.pressedKeys.has('ArrowRight') ? 1 : this.pressedKeys.has('ArrowLeft') ? -1 : 0;
			const vert = this.pressedKeys.has('ArrowDown') ? 1 : this.pressedKeys.has('ArrowUp') ? -1 : 0;

			// Shift+arrow drives the two angles directly rather than synthesising
			// an incremental rotation. Rotation is about the focal point, which
			// setCameraState leaves untouched, and stepping the angles is what
			// guarantees the keyboard matches the read-out exactly
			// (docs sections 6.1 and 6.3).
			if (isShift && (horiz !== 0 || vert !== 0)) {
				if (this.is3D) {
					// Left decreases theta, Right increases theta; Up decreases phi,
					// Down increases phi (docs section 6.3).
					this.setCameraState({
						elevation: this.currentElevation + vert * rotSpeed,
						azimuth: this.currentAzimuth + horiz * rotSpeed,
						distance: this.cameraDistance,
					});
					this.totalSpin += horiz * rotSpeed;
				} else if (horiz !== 0) {
					this.rotateAboutAxis([0, 1, 0], horiz * 0.01);
				} else if (vert !== 0) {
					this.rotateAboutAxis([1, 0, 0], vert * 0.01);
				}
			}
			// rotM rows are [right, up, forward], so a screen-horizontal pan moves
			// along the right row (m[0..2]) and a screen-vertical pan along the up
			// row (m[3..5]) - the same mapping the mouse pan uses. Accumulate the
			// delta first so diagonal key presses share a single matrix read.
			if (!isShift && (horiz !== 0 || vert !== 0)) {
				const panX = panSpeed * (horiz * (m[0] ?? 0) + vert * (m[3] ?? 0));
				const panY = panSpeed * (horiz * (m[1] ?? 0) + vert * (m[4] ?? 0));
				const panZ = panSpeed * (horiz * (m[2] ?? 0) + vert * (m[5] ?? 0));
				// Negate so the content travels in the direction of the arrow, the
				// same way the world follows the cursor during a mouse drag.
				if (this.is3D) {
					this.target[0] -= panX;
					this.target[1] -= panY;
					this.target[2] -= panZ;
				} else {
					this.viewX -= panX;
					this.viewY += panY;
				}
			}
			this.markViewAdjusted();
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
					if (!this.userAdjustedView) {
						this.fitToView();
					}
				}
			} else {
				this.settleCount = 0;
			}

			if (this.autoFitCooldown > 0) {
				this.autoFitCooldown--;
			} else if (!this.userAdjustedView && this.layoutFrames % PHYS.fitEveryFrame === 0) {
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
		if (this.is3D) {
			const w = this.canvas?.clientWidth ?? 800;
			return w / 2 + x * this.viewScale;
		}
		return (x - this.viewX) * this.viewScale;
	}

	private toScreenY(y: number): number {
		if (this.is3D) {
			const h = this.canvas?.clientHeight ?? 600;
			return h / 2 + y * this.viewScale;
		}
		return (y - this.viewY) * this.viewScale;
	}

	private toWorldX(sx: number): number {
		if (this.is3D) {
			const w = this.canvas?.clientWidth ?? 800;
			return (sx - w / 2) / this.viewScale;
		}
		return sx / this.viewScale + this.viewX;
	}

	private toWorldY(sy: number): number {
		if (this.is3D) {
			const h = this.canvas?.clientHeight ?? 600;
			return (sy - h / 2) / this.viewScale;
		}
		return sy / this.viewScale + this.viewY;
	}

	private fitToView(): void {
		const canvas = this.canvas;
		if (!canvas || this.nodes.length === 0) {
			return;
		}
		this.userAdjustedView = false;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;

		if (this.is3D) {
			this.target = [0, 0, 0];
			this.rotM = [
				1,  0,  0,
				0, -1,  0,
				0,  0, -1
			];
			this.cameraDistance = 1000;
			this.updateAnglesFromMatrix();
		} else {
			this.rotM = [
				1,  0,  0,
				0, -1,  0,
				0,  0,  1
			];
			this.totalSpin = 0;
			this.rotCx = 0;
			this.rotCy = 0;
			this.rotCz = 0;
			this.camZ = 0;
			this.updateAnglesFromMatrix();
		}

		const visibleNodes = this.nodes.filter((node) => this.nodeMatchesSelectedHolograms(node));
		const targetNodes = visibleNodes.length > 0 ? visibleNodes : this.nodes;

		let maxAbsX = 0;
		let maxAbsY = 0;
		for (const node of targetNodes) {
			const r = this.is3D
				? this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2])
				: { x: node.x, y: -node.y };
			maxAbsX = Math.max(maxAbsX, Math.abs(r.x) + node.radius);
			maxAbsY = Math.max(maxAbsY, Math.abs(r.y) + node.radius);
		}
		maxAbsX = Math.max(1, maxAbsX);
		maxAbsY = Math.max(1, maxAbsY);

		const m = 0.08;
		this.viewScale = Math.min(
			PHYS.zoomMax,
			Math.max(
				PHYS.zoomMin,
				Math.min(((w / 2) * (1 - 2 * m)) / maxAbsX, ((h / 2) * (1 - 2 * m)) / maxAbsY),
			),
		);
		this.baseCameraDistance = 1000;
		this.cameraDistance = this.baseCameraDistance / this.viewScale;

		if (!this.is3D) {
			this.viewX = -w / (2 * this.viewScale);
			this.viewY = -h / (2 * this.viewScale);
		}

		console.log(`[SH] fitToView (Home Position): visibleNodes=${visibleNodes.length}/${this.nodes.length} canvas=${w}x${h} view=(${this.is3D ? this.target : `${this.viewX.toFixed(1)},${this.viewY.toFixed(1)}`}) scale=${this.viewScale.toFixed(3)}`);
		this.markViewAdjusted();
	}

	private resetView(): void {
		this.fitToView();
	}

	public getFocalPoint(): { x: number; y: number; z: number } {
		const w = this.canvas?.clientWidth ?? 0;
		const h = this.canvas?.clientHeight ?? 0;
		if (this.is3D) {
			return { x: this.target[0], y: this.target[1], z: this.target[2] };
		}
		// In 2D, translate screen center to world coordinates
		const sx = w / 2;
		const sy = h / 2;
		return { x: this.toWorldX(sx), y: this.toWorldY(sy), z: 0 };
	}

	public setFocalPoint(x: number, y: number, z = 0): void {
		if (this.is3D) {
			this.target[0] = x;
			this.target[1] = y;
			this.target[2] = z;
		} else {
			this.viewX = x;
			this.viewY = y;
		}
	}

	/** Record that the user moved the camera, so the in-settle auto-fit stops fighting them. */
	private markViewAdjusted(skipControls = false): void {
		this.userAdjustedView = true;
		this.autoFitCooldown = PHYS.fitCooldown;
		if (!skipControls) {
			this.refreshControlsPanel();
		}
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
		const contentRect = this.contentEl.getBoundingClientRect();
		const x = this.pointerX - contentRect.left;
		const y = this.pointerY - contentRect.top;
		this.cursorOverlay.style.left = `${x}px`;
		this.cursorOverlay.style.top = `${y}px`;
		this.cursorOverlay.style.transform = '';
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

		this.rotCx = this.viewX + w / (2 * this.viewScale);
		this.rotCy = this.viewY + h / (2 * this.viewScale);
		this.rotCz = this.camZ;

		// Calculate highlighted nodes if hovering
		const distances = this.hoverIndex >= 0 && this.plugin.settings.hoverDepth > 0 ? this.getDistances(this.hoverIndex) : undefined;
		const highlighted = distances ? new Set(distances.keys()) : new Set<number>();

		if (this.is3D) {
			const R = this.worldR();
			const rotated = this.nodes.map((n) => this.rotatePoint(n.x, n.y, n.z, this.target[0], this.target[1], this.target[2]));
			const maxAbsZ = Math.max(...rotated.map(p => Math.abs(p.z)), 1);

			if (this.plugin.settings.facesEnabled && this.faces.length > 0) {
				const renderables: { type: 'face'; face: number[]; z: number }[] = [];
				for (const face of this.faces) {
					if (face.every(idx => this.nodeMatchesSelectedHolograms(this.nodes[idx]!))) {
						const z = (rotated[face[0]!]!.z + rotated[face[1]!]!.z + rotated[face[2]!]!.z) / 3;
						renderables.push({ type: 'face', face, z });
					}
				}
				renderables.sort((a, b) => a.z - b.z);
				ctx.fillStyle = this.withAlpha(this.plugin.settings.facesColor, this.plugin.settings.facesOpacity);
				for (const item of renderables) {
					const pA = rotated[item.face[0]!]!;
					const pB = rotated[item.face[1]!]!;
					const pC = rotated[item.face[2]!]!;
					const depth = (item.z + maxAbsZ) / (2 * maxAbsZ || 1);
					const opacity = Math.min(1.0, this.plugin.settings.facesOpacity * (0.3 + depth * 0.7));
					ctx.fillStyle = this.withAlpha(this.plugin.settings.facesColor, opacity);
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
				if (!this.nodeMatchesSelectedHolograms(node)) {
					continue;
				}
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
				if (!this.nodeMatchesSelectedHolograms(node)) {
					continue;
				}
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
				if (!a || !b || !ra || !rb || !this.nodeMatchesSelectedHolograms(a) || !this.nodeMatchesSelectedHolograms(b)) {
					continue;
				}
				const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
				const normZA = ra.z / maxAbsZ;
				const normZB = rb.z / maxAbsZ;
				const edgeNormZ = (normZA + normZB) / 2;
				this.strokeArrowLine(
					this.toScreenX(ra.x),
					this.toScreenY(ra.y),
					this.nodeScreenRadius(a, ra, maxAbsZ, 12),
					this.toScreenX(rb.x),
					this.toScreenY(rb.y),
					this.nodeScreenRadius(b, rb, maxAbsZ, 12),
					l,
					this.edgeStroke(l, sel, highlighted, distances, edgeNormZ),
				);
			}
			if (this.edgeDraggingSourceNode && this.canvas) {
				const canvasRect = this.canvas.getBoundingClientRect();
				ctx.save();
				ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
				ctx.lineWidth = 2;
				ctx.setLineDash([5, 5]);
				ctx.beginPath();
				const sourcePos = this.nodeScreenPos(this.edgeDraggingSourceNode);
				ctx.moveTo(sourcePos.x, sourcePos.y);
				ctx.lineTo(this.pointerX - canvasRect.left, this.pointerY - canvasRect.top);
				ctx.stroke();
				ctx.restore();
			}
			this.drawLiveSelection();
			this.drawSelectionArea();
			this.drawOriginIndicator();
			return;
		}

		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (const node of this.nodes) {
			if (!this.nodeMatchesSelectedHolograms(node)) {
				continue;
			}
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
			if (!this.nodeMatchesSelectedHolograms(node)) {
				continue;
			}
			ctx.fillStyle = this.labelColor;
			ctx.fillText(node.label, this.toScreenX(node.x) + node.radius + 3, this.toScreenY(node.y));
		}
		// Edges are drawn in the foreground so arrowheads stay visible over nodes.
		ctx.lineWidth = 1;
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b || !this.nodeMatchesSelectedHolograms(a) || !this.nodeMatchesSelectedHolograms(b)) {
				continue;
			}
			const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
			this.strokeArrowLine(
				this.toScreenX(a.x),
				this.toScreenY(a.y),
				this.nodeScreenRadius(a, a, 1, 12),
				this.toScreenX(b.x),
				this.toScreenY(b.y),
				this.nodeScreenRadius(b, b, 1, 12),
				l,
					this.edgeStroke(l, sel, highlighted, distances),

			);
		}
		this.drawLiveSelection();
		this.drawSelectionArea();
		this.drawOriginIndicator();
		if (this.edgeDraggingSourceNode && this.canvas) {
			const canvasRect = this.canvas.getBoundingClientRect();
			ctx.save();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			const sourcePos = this.nodeScreenPos(this.edgeDraggingSourceNode);
			ctx.moveTo(sourcePos.x, sourcePos.y);
			ctx.lineTo(this.pointerX - canvasRect.left, this.pointerY - canvasRect.top);
			ctx.stroke();
			ctx.restore();
		}
		
		// Edge hover inspection
		const edge = this.hoveredEdge;
		if (edge) {
			this.drawEdgeTooltip(edge);
		}

		this.drawHoverTooltip();
		this.updateCursor();
	}

	private nodeScreenPos(node: GraphNode): { x: number, y: number } {
		if (this.is3D) {
			const rotated = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
			return { x: this.toScreenX(rotated.x), y: this.toScreenY(rotated.y) };
		}
		return { x: this.toScreenX(node.x), y: this.toScreenY(node.y) };
	}

	private drawHoverTooltip(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) return;
		if (!this.pointerInside || this.hoverIndex < 0 || this.ctrlPressed) return;
		if (this.rotating || this.panning || this.pinnedIndex >= 0 || this.selecting || this.selectMode || this.groupDragging) return;
		const node = this.nodes[this.hoverIndex];
		if (!node) return;

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
			if (!l) continue;
			ctx.font = l.font;
			ctx.globalAlpha = l.dim ? 0.65 : 1;
			ctx.fillStyle = cs.color || '#ccc';
			ctx.fillText(l.text, x + padX, y + padY + i * lineH + lineH / 2);
		}
		ctx.globalAlpha = 1;
		ctx.restore();
	}

	private hidePreviewCardTimer: number | null = null;

	private hidePreviewCard(): void {
		if (this.hidePreviewCardTimer) {
			window.clearTimeout(this.hidePreviewCardTimer);
			this.hidePreviewCardTimer = null;
		}
		if (this.activePreviewCard) {
			this.activePreviewCard.remove();
			this.activePreviewCard = null;
		}
	}

	private showPreviewCard(): void {
		if (!this.canvas) return;
		if (this.hidePreviewCardTimer) {
			window.clearTimeout(this.hidePreviewCardTimer);
			this.hidePreviewCardTimer = null;
		}
		if (this.hoverIndex < 0) return;
		const node = this.nodes[this.hoverIndex];
		if (!node) return;

		const entry = this.searchIndex.get(node.path);
		if (!entry) return;

		const previewData = buildNodePreviewModel(
			{ ...node, content: entry.content },
			this.plugin.settings,
		);

		if (this.activePreviewCard && this.activePreviewCard.getAttribute("data-path") === node.path) {
			return;
		}
		if (this.activePreviewCard) {
			this.activePreviewCard.remove();
		}

		this.activePreviewCard = document.body.createDiv({ cls: "sh-node-preview-card" });
		this.activePreviewCard.setAttribute("data-path", node.path);
		this.activePreviewCard.style.position = "fixed";
		this.activePreviewCard.style.zIndex = "1000";
		this.activePreviewCard.style.maxHeight = "400px";
		this.activePreviewCard.style.overflowY = "auto";
		this.activePreviewCard.style.userSelect = "text";
		this.activePreviewCard.style.pointerEvents = "auto";

		this.activePreviewCard.addEventListener("mouseenter", () => {
			if (this.hidePreviewCardTimer) {
				window.clearTimeout(this.hidePreviewCardTimer);
				this.hidePreviewCardTimer = null;
			}
		});

		this.activePreviewCard.addEventListener("wheel", (e) => {
			e.stopPropagation();
		});

		this.activePreviewCard.addEventListener("mouseleave", () => {
			this.hidePreviewCardTimer = window.setTimeout(() => this.hidePreviewCard(), 250);
		});

		this.activePreviewCard.createDiv({ cls: "sh-preview-label", text: previewData.label });
		this.activePreviewCard.createDiv({ cls: "sh-preview-path", text: node.path });
		const metaText = `${previewData.typeName} · Confidence ${previewData.confidencePct}% · Gravitas ${previewData.gravitasPct}%`;
		this.activePreviewCard.createDiv({ cls: "sh-preview-meta", text: metaText });
		
		const contentBlock = this.activePreviewCard.createDiv({ cls: "sh-preview-content" });
		contentBlock.style.whiteSpace = "pre-wrap";
		contentBlock.style.fontSize = "12px";
		contentBlock.style.lineHeight = "1.5";
		contentBlock.style.marginTop = "8px";
		contentBlock.textContent = entry.content;

		const rect = this.canvas.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const cardWidth = 320;

		let left = rect.left + this.pointerX - cardWidth - 16;
		let top = rect.top + this.pointerY;

		if (left < 8) {
			left = rect.left + this.pointerX + 16;
		}

		const cardHeight = this.activePreviewCard.getBoundingClientRect().height;
		if (top + cardHeight > viewportHeight - 8) {
			top = viewportHeight - cardHeight - 8;
		}

		this.activePreviewCard.style.left = `${left}px`;
		this.activePreviewCard.style.top = `${top}px`;
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

	private nodeScreenRadius(node: GraphNode, p: { x: number; y: number; z: number }, R: number, buffer = 0): number {
		let depthScale = 1;
		if (this.is3D && R > 0) {
			const normZ = p.z / R;
			depthScale = normZ <= 0 ? 0.25 + (normZ + 1) * 0.75 : 1.0 + normZ * 1.0;
		}
		return Math.max(3, node.radius * this.viewScale * depthScale) + buffer;
	}

	private edgeStroke(link: GraphLink, selCount: number, highlightedNodes?: Set<number>, distances?: Map<number, number>, edgeDepth?: number): string {
		const hasHighlight = highlightedNodes !== undefined && highlightedNodes.size > 0;
		let baseAlpha = 1.0;
		if (this.is3D && edgeDepth !== undefined) {
			const norm01 = (edgeDepth + 1) / 2;
			baseAlpha = 0.25 + norm01 * 0.75;
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
				const r = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
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
		if (!ctx || !canvas) {
			return;
		}
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;

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

		if (!this.plugin.settings.showRotationCenter) {
			return;
		}

		const origin = this.rotatePoint(0, 0, 0, this.target[0], this.target[1], this.target[2]);
		let ix = this.toScreenX(origin.x);
		let iy = this.toScreenY(origin.y);

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

			// Focal Point Indicator (red crosshair with whitespace in the center at viewport midpoint)
			const w = this.canvas?.clientWidth ?? 800;
			const h = this.canvas?.clientHeight ?? 600;
			const cx = w / 2;
			const cy = h / 2;
			const gap = 8;
			const len = 8;

			ctx.save();
			ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			// Top line
			ctx.moveTo(cx, cy - gap - len);
			ctx.lineTo(cx, cy - gap);
			// Bottom line
			ctx.moveTo(cx, cy + gap);
			ctx.lineTo(cx, cy + gap + len);
			// Left line
			ctx.moveTo(cx - gap - len, cy);
			ctx.lineTo(cx - gap, cy);
			// Right line
			ctx.moveTo(cx + gap, cy);
			ctx.lineTo(cx + gap + len, cy);
			ctx.stroke();
			ctx.restore();
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
		this.cameraDistance = this.baseCameraDistance / this.viewScale;
		this.viewX = worldX - midX / this.viewScale;
		this.viewY = worldY - midY / this.viewScale;
		this.markViewAdjusted();
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
			this.markViewAdjusted();
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
		this.panTarget = [...this.target] as [number, number, number];
		this.panViewX = this.viewX;
		this.panViewY = this.viewY;
		this.markViewAdjusted();
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
			this.markViewAdjusted();
			return;
		}
		if (this.groupDragging) {
			const dx = e.clientX - this.groupStartX;
			const dy = e.clientY - this.groupStartY;
			this.moveSelectedGroup(dx, dy);
			this.checkDragSeparation();
			this.markViewAdjusted();
			return;
		}
		if (this.rotating) {
			const dxNow = e.clientX - this.rotateStartX;
			const dyNow = e.clientY - this.rotateStartY;
			const ddx = dxNow - this.lastRotX;
			const ddy = dyNow - this.lastRotY;
			this.lastRotX = dxNow;
			this.lastRotY = dyNow;
			const sensitivity = 0.005;
			if (this.is3D) {
				const R_y = this.getRotationMatrixAboutAxis([0, 1, 0], -ddx * sensitivity);
				const R_x = this.getRotationMatrixAboutAxis([1, 0, 0], ddy * sensitivity);
				this.rotM = this.multiplyMatrices(R_y, this.rotM);
				this.rotM = this.multiplyMatrices(this.rotM, R_x);
				this.updateCameraMatrix();
			} else {
				this.rotateAboutAxis([0, 1, 0], -ddx * sensitivity);
				this.rotateAboutAxis([1, 0, 0], ddy * sensitivity);
			}
			this.totalSpin -= ddx * sensitivity;
			this.markViewAdjusted();
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
				const rOld = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
				const desiredRx = this.toWorldX(sx);
				const desiredRy = this.toWorldY(sy);
				const inv = this.inverseRotate(desiredRx, desiredRy, rOld.z, this.target[0], this.target[1], this.target[2]);
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
			const dScreenX = (e.clientX - this.panStartX) / this.viewScale;
			const dScreenY = (e.clientY - this.panStartY) / this.viewScale;
			if (this.is3D) {
				const m = this.rotM;
				const dx = dScreenX * (m[0] ?? 0) + dScreenY * (m[3] ?? 0);
				const dy = dScreenX * (m[1] ?? 0) + dScreenY * (m[4] ?? 0);
				const dz = dScreenX * (m[2] ?? 0) + dScreenY * (m[5] ?? 0);
				this.target[0] = this.panTarget[0] - dx;
				this.target[1] = this.panTarget[1] - dy;
				this.target[2] = this.panTarget[2] - dz;
				this.updateCameraMatrix();
			} else {
				const canvas = this.canvas;
				const w = canvas?.clientWidth ?? 1;
				const h = canvas?.clientHeight ?? 1;
				this.rotCx = this.panRotCx - (dScreenX * (this.rotM[0] ?? 1) + dScreenY * (this.rotM[3] ?? 0));
				this.rotCy = this.panRotCy - (dScreenX * (this.rotM[1] ?? 0) + dScreenY * (this.rotM[4] ?? 1));
				this.camZ = this.panCamZ - (dScreenX * (this.rotM[2] ?? 0) + dScreenY * (this.rotM[5] ?? 0));
				this.rotCz = this.camZ;
				this.viewX = this.rotCx - w / (2 * this.viewScale);
				this.viewY = this.rotCy - h / (2 * this.viewScale);
			}
			this.markViewAdjusted();
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
			this.markViewAdjusted();
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
			this.beginGroupDrag(e);
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

		if (e.altKey && idx >= 0) {
			this.edgeDraggingSourceNode = this.nodes[idx]!;
			this.canvas?.setPointerCapture(e.pointerId);
			return;
		}

		if (idx >= 0) {
			const node = this.nodes[idx];
			if (node && node.selected) {
				this.beginGroupDrag(e);
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
			this.panRotCx = this.rotCx;
			this.panRotCy = this.rotCy;
			this.panRotCz = this.rotCz;
			this.panCamZ = this.camZ;
			this.panTarget = [...this.target] as [number, number, number];
			this.canvas?.setPointerCapture(e.pointerId);
			this.markViewAdjusted();
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
		this.hoveredEdge = this.hitTestEdge(e);
		
		// Only draw/update if Ctrl is pressed and we have a valid edge
		if (this.ctrlPressed && this.hoveredEdge && this.hoverIndex < 0 && !this.edgeDraggingSourceNode) {
			this.drawEdgeTooltip(this.hoveredEdge);
		} else if (!this.edgeTooltipEl?.classList.contains('is-hovering')) {
			if (!this.hideEdgeTooltipTimer) {
				this.hideEdgeTooltipTimer = window.setTimeout(() => this.hideEdgeTooltip(), 500);
			}
		}

		if (this.selecting) {
			const rect = this.canvas?.getBoundingClientRect();
			if (!rect) {
				return;
			}
			this.selectCurX = e.clientX - rect.left;
			this.selectCurY = e.clientY - rect.top;
			this.selectLasso.push({ x: this.selectCurX, y: this.selectCurY });
			this.markViewAdjusted();
			return;
		}
		if (this.groupDragging) {
			const dx = e.clientX - this.groupStartX;
			const dy = e.clientY - this.groupStartY;
			this.moveSelectedGroup(dx, dy);
			this.checkDragSeparation();
			this.markViewAdjusted();
			return;
		}
		if (this.rotating) {
			const dxNow = e.clientX - this.rotateStartX;
			const dyNow = e.clientY - this.rotateStartY;
			const ddx = dxNow - this.lastRotX;
			const ddy = dyNow - this.lastRotY;
			this.lastRotX = dxNow;
			this.lastRotY = dyNow;
			const sensitivity = 0.005;
			if (this.is3D) {
				const R_y = this.getRotationMatrixAboutAxis([0, 1, 0], -ddx * sensitivity);
				const R_x = this.getRotationMatrixAboutAxis([1, 0, 0], ddy * sensitivity);
				this.rotM = this.multiplyMatrices(R_y, this.rotM);
				this.rotM = this.multiplyMatrices(this.rotM, R_x);
				this.updateCameraMatrix();
			} else {
				this.rotateAboutAxis([0, 1, 0], -ddx * sensitivity);
				this.rotateAboutAxis([1, 0, 0], ddy * sensitivity);
			}
			this.totalSpin -= ddx * sensitivity;
			this.markViewAdjusted();
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
				const rOld = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
				const desiredRx = this.toWorldX(sx);
				const desiredRy = this.toWorldY(sy);
				const inv = this.inverseRotate(desiredRx, desiredRy, rOld.z, this.target[0], this.target[1], this.target[2]);
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
			const dScreenX = (e.clientX - this.panStartX) / this.viewScale;
			const dScreenY = (e.clientY - this.panStartY) / this.viewScale;
			if (this.is3D) {
				const m = this.rotM;
				const dx = dScreenX * (m[0] ?? 0) + dScreenY * (m[3] ?? 0);
				const dy = dScreenX * (m[1] ?? 0) + dScreenY * (m[4] ?? 0);
				const dz = dScreenX * (m[2] ?? 0) + dScreenY * (m[5] ?? 0);
				this.target[0] = this.panTarget[0] - dx;
				this.target[1] = this.panTarget[1] - dy;
				this.target[2] = this.panTarget[2] - dz;
				this.updateCameraMatrix();
			} else {
				const canvas = this.canvas;
				const w = canvas?.clientWidth ?? 1;
				const h = canvas?.clientHeight ?? 1;
				this.rotCx = this.panRotCx - (dScreenX * (this.rotM[0] ?? 1) + dScreenY * (this.rotM[3] ?? 0));
				this.rotCy = this.panRotCy - (dScreenX * (this.rotM[1] ?? 0) + dScreenY * (this.rotM[4] ?? 1));
				this.camZ = this.panCamZ - (dScreenX * (this.rotM[2] ?? 0) + dScreenY * (this.rotM[5] ?? 0));
				this.rotCz = this.camZ;
				this.viewX = this.rotCx - w / (2 * this.viewScale);
				this.viewY = this.rotCy - h / (2 * this.viewScale);
			}
			this.markViewAdjusted();
			return;
		}
		this.hoverIndex = this.hitTest(e);
		this.updateCursor();
		if (this.ctrlPressed || e.ctrlKey) {
			if (this.hoverIndex >= 0) {
				this.showPreviewCard();
			} else if (!this.activePreviewCard?.matches(':hover')) {
				if (!this.hidePreviewCardTimer) {
					this.hidePreviewCardTimer = window.setTimeout(() => this.hidePreviewCard(), 250);
				}
			}
		} else if (!this.activePreviewCard?.matches(':hover')) {
			this.hidePreviewCard();
		}
	};

	private onPointerUp = (e: PointerEvent): void => {
		if (this.edgeDraggingSourceNode) {
			const idx = this.hitTest(e);
			if (idx >= 0 && this.nodes[idx] !== this.edgeDraggingSourceNode) {
				void this.createRelationBetween(this.edgeDraggingSourceNode, this.nodes[idx]!);
			}
			this.edgeDraggingSourceNode = null;
			this.canvas?.releasePointerCapture(e.pointerId);
			return;
		}

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
			this.groupStartCentroid = null;
			this.dragSplitHandled = false;
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

	/**
	 * Persist an Alt+drag as a real relationship in the source note's
	 * `## Relations` section, then rebuild so the graph picks it up from disk.
	 */
	private async createRelationBetween(sourceNode: GraphNode, targetNode: GraphNode): Promise<void> {
		const sourceFile = this.app.vault.getAbstractFileByPath(sourceNode.path);
		const targetFile = this.app.vault.getAbstractFileByPath(targetNode.path);
		if (!(sourceFile instanceof TFile) || !(targetFile instanceof TFile)) {
			this.showToast(`Edge failed: ${sourceNode.label} or ${targetNode.label} is not a file in the vault`);
			return;
		}

		const knownIds = new Set(this.plugin.settings.relTypes.map((t) => t.id));
		const preferred = (this.plugin.settings as unknown as { defaultRelType?: string }).defaultRelType;
		const relId = preferred && knownIds.has(preferred)
			? preferred
			: (this.plugin.settings.relTypes.find((t) => t.enabled)?.id ?? this.plugin.settings.relTypes[0]?.id ?? 'related');
		const strength = this.plugin.settings.defaultRelStrength;
		const symmetric = relId === 'related';

		const hasAuthored = (content: string, targetBasename: string): boolean => {
			const section = findRelationsSection(content);
			if (!section) {
				return false;
			}
			const link = `[[${targetBasename}]]`;
			return content
				.split(/\r?\n/)
				.slice(section.startLine + 1, section.endLine)
				.some((l) => l.trim().startsWith(`- ${relId} `) && l.includes(link));
		};

		try {
			const forwardDup = hasAuthored(await this.app.vault.read(sourceFile), targetFile.basename);
			const reverseDup = symmetric
				? hasAuthored(await this.app.vault.read(targetFile), sourceFile.basename)
				: false;
			if (forwardDup && (!symmetric || reverseDup)) {
				const arrow = symmetric ? '↔' : '→';
				this.showToast(`${sourceNode.label} ${arrow} ${targetNode.label} already linked as '${relId}'`);
				return;
			}
			if (!forwardDup) {
				await addRelation(this.plugin, sourceFile, targetFile, relId, strength, false);
			}
			if (symmetric && !reverseDup) {
				await addRelation(this.plugin, targetFile, sourceFile, relId, strength, false);
			}
			await this.plugin.refreshGraphs();
			this.showToast(
				symmetric
					? `Related edges created: ${sourceNode.label} ↔ ${targetNode.label} (${relId}, ${formatStrength(strength)})`
					: `Edge created: ${sourceNode.label} → ${targetNode.label} (${relId}, ${formatStrength(strength)})`,
			);
		} catch (err) {
			this.showToast(`Edge failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

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
			const r = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
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

	private beginGroupDrag(e: PointerEvent): void {
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
		this.dragSplitHandled = false;
		this.groupStartCentroid = this.centroidOf(this.selected);
		const restC = this.centroidOfRest();
		this.lastRestDistance = restC ? this.dist3(this.groupStartCentroid, restC) : 0;
		this.canvas?.setPointerCapture(e.pointerId);
		this.pointerDown = true;
	}

	private centroidOf(indices: Set<number> | Iterable<number>): { x: number; y: number; z: number } {
		let x = 0;
		let y = 0;
		let z = 0;
		let n = 0;
		for (const i of indices) {
			const node = this.nodes[i];
			if (!node) {
				continue;
			}
			x += node.x;
			y += node.y;
			z += node.z;
			n++;
		}
		if (n === 0) {
			return { x: 0, y: 0, z: 0 };
		}
		return { x: x / n, y: y / n, z: z / n };
	}

	private dist3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
		return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	}

	private centroidOfRest(): { x: number; y: number; z: number } | null {
		const rest = new Set<number>();
		for (let i = 0; i < this.nodes.length; i++) {
			if (!this.selected.has(i)) {
				rest.add(i);
			}
		}
		if (rest.size === 0) {
			return null;
		}
		return this.centroidOf(rest);
	}

	/** During a group drag: split when the dragged set leaves the rest; merge when it reaches another hologram. */
	private checkDragSeparation(): void {
		const sd = this.plugin.settings.separationDistance;
		if (sd <= 0 || this.splitPromptOpen || this.dragSplitHandled) {
			return;
		}
		if (this.selected.size === 0 || this.selected.size >= this.nodes.length) {
			return;
		}
		const selCentroid = this.centroidOf(this.selected);
		const restC = this.centroidOfRest();
		if (restC) {
			const dRest = this.dist3(selCentroid, restC);
			if (dRest > sd && dRest > this.lastRestDistance + 1) {
				this.dragSplitHandled = true;
				void this.beginSplit();
				return;
			}
			this.lastRestDistance = dRest;
		}

		this.maybeMergeIntoHologram(selCentroid);
	}

	private nodeMatchesSelectedHolograms(node: GraphNode): boolean {
		const sel = this.plugin.settings.selectedHolograms;
		if (!sel || sel.length === 0) {
			return true;
		}
		const tags = this.plugin.hologramService.getTags(node.path);
		return [...tags].some((t) => sel.includes(t));
	}

	private canMerge(selectedIndices: Set<number>, targetGroup: Set<number>): boolean {
		for (const i of selectedIndices) {
			const n1 = this.nodes[i];
			if (!n1) continue;
			for (const j of targetGroup) {
				const n2 = this.nodes[j];
				if (!n2) continue;
				if (n1.path === n2.path || (n1.nodeType === n2.nodeType && n1.label === n2.label)) {
					return true;
				}
			}
		}
		for (const l of this.links) {
			if ((selectedIndices.has(l.a) && targetGroup.has(l.b)) || (selectedIndices.has(l.b) && targetGroup.has(l.a))) {
				return true;
			}
		}
		return false;
	}

	private openReviewModal(): Promise<void> {
		return new Promise((resolve) => {
			const modal = new ReviewConnectionsModal(this.app, this.plugin, undefined, () => {
				resolve();
			});
			modal.open();
		});
	}

	private maybeMergeIntoHologram(selCentroid: { x: number; y: number; z: number }): void {
		const sd = this.plugin.settings.separationDistance;
		const mergeDist = sd * 0.35;
		const draggedTags = new Set<string>();
		for (const i of this.selected) {
			const n = this.nodes[i];
			if (n) {
				for (const t of this.plugin.hologramService.getTags(n.path)) {
					draggedTags.add(t);
				}
			}
		}
		for (const tag of this.plugin.hologramService.getAllTags()) {
			if (draggedTags.has(tag)) {
				continue;
			}
			const group = new Set<number>();
			for (let i = 0; i < this.nodes.length; i++) {
				const n = this.nodes[i];
				if (!n || this.selected.has(i)) {
					continue;
				}
				if (this.plugin.hologramService.getTags(n.path).has(tag)) {
					group.add(i);
				}
			}
			if (group.size === 0) {
				continue;
			}
			const target = this.centroidOf(group);
			const d = this.dist3(selCentroid, target);
			const start = this.dist3(this.groupStartCentroid ?? selCentroid, target);
			if (d < mergeDist && d < start) {
				if (!this.canMerge(this.selected, group)) {
					this.dragSplitHandled = true;
					this.showToast('No relationships or shared nodes between holograms. Please review connections.');
					void this.openReviewModal().then(() => {
						if (this.canMerge(this.selected, group)) {
							void this.applyMerge(tag);
						}
					});
					return;
				}
				this.dragSplitHandled = true;
				void this.applyMerge(tag);
				return;
			}
		}
	}

	private async beginSplit(): Promise<void> {
		this.splitPromptOpen = true;
		const newTag = await this.promptNewHologramTag();
		this.splitPromptOpen = false;
		if (!newTag) {
			return;
		}
		const mode = this.plugin.settings.splitMode ?? 'move';
		const files: TFile[] = [];
		for (const i of this.selected) {
			const n = this.nodes[i];
			if (!n) {
				continue;
			}
			const f = this.app.vault.getAbstractFileByPath(n.path);
			if (f instanceof TFile) {
				files.push(f);
			}
		}
		for (const f of files) {
			const cur = this.plugin.hologramService.getTags(f.path);
			const next = mode === 'move' ? new Set([newTag]) : new Set(cur);
			if (mode === 'copy') {
				next.add(newTag);
			}
			await this.plugin.hologramService.setTags(f, next);
		}
		this.showToast(
			mode === 'move'
				? `Moved ${files.length} node${files.length === 1 ? '' : 's'} → "${newTag}"`
				: `Copied ${files.length} node${files.length === 1 ? '' : 's'} → "${newTag}"`,
		);
	}

	private async applyMerge(targetTag: string): Promise<void> {
		const mode = this.plugin.settings.mergeMode ?? 'emulsify';
		const files: TFile[] = [];
		for (const i of this.selected) {
			const n = this.nodes[i];
			if (!n) {
				continue;
			}
			const f = this.app.vault.getAbstractFileByPath(n.path);
			if (f instanceof TFile) {
				files.push(f);
			}
		}
		for (const f of files) {
			const cur = this.plugin.hologramService.getTags(f.path);
			const next = mode === 'absorb' ? new Set([targetTag]) : new Set(cur);
			if (mode === 'emulsify') {
				next.add(targetTag);
			}
			await this.plugin.hologramService.setTags(f, next);
		}
		this.showToast(
			mode === 'absorb'
				? `Absorbed ${files.length} node${files.length === 1 ? '' : 's'} into "${targetTag}"`
				: `Emulsified ${files.length} node${files.length === 1 ? '' : 's'} into "${targetTag}"`,
		);
	}

	private promptNewHologramTag(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new HologramSplitModal(this.app, (name) => {
				resolve(name);
			});
			modal.open();
		});
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
		if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
			this.ctrlPressed = true;
			if (this.hoverIndex >= 0) {
				this.showPreviewCard();
			} else if (
				this.hoveredEdge &&
				!this.edgeDraggingSourceNode &&
				// Guard against key auto-repeat clobbering a card being interacted with.
				!this.edgeTooltipEl?.classList.contains('is-hovering')
			) {
				// 3D draws the edge card from pointermove only, so reveal it here too.
				this.drawEdgeTooltip(this.hoveredEdge);
			}
		}
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
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.repeat) {
				e.preventDefault();
				if (e.shiftKey) {
					this.historyStack.redo();
				} else {
					this.historyStack.undo();
				}
				this.rebuildGraph();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !e.repeat) {
				e.preventDefault();
				this.historyStack.redo();
				this.rebuildGraph();
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
		} else if (key === '1' && !e.repeat) {
			const R_x = this.getRotationMatrixAboutAxis([1, 0, 0], Math.PI);
			this.rotM = this.multiplyMatrices(this.rotM, R_x);
			this.updateCameraMatrix();
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
		} else if (key === 's' && e.shiftKey && !e.repeat) {
			e.preventDefault();
			this.plugin.settings.splitMode = this.plugin.settings.splitMode === 'move' ? 'copy' : 'move';
			void this.plugin.saveSettings();
			this.showToast(this.plugin.settings.splitMode === 'move' ? 'Split mode: Move' : 'Split mode: Copy');
			this.refreshControlsPanel();
		} else if (key === 'm' && e.shiftKey && !e.repeat) {
			e.preventDefault();
			this.plugin.settings.mergeMode = this.plugin.settings.mergeMode === 'absorb' ? 'emulsify' : 'absorb';
			void this.plugin.saveSettings();
			this.showToast(this.plugin.settings.mergeMode === 'absorb' ? 'Merge mode: Absorb' : 'Merge mode: Emulsify');
			this.refreshControlsPanel();
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
		console.log(`[SH] centerSelectedOnOrigin: view=(${this.viewX.toFixed(1)},${this.viewY.toFixed(1)}) scale=${this.viewScale.toFixed(3)}`);
		this.markViewAdjusted();
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
			'<div class="sh-help-row"><span class="sh-help-key">Shift+drag</span><span class="sh-help-desc">3D rotate about focal point (3D mode only)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">s + drag</span><span class="sh-help-desc">box select (2D) / lasso select (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+click</span><span class="sh-help-desc">toggle node selection</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">middle-drag</span><span class="sh-help-desc">3D rotate about focal point</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">scroll</span><span class="sh-help-desc">dolly in/out (focal-point centred)</span></div>' +
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
		if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
			this.ctrlPressed = false;
			if (!this.activePreviewCard?.matches(':hover')) {
				this.hidePreviewCard();
			}
			if (!this.edgeTooltipEl?.classList.contains('is-hovering')) {
				this.hideEdgeTooltip();
			}
		}
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
		const sy = e.clientY - rect.top;
		const dy = Math.max(-100, Math.min(100, e.deltaY));

		// If hovering over a node, change max depth instead of moving the camera
		if (this.hoverIndex >= 0) {
			const delta = dy > 0 ? -1 : 1;
			const newDepth = Math.max(0, Math.min(5, this.plugin.settings.maxDepth + delta));
			void this.plugin.setMaxDepth(newDepth);
			this.showToast(`Max Depth: ${newDepth}`);
			return;
		}

		if (this.is3D) {
			// 3D has no zoom. Magnification is derived from the standoff distance,
			// so the wheel travels the whole assembly along the line of sight and
			// is therefore always centred on the focal point. The cursor position
			// is deliberately unused: there is no zoom-to-cursor and no
			// screen-plane compensation (docs sections 5.3 and 5.4).
			this.dolly(Math.exp(-dy * PHYS.dollySpeed));
			this.markViewAdjusted();
			return;
		}

		// 2D is a flat canvas and keeps its ordinary zoom-to-cursor behaviour.
		const sx = e.clientX - rect.left;
		const factor = Math.exp(-dy * PHYS.zoomSpeed);
		const worldX = this.toWorldX(sx);
		const worldY = this.toWorldY(sy);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.cameraDistance = this.baseCameraDistance / this.viewScale;
		this.viewX = worldX - sx / this.viewScale;
		this.viewY = worldY - sy / this.viewScale;

		this.markViewAdjusted();
	};

	private hitTestEdge(e: PointerEvent): GraphLink | null {
		if (!this.canvas) return null;
		const rect = this.canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		for (const l of this.links) {
			const nA = this.nodes[l.a];
			const nB = this.nodes[l.b];
			if (!nA || !nB) continue;
			
			// Ensure both nodes of the edge belong to the current hologram
			if (!this.nodeMatchesSelectedHolograms(nA) || !this.nodeMatchesSelectedHolograms(nB)) {
				continue;
			}

			const pA = this.is3D ? this.rotatePoint(nA.x, nA.y, nA.z, this.target[0], this.target[1], this.target[2]) : { x: nA.x, y: nA.y };
			const pB = this.is3D ? this.rotatePoint(nB.x, nB.y, nB.z, this.target[0], this.target[1], this.target[2]) : { x: nB.x, y: nB.y };

			const sxA = this.toScreenX(pA.x);
			const syA = this.toScreenY(pA.y);
			const sxB = this.toScreenX(pB.x);
			const syB = this.toScreenY(pB.y);

			const l2 = (sxB - sxA) ** 2 + (syB - syA) ** 2;
			if (l2 === 0) continue;
			let t = ((x - sxA) * (sxB - sxA) + (y - syA) * (syB - syA)) / l2;
			t = Math.max(0, Math.min(1, t));
			const projX = sxA + t * (sxB - sxA);
			const projY = syA + t * (syB - syA);
			const dist = Math.hypot(x - projX, y - projY);

			if (dist < 8) return l;
		}
		return null;
	}

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
				if (!this.nodeMatchesSelectedHolograms(node)) {
					return;
				}
				const r = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
				const sx = this.toScreenX(r.x);
				const sy = this.toScreenY(r.y);
				const rad = Math.max(3, node.radius * this.viewScale);
				const sd = Math.hypot(sx - x, sy - y);
				if (sd < rad + 6 && sd < bestD) {
					bestD = sd;
					best = i;
				}
			});
			return best;
		}
		this.nodes.forEach((node, i) => {
			if (!this.nodeMatchesSelectedHolograms(node)) {
				return;
			}
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

	/** Re-render the controls panel so its merge/split mode buttons reflect hotkey toggles. */
	refreshControlsPanel(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('semantic-hologram-controls')) {
			const view = leaf.view as any;
			if (view.render) view.render();
			if (view.onCameraChange) view.onCameraChange();
		}
	}

	requestRedraw(): void {
		this.settled = false;
	}

	showLevelTooltip(show: boolean): void {
		// Implement later
	}

	private updateAnglesFromMatrix(): void {
		const fx = this.rotM[6] ?? 0;
		const fy = this.rotM[7] ?? 0;
		const fz = this.rotM[8] ?? 0;

		// theta is the azimuth of the eye-offset direction (-F) in the focal
		// point XZ plane: 0 deg at +X, increasing toward +Z. Home (F = [0,0,-1])
		// therefore reads 90 deg, not 0.
		let azimDeg = Math.atan2(-fz, -fx) * 180 / Math.PI;

		// phi is the elevation of F above the focal point XZ plane, so home
		// reads 0 deg. atan2(Fy, -F.h) is used rather than asin(Fy) because the
		// horizontal length -F.h is cos(phi) and this form stays unambiguous
		// through the poles instead of folding.
		const hLen = Math.hypot(-fx, -fz);
		let elevDeg: number;
		if (hLen < 1e-6) {
			// Straight up or straight down: the horizontal reference is undefined.
			elevDeg = fy >= 0 ? 90 : 270;
		} else {
			elevDeg = Math.atan2(fy, hLen) * 180 / Math.PI;
		}

		// Wrap after rounding so a value like 359.7 deg cannot round up to 360.
		azimDeg = ((Math.round(azimDeg) % 360) + 360) % 360;
		elevDeg = ((Math.round(elevDeg) % 360) + 360) % 360;
		this.currentAzimuth = azimDeg;
		this.currentElevation = elevDeg;
	}

	public setCameraState(state: { elevation: number; azimuth: number; distance: number }): void {
		// Normalize to 0-360 range with wrap-around
		let elev = ((state.elevation % 360) + 360) % 360;
		if (elev >= 360) elev = 0;
		let azim = ((state.azimuth % 360) + 360) % 360;
		if (azim >= 360) azim = 0;

		if (elev === this.currentElevation && azim === this.currentAzimuth && state.distance === this.cameraDistance) {
			return;
		}
		this.currentElevation = elev;
		this.currentAzimuth = azim;

		const elevRad = elev * Math.PI / 180;
		const azimRad = azim * Math.PI / 180;

		// Exact reconstruction from the two angles (see docs section 7.3) rather
		// than an incremental rotation, so the read-out and the basis can never
		// disagree and no error accumulates across repeated edits.
		//
		//   F     = [-cos(phi)cos(theta),  sin(phi), -cos(phi)sin(theta)]
		//   U_v   = [ sin(phi)cos(theta),  cos(phi),  sin(phi)sin(theta)]
		//   R_v   = [          sin(theta),       0,   -cos(theta)]
		//
		// Row 1 is stored negated (see docs section 8.1): the canvas mapping stays
		// a plain affine scale and det(R_rot) remains +1.
		const cp = Math.cos(elevRad);
		const sp = Math.sin(elevRad);
		const ct = Math.cos(azimRad);
		const st = Math.sin(azimRad);

		const fx = -cp * ct;
		const fy = sp;
		const fz = -cp * st;

		const rx = st;
		const ry = 0;
		const rz = -ct;

		const ux = -sp * ct;
		const uy = -cp;
		const uz = -sp * st;

		this.rotM = [
			rx, ry, rz,
			ux, uy, uz,
			fx, fy, fz
		];

		this.cameraDistance = Math.max(PHYS.dollyMin, Math.min(PHYS.dollyMax, state.distance));
		this.viewScale = this.baseCameraDistance / this.cameraDistance;
		this.markViewAdjusted(true);
	}

	public getCameraState(): { elevation: number; azimuth: number; distance: number } {
		return {
			elevation: this.currentElevation,
			azimuth: this.currentAzimuth,
			distance: Math.round(this.cameraDistance ?? 0)
		};
	}

	async dumpGraphState(): Promise<string> {
		console.log('[SH] DUMPING GRAPH STATE, target:', this.target);
		const dir = this.plugin.manifest.dir ?? '.obsidian/plugins/semantic-hologram';
		const path = `${dir}/graph-state.json`;
		const state = {
			settled: this.settled,
			layoutFrames: this.layoutFrames,
			scale: this.scale,
			viewScale: this.viewScale,
			cameraDistance: this.cameraDistance,
			baseCameraDistance: this.baseCameraDistance,
			viewX: this.viewX,
			viewY: this.viewY,
			target: this.target,
			canvas: {
				width: this.canvas?.clientWidth ?? 0,
				height: this.canvas?.clientHeight ?? 0,
				dpr: window.devicePixelRatio,
			},
			mode: this.plugin.settings.hologramMode,
			rotM: (this.rotM ?? []).map(v => Math.round(v * 1000) / 1000),
			totalSpin: Math.round((this.totalSpin ?? 0) * 1000) / 1000,
			nodeCount: this.nodes?.length ?? 0,
			linkCount: this.links?.length ?? 0,
			avgEdgeLength: Math.round((this.avgEdgeLength?.() ?? 0) * 10) / 10,
			restLengthScaled:
				Math.round(((this.links?.reduce((s, l) => s + (l.restLen ?? 0), 0) ?? 0) / Math.max(1, this.links?.length ?? 1)) * (this.scale ?? 1) * 10) / 10,
			worldR: Math.round((this.worldR?.() ?? 0) * 10) / 10,
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
				relations: l.relations,
				restLen: Math.round(l.restLen * 10) / 10,
			})),
		};
		await this.app.vault.adapter.write(path, JSON.stringify(state, null, 2));
		return path;
	}
}
/** Asks for the name of a new hologram when a dragged set separates from the graph. */
class HologramSplitModal extends Modal {
	private resolveFirst: (name: string | null) => void;
	private done = false;

	constructor(app: App, resolve: (name: string | null) => void) {
		super(app);
		this.resolveFirst = resolve;
	}

	private finish(name: string | null): void {
		if (this.done) {
			return;
		}
		this.done = true;
		this.resolveFirst(name);
		this.close();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sh-split-modal');
		this.titleEl.setText('Separate into a new hologram');
		contentEl.createDiv({ cls: 'sh-split-desc', text: 'Name the new hologram for the separated nodes.' });
		const input = new TextComponent(contentEl);
		input.setPlaceholder('e.g. Linux Kernel Signals');
		input.inputEl.addClass('sh-split-input');
		contentEl.createDiv({ cls: 'sh-split-buttons' }, (el) => {
			el.createEl('button', { text: 'Cancel', cls: 'mod-cta' }, (btn) => {
				btn.addEventListener('click', () => this.finish(null));
			});
			el.createEl('button', { text: 'Split', cls: 'mod-cta sh-split-ok' }, (btn) => {
				btn.addEventListener('click', () => this.finish(input.getValue().trim() || null));
			});
		});
		input.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				this.finish(input.getValue().trim() || null);
			}
		});
		window.setTimeout(() => {
			input.inputEl.focus();
			input.inputEl.select();
		}, 50);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) {
			this.done = true;
			this.resolveFirst(null);
		}
	}
}
