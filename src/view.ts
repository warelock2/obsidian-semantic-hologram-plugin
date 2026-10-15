import { App, ItemView, Modal, Notice, Platform, TFile, TextComponent, WorkspaceLeaf } from 'obsidian';
import { writeFileSync } from 'fs';
import { join } from 'path';
// @ts-ignore
import * as gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import type SemanticHologramPlugin from './main';
import type { HologramTool, ProjectionMode, RelTypeEntry } from './settings';
import type { SemanticHologramSettings } from './settings';
import type { RelationEdge, RelationScan } from './relations';
import { findRelationsSection, formatStrength, inScopePath, scanRelations } from './relations';
import { notifyLegendRefresh } from './legendBus';
import { addRelation, removeRelation } from './reviewCommon';
import { computeNodeStats, isEvidenceType, readNodeMetas, scanGravitas } from './gravitas';
import { ReviewConnectionsModal } from './review';
import type { GravitasScan } from './gravitas';
import type { ScanGraph, ScanResult } from './diffraction';
import { buildAdjacency, explainConnection, findNodeByRef, runScan } from './diffraction';
import type { ScanLayerSettings } from './settings';

export const VIEW_TYPE_HOLOGRAM = 'semantic-hologram-view';

const GIF_MAX_FRAMES = 720;
const GIF_SAMPLE_MS = 0;
const GIF_MAX_WIDTH = 640;
const GIF_MAX_PIXELS = 200_000;

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

/**
 * A derived hologram anchor: one connected component of the hologram-tag graph.
 * Tags that share a node (an emulsified bridge) are unioned into a single
 * component, so an emulsified pair has ONE anchor. Membership is stable; the
 * centroid is computed live from `nodeIndices` so it tracks the nodes.
 */
export interface AnchorGroup {
	id: string;
	tags: string[];
	nodeIndices: number[];
}

/** Full camera state for temporary framing (hologram peek) and exact restore. */
interface CameraSnapshot {
	target: [number, number, number];
	rotM: number[];
	cameraDistance: number;
	baseCameraDistance: number;
	viewScale: number;
	viewX: number;
	viewY: number;
	camZ: number;
	totalSpin: number;
	primePitch: number;
	userAdjustedView: boolean;
	autoFitCooldown: number;
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

/** One node's resolved highlight layer, as the renderer sees it. */
interface ScanLayerAssignment {
	key: keyof ScanLayerSettings;
	/** 0..1, normalised within the layer. Drives ring alpha, never geometry. */
	strength: number;
	detail: string;
}

/** How two notes are connected, resolved to display names for the MCP surface. */
interface ScanConnectionExplanation {
	source: string;
	target: string;
	connected: boolean;
	shortestPath: string[];
	intermediates: Array<{ label: string; path: string; charge: number; degree: number }>;
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
	relDescs: string[];
}

export function buildNodePreviewModel(
	node: { label: string; path: string; nodeType: string; confidenceTotal: number; gravitasDisplay: number; content?: string; relDescs?: string[] },
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
		relDescs: node.relDescs ?? [],
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
	// The standoff R is the camera's distance to the focal point and is the ONLY
	// source of magnification in 3D (viewScale = baseCameraDistance / R). Plain
	// scroll changes it, which is why plain scroll magnifies about the focal
	// point and never moves anything. It is bounded below only so R can never
	// reach 0 and make viewScale infinite; `zoomMax` caps the resulting scale,
	// and once capped further scroll shrinks R toward `standoffMin`, turning the
	// rig into a turret that rotates in place (docs section 5).
	standoffMin: 1,
	// Shift+scroll travels the whole assembly along the line of sight (F) and
	// leaves R intact. The travel is a fraction of R so a notch feels the same
	// at any magnification.
	dollyFraction: 0.15,
	dollySpeed: 0.004,
	dollyStep: 1.25,
	baseSize: 400,
};

// Hologram anchors: a derived, session-scoped centroid for each hologram (or
// emulsified group). Rendered only while the reveal hotkey is held, and never
// persisted to disk.
const ANCHOR_RADIUS = 13;
const ANCHOR_COLOR = '#6EE7B7';
const ANCHOR_SELECTED_COLOR = '#F59E0B';
const ANCHOR_UNION_COLOR = '#60A5FA';

// Perspective projection (`projectionMode === 'perspective'`). The eye and the
// image plane form a rigid assembly: the plane sits a FIXED distance
// `baseCameraDistance` in front of the eye, and the whole assembly stands off
// the focal point T by `R` (`cameraDistance`) along F. Magnification is then a
// pure function of position — screen = centre + d·(x2, y2)/(z2 + R) — with no
// injected scale factor. `PERSP_NEAR` floors the denominator so points at or
// behind the eye are treated as off-camera; `PERSP_STANDOFF_MIN` keeps R (and
// hence the denominator at the focal plane) from reaching that singularity.
const PERSP_NEAR = 1;
const PERSP_STANDOFF_MIN = 50;

// Projection-mode glyphs, deliberately distinct from the 2D/3D badge. Both show
// a projection plane (vertical bar, right), an object (small rect, left) and the
// rays between them: perspective's rays diverge from a focal point (dot) to the
// plane, orthographic's stay parallel. Wrapping the rays in this scene keeps the
// orthographic glyph from reading as a hamburger menu and the perspective one
// from reading as an arrowhead.
const ICON_PROJ_PERSP =
	'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="48" y1="12" x2="48" y2="52"/><rect x="10" y="22" width="10" height="20"/><circle cx="4" cy="32" r="3" fill="currentColor"/><line x1="7" y1="32" x2="48" y2="22"/><line x1="7" y1="32" x2="48" y2="32"/><line x1="7" y1="32" x2="48" y2="42"/></g></svg>';
const ICON_PROJ_ORTHO =
	'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 64 64"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><rect x="10" y="22" width="12" height="20"/><line x1="48" y1="14" x2="48" y2="50"/><line x1="22" y1="22" x2="48" y2="22"/><line x1="22" y1="32" x2="48" y2="32"/><line x1="22" y1="42" x2="48" y2="42"/></g></svg>';

const WHITE_EDGE = '#DDDDDD';

const CANDIDATE_COLOR = '#9B5DE5';

// Diffraction layer colours. Chosen to sit apart from both the gravitas spectrum
// (red→green ramp) and the eleven editable node-type colours: the two cool hues
// here and the warm-to-green ramp there cannot be confused, and each layer is
// separated by roughly 60 degrees of hue so two lit layers stay tellable apart.
// Rendered as a ring at r + 5, clear of the r + 4 "special" ring and the
// r * 1.25 confidence halo.
const SCAN_LAYER_COLORS: Record<string, string> = {
	activation: '#4CC9F0',
	gaps: '#F72585',
	resonance: '#B5179E',
	bridges: '#7209B7',
	discovered: '#3A0CA3',
};

// Per-entity cap on the debug graph-state dump. The dump exists to make live
// state inspectable, and a bounded capture has to say so — an unqualified
// first-200 is indistinguishable from a graph that only has 200 nodes.
const DUMP_ENTITY_LIMIT = 200;

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
	private projectionBanner: HTMLElement | null = null;
	private magnifyBtn: HTMLButtonElement | null = null;
	private demagnifyBtn: HTMLButtonElement | null = null;
	private nodes: GraphNode[] = [];
	private historyStack = new HistoryStack();
	private links: GraphLink[] = [];
	private searchIndex: Map<string, SearchIndexEntry> = new Map();
	private faces: number[][] = [];
	private loadingNotice: Notice | null = null;
	private raf = 0;
	private gifFrameCounter = 0;
	private initialCameraState: { azimuth: number; elevation: number; distance: number } | null = null;
	private initialFocalPoint: [number, number, number] | null = null;
	// Demand-driven render loop: it only keeps requesting animation frames while
	// there is work to do (physics running, autorotation, an active gesture, held
	// keys, recording, or residual motion still bleeding off). `wake()` restarts
	// it from any input handler, so an idle, settled view costs ~0% CPU.
	private loopRunning = false;
	private frameEnergy = 0;
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
	/** Persistent depth component of the camera's rotation center; panning needs it to move the view in pure screen space. */
	private camZ = 0;
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

		let html = `<div style="font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 4px; word-break: break-word;">${nA.label} ↔ ${nB.label}</div>`;

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
					? `<button class="sh-delete-rel" data-index="${index}" title="Remove this relationship from ${rel.authoredFrom}" style="flex: 0 0 auto; margin-left: auto; cursor: pointer; background: transparent; border: none; font-weight: bold; font-size: 14px; line-height: 1; padding: 2px 5px; border-radius: 3px; opacity: 0.6;">×</button>`
					: '';
				html += `
					<div class="sh-edge-rel-row" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 4px 0; padding: 3px 6px; border-radius: 4px; background: var(--background-secondary);">
						<span class="sh-edge-rel-text" style="flex: 1 1 auto; min-width: 0; font-size: 0.9em; line-height: 1.35; word-break: break-word; overflow-wrap: anywhere;">${dirText} · ${rel.type} (${rel.strength.toFixed(2)})</span>
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
	private bgColor = '#1e1e1e';
	// Hologram anchors are derived, session-scoped, and never persisted. The
	// groups are rebuilt from the hologram tag graph; centroids are read live
	// from the member nodes so a moving hologram's anchor follows it.
	private revealAnchors = false;
	private anchorGroups: AnchorGroup[] = [];
	private hoveredAnchor = -1;
	private selectedAnchor = -1;
	private anchorDragging = false;
	private anchorDragStartX = 0;
	private anchorDragStartY = 0;
	private anchorDragBasis: number[] | null = null;
	/** Screen px per world unit at the anchor's view depth (perspective); 0 = use viewScale. */
	private anchorDragScale = 0;
	private anchorDragOrigins = new Map<number, { x: number; y: number; z: number }>();
	/** Union of every anchor group's member indices, for reveal-mode fading. */
	private anchorMember = new Set<number>();
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
	private primePitch = 0;
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
	private peekActive = false;
	private peekTags: string[] = [];
	private peekCamera: CameraSnapshot | null = null;
	private isRecording = false;
	private isEncoding = false;
	/**
	 * Frames are quantised the moment they are captured and stored as indices
	 * plus their palette, not as raw ImageData.
	 *
	 * Raw RGBA at the capture size is ~1.6 MB per frame; a few hundred of those
	 * is close to a gigabyte held in memory for the length of a recording. Indexed
	 * data is one byte per pixel, so the same clip costs a quarter as much and the
	 * encode step at the end has nothing left to do.
	 */
	private recordingFrames: Array<{ index: Uint8Array; palette: number[][]; width: number; height: number }> = [];
	private recordingStartedAt = 0;
	private recordingStopRequested = false;
	private recordingHitCap = false;
	private lastCaptureAt = 0;
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

	/**
	 * Perspective exists only in 3D. A 2D view has no eye and no line of sight, so
	 * the pinhole has nothing to act on and the projection degenerates to a flat
	 * scale — so 2D reports orthographic. This is a read-time decision: the
	 * persisted preference is never clobbered, so returning to 3D restores it.
	 */
	private get isPerspective(): boolean {
		return this.is3D && this.plugin.settings.projectionMode === 'perspective';
	}

	/**
	 * Screen pixels per view-frame unit for a point at view-frame depth `z`
	 * (`z = F · (p − T)`). Orthographic: the constant `viewScale` (= base/R).
	 * Perspective: the true pinhole scale `d / (z + R)`, where `d =
	 * baseCameraDistance` is the fixed eye-to-screen distance. Returns NaN for
	 * points at or behind the eye (denominator ≤ 0) so callers can skip them.
	 */
	private projectionScale(z: number): number {
		if (!this.is3D || !this.isPerspective) {
			return this.viewScale;
		}
		const denom = z + this.cameraDistance;
		if (!(denom > PERSP_NEAR)) {
			return NaN;
		}
		return this.baseCameraDistance / denom;
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
		// The effective projection depends on the mode, so the banner has to be
		// re-read on every switch.
		this.setProjectionMode(this.plugin.settings.projectionMode);
		this.updateMagnifyTooltips();
		this.updateToolDock();
		this.updateCursor();
	}

	setTool(tool: HologramTool): void {
		this.updateToolDock();
		this.updateCursor();
	}

	setProjectionMode(mode: ProjectionMode): void {
		if (this.projectionBanner) {
			const persp = this.is3D && mode === 'perspective';
			this.projectionBanner.innerHTML = persp ? ICON_PROJ_PERSP : ICON_PROJ_ORTHO;
			this.projectionBanner.classList.toggle('is-3d', persp);
			this.projectionBanner.title = !this.is3D
				? 'Projection: orthographic — 2D is always orthographic'
				: persp
					? 'Projection: perspective — click (or press P) for orthographic'
					: 'Projection: orthographic — click (or press P) for perspective';
		}
		this.requestRedraw();
	}

	/** The projection toggle is a 3D control: 2D has no eye, so it stays orthographic. */
	private toggleProjection(): void {
		if (!this.is3D) {
			this.showToast('Projection: orthographic (2D)');
			return;
		}
		const next = this.isPerspective ? 'orthographic' : 'perspective';
		void this.plugin.setProjectionMode(next);
		this.showToast(next === 'perspective' ? 'Projection: perspective' : 'Projection: orthographic');
	}

	fitToViewPublic(): void {
		this.fitToView();
	}

	/**
	 * Plain-scroll control: change the standoff R, and with it the magnification
	 * (viewScale = baseCameraDistance / R). The focal point T does not move, and
	 * because the projection is orthographic the scene scales about T's screen
	 * position — the one and only magnification in 3D.
	 *
	 * R is floored at `standoffMin` (or the larger `PERSP_STANDOFF_MIN` under
	 * perspective) so it can never reach 0 (which would make viewScale infinite),
	 * and `viewScale` is capped at `zoomMax`. Once that cap bites, further scroll
	 * keeps shrinking R toward the floor: the camera closes on the focal point
	 * until the rig degenerates into a turret that rotates in place instead of
	 * translating.
	 */
	private setStandoff(factor: number): void {
		if (!this.is3D || !Number.isFinite(factor) || factor <= 0) {
			return;
		}
		let next = this.cameraDistance / factor;
		if (!Number.isFinite(next) || next <= 0) {
			return;
		}
		const floor = this.isPerspective ? PERSP_STANDOFF_MIN : PHYS.standoffMin;
		next = Math.max(floor, next);
		if (next === this.cameraDistance) {
			return;
		}
		this.cameraDistance = next;
		this.viewScale = Math.min(PHYS.zoomMax, this.baseCameraDistance / next);
		this.updateCameraMatrix();
	}

	/**
	 * Shift-scroll control: travel the whole camera/focal-point assembly along
	 * the line of sight. `amount` is in units of `dollyFraction · R`, positive
	 * for forward (+F, deeper into the graph), negative for backward.
	 *
	 * R is UNCHANGED here — position and magnification are separate controls.
	 * The travel is applied to T and ACCUMULATES (it must not assign, or a prior
	 * pan is discarded on the first wheel event). T is deliberately never
	 * clamped: T moves only along F, and R_v is orthogonal to F, so the scene's
	 * screen position is invariant under a dolly and cannot be walked out of
	 * view.
	 */
	private dolly(amount: number): void {
		if (!this.is3D || !Number.isFinite(amount) || amount === 0) {
			return;
		}
		const fx = this.rotM[6] ?? 0;
		const fy = this.rotM[7] ?? 0;
		const fz = this.rotM[8] ?? 0;
		const step = amount * PHYS.dollyFraction * this.cameraDistance;
		this.target[0] += step * fx;
		this.target[1] += step * fy;
		this.target[2] += step * fz;
		this.updateCameraMatrix();
	}

	/**
	 * The +/- buttons change magnification in both modes, but by different
	 * mechanisms, so the tooltip says which one is in effect. Calling them
	 * "Zoom In" in 3D was actively misleading: 3D has no zoom control.
	 */
	private updateMagnifyTooltips(): void {
		const is3D = this.is3D;
		if (this.magnifyBtn) {
			this.magnifyBtn.title = is3D
				? 'Magnify — scale about the focal point (Shift: travel forward)'
				: 'Magnify — scale about the centre';
		}
		if (this.demagnifyBtn) {
			this.demagnifyBtn.title = is3D
				? 'Demagnify — scale about the focal point (Shift: travel backward)'
				: 'Demagnify — scale about the centre';
		}
	}

	/** Scale the 2D view about the focal point, which is the canvas centre.
	 *
	 * The world point under the canvas centre is held fixed while `viewScale`
	 * moves, so every node keeps a single common factor of screen offset from
	 * the centre. This is the 2D counterpart of the 3D focal-point dolly — not a
	 * dolly itself: 2D has no line of sight, so travel along F is impossible and
	 * `dolly()` refuses to run. Here the cursor plays no part either, so wheel
	 * and buttons magnify about the same place.
	 */
	private applyScaleAboutFocalPoint(factor: number): void {
		if (!this.canvas) return;
		const halfW = this.canvas.clientWidth / 2;
		const halfH = this.canvas.clientHeight / 2;
		const focalX = this.toWorldX(halfW);
		const focalY = this.toWorldY(halfH);
		this.viewScale = Math.min(PHYS.zoomMax, Math.max(PHYS.zoomMin, this.viewScale * factor));
		this.cameraDistance = this.baseCameraDistance / this.viewScale;
		this.viewX = focalX - halfW / this.viewScale;
		this.viewY = focalY - halfH / this.viewScale;
	}

	/** Increase the magnification of the graph. In 3D this changes the standoff
	 * (scale about the focal point); with Shift held it instead travels the
	 * assembly forward along the line of sight. In 2D it is a scale change about
	 * the canvas centre. Named for the observable effect, which is the same in
	 * both modes.
	 */
	public magnify(shift = false): void {
		if (this.is3D) {
			if (shift) {
				this.dolly(1);
			} else {
				this.setStandoff(PHYS.dollyStep);
			}
			this.markViewAdjusted();
			return;
		}
		if (!this.canvas) return;
		this.applyScaleAboutFocalPoint(1.25);
		this.markViewAdjusted();
	}

	/** Decrease the magnification of the graph. See {@link magnify}. */
	public demagnify(shift = false): void {
		if (this.is3D) {
			if (shift) {
				this.dolly(-1);
			} else {
				this.setStandoff(1 / PHYS.dollyStep);
			}
			this.markViewAdjusted();
			return;
		}
		if (!this.canvas) return;
		this.applyScaleAboutFocalPoint(1 / 1.25);
		this.markViewAdjusted();
	}

	rebuildGraph(): Promise<void> {
		// Incremental: a save must not re-randomise the layout, drop the
		// selection, or move the camera. Measured before this change, a single
		// frontmatter edit on a settled 25-node graph moved nodes by 382 world
		// units and cleared a 3-node selection, with the drift floor at 0.
		return this.buildGraph(true).then((r) => {
			this.notifyGraphChanged();
			return r;
		});
	}

	/**
	 * Announce that the graph finished (re)building.
	 *
	 * Broadcasts on the shared bus rather than to subscribers held here, so a
	 * panel that loaded before this view existed still hears it. See
	 * legendBus.ts for why the direct-subscription version was removed.
	 */
	private notifyGraphChanged(): void {
		notifyLegendRefresh();
	}

	/**
	 * The live graph as a body-free structure the analysis can consume.
	 *
	 * Deliberately drops positions, gravitas-as-render-state and everything DOM.
	 * The analysis only needs identity and connection strength, so this is the
	 * seam that lets `diffraction.ts` stay pure and lets a scan run off the
	 * in-memory graph with no vault reads at all.
	 */
		scanGraph(): ScanGraph {
		return {
			nodes: this.nodes.map((n) => ({ path: n.path, label: n.label })),
			edges: this.links.map((l) => {
				// A link can carry several typed relations; conductance is their
				// mean strength, which is what the layout's rest length already uses.
				const strengths = l.relations.map((r) => r.strength).filter((s) => Number.isFinite(s));
				const strength = strengths.length > 0
					? strengths.reduce((a, b) => a + b, 0) / strengths.length
					: 0.5;
				return { a: l.a, b: l.b, strength };
			}),
		};
	}

	/**
	 * Run the diffraction pass over the current graph.
	 *
	 * `sources` are node indices; empty means "no injection", which still yields
	 * the bridge and chain layers because those are properties of the graph
	 * rather than of a propagation.
	 *
	 * Called by the render layer and by the MCP scan action. Pure with respect to
	 * the view: reads graph state, writes nothing.
	 */
	runDiffractionScan(
		sources: readonly number[] = [],
		target?: number,
	): { result: ScanResult; targetExplanation: ScanConnectionExplanation | null } {
		const graph = this.scanGraph();
		// Gravitas is the honest weight for the truth axis — it already aggregates
		// mass through the derivation DAG — so the scan reads it rather than
		// re-deriving something weaker from edge strength.
		const nodeWeight = this.nodes.map((n) => n.gravitasReal);
		const result = runScan(graph, { sources, nodeWeight });
		return {
			result,
			targetExplanation: target === undefined
				? null
				: this.explainScanConnection(graph, result, sources[0] ?? 0, target),
		};
	}

	private explainScanConnection(
		graph: ScanGraph,
		result: ScanResult,
		source: number,
		target: number,
	): ScanConnectionExplanation {
		const adj = buildAdjacency(graph);
		const explanation = explainConnection(graph, source, target, result.activation.energy, adj);
		const name = (i: number): { label: string; path: string } => ({
			label: graph.nodes[i]?.label ?? `#${i}`,
			path: graph.nodes[i]?.path ?? '',
		});
		return {
			source: name(explanation.source).label,
			target: name(explanation.target).label,
			connected: explanation.connected,
			shortestPath: explanation.shortestPath.map((i) => name(i).label),
			intermediates: explanation.intermediates.map((i) => ({
				...name(i.node),
				charge: Math.round(i.charge * 10000) / 10000,
				degree: i.degree,
			})),
		};
	}

	/** Resolve a path or label against the live graph, for the MCP surface. */
	resolveScanNode(ref: string): number {
		return findNodeByRef(this.scanGraph(), ref);
	}

	// --- diffraction highlight layers -----------------------------------------
	//
	// Read-only projections of one scan. Three rules hold here and must keep
	// holding:
	//
	//  1. Recomputed once per pass, never per frame. `draw()` runs on every rAF,
	//     and a scan is O(steps x edges); running it there would make the frame
	//     cost scale with the graph.
	//  2. No inferred edge ever reaches the layout. The layers read activation
	//     values and write colour only. A candidate edge fed to `applySprings`
	//     would make the graph physically rearrange around a fiction, and the
	//     fiction would then look confirmed by the shape.
	//  3. Nothing here touches projection, camera, or the layout maths. It is
	//     colour, alpha and ring width inside the existing draw pass.

	private scanResult: ScanResult | null = null;
	private scanStamp = '';
	private scanLayerOfNode: Map<number, ScanLayerAssignment> = new Map();
	private scanCounts = { nodes: 0, suppressed: 0 };

	/**
	 * What the scan found, per layer — independent of what is switched on.
	 *
	 * This must read `scanResult`, not `scanLayerOfNode`. The latter only holds
	 * *highlighted* nodes, because `resolveScanLayers` skips disabled layers, so
	 * counting it would report zero for a layer the scan actually found things
	 * in. The panel shows every count whether or not its layer is on, so the
	 * numbers have to describe the analysis rather than the display.
	 *
	 * `found` vs `reported` is the truncation disclosure: a bounded view that
	 * reports only what it drew tells the flattering half of the truth.
	 */
	getScanLegend(): {
		layers: Array<{
			key: keyof ScanLayerSettings;
			label: string;
			count: number;
			on: boolean;
			found: number | null;
			limit: number | null;
		}>;
		suppressed: number;
		degenerate: boolean;
		scanned: boolean;
	} {
		const settings = this.plugin.settings.scanLayers;
		const result = this.scanResult;
		const bounds = result?.diagnostics.bounds ?? {};

		// Distinct nodes each layer touches, which is what the column means.
		const nodesFor = (key: keyof ScanLayerSettings): number => {
			if (!result) return 0;
			switch (key) {
				case 'activation':
					return result.activation.litCount;
				case 'resonance':
					return new Set(result.resonance.map((r) => r.node)).size;
				case 'bridges':
					return new Set(result.bridges.map((b) => b.node)).size;
				case 'gaps': {
					const nodes = new Set<number>();
					for (const g of result.gaps) { nodes.add(g.a); nodes.add(g.b); }
					return nodes.size;
				}
				case 'discovered': {
					const nodes = new Set<number>();
					for (const c of result.chains) for (const n of c.chain) nodes.add(n);
					return nodes.size;
				}
			}
		};

		const order: Array<{ key: keyof ScanLayerSettings; label: string; bound: string }> = [
			{ key: 'discovered', label: 'Discovered', bound: 'chains' },
			{ key: 'bridges', label: 'Bridges', bound: 'bridges' },
			{ key: 'gaps', label: 'Gaps', bound: 'gaps' },
			{ key: 'resonance', label: 'Resonance', bound: 'resonance' },
			{ key: 'activation', label: 'Activation', bound: '' },
		];

		return {
			layers: order.map(({ key, label, bound }) => ({
				key,
				label,
				count: nodesFor(key),
				on: settings[key] === true,
				found: bound ? (bounds[bound]?.found ?? null) : null,
				limit: bound ? (bounds[bound]?.limit ?? null) : null,
			})),
			suppressed: this.scanCounts.suppressed,
			degenerate: result?.diagnostics.degenerate ?? false,
			scanned: result !== null,
		};
	}

	/**
	 * Force the layers to be up to date now, rather than on the next frame.
	 *
	 * The draw loop recomputes them lazily, which is right for rendering but too
	 * late for a control panel that wants to print counts immediately after a
	 * toggle. Stamp-guarded, so calling it when nothing changed costs a string
	 * comparison.
	 */
	refreshScan(): void {
		this.ensureScan();
	}

	/** Whether a given highlight layer is currently switched on. */
	isScanLayerOn(key: keyof ScanLayerSettings): boolean {
		return this.plugin.settings.scanLayers[key] === true;
	}

	/**
	 * Recompute the scan if anything it depends on has changed.
	 *
	 * The stamp covers the graph shape and the layer settings, so toggling a
	 * layer recomputes and an unchanged graph does not.
	 */
	private ensureScan(): void {
		const settings = this.plugin.settings.scanLayers;

		// Deliberately NOT skipped when every layer is off. The panel shows a count
		// for all five layers whether or not they are highlighted, and runScan
		// computes all five on a single pass anyway — so an early-out here would
		// report a row of zeroes for bridges and chains, which need no injection
		// source and are perfectly well defined in a structural pass.
		//
		// This runs from draw() every frame, but it is stamp-guarded below, so
		// steady-state cost is one string comparison.
		const stamp = [
			this.nodes.length,
			this.links.length,
			settings.activation, settings.gaps, settings.resonance,
			settings.bridges, settings.discovered,
			this.plugin.settings.scanSource,
		].join('|');
		if (stamp === this.scanStamp) return;
		this.scanStamp = stamp;

		const sourceRef = this.plugin.settings.scanSource.trim();
		const sources = sourceRef ? [this.resolveScanNode(sourceRef)] : [];
		if (sources[0] === -1) sources.length = 0;

		const graph = this.scanGraph();
		const result = runScan(graph, { sources, nodeWeight: this.nodes.map((n) => n.gravitasReal) });
		this.scanResult = result;
		this.scanCounts = { nodes: 0, suppressed: this.countOverlap(result) };
		this.scanLayerOfNode = this.resolveScanLayers(result, settings);
	}

	/**
	 * Assign each node the strongest layer it belongs to.
	 *
	 * Precedence is by authority, weakest claim first, so the strongest wins.
	 * `suppressed` counts nodes that matched more than one layer — the number
	 * that would otherwise be invisible, since a bounded view that reports only
	 * what it drew tells the flattering half of the truth.
	 */
	private resolveScanLayers(result: ScanResult, settings: ScanLayerSettings): Map<number, ScanLayerAssignment> {
		const out = new Map<number, ScanLayerAssignment>();

		// Strongest layer FIRST, first claim wins. A node renders its most
		// authoritative reading; weaker readings it also belongs to are counted in
		// `suppressed` rather than drawn, because they remain queryable over MCP
		// and the render is the bounded view.
		const claim = (node: number, key: keyof ScanLayerSettings, strength: number, detail: string): void => {
			if (!settings[key]) return;
			const existing = out.get(node);
			if (existing === undefined) {
				out.set(node, { key, strength, detail });
				return;
			}
			// Same layer claiming twice: keep the stronger reading.
			if (key === existing.key && strength > existing.strength) {
				existing.strength = strength;
				existing.detail = detail;
			}
		};

		if (settings.discovered) {
			const max = result.chains.reduce((m, c) => Math.max(m, c.composite), 0);
			for (const c of result.chains) {
				const s = max > 0 ? c.composite / max : 0.5;
				for (const node of c.chain) {
					claim(node, 'discovered', s, `chain score ${c.composite}`);
				}
			}
		}
		if (settings.bridges) {
			const max = result.bridges.reduce((m, b) => Math.max(m, b.bridgingPower), 0);
			for (const b of result.bridges) {
				claim(b.node, 'bridges', max > 0 ? b.bridgingPower / max : 0.5,
					`bridges ${b.bridgingPower} of ${b.neighbourCount} neighbours`);
			}
		}
		if (settings.gaps) {
			// Both endpoints of a gap carry it; the score is their joint prominence.
			const max = result.gaps.reduce((m, g) => Math.max(m, g.combined), 0);
			for (const g of result.gaps) {
				const s = max > 0 ? g.combined / max : 0.5;
				claim(g.a, 'gaps', s, 'lit but unlinked');
				claim(g.b, 'gaps', s, 'lit but unlinked');
			}
		}
		if (settings.resonance) {
			// Normalised by the strongest resonance rather than a flat constant —
			// otherwise every resonance ring draws at the same alpha and the layer
			// says nothing about relative prominence.
			const max = result.resonance.reduce((m, r) => Math.max(m, r.charge), 0);
			for (const r of result.resonance) {
				claim(r.node, 'resonance', max > 0 ? r.charge / max : 0.5, `charge ${r.charge.toFixed(3)}`);
			}
		}
		if (settings.activation) {
			// The fallback, and deliberately last: it is diffuse across the whole
			// field, so it only shows on a node no more specific layer claimed.
			const max = result.activation.maxEnergy;
			for (const [node, charge] of result.activation.energy) {
				if (charge <= 0 || max <= 0) continue;
				claim(node, 'activation', charge / max, `charge ${charge.toFixed(3)}`);
			}
		}

		return out;
	}

	/**
	 * Nodes appearing in more than one layer's result.
	 *
	 * Computed from the results, not from `scanLayerOfNode`, so it does not change
	 * when layers are toggled — it is a property of the scan rather than of the
	 * current display. `resolveScanLayers` counts overlaps among *highlighted*
	 * layers only, which would report a different number every time a box is
	 * ticked and silently disagree with the table.
	 */
	private countOverlap(result: ScanResult): number {
		const membership = new Map<number, number>();
		const add = (n: number): void => {
			membership.set(n, (membership.get(n) ?? 0) + 1);
		};
		for (const b of result.bridges) add(b.node);
		for (const r of result.resonance) add(r.node);
		for (const g of result.gaps) { add(g.a); add(g.b); }
		for (const c of result.chains) for (const n of c.chain) add(n);
		for (const n of result.activation.energy.keys()) add(n);
		let overlapping = 0;
		for (const count of membership.values()) if (count > 1) overlapping++;
		return overlapping;
	}

	/** Force the next frame to recompute the layers. Called by the settings setters. */
	invalidateScan(): void {
		this.scanStamp = '';
	}

	/** The resolved layer for a node index, or null. Called from `draw()`. */
	scanLayerAt(index: number): ScanLayerAssignment | null {
		return this.scanLayerOfNode.get(index) ?? null;
	}

	/** Whether any node belongs to a scan layer at all, for the link pass. */
	hasScanLayers(): boolean {
		return this.scanLayerOfNode.size > 0;
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

		this.projectionBanner = container.createDiv({
			cls: 'sh-mode-banner sh-projection-banner sh-mode-indicator',
		});
		this.projectionBanner.addEventListener('click', () => {
			this.toggleProjection();
		});
		this.setProjectionMode(this.plugin.settings.projectionMode);

		this.cursorOverlay = container.createDiv({ cls: 'sh-cursor-overlay' });
		this.cursorOverlay.setAttribute('aria-hidden', 'true');
		this.cursorOverlay.innerHTML =
			'<div class="sh-cursor-crosshair"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 1.5v4M9 12.5v4M1.5 9h4M12.5 9h4"/><circle cx="9" cy="9" r="0.9" fill="currentColor" stroke="none"/></svg></div>' +
			'<div class="sh-cursor-icon"></div>';
		this.cursorOverlay.style.display = 'none';

		const magnifyControls = container.createDiv({ cls: 'sh-map-magnify-controls' });
		const btnIn = magnifyControls.createEl('button', { text: '+', cls: 'sh-map-magnify-btn' });
		this.magnifyBtn = btnIn;
		btnIn.addEventListener('click', (e) => this.magnify(e.shiftKey));

		const btnFit = magnifyControls.createEl('button', { text: '⌖', cls: 'sh-map-magnify-btn' });
		btnFit.title = 'Fit to View (fits the selection when there is one)';
		btnFit.addEventListener('click', () => this.fitToView());

		const btnOut = magnifyControls.createEl('button', { text: '−', cls: 'sh-map-magnify-btn' });
		this.demagnifyBtn = btnOut;
		btnOut.addEventListener('click', (e) => this.demagnify(e.shiftKey));
		this.updateMagnifyTooltips();

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
		window.addEventListener('blur', this.onWindowBlur);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.canvas);
		this.resize();

		void this.buildGraph().then(() => {
			// First open frames the graph. This lives at the call site rather than
			// inside buildGraph so that an incremental rebuild — which happens on
			// every save — cannot move the camera out from under the user.
			this.fitToView();
			this.notifyGraphChanged();
		});

		this.registerEvent(
			this.app.metadataCache.on('resolved', () => this.buildGraph(true).then(() => this.notifyGraphChanged())),
		);

		this.wake();
	}

	onClose(): Promise<void> {
		this.loopRunning = false;
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
		window.removeEventListener('blur', this.onWindowBlur);
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
		const bg = cs.getPropertyValue('--background-primary').trim();
		if (accent) {
			this.nodeColor = accent;
		}
		if (bg) {
			this.bgColor = bg;
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
		this.wake();
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
				// label is part of the reused object's state. Without this a renamed
				// or retitled note would keep rendering its old name forever, since
				// the incremental branch is now the normal rebuild path.
				node.label = f.basename;
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
		// Captured before the swap: the shape of the previous graph is what tells
		// us whether physics needs to re-arm below.
		const prevNodeCount = this.nodes?.length ?? 0;
		const prevLinkCount = this.links?.length ?? 0;
		this.nodes = nodes;
		this.links = links;
		for (const i of this.selected) {
			const nd = this.nodes[i];
			if (nd) {
				nd.selected = true;
			}
		}
		this.calculateFaces();
		this.rebuildAnchors();
		console.log(`[SH] buildGraph: nodes=${nodes.length} links=${links.length} faces=${this.faces.length} settled=${this.settled}`);
		const topologyChanged = nodes.length !== prevNodeCount || links.length !== prevLinkCount;
		if (!incremental || topologyChanged) {
			// Physics must re-arm when the shape changes. `settled` is a one-way
			// latch — the settle detector is gated on `!this.settled` — and a node
			// arriving while settled is true is home-locked at its seed position, so
			// without this a newly added note would sit on the ring forever instead
			// of integrating. A content-only edit re-runs no physics at all, which is
			// what keeps the layout stable across a save.
			this.settled = false;
			this.settleCount = 0;
			this.layoutFrames = 0;
		}
		if (!incremental) {
			this.selected.clear();
		}
		// A rebuild reloads content and may re-arm physics; make sure a parked
		// loop wakes so the new graph is laid out and drawn.
		this.wake();
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
			this.captureFrame();
		}
		if (this.needsAnimationFrame()) {
			this.raf = requestAnimationFrame(this.loop);
		} else {
			// Nothing left to animate: park the loop. Any input handler calls
			// wake() to restart it, so the view stays fully interactive.
			this.loopRunning = false;
			this.raf = 0;
		}
	};

	/**
	 * Restart the render loop if it is parked. Safe to call from any handler and
	 * cheap when the loop is already running.
	 */
	private wake(): void {
		if (this.loopRunning) {
			return;
		}
		this.loopRunning = true;
		this.raf = requestAnimationFrame(this.loop);
	}

	/** Whether another animation frame is warranted (otherwise the loop parks). */
	private needsAnimationFrame(): boolean {
		return (
			!this.settled ||
			this.autoRotating !== 'off' ||
			this.isRecording ||
			this.pressedKeys.size > 0 ||
			this.isInteracting() ||
			this.frameEnergy > PHYS.settleEnergy
		);
	}

	/** True while a pointer/touch gesture owns the canvas and needs live frames. */
	private isInteracting(): boolean {
		return (
			this.pointerDown ||
			this.rotating ||
			this.panning ||
			this.selecting ||
			this.groupDragging ||
			this.anchorDragging ||
			this.pinnedIndex >= 0 ||
			this.edgeDraggingSourceNode !== null ||
			this.touchGesture !== 'none'
		);
	}

	/**
	 * Start recording whatever happens on screen.
	 *
	 * Deliberately does not rotate anything. Recording a spinning animation and
	 * recording someone panning, selecting or merging are both legitimate, and the
	 * only one that can be right without knowing the intent is the one that
	 * captures what actually happened. The user stops it.
	 */
	public async startRecording(): Promise<void> {
		if (!this.is3D) {
			this.showToast('Recording only supported in 3D mode');
			return;
		}
		if (this.isEncoding) {
			this.showToast('Still encoding the previous capture');
			return;
		}
		this.isRecording = true;
		this.isEncoding = false;
		this.recordingFrames = [];
		this.recordingStartedAt = performance.now();
		this.recordingStopRequested = false;
		this.recordingHitCap = false;
		this.lastCaptureAt = 0;
		this.gifFrameCounter = 0;
		this.showToast('Recording — press Stop to finish');

		if (!this.recordingProgressEl) {
			this.recordingProgressEl = document.body.createDiv({ cls: 'sh-recording-progress' });
		}
		this.recordingProgressEl.empty();
		this.renderRecordingPanel();
		this.updateProgressUI(0);

		this.writeGifStatus({ status: 'recording', frames: 0, timestamp: Date.now() });
	}

	public isRecordingActive(): boolean {
		return this.isRecording;
	}

	public stopRecording(): void {
		this.recordingStopRequested = true;
	}

	/**
	 * Write the status file the MCP server polls.
	 *
	 * It has to land in the plugin directory: the MCP server resolves it
	 * against its own `process.cwd()`, which is the plugin directory, not the
	 * vault. Writing through `vault.adapter` put it at the vault root, so
	 * `get_gif_status` reported "no status found" while a recording was
	 * demonstrably running.
	 */
	private writeGifStatus(payload: Record<string, unknown>): void {
		try {
			writeFileSync(
				join(this.plugin.pluginDir(), '.hologram-status.json'),
				JSON.stringify(payload, null, 2),
			);
		} catch (err) {
			console.error('[SH] failed to write GIF status file:', err);
		}
	}

	/**
	 * Progress panel for a recording in progress, with the control that ends it.
	 *
	 * There was previously no way to stop a recording other than letting it run
	 * into a frame limit derived from auto-rotation, which only advanced in one
	 * rotation mode. So "record something I do" was not actually possible.
	 */
	private renderRecordingPanel(): void {
		const el = this.recordingProgressEl;
		if (!el) return;
		el.style.cssText = 'display: block !important; visibility: visible !important;';
		el.empty();
		el.createDiv({ cls: 'sh-progress-bar-title', text: `Recording — ${this.recordingFrames.length} / ${GIF_MAX_FRAMES} frames` });
		el.createDiv({ cls: 'sh-progress-bar-track' }).createDiv({ cls: 'sh-progress-bar-fill', attr: { style: 'width: 0%' } });
		const hint = el.createDiv({ cls: 'sh-progress-hint' });
		hint.createSpan({ text: `Captures whatever you do on the canvas. Stops at ${GIF_MAX_FRAMES} frames.` });
		const stop = el.createEl('button', { text: 'Stop and save', cls: 'sh-stop-record-btn' });
		stop.addEventListener('click', () => {
			this.recordingStopRequested = true;
			this.updateProgressUI(this.recordingFrames.length);
		});
	}

	private updateProgressUI(current: number): void {
		const el = this.recordingProgressEl;
		if (!el) return;
		const title = el.querySelector('.sh-progress-bar-title');
		const fill = el.querySelector('.sh-progress-bar-fill') as HTMLElement | null;
		if (title) {
			title.textContent = current >= GIF_MAX_FRAMES
				? `Frame cap reached (${GIF_MAX_FRAMES}) — finishing…`
				: `Recording — ${current} / ${GIF_MAX_FRAMES} frames`;
		}
		if (fill) {
			const pct = Math.min(100, Math.round((current / GIF_MAX_FRAMES) * 100));
			fill.style.width = `${pct}%`;
		}
	}

	/**
	 * Capture one frame of whatever is currently on the canvas.
	 *
	 * Frame skipping: autorotation advances ~0.5 degrees per tick, so capturing
	 * every 2nd frame yields one GIF frame per 1.0 degree step. At the 360-frame
	 * cap, a full rotation produces a 360-frame GIF.
	 *
	 * Stop conditions by mode:
	 *  - full: stops when the frame cap is reached
	 *  - time: stops when elapsed time reaches gifDuration
	 *  - continuous: no automatic stop — runs until user clicks Stop
	 */
	private captureFrame(): void {
		if (!this.canvas || !this.ctx) return;

		const now = performance.now();
		if (now - this.lastCaptureAt < GIF_SAMPLE_MS) return;
		this.lastCaptureAt = now;

		// Captures every animation frame (720 frames cover a full 360° rotation at 0.5° per step).
		this.gifFrameCounter++;

		const mode = this.plugin.settings.gifMode;

		if (mode === 'time') {
			const elapsed = (now - this.recordingStartedAt) / 1000;
			if (elapsed >= this.plugin.settings.gifDuration) {
				this.stopAndEncode();
				return;
			}
		} else if (mode === 'full') {
			if (this.recordingFrames.length >= GIF_MAX_FRAMES) {
				this.recordingHitCap = true;
				this.stopAndEncode();
				return;
			}
		}
		// 'continuous': no automatic stop — runs until user clicks Stop.

		const { width: targetWidth, height: targetHeight } = this.captureSize();

		const offscreen = document.createElement('canvas');
		offscreen.width = targetWidth;
		offscreen.height = targetHeight;
		const offCtx = offscreen.getContext('2d');
		if (!offCtx) return;

		// Paint the resolved background first. The canvas is cleared to
		// transparent and never filled, so without this the translucent face
		// triangles and the antialiased edges composite against nothing and the
		// GIF renders them over the viewer's default background — which is why
		// captures looked washed out and did not match the screen.
		const background = this.resolvedCanvasBackground();
		offCtx.fillStyle = background;
		offCtx.fillRect(0, 0, targetWidth, targetHeight);
		offCtx.drawImage(this.canvas, 0, 0, targetWidth, targetHeight);

		// Quantise immediately rather than holding raw RGBA for the whole
		// recording: one byte per pixel instead of four.
		const data = offCtx.getImageData(0, 0, targetWidth, targetHeight).data;
		const palette = quantize(data, 256);
		const index = applyPalette(data, palette);
		this.recordingFrames.push({ index, palette, width: targetWidth, height: targetHeight });

		this.updateProgressUI(this.recordingFrames.length);

		if (this.recordingStopRequested) {
			this.stopAndEncode();
		}
	}

	/**
	 * Frame size for a capture, as a downscale of the live canvas.
	 *
	 * It never upscales. Sizing off a fixed target width meant a 298x614 sidebar
	 * was captured at 720x1483 — 1.07 million pixels, 2.4x more than the source
	 * had, buying no detail while making each frame's quantise pass expensive
	 * enough to dominate the render loop (measured: ~390 ms per capture, so a
	 * 240-frame recording would have taken 90 seconds of real time to accrue 36
	 * seconds of playback). The pixel budget bounds that cost independently of
	 * window shape.
	 */
	private captureSize(): { width: number; height: number } {
		const srcW = Math.max(1, this.canvas ? this.canvas.width : 1);
		const srcH = Math.max(1, this.canvas ? this.canvas.height : 1);
		let scale = 1;
		if (srcW > GIF_MAX_WIDTH) scale = GIF_MAX_WIDTH / srcW;
		if (srcW * srcH * scale * scale > GIF_MAX_PIXELS) {
			scale = Math.sqrt(GIF_MAX_PIXELS / (srcW * srcH));
		}
		return {
			width: Math.max(1, Math.round(srcW * scale)),
			height: Math.max(1, Math.round(srcH * scale)),
		};
	}

	/** The theme background the canvas is drawn on, as a CSS colour. */
	private resolvedCanvasBackground(): string {
		const canvas = this.canvas;
		if (!canvas) return '#000000';
		const view = getComputedStyle(canvas);
		const primary = view.getPropertyValue('--background-primary').trim();
		if (primary) return primary;
		const secondary = getComputedStyle(document.body).getPropertyValue('--background-primary').trim();
		return secondary || '#000000';
	}

	private stopAndEncode(): void {
		this.isRecording = false;
		this.isEncoding = true;
		const frames = this.recordingFrames;
		this.recordingFrames = [];

		// Fixed 30 FPS delay (33ms per frame).
		const delay = 33;

		if (this.recordingProgressEl) {
			this.recordingProgressEl.empty();
			this.recordingProgressEl.createDiv({ cls: 'sh-progress-bar-title', text: `Encoding ${frames.length} frames...` });
		}
		this.showToast(`Encoding ${frames.length} frames...`);

		if (frames.length === 0) {
			this.isEncoding = false;
			this.writeGifStatus({ status: 'error', error: 'no frames were captured', timestamp: Date.now() });
			this.showToast('GIF recording captured no frames');
			if (this.recordingProgressEl) this.recordingProgressEl.style.display = 'none';
			return;
		}

		this.writeGifStatus({
			status: 'encoding',
			frames: frames.length,
			hitCap: this.recordingHitCap,
			delay,
			timestamp: Date.now(),
		});

		setTimeout(async () => {
			try {
				const gif = GIFEncoder();

				// Frames were already quantised at capture time, one byte per pixel.
				// Quantising the whole array again would be both pointless and
				// slow.
				frames.forEach((frame) => {
					const opts: Record<string, unknown> = {
						palette: frame.palette,
						delay,
						// 0 = loop forever. The user asked for an endless cycle.
						repeat: 0,
					};
					gif.writeFrame(frame.index, frame.width, frame.height, opts as any);
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

				const stamp = Date.now();
				let finalFileName = `${folderName}/hologram-${stamp}.gif`;
				let counter = 1;
				while (vault.getAbstractFileByPath(finalFileName)) {
					finalFileName = `${folderName}/hologram-${stamp}-${counter++}.gif`;
				}

				await vault.createBinary(finalFileName, await blob.arrayBuffer());

				this.showToast(`Saved GIF to ${finalFileName}`);
				this.writeGifStatus({
					status: 'success',
					path: finalFileName,
					frames: frames.length,
					bytes: buffer.byteLength,
					delay,
					loopsForever: true,
					timestamp: Date.now(),
				});

				if (this.recordingProgressEl) {
					this.recordingProgressEl.empty();
					this.recordingProgressEl.createDiv({ cls: 'sh-progress-bar-title', text: `Saved to ${finalFileName}` });
					this.recordingProgressEl.createDiv({ cls: 'sh-preview-container' })
						.createEl('img', { cls: 'sh-gif-preview', attr: { src: url } });
					const actions = this.recordingProgressEl.createDiv({ cls: 'sh-progress-actions' });
					const close = actions.createEl('button', { text: 'Close', cls: 'sh-dismiss-progress-btn' });
					close.addEventListener('click', () => {
						if (this.recordingProgressEl) this.recordingProgressEl.style.display = 'none';
						URL.revokeObjectURL(url);
					});
				}
			} catch (err) {
				console.error('[SH] GIF encoding error:', err);
				this.showToast('GIF encoding failed');
				this.writeGifStatus({ status: 'error', error: String(err), timestamp: Date.now() });
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
		if (this.pressedKeys.size > 0 && pluginPaneActive && !this.peekActive) {
			const panSpeed = 5 / this.viewScale;
			const rotSpeed = 3; // degrees per step
			const isShift = this.shiftDown;

			const m = this.rotM;
			const horiz = this.pressedKeys.has('ArrowRight') ? 1 : this.pressedKeys.has('ArrowLeft') ? -1 : 0;
			const vert = this.pressedKeys.has('ArrowDown') ? 1 : this.pressedKeys.has('ArrowUp') ? -1 : 0;

			// Shift+arrow drives the two body-relative angles θ′ and φ′ about the
			// assembly's own axes (docs sections 6.1 and 6.3). The same
			// applyRotationDeltas path the mouse uses, so keyboard and pointer
			// cannot disagree. Rotation is about the focal point, which is left
			// untouched.
			if (isShift && (horiz !== 0 || vert !== 0)) {
				if (this.is3D) {
					// Prime-frame rotation: θ′ about the assembly's own y′ and
					// φ′ about its own x′ (docs sections 6.1 and 6.3). The world
					// angles θ and φ are derived from the resulting basis, never
					// set directly here.
					this.applyRotationDeltas(horiz * rotSpeed, -vert * rotSpeed);
					this.totalSpin += (horiz * rotSpeed * Math.PI) / 180;
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
		// Physics is scoped to the nodes that are actually drawn. When a hologram
		// filter is active (or a peek is showing), the hidden nodes must not push
		// or pull the visible subset, and the settle metric must describe that
		// subset. With no filter every entry is true, so the all-visible layout is
		// unchanged.
		const visible = nodes.map((node) => this.isNodeVisible(node));

		if (is3D) {
			this.applyRepulsion3D(visible);
		} else {
			this.applyRepulsion(visible);
		}

		if (this.settled) {
			// After the first settle the origin-centering force is switched OFF:
			// each node's home now holds the layout, so there is nothing to pull
			// the graph inward. Re-enabling it would fight every anchor drag and
			// drag the whole graph back to the origin.
			for (let i = 0; i < nodes.length; i++) {
				const node = nodes[i]!;
				if (!visible[i] || node.pinned || node.selected) {
					continue;
				}
				node.vx += (node.homeX - node.x) * PHYS.homeSpring;
				node.vy += (node.homeY - node.y) * PHYS.homeSpring;
				if (is3D) {
					node.vz += (node.homeZ - node.z) * PHYS.homeSpring;
				}
			}
		} else {
			if (is3D) {
				this.applySprings3D(visible);
				this.applyCenter3D(visible);
			} else {
				this.applySprings(visible);
				this.applyCenter(visible);
			}
		}

		let energy = 0;
		let visibleCount = 0;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]!;
			if (!visible[i]) {
				// Hidden nodes are frozen rather than integrated, and their stale
				// velocity is cleared so they do not lurch when they re-enter the
				// filter.
				node.vx = 0;
				node.vy = 0;
				if (is3D) {
					node.vz = 0;
				}
				continue;
			}
			if (node.pinned || node.selected) {
				continue;
			}
			visibleCount++;
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

		// Residual kinetic energy (per integrable node) is the sleep signal: below
		// the settle threshold with a settled layout there is nothing left to draw.
		this.frameEnergy = energy / Math.max(1, visibleCount);

		if (this.autoRotating === 'ccw' && this.nodes.length > 0) {
			if (this.is3D) {
				this.applyRotationDeltas(-0.5, 0);
			} else {
				this.rotateAboutAxis([0, 1, 0], -0.005);
			}
			this.totalSpin -= 0.005;
		} else if (this.autoRotating === 'cw' && this.nodes.length > 0) {
			if (this.is3D) {
				this.applyRotationDeltas(0.5, 0);
			} else {
				this.rotateAboutAxis([0, 1, 0], 0.005);
			}
			this.totalSpin += 0.005;
		}
		if (this.autoRotating !== 'off') {
			this.syncControlsCamera();
		}
		if (!this.settled) {
			this.layoutFrames++;
			const avg = energy / Math.max(1, visibleCount);
			const avgEdge = this.avgEdgeLength(visible);
			let restSum = 0;
			let visibleLinkCount = 0;
			for (const l of links) {
				if (!visible[l.a] || !visible[l.b]) {
					continue;
				}
				restSum += l.restLen;
				visibleLinkCount++;
			}
			const restLen = (restSum / Math.max(1, visibleLinkCount)) * this.scale;
			const spread = visibleLinkCount === 0 || avgEdge >= restLen * 0.7;
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
				if (!this.initialCameraState) {
					this.initialCameraState = {
						azimuth: this.currentAzimuth,
						elevation: this.currentElevation,
						distance: this.cameraDistance,
					};
					this.initialFocalPoint = [...this.target];
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

	private avgEdgeLength(visible?: boolean[]): number {
		// Defaults to the drawn subset so a filtered view reports the edge length
		// of the graph the user can actually see.
		const vis = visible ?? this.nodes.map((node) => this.isNodeVisible(node));
		const is3D = this.is3D;
		let total = 0;
		let count = 0;
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b || !vis[l.a] || !vis[l.b]) {
				continue;
			}
			total += is3D
				? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
				: Math.hypot(b.x - a.x, b.y - a.y);
			count++;
		}
		return count === 0 ? 0 : total / count;
	}

	// `z` is the view-frame depth of the point (see `projectionScale`); it
	// defaults to 0, i.e. the focal plane, where perspective and orthographic
	// scales coincide. 3D callers that know a real depth must pass it.
	private toScreenX(x: number, z = 0): number {
		if (this.is3D) {
			const w = this.canvas?.clientWidth ?? 800;
			return w / 2 + x * this.projectionScale(z);
		}
		return (x - this.viewX) * this.viewScale;
	}

	private toScreenY(y: number, z = 0): number {
		if (this.is3D) {
			const h = this.canvas?.clientHeight ?? 600;
			return h / 2 + y * this.projectionScale(z);
		}
		return (y - this.viewY) * this.viewScale;
	}

	private toWorldX(sx: number, z = 0): number {
		if (this.is3D) {
			const w = this.canvas?.clientWidth ?? 800;
			return (sx - w / 2) / this.projectionScale(z);
		}
		return sx / this.viewScale + this.viewX;
	}

	private toWorldY(sy: number, z = 0): number {
		if (this.is3D) {
			const h = this.canvas?.clientHeight ?? 600;
			return (sy - h / 2) / this.projectionScale(z);
		}
		return sy / this.viewScale + this.viewY;
	}

	private fitToView(): void {
		const canvas = this.canvas;
		if (!canvas || this.nodes.length === 0) {
			return;
		}
		// Preserve the orientation only when the user has already moved the
		// camera and is now explicitly reframing a selection. An automatic fit
		// (during settle, or the home fit) always restores the home basis, so
		// the initial view is never a stale identity matrix.
		const preserveOrientation = this.userAdjustedView;
		this.userAdjustedView = false;

		// Selection-aware fit. When there is a node selection or a hologram
		// filter, frame exactly that subset and — when the user is reframing —
		// keep the current orientation, moving only the focal point onto the
		// subset's centroid. With nothing selected we keep the long-standing
		// home behaviour: reset to θ=90°, φ=0° and frame the whole graph.
		const hologramFiltered = this.nodes.filter((node) => this.nodeMatchesSelectedHolograms(node));
		let selectionNodes: GraphNode[];
		if (this.selected.size > 0) {
			selectionNodes = [...this.selected]
				.map((i) => this.nodes[i])
				.filter((n): n is GraphNode => !!n);
		} else if (this.plugin.settings.selectedHolograms.length > 0 && hologramFiltered.length > 0) {
			selectionNodes = hologramFiltered;
		} else {
			selectionNodes = [];
		}
		const hasSelection = selectionNodes.length > 0;
		const targetNodes = hasSelection ? selectionNodes : this.nodes;

		this.frameNodes(targetNodes, preserveOrientation, hasSelection);

		console.log(`[SH] fitToView (${hasSelection ? 'selection' : 'home'}): nodes=${targetNodes.length}/${this.nodes.length} canvas=${this.canvas?.clientWidth}x${this.canvas?.clientHeight} view=(${this.is3D ? this.target : `${this.viewX.toFixed(1)},${this.viewY.toFixed(1)}`}) scale=${this.viewScale.toFixed(3)}`);
		this.markViewAdjusted();
	}

	private resetView(): void {
		if (this.initialCameraState) {
			this.setCameraState({ ...this.initialCameraState });
		}
		if (this.initialFocalPoint) {
			this.target = [...this.initialFocalPoint];
		}
		this.userAdjustedView = false;
		this.wake();
	}

	/**
	 * Frame `targetNodes` exactly, moving the focal point onto their centroid.
	 * `preserveOrientation` keeps the current basis (only the focal point moves);
	 * otherwise a selection resets to the home basis. `hasSelection` is false
	 * only for the whole-graph home fit, which frames about the world origin.
	 * Does not touch `userAdjustedView` or the controls panel; callers own that.
	 */
	private frameNodes(targetNodes: GraphNode[], preserveOrientation: boolean, hasSelection: boolean): void {
		const canvas = this.canvas;
		if (!canvas || targetNodes.length === 0) {
			return;
		}
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;

		// Centroid of the nodes being framed (world space). For the home fit
		// this is the graph's centroid, but the home path deliberately frames
		// about the origin, so only the selection path uses it.
		let cx = 0;
		let cy = 0;
		let cz = 0;
		for (const n of targetNodes) {
			cx += n.x;
			cy += n.y;
			cz += n.z;
		}
		cx /= targetNodes.length;
		cy /= targetNodes.length;
		cz /= targetNodes.length;

		// The home fit frames about the world origin, not the graph centroid.
		if (!hasSelection) {
			cx = 0;
			cy = 0;
			cz = 0;
		}

		if (this.is3D) {
			if (hasSelection && !preserveOrientation) {
				this.target = [cx, cy, cz];
				this.rotM = [
					1,  0,  0,
					0, -1,  0,
					0,  0, -1
				];
				this.updateAnglesFromMatrix();
			} else if (hasSelection) {
				this.target = [cx, cy, cz];
			} else {
				this.target = [0, 0, 0];
				this.rotM = [
					1,  0,  0,
					0, -1,  0,
					0,  0, -1
				];
				this.cameraDistance = 1000;
				this.updateAnglesFromMatrix();
			}
		} else {
			if (!hasSelection) {
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
		}

		// Screen extents about the framing centroid. 3D projects through the
		// current basis; depth is ignored, which frames the focal plane exactly
		// (perspective and orthographic coincide there) but is only approximate
		// for off-plane nodes under perspective. 2D is a flat translation.
		let maxAbsX = 0;
		let maxAbsY = 0;
		for (const node of targetNodes) {
			const r = this.is3D
				? this.rotatePoint(node.x, node.y, node.z, cx, cy, cz)
				: { x: node.x - cx, y: node.y - cy };
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
			this.viewX = cx - w / (2 * this.viewScale);
			this.viewY = cy - h / (2 * this.viewScale);
		}
		this.wake();
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
		this.wake();
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

	private applyRepulsion(visible: boolean[]): void {
		const { nodes } = this;
		const cellSize = PHYS.cellSize * this.scale;
		const grid = new Map<number, number[]>();
		const cellOf = (x: number, y: number): number => {
			const cx = Math.floor(x / cellSize);
			const cy = Math.floor(y / cellSize);
			return cx * 100000 + cy;
		};
		nodes.forEach((node, i) => {
			if (!visible[i]) {
				return;
			}
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
			if (!visible[i] || a.pinned || a.selected) {
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

	private applySprings(visible: boolean[]): void {
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			// Only links whose endpoints are both drawn exert a pull, so a hidden
			// neighbour can neither yank nor spring the visible subset.
			if (!visible[l.a] || !visible[l.b]) {
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

	private applyCenter(visible: boolean[]): void {
		for (let i = 0; i < this.nodes.length; i++) {
			const node = this.nodes[i]!;
			if (!visible[i] || node.pinned || node.selected) {
				continue;
			}
			node.vx += (0 - node.x) * PHYS.center;
			node.vy += (0 - node.y) * PHYS.center;
		}
	}

	private applyRepulsion3D(visible: boolean[]): void {
		const { nodes } = this;
		const cellSize = PHYS.cellSize * this.scale;
		for (let i = 0; i < nodes.length; i++) {
			const a = nodes[i]!;
			if (!visible[i] || a.pinned || a.selected) {
				continue;
			}
			for (let j = i + 1; j < nodes.length; j++) {
				const b = nodes[j]!;
				if (!visible[j] || b.pinned || b.selected) {
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

	private applySprings3D(visible: boolean[]): void {
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b) {
				continue;
			}
			if (!visible[l.a] || !visible[l.b]) {
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

	private applyCenter3D(visible: boolean[]): void {
		for (let i = 0; i < this.nodes.length; i++) {
			const node = this.nodes[i]!;
			if (!visible[i] || node.pinned || node.selected) {
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

	// Recompute the diffraction layers here, once per frame rather than per node.
	// The stamp short-circuits unless the graph or the toggles changed.
	this.ensureScan();

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
					if (face.every(idx => this.isNodeVisible(this.nodes[idx]!))) {
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
					const sA = this.projectionScale(pA.z);
					const sB = this.projectionScale(pB.z);
					const sC = this.projectionScale(pC.z);
					if (!Number.isFinite(sA) || !Number.isFinite(sB) || !Number.isFinite(sC)) {
						continue;
					}
					const depth = (item.z + maxAbsZ) / (2 * maxAbsZ || 1);
					const opacity = Math.min(1.0, this.plugin.settings.facesOpacity * (0.3 + depth * 0.7));
					ctx.fillStyle = this.withAlpha(this.plugin.settings.facesColor, opacity);
					ctx.beginPath();
					ctx.moveTo(w / 2 + pA.x * sA, h / 2 + pA.y * sA);
					ctx.lineTo(w / 2 + pB.x * sB, h / 2 + pB.y * sB);
					ctx.lineTo(w / 2 + pC.x * sC, h / 2 + pC.y * sC);
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
				if (!this.isNodeVisible(node)) {
					continue;
				}
				const s = this.projectionScale(p.z);
				if (!Number.isFinite(s)) {
					continue;
				}
				const sx = w / 2 + p.x * s;
				const sy = h / 2 + p.y * s;
				const depth = (p.z + R) / (2 * R || 1);
				const isHighlighted = this.hoverIndex === i || highlighted.has(i);
				const isCandidate = this.candidateNodes.has(node.path);
				const isFaded = (this.hoverIndex >= 0 && !isHighlighted) || this.isNodeFadedByAnchors(i);
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
				// Diffraction ring. Strength drives alpha only — never radius, so a
				// scan layer cannot be mistaken for a change in node size, and the
				// projection maths stays untouched.
				const scanLayer = this.scanLayerAt(i);
				if (scanLayer) {
					const hue = SCAN_LAYER_COLORS[scanLayer.key] ?? SCAN_LAYER_COLORS.activation!;
					ctx.beginPath();
					ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
					ctx.strokeStyle = this.withAlpha(hue, 0.35 + 0.6 * scanLayer.strength);
					ctx.lineWidth = 1 + scanLayer.strength * 1.5;
					ctx.stroke();
				}
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
				if (!this.isNodeVisible(node)) {
					continue;
				}
				const s = this.projectionScale(p.z);
				if (!Number.isFinite(s)) {
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
				const labelAlpha = (0.35 + ((p.z + R) / (2 * R || 1)) * 0.65) * (this.isNodeFadedByAnchors(i) ? 0.2 : 1);
				ctx.fillStyle = this.withAlpha(this.labelColor, labelAlpha);
				ctx.fillText(node.label, w / 2 + p.x * s + this.nodeScreenRadius(node, p, maxAbsZ) + 3, h / 2 + p.y * s);
			}

			// Edges are drawn in the foreground so arrowheads stay visible over nodes.
			ctx.lineWidth = 1;
			for (const l of this.links) {
				const a = this.nodes[l.a];
				const b = this.nodes[l.b];
				const ra = rotated[l.a];
				const rb = rotated[l.b];
				if (!a || !b || !ra || !rb || !this.isNodeVisible(a) || !this.isNodeVisible(b)) {
					continue;
				}
				const sA = this.projectionScale(ra.z);
				const sB = this.projectionScale(rb.z);
				if (!Number.isFinite(sA) || !Number.isFinite(sB)) {
					continue;
				}
				const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
				const normZA = ra.z / maxAbsZ;
				const normZB = rb.z / maxAbsZ;
				const edgeNormZ = (normZA + normZB) / 2;
				ctx.globalAlpha = this.isNodeFadedByAnchors(l.a) || this.isNodeFadedByAnchors(l.b) ? 0.12 : 1;
				this.strokeArrowLine(
					w / 2 + ra.x * sA,
					h / 2 + ra.y * sA,
					this.nodeScreenRadius(a, ra, maxAbsZ, 12),
					w / 2 + rb.x * sB,
					h / 2 + rb.y * sB,
					this.nodeScreenRadius(b, rb, maxAbsZ, 12),
					l,
					this.edgeStroke(l, sel, highlighted, distances, edgeNormZ),
				);
			}
			ctx.globalAlpha = 1;
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
			this.drawAnchors();
			return;
		}

		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		for (const node of this.nodes) {
			if (!this.isNodeVisible(node)) {
				continue;
			}
			const i = this.nodes.indexOf(node);
			const sx = this.toScreenX(node.x);
			const sy = this.toScreenY(node.y);
			const isHighlighted = this.hoverIndex === i || highlighted.has(i);
			const isCandidate = this.candidateNodes.has(node.path);
			const isFaded = (this.hoverIndex >= 0 && !isHighlighted) || this.isNodeFadedByAnchors(i);
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
			const scanLayer2d = this.scanLayerAt(i);
			if (scanLayer2d) {
				const hue = SCAN_LAYER_COLORS[scanLayer2d.key] ?? SCAN_LAYER_COLORS.activation!;
				ctx.beginPath();
				ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
				ctx.strokeStyle = this.withAlpha(hue, 0.35 + 0.6 * scanLayer2d.strength);
				ctx.lineWidth = 1 + scanLayer2d.strength * 1.5;
				ctx.stroke();
			}
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
		for (let i = 0; i < this.nodes.length; i++) {
			const node = this.nodes[i]!;
			if (!this.isNodeVisible(node)) {
				continue;
			}
			ctx.fillStyle = this.isNodeFadedByAnchors(i) ? this.withAlpha(this.labelColor, 0.15) : this.labelColor;
			ctx.fillText(node.label, this.toScreenX(node.x) + node.radius + 3, this.toScreenY(node.y));
		}
		// Edges are drawn in the foreground so arrowheads stay visible over nodes.
		ctx.lineWidth = 1;
		for (const l of this.links) {
			const a = this.nodes[l.a];
			const b = this.nodes[l.b];
			if (!a || !b || !this.isNodeVisible(a) || !this.isNodeVisible(b)) {
				continue;
			}
			const sel = (a.selected ? 1 : 0) + (b.selected ? 1 : 0);
			ctx.globalAlpha = this.isNodeFadedByAnchors(l.a) || this.isNodeFadedByAnchors(l.b) ? 0.12 : 1;
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
		ctx.globalAlpha = 1;
		this.drawLiveSelection();
		this.drawSelectionArea();
		this.drawOriginIndicator();
		this.drawAnchors();
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
			const s = this.projectionScale(rotated.z);
			const w = this.canvas?.clientWidth ?? 800;
			const h = this.canvas?.clientHeight ?? 600;
			return { x: w / 2 + rotated.x * s, y: h / 2 + rotated.y * s };
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
			{ ...node, content: entry?.content, relDescs: entry?.relDescs },
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
		];
		if (preview.relDescs && preview.relDescs.length > 0) {
			for (const d of preview.relDescs) {
				lines.push({ text: `• ${d}`, font: bodyFont, dim: true });
			}
		}
		lines.push({ text: preview.contentSnippet, font: bodyFont, dim: true });

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
			{ ...node, content: entry.content, relDescs: entry.relDescs },
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

		// Add relationship descriptions if any
		if (previewData.relDescs && previewData.relDescs.length > 0) {
			const relText = previewData.relDescs.map(desc => `• ${desc}`).join('\n');
			this.activePreviewCard.createDiv({ cls: "sh-preview-relationships", text: relText });
		}
		
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
		// Under perspective the projection already carries the depth scaling, so
		// use it directly instead of the stylistic orthographic depth cue.
		if (this.is3D && this.isPerspective) {
			const s = this.projectionScale(p.z);
			if (!Number.isFinite(s)) {
				return 0;
			}
			return Math.max(3, node.radius * s) + buffer;
		}
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
				const s = this.projectionScale(r.z);
				if (!Number.isFinite(s)) {
					continue;
				}
				const w = this.canvas?.clientWidth ?? 800;
				const h = this.canvas?.clientHeight ?? 600;
				sx = w / 2 + r.x * s;
				sy = h / 2 + r.y * s;
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
			const cxTrack = w / 2;
			const cyTrack = h - 35;
			const rx = 20;
			const ry = 7;

			ctx.save();
			ctx.strokeStyle = this.withAlpha(this.nodeColor, 0.85);
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.ellipse(cxTrack, cyTrack, rx, ry, 0, 0, Math.PI * 2);
			ctx.stroke();

			const dotSx = cxTrack + rx * Math.cos(-this.totalSpin);
			const dotSy = cyTrack + ry * Math.sin(-this.totalSpin);
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

		// Always draw the prime frame gizmo (x'/y'/z' axes at canvas centre).
		// This is independent of the "Show indicators" setting.
		this.drawPrimeFrameGizmo();

		if (!this.plugin.settings.showRotationCenter) {
			return;
		}

		if (this.is3D) {
			const origin = this.rotatePoint(0, 0, 0, this.target[0], this.target[1], this.target[2]);
			const originScale = this.projectionScale(origin.z);
			const ix = this.toScreenX(origin.x, origin.z);
			const iy = this.toScreenY(origin.y, origin.z);
			if (!Number.isFinite(originScale)) {
				return;
			}

			const s = 24;
			const BLUE = '#43AA8B';

			const worldX = this.rotatePoint(1, 0, 0, 0, 0, 0);
			const worldY = this.rotatePoint(0, 1, 0, 0, 0, 0);
			const worldZ = this.rotatePoint(0, 0, 1, 0, 0, 0);

			const axes: Array<{ v: { x: number; y: number }; label: string }> = [
				{ v: { x: worldX.x, y: worldX.y }, label: 'x' },
				{ v: { x: worldY.x, y: worldY.y }, label: 'y' },
				{ v: { x: worldZ.x, y: worldZ.y }, label: 'z' },
			];

			ctx.save();
			ctx.strokeStyle = BLUE;
			ctx.fillStyle = BLUE;
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.font = '10px var(--font-interface)';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			ctx.beginPath();
			ctx.arc(ix, iy, 3, 0, Math.PI * 2);
			ctx.fill();
			ctx.beginPath();
			ctx.arc(ix, iy, 6.5, 0, Math.PI * 2);
			ctx.stroke();

			for (const ax of axes) {
				const vx = ax.v.x;
				const vy = ax.v.y;
				const len = Math.hypot(vx, vy);

				if (len < 0.001) {
					ctx.beginPath();
					ctx.arc(ix, iy, 3, 0, Math.PI * 2);
					ctx.fill();
					ctx.beginPath();
					ctx.arc(ix, iy, 6.5, 0, Math.PI * 2);
					ctx.stroke();
					ctx.fillText(ax.label, ix + 12, iy + 12);
					continue;
				}

				const ex = vx / len;
				const ey = vy / len;
				const tx = ix + ex * s;
				const ty = iy + ey * s;

				ctx.beginPath();
				ctx.moveTo(ix, iy);
				ctx.lineTo(tx, ty);
				ctx.stroke();

				const head = 6;
				const px = -ey;
				const py = ex;

				ctx.beginPath();
				ctx.moveTo(tx, ty);
				ctx.lineTo(tx - ex * head + px * head * 0.55, ty - ey * head + py * head * 0.55);
				ctx.lineTo(tx - ex * head - px * head * 0.55, ty - ey * head - py * head * 0.55);
				ctx.closePath();
				ctx.fill();

				ctx.fillText(ax.label, ix + ex * (s + 9), iy + ey * (s + 9));
			}
			ctx.restore();
		}

		this.drawLeftXAxisIndicator();

		if (this.is3D) {
			const cx = w / 2;
			const cy = h / 2;
			const gap = 8;
			const len = 8;

			ctx.save();
			ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(cx, cy - gap - len);
			ctx.lineTo(cx, cy - gap);
			ctx.moveTo(cx, cy + gap);
			ctx.lineTo(cx, cy + gap + len);
			ctx.moveTo(cx - gap - len, cy);
			ctx.lineTo(cx - gap, cy);
			ctx.moveTo(cx + gap, cy);
			ctx.lineTo(cx + gap + len, cy);
			ctx.stroke();
			ctx.restore();
		}

		if (!this.is3D) {
			const cx = w / 2;
			const cy = h / 2;
			const s = 24;
			const BLUE = '#43AA8B';

			ctx.save();
			ctx.strokeStyle = BLUE;
			ctx.fillStyle = BLUE;
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.font = '10px var(--font-interface)';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';

			const draw2DAxis = (ex: number, ey: number, label: string): void => {
				const tx = cx + ex * s;
				const ty = cy + ey * s;
				ctx.beginPath();
				ctx.moveTo(cx, cy);
				ctx.lineTo(tx, ty);
				ctx.stroke();

				const head = 6;
				const px = -ey;
				const py = ex;

				ctx.beginPath();
				ctx.moveTo(tx, ty);
				ctx.lineTo(tx - ex * head + px * head * 0.55, ty - ey * head + py * head * 0.55);
				ctx.lineTo(tx - ex * head - px * head * 0.55, ty - ey * head - py * head * 0.55);
				ctx.closePath();
				ctx.fill();

				ctx.fillText(label, cx + ex * (s + 9), cy + ey * (s + 9));
			};

			draw2DAxis(1, 0, 'x');
			draw2DAxis(0, 1, 'y');
			ctx.restore();
		}
	}

	/**
	 * Live red gizmo for the prime frame (x′, y′, z′), anchored at the focal
	 * point. +x′ is R_v (row 0), +y′ is U_v = −Ũ_v (−row 1), +z′ is F (row 2).
	 * Recomputed every frame from {@link rotM}, so it reflects the current
	 * frame — but note the prime frame is defined relative to the camera, so
	 * on screen +x′ is always screen-right, +y′ screen-up and +z′ into the
	 * screen; it cannot tilt. Only the world triad (drawn grey) animates.
	 */
	private drawPrimeFrameGizmo(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas || !this.is3D) {
			return;
		}
		// The focal point maps to the view origin, which is the canvas centre.
		const cx = (canvas.clientWidth ?? 800) / 2;
		const cy = (canvas.clientHeight ?? 600) / 2;
		const m = this.rotM;
		const s = 30;
		const RED = '#FF3B30';

		const axes: Array<{ v: [number, number, number]; label: string }> = [
			{ v: [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0], label: "x′" },
			{ v: [-(m[3] ?? 0), -(m[4] ?? 0), -(m[5] ?? 0)], label: "y′" },
			{ v: [m[6] ?? 0, m[7] ?? 0, m[8] ?? 0], label: "z′" },
		];

		ctx.save();
		ctx.strokeStyle = RED;
		ctx.fillStyle = RED;
		ctx.lineWidth = 2;
		ctx.lineCap = 'round';
		ctx.font = '10px var(--font-interface)';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		for (const ax of axes) {
			// Project the world direction into view coords, then to screen.
			const vx = (m[0] ?? 0) * ax.v[0] + (m[1] ?? 0) * ax.v[1] + (m[2] ?? 0) * ax.v[2];
			const vy = (m[3] ?? 0) * ax.v[0] + (m[4] ?? 0) * ax.v[1] + (m[5] ?? 0) * ax.v[2];
			const len = Math.hypot(vx, vy);

			if (len < 0.001) {
				// Axis points straight at/away from the viewer: dot + ring.
				ctx.beginPath();
				ctx.arc(cx, cy, 3, 0, Math.PI * 2);
				ctx.fill();
				ctx.beginPath();
				ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
				ctx.stroke();
				ctx.fillText(ax.label, cx + 12, cy + 12);
				continue;
			}

			const ex = vx / len;
			const ey = vy / len;
			const tx = cx + ex * s;
			const ty = cy + ey * s;

			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.lineTo(tx, ty);
			ctx.stroke();

			// Arrowhead at the tip.
			const head = 6;
			const px = -ey;
			const py = ex;
			ctx.beginPath();
			ctx.moveTo(tx, ty);
			ctx.lineTo(tx - ex * head + px * head * 0.55, ty - ey * head + py * head * 0.55);
			ctx.lineTo(tx - ex * head - px * head * 0.55, ty - ey * head - py * head * 0.55);
			ctx.closePath();
			ctx.fill();

			ctx.fillText(ax.label, cx + ex * (s + 9), cy + ey * (s + 9));
		}
		ctx.restore();
	}

	private drawLeftXAxisIndicator(): void {
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas || !this.is3D) {
			return;
		}
		const h = canvas.clientHeight ?? 600;
		const cx = 60;
		const cy = h / 2;
		const rx = 7;
		const ry = 20;
		const color = this.nodeColor;

		ctx.save();
		ctx.strokeStyle = this.withAlpha(color, 0.85);
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
		ctx.stroke();

		const pitchRad = (this.primePitch * Math.PI) / 180;
		const dotSx = cx + rx * Math.cos(pitchRad);
		const dotSy = cy + ry * Math.sin(pitchRad);
		const dotRadius = 4.5;

		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(dotSx, dotSy, dotRadius, 0, Math.PI * 2);
		ctx.fill();
		ctx.strokeStyle = this.withAlpha(color, 0.8);
		ctx.lineWidth = 1.5;
		ctx.stroke();

		ctx.restore();
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
			if (this.is3D) {
				const degScale = 0.3;
				// Prime-frame rotation, same as the keyboard handler: θ′ about
				// y′, φ′ about x′; θ and φ stay derived.
				this.applyRotationDeltas(ddx * degScale, -ddy * degScale);
				this.totalSpin += ddx * 0.005;
			} else {
				const sensitivity = 0.005;
				this.rotateAboutAxis([0, 1, 0], ddx * sensitivity);
				this.rotateAboutAxis([1, 0, 0], -ddy * sensitivity);
				this.totalSpin += ddx * sensitivity;
			}
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
				const desiredRx = this.toWorldX(sx, rOld.z);
				const desiredRy = this.toWorldY(sy, rOld.z);
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
				// The 2D projection is axis-aligned — toScreenX/toScreenY ignore
				// rotM — so each screen axis pans its own world axis and the two are
				// handled separately. Projecting both through the rotM rows fed the
				// vertical term through the negated up row (-U_v), which inverted
				// drag up/down, and sent the pan diagonal once the view had been
				// rotated. Drag moves the content with the cursor: dragging up
				// raises viewY, so content rises.
				this.viewX = this.panViewX - dScreenX;
				this.viewY = this.panViewY - dScreenY;
				const w = this.canvas?.clientWidth ?? 1;
				const h = this.canvas?.clientHeight ?? 1;
				this.rotCx = this.viewX + w / (2 * this.viewScale);
				this.rotCy = this.viewY + h / (2 * this.viewScale);
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
			this.endGroupDrag();
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
		this.wake();
		if (this.peekActive) {
			return;
		}
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
		if (this.revealAnchors) {
			// Reveal mode is anchor-placement mode: anchors take priority over
			// nodes, and empty space clears both selections and pans.
			const ai = this.hitTestAnchor(e.clientX, e.clientY);
			if (ai >= 0) {
				this.beginAnchorDrag(e, ai);
				return;
			}
			this.selectedAnchor = -1;
			this.clearSelection();
			this.pointerDown = true;
			this.downX = e.clientX;
			this.downY = e.clientY;
			this.panning = true;
			this.panStartX = e.clientX;
			this.panStartY = e.clientY;
			this.panViewX = this.viewX;
			this.panViewY = this.viewY;
			this.panTarget = [...this.target] as [number, number, number];
			this.canvas?.setPointerCapture(e.pointerId);
			this.markViewAdjusted();
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
			this.panTarget = [...this.target] as [number, number, number];
			this.canvas?.setPointerCapture(e.pointerId);
			this.markViewAdjusted();
		}
		this.hoverIndex = idx;
	};

	private onPointerMove = (e: PointerEvent): void => {
		this.wake();
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

		if (this.anchorDragging) {
			this.moveAnchorDrag(e);
			this.markViewAdjusted();
			return;
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
			if (this.is3D) {
				const degScale = 0.3;
				// Prime-frame rotation, same as the keyboard handler: θ′ about
				// y′, φ′ about x′; θ and φ stay derived.
				this.applyRotationDeltas(ddx * degScale, -ddy * degScale);
				this.totalSpin += ddx * 0.005;
			} else {
				const sensitivity = 0.005;
				this.rotateAboutAxis([0, 1, 0], ddx * sensitivity);
				this.rotateAboutAxis([1, 0, 0], -ddy * sensitivity);
				this.totalSpin += ddx * sensitivity;
			}
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
				const desiredRx = this.toWorldX(sx, rOld.z);
				const desiredRy = this.toWorldY(sy, rOld.z);
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
				// The 2D projection is axis-aligned — toScreenX/toScreenY ignore
				// rotM — so each screen axis pans its own world axis and the two are
				// handled separately. Projecting both through the rotM rows fed the
				// vertical term through the negated up row (-U_v), which inverted
				// drag up/down, and sent the pan diagonal once the view had been
				// rotated. Drag moves the content with the cursor: dragging up
				// raises viewY, so content rises.
				this.viewX = this.panViewX - dScreenX;
				this.viewY = this.panViewY - dScreenY;
				const w = this.canvas?.clientWidth ?? 1;
				const h = this.canvas?.clientHeight ?? 1;
				this.rotCx = this.viewX + w / (2 * this.viewScale);
				this.rotCy = this.viewY + h / (2 * this.viewScale);
			}
			this.markViewAdjusted();
			return;
		}
		if (this.revealAnchors) {
			this.hoverIndex = -1;
			this.hoveredAnchor = this.hitTestAnchor(e.clientX, e.clientY);
		} else {
			this.hoveredAnchor = -1;
			this.hoverIndex = this.hitTest(e);
		}
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
		this.wake();
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
		if (this.anchorDragging) {
			this.endAnchorDrag();
			return;
		}
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
			this.endGroupDrag();
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
		// Node selection and anchor selection are mutually exclusive.
		this.selectedAnchor = -1;
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
		// Clearing the node selection also clears any anchor selection, so the
		// two can never be live at once.
		this.selectedAnchor = -1;
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
		const cw = this.canvas?.clientWidth ?? 800;
		const ch = this.canvas?.clientHeight ?? 600;
		this.nodes.forEach((node, i) => {
			const r = this.rotatePoint(node.x, node.y, node.z, this.target[0], this.target[1], this.target[2]);
			const s = this.projectionScale(r.z);
			if (!Number.isFinite(s)) {
				return;
			}
			const sx = cw / 2 + r.x * s;
			const sy = ch / 2 + r.y * s;
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

	/**
	 * Release a group drag, committing the dropped positions as the new homes.
	 *
	 * The settled home spring skips `node.selected`, so a dragged group holds
	 * its new position only while it is selected. If the drop does not become
	 * the home, deselecting hands the group back to a spring still anchored at
	 * the pre-drag position and it snaps back with nothing visibly pulling it.
	 * Committing the home here is what makes a manual placement stick, and it
	 * matches what `endAnchorDrag` already does for anchor drags.
	 */
	private endGroupDrag(): void {
		// Note: we do NOT overwrite homeX/homeY/homeZ here.
		// The home spring will pull nodes back to their initial positions
		// (set during graph build), so deselecting after a group drag will
		// make the selected nodes snap back, while the rest of the hologram
		// nodes stay in place — matching the pre-13882b2 behavior.
		this.groupDragging = false;
		this.groupOrigins.clear();
		this.groupStartCentroid = null;
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
		// Split/merge is suppressed while anchors are revealed, so an anchor
		// placement can never accidentally trigger a hologram edit.
		if (sd <= 0 || this.splitPromptOpen || this.dragSplitHandled || this.revealAnchors) {
			return;
		}
		if (this.selected.size === 0 || this.selected.size >= this.nodes.length) {
			return;
		}
		const selCentroid = this.centroidOf(this.selected);
		const restC = this.centroidOfRest();
		if (restC) {
			const dRest = this.dist3(selCentroid, restC);
			const movingOut = dRest > sd && dRest > this.lastRestDistance + 1;
			// Dragging a set that is already a whole hologram (or whole holograms)
			// away from another splits nothing — they were separate to begin with,
			// so there is no new hologram to name. Fall through to the merge check,
			// which still applies when the drag carries them toward another one.
			if (movingOut && !this.selectionIsWholeHolograms()) {
				this.dragSplitHandled = true;
				void this.beginSplit();
				return;
			}
			this.lastRestDistance = dRest;
		}

		this.maybeMergeIntoHologram(selCentroid);
	}

	private nodeMatchesTags(node: GraphNode, tags: string[]): boolean {
		if (!tags || tags.length === 0) {
			return true;
		}
		const nodeTags = this.plugin.hologramService.getTags(node.path);
		return [...nodeTags].some((t) => tags.includes(t));
	}

	private nodeMatchesSelectedHolograms(node: GraphNode): boolean {
		return this.nodeMatchesTags(node, this.plugin.settings.selectedHolograms);
	}

	/** Visibility used by draw(): a live peek overrides the persisted filter without writing it. */
	private isNodeVisible(node: GraphNode): boolean {
		return this.peekActive
			? this.nodeMatchesTags(node, this.peekTags)
			: this.nodeMatchesSelectedHolograms(node);
	}

	/** Tags carried by any selected node. */
	private selectedHologramTags(): Set<string> {
		const tags = new Set<string>();
		for (const i of this.selected) {
			const node = this.nodes[i];
			if (node) {
				for (const t of this.plugin.hologramService.getTags(node.path)) {
					tags.add(t);
				}
			}
		}
		return tags;
	}

	/**
	 * True when the selection is already the *whole* of every hologram it
	 * touches: for each tag represented in the selection, no node carrying that
	 * tag is left behind.
	 *
	 * Such a set cannot be split. Moving it away from another hologram changes
	 * no membership — the two are already separate — so asking for a name for a
	 * "new" hologram would be wrong. A split is only meaningful when the
	 * selection is a proper part of a hologram, or carries no hologram tag at
	 * all, and those return false here.
	 */
	private selectionIsWholeHolograms(): boolean {
		const tags = this.selectedHologramTags();
		if (tags.size === 0) {
			return false;
		}
		for (let i = 0; i < this.nodes.length; i++) {
			const node = this.nodes[i];
			if (!node || this.selected.has(i)) {
				continue;
			}
			const nodeTags = this.plugin.hologramService.getTags(node.path);
			for (const t of tags) {
				if (nodeTags.has(t)) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Rebuild the hologram anchor groups from the current tag graph. Tags on the
	 * same node are unioned (an emulsified bridge carries two tags, so its two
	 * holograms share one anchor); every resulting component becomes one anchor.
	 * Nodes with no hologram tag belong to no anchor.
	 */
	private rebuildAnchors(): void {
		const tagsOf = new Map<number, string[]>();
		const allTags = new Set<string>();
		for (let i = 0; i < this.nodes.length; i++) {
			const node = this.nodes[i];
			if (!node) {
				continue;
			}
			const tags = [...this.plugin.hologramService.getTags(node.path)];
			if (tags.length === 0) {
				continue;
			}
			tagsOf.set(i, tags);
			for (const t of tags) {
				allTags.add(t);
			}
		}

		const parent = new Map<string, string>();
		const find = (x: string): string => {
			let r = parent.get(x) ?? x;
			while (r !== (parent.get(r) ?? r)) {
				r = parent.get(r) ?? r;
			}
			return r;
		};
		const union = (a: string, b: string): void => {
			const ra = find(a);
			const rb = find(b);
			if (ra !== rb) {
				parent.set(ra, rb);
			}
		};
		for (const t of allTags) {
			parent.set(t, t);
		}
		for (const tags of tagsOf.values()) {
			for (let k = 1; k < tags.length; k++) {
				union(tags[0]!, tags[k]!);
			}
		}

		const groups = new Map<string, { tags: Set<string>; nodeIndices: number[] }>();
		for (const [i, tags] of tagsOf) {
			const root = find(tags[0]!);
			let g = groups.get(root);
			if (!g) {
				g = { tags: new Set(), nodeIndices: [] };
				groups.set(root, g);
			}
			for (const t of tags) {
				g.tags.add(t);
			}
			g.nodeIndices.push(i);
		}

		this.anchorGroups = [...groups].map(([root, g]) => ({
			id: root,
			tags: [...g.tags].sort(),
			nodeIndices: g.nodeIndices,
		}));
		this.anchorMember.clear();
		for (const g of this.anchorGroups) {
			for (const i of g.nodeIndices) {
				this.anchorMember.add(i);
			}
		}
		if (this.selectedAnchor >= this.anchorGroups.length) {
			this.selectedAnchor = -1;
		}
		if (this.hoveredAnchor >= this.anchorGroups.length) {
			this.hoveredAnchor = -1;
		}
	}

	private anchorCentroid(g: AnchorGroup): { x: number; y: number; z: number } {
		return this.centroidOf(g.nodeIndices);
	}

	/**
	 * The temporary union anchor for a multi-hologram selection: one centroid
	 * spanning every node of every selected hologram, so the whole selection can
	 * be dragged (and probed) as a single body. Null unless 2+ holograms are
	 * selected.
	 */
	private unionAnchor(): AnchorGroup | null {
		const sel = this.plugin.settings.selectedHolograms;
		if (!sel || sel.length < 2) {
			return null;
		}
		const nodeIndices: number[] = [];
		for (let i = 0; i < this.nodes.length; i++) {
			const n = this.nodes[i];
			if (n && this.nodeMatchesSelectedHolograms(n)) {
				nodeIndices.push(i);
			}
		}
		if (nodeIndices.length === 0) {
			return null;
		}
		return { id: '__union__', tags: [...sel], nodeIndices };
	}

	/**
	 * The anchor list currently shown and selectable: the per-hologram groups,
	 * with every group touched by a multi-hologram selection replaced by the
	 * single temporary union anchor for that selection.
	 */
	private activeAnchors(): AnchorGroup[] {
		const sel = this.plugin.settings.selectedHolograms;
		if (!sel || sel.length < 2) {
			return this.anchorGroups;
		}
		const selSet = new Set(sel);
		const rest = this.anchorGroups.filter((g) => !g.tags.some((t) => selSet.has(t)));
		const union = this.unionAnchor();
		return union ? [...rest, union] : rest;
	}

	/** True when reveal mode should dim this node (not a member of any anchor). */
	private isNodeFadedByAnchors(index: number): boolean {
		return this.revealAnchors && this.anchorMember.size > 0 && !this.anchorMember.has(index);
	}

	/** Screen position (and rotated depth) of an anchor's live centroid. */
	private anchorScreen(g: AnchorGroup): { x: number; y: number; sx: number; sy: number; z: number } {
		const c = this.anchorCentroid(g);
		if (this.is3D) {
			const r = this.rotatePoint(c.x, c.y, c.z, this.target[0], this.target[1], this.target[2]);
			return { x: c.x, y: c.y, sx: this.toScreenX(r.x, r.z), sy: this.toScreenY(r.y, r.z), z: r.z };
		}
		return { x: c.x, y: c.y, sx: this.toScreenX(c.x), sy: this.toScreenY(c.y), z: 0 };
	}

	/** Depth-resolved anchor picking: nearest anchor within range wins. */
	private hitTestAnchor(clientX: number, clientY: number): number {
		if (!this.canvas || !this.revealAnchors) {
			return -1;
		}
		const rect = this.canvas.getBoundingClientRect();
		const x = clientX - rect.left;
		const y = clientY - rect.top;
		let best = -1;
		let bestZ = -Infinity;
		this.activeAnchors().forEach((g, gi) => {
			const s = this.anchorScreen(g);
			if (Math.hypot(s.sx - x, s.sy - y) <= ANCHOR_RADIUS + 4 && s.z > bestZ) {
				bestZ = s.z;
				best = gi;
			}
		});
		return best;
	}

	private beginAnchorDrag(e: PointerEvent, gi: number): void {
		const g = this.activeAnchors()[gi];
		if (!g) {
			return;
		}
		this.clearSelection();
		this.selectedAnchor = gi;
		this.anchorDragging = true;
		this.anchorDragStartX = e.clientX;
		this.anchorDragStartY = e.clientY;
		// Freeze the screen-parallel basis at drag start so the whole drag stays
		// in one x'y' plane even if the user rotates mid-drag.
		this.anchorDragBasis = [...this.rotM];
		const anchorDepth = this.anchorScreen(g).z;
		const anchorScale = this.projectionScale(anchorDepth);
		this.anchorDragScale = Number.isFinite(anchorScale) && anchorScale > 0 ? anchorScale : 0;
		this.anchorDragOrigins.clear();
		for (const i of g.nodeIndices) {
			const n = this.nodes[i];
			if (!n) {
				continue;
			}
			this.anchorDragOrigins.set(i, { x: n.x, y: n.y, z: n.z });
			n.pinned = true;
			n.vx = 0;
			n.vy = 0;
			n.vz = 0;
		}
		this.canvas?.setPointerCapture(e.pointerId);
		this.pointerDown = true;
		this.updateCursor();
	}

	private moveAnchorDrag(e: PointerEvent): void {
		if (!this.canvas) {
			return;
		}
		const vs = (this.is3D && this.anchorDragScale > 0 ? this.anchorDragScale : this.viewScale) || 1;
		const dsx = (e.clientX - this.anchorDragStartX) / vs;
		const dsy = (e.clientY - this.anchorDragStartY) / vs;
		let dx = dsx;
		let dy = dsy;
		let dz = 0;
		const m = this.anchorDragBasis;
		if (this.is3D && m) {
			dx = (m[0] ?? 1) * dsx + (m[3] ?? 0) * dsy;
			dy = (m[1] ?? 0) * dsx + (m[4] ?? 1) * dsy;
			dz = (m[2] ?? 0) * dsx + (m[5] ?? 0) * dsy;
		}
		for (const [i, orig] of this.anchorDragOrigins) {
			const n = this.nodes[i];
			if (!n) {
				continue;
			}
			n.x = orig.x + dx;
			n.y = orig.y + dy;
			n.z = orig.z + dz;
			n.vx = 0;
			n.vy = 0;
			n.vz = 0;
		}
	}

	/** Release the anchor drag, un-pin the members, and commit their new homes. */
	private endAnchorDrag(): void {
		for (const i of this.anchorDragOrigins.keys()) {
			const n = this.nodes[i];
			if (!n) {
				continue;
			}
			n.pinned = false;
			n.homeX = n.x;
			n.homeY = n.y;
			n.homeZ = n.z;
			n.homeSet = true;
		}
		this.anchorDragging = false;
		this.anchorDragOrigins.clear();
		this.anchorDragBasis = null;
		this.pointerDown = false;
		this.updateCursor();
	}

	private drawAnchors(): void {
		if (!this.revealAnchors) {
			return;
		}
		const anchors = this.activeAnchors();
		if (anchors.length === 0) {
			return;
		}
		const ctx = this.ctx;
		const canvas = this.canvas;
		if (!ctx || !canvas) {
			return;
		}
		// Reveal mode fades the non-member graph at node-draw time, so anchored
		// holograms stay crisp while everything else dims — no scrim overlay.
		ctx.save();
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		const items = anchors.map((g, i) => {
			const s = this.anchorScreen(g);
			return { i, g, sx: s.sx, sy: s.sy, z: s.z };
		});
		items.sort((a, b) => a.z - b.z);
		for (const it of items) {
			const isUnion = it.g.id === '__union__';
			const selected = this.selectedAnchor === it.i;
			const hovered = this.hoveredAnchor === it.i;
			const color = selected ? ANCHOR_SELECTED_COLOR : (isUnion ? ANCHOR_UNION_COLOR : ANCHOR_COLOR);
			const rad = ANCHOR_RADIUS + (isUnion ? 4 : 0) + (hovered || selected ? 3 : 0);
			ctx.beginPath();
			ctx.arc(it.sx, it.sy, rad, 0, Math.PI * 2);
			ctx.fillStyle = this.withAlpha(color, 0.18);
			ctx.fill();
			ctx.lineWidth = isUnion ? 3 : 2;
			ctx.strokeStyle = color;
			if (isUnion) {
				ctx.setLineDash([6, 4]);
			}
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.beginPath();
			ctx.arc(it.sx, it.sy, 3, 0, Math.PI * 2);
			ctx.fillStyle = color;
			ctx.fill();
			ctx.font = isUnion ? '600 11px var(--font-interface)' : '11px var(--font-interface)';
			ctx.fillStyle = this.withAlpha(color, 0.95);
			ctx.fillText((isUnion ? '\u222a ' : '') + it.g.tags.join(' + '), it.sx + rad + 4, it.sy);
		}
		ctx.restore();
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
		this.wake();
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
		this.wake();
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
				let count = 0;
				for (let i = 0; i < this.nodes.length; i++) {
					const node = this.nodes[i];
					if (!node || !this.isNodeVisible(node)) {
						continue;
					}
					this.selected.add(i);
					count++;
				}
				this.showToast(`Selected all ${count} nodes`);
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
		} else if (key === 'p' && !e.repeat) {
			e.preventDefault();
			this.toggleProjection();
		} else if (key === 'a' && !e.repeat) {
			// Hold to reveal hologram anchors for placement. Rebuild on reveal
			// so membership matches the current tag graph.
			if (!this.revealAnchors) {
				this.rebuildAnchors();
				this.revealAnchors = true;
				this.updateCursor();
			}
		} else if (key === 'c') {
			this.centerSelectedOnOrigin();
		} else if (e.key === 'Delete' && !e.repeat) {
			e.preventDefault();
			void this.deleteSelectedNodes();
		} else if (key === 'f' && e.shiftKey) {
			if (this.peekActive) {
				this.commitHologramPeek();
			} else {
				this.fitToView();
			}
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
		let count = 0;

		if (this.selected.size > 0) {
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
		} else if (this.plugin.settings.selectedHolograms.length > 0) {
			for (const n of this.nodes) {
				if (!this.nodeMatchesSelectedHolograms(n)) {
					continue;
				}
				tx += n.x;
				ty += n.y;
				tz += n.z;
				count++;
			}
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
			count = 1;
		}

		if (count === 0) {
			return;
		}

		tx /= count;
		ty /= count;
		tz /= count;

		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w === 0 || h === 0) {
			return;
		}

		if (this.is3D) {
			this.target = [tx, ty, tz];
		} else {
			this.viewX = tx - w / (2 * this.viewScale);
			this.viewY = ty - h / (2 * this.viewScale);
		}
		this.markViewAdjusted();
	}

	/** Resolve true only after both confirmation stages are accepted. */
	private confirmNodeDeletion(targets: DeleteTarget[]): Promise<boolean> {
		return new Promise((resolve) => {
			let settled = false;
			const settle = (ok: boolean): void => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(ok);
			};
			new DeleteNodesModal(this.app, targets, (ok) => {
				if (!ok) {
					settle(false);
					return;
				}
				new DeleteNodesConfirmModal(this.app, targets, settle).open();
			}).open();
		});
	}

	private async deleteSelectedNodes(): Promise<void> {
		const targets: DeleteTarget[] = [];
		const seen = new Set<string>();
		for (const i of this.selected) {
			const node = this.nodes[i];
			if (!node || seen.has(node.path)) {
				continue;
			}
			const file = this.app.vault.getAbstractFileByPath(node.path);
			if (!(file instanceof TFile)) {
				continue;
			}
			seen.add(node.path);
			targets.push({
				file,
				title: node.label || file.basename,
				holograms: [...this.plugin.hologramService.getTags(node.path)].sort((a, b) => a.localeCompare(b)),
			});
		}
		if (targets.length === 0) {
			this.showToast('No selected nodes to delete');
			return;
		}

		if (!(await this.confirmNodeDeletion(targets))) {
			return;
		}

		let deleted = 0;
		const failures: string[] = [];
		for (const t of targets) {
			try {
				await this.app.vault.trash(t.file, true);
				deleted++;
			} catch (err) {
				failures.push(`${t.file.path}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}

		this.selected.clear();
		for (const node of this.nodes) {
			node.selected = false;
		}
		this.hoverIndex = -1;
		this.pinnedIndex = -1;
		await this.plugin.refreshIncomingRelationships();
		await this.plugin.refreshGraphs();

		if (failures.length > 0) {
			this.showToast(`Trashed ${deleted}; failed ${failures.length} (${failures[0]})`);
		} else {
			this.showToast(`Moved ${deleted} note${deleted === 1 ? '' : 's'} to trash`);
		}
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
			'<div class="sh-help-section">Keyboard</div>' +
			'<div class="sh-help-row"><span class="sh-help-key">h</span><span class="sh-help-desc">hold: show help</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+f</span><span class="sh-help-desc">focus node search</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+a</span><span class="sh-help-desc">select all visible nodes</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+z</span><span class="sh-help-desc">undo</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+Shift+z / Ctrl+y</span><span class="sh-help-desc">redo</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">c</span><span class="sh-help-desc">center hovered / selected node(s) on rotation origin</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Delete</span><span class="sh-help-desc">delete selected nodes (notes to trash, confirmed twice)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">1</span><span class="sh-help-desc">flip view 180°</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">f</span><span class="sh-help-desc">toggle faces (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+f</span><span class="sh-help-desc">fit graph to view; while previewing a hologram: keep that view</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">r</span><span class="sh-help-desc">cycle rotation: off → clockwise → counter-clockwise</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+r</span><span class="sh-help-desc">reset view to initial state</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+=</span><span class="sh-help-desc">fit graph to view</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+Shift+=</span><span class="sh-help-desc">magnify (dolly in 3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+-</span><span class="sh-help-desc">demagnify (dolly in 3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">s</span><span class="sh-help-desc">hold: box/lasso select, tap: select hovered node / candidates</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">a</span><span class="sh-help-desc">hold: reveal hologram anchors, drag one to place its hologram</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+s</span><span class="sh-help-desc">toggle split mode: move / copy</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+m</span><span class="sh-help-desc">toggle merge mode: absorb / emulsify</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">p</span><span class="sh-help-desc">toggle projection: perspective / orthographic (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">← ↑ ↓ →</span><span class="sh-help-desc">pan</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+arrows</span><span class="sh-help-desc">rotate about the focal point (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Space</span><span class="sh-help-desc">stop auto-rotation</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">PrtSc</span><span class="sh-help-desc">copy screenshot to clipboard</span></div>' +
			'<div class="sh-help-section">Mouse</div>' +
			'<div class="sh-help-row"><span class="sh-help-key">drag</span><span class="sh-help-desc">pan background / move node / move selection</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+drag</span><span class="sh-help-desc">3D rotate about focal point (3D mode only)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">middle-drag</span><span class="sh-help-desc">3D rotate about focal point</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">s + drag</span><span class="sh-help-desc">box select (2D) / lasso select (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+click</span><span class="sh-help-desc">toggle node selection</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Ctrl+hover</span><span class="sh-help-desc">preview node / relationship card</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">scroll</span><span class="sh-help-desc">magnify / demagnify (standoff, focal-point centred)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">Shift+scroll</span><span class="sh-help-desc">dolly the camera along the line of sight (3D)</span></div>' +
			'<div class="sh-help-row"><span class="sh-help-key">click bg</span><span class="sh-help-desc">clear selection</span></div>' +
			'<div class="sh-help-section">Modes</div>' +
			'<div class="sh-help-desc">2D canvas / 3D projected — toggle via the upper-left icon or side panel.</div>' +
			'<div class="sh-help-desc">Projection (3D) perspective / orthographic — toggle via the second upper-left icon or P.</div>';
		this.helpOverlay = el;
	}

	private hideHelp(): void {
		if (this.helpOverlay) {
			this.helpOverlay.remove();
			this.helpOverlay = null;
		}
	}

	private onKeyUp = (e: KeyboardEvent): void => {
		this.wake();
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
				if (this.peekActive) {
					this.commitHologramPeek({ select: true });
				} else if (this.hoverIndex < 0 && this.candidateNodes.size > 0) {
					this.selectCandidates();
				} else {
					this.selectHovered();
				}
			}
			if (this.selecting) {
				this.finishSelection();
				this.selecting = false;
				this.selectLasso = [];
				this.pointerDown = false;
				this.clearOnUp = false;
			}
			this.updateCursor();
		} else if (e.key.toLowerCase() === 'a') {
			this.revealAnchors = false;
			this.hoveredAnchor = -1;
			if (this.anchorDragging) {
				this.endAnchorDrag();
			}
			this.updateCursor();
		} else if (e.key.startsWith('Arrow')) {
			this.pressedKeys.delete(e.key);
		}
	};

	/**
	 * A held key (or an in-flight gesture) whose keyup/pointerup fires while the
	 * window is unfocused would otherwise stick, keeping the demand-driven loop
	 * awake forever. Clear the transient input state and let the loop park.
	 */
	private onWindowBlur = (): void => {
		this.pressedKeys.clear();
		this.shiftDown = false;
		this.ctrlPressed = false;
		this.updateCursor();
	};

	private onWheel = (e: WheelEvent): void => {
		this.wake();
		e.preventDefault();
		if (this.peekActive) {
			return;
		}
		if (!this.canvas) {
			return;
		}
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
			// Plain scroll changes the standoff R — i.e. magnification about the
			// focal point. Shift-scroll instead travels the assembly along the
			// line of sight. In neither case does the cursor participate: there
			// is no zoom-to-cursor and no screen-plane compensation (docs 5.3-5.4).
			if (e.shiftKey) {
				this.dolly(-dy / 100);
			} else {
				this.setStandoff(Math.exp(-dy * PHYS.dollySpeed));
			}
			this.markViewAdjusted();
			return;
		}

		// 2D is a flat canvas, but magnification still anchors on the focal
		// point (the canvas centre) so that wheel, buttons and 3D dolly all
		// behave alike. The cursor does not participate.
		this.applyScaleAboutFocalPoint(Math.exp(-dy * PHYS.zoomSpeed));
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

			let sxA: number;
			let syA: number;
			let sxB: number;
			let syB: number;
			if (this.is3D) {
				const pA = this.rotatePoint(nA.x, nA.y, nA.z, this.target[0], this.target[1], this.target[2]);
				const pB = this.rotatePoint(nB.x, nB.y, nB.z, this.target[0], this.target[1], this.target[2]);
				const sA = this.projectionScale(pA.z);
				const sB = this.projectionScale(pB.z);
				if (!Number.isFinite(sA) || !Number.isFinite(sB)) {
					continue;
				}
				const cw = this.canvas.clientWidth;
				const ch = this.canvas.clientHeight;
				sxA = cw / 2 + pA.x * sA;
				syA = ch / 2 + pA.y * sA;
				sxB = cw / 2 + pB.x * sB;
				syB = ch / 2 + pB.y * sB;
			} else {
				sxA = this.toScreenX(nA.x);
				syA = this.toScreenY(nA.y);
				sxB = this.toScreenX(nB.x);
				syB = this.toScreenY(nB.y);
			}

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
		const canvas = this.canvas;
		const rect = canvas.getBoundingClientRect();
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
				const s = this.projectionScale(r.z);
				if (!Number.isFinite(s)) {
					return;
				}
				const sx = canvas.clientWidth / 2 + r.x * s;
				const sy = canvas.clientHeight / 2 + r.y * s;
				const rad = Math.max(3, node.radius * s);
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

	private snapshotCamera(): CameraSnapshot {
		return {
			target: [...this.target] as [number, number, number],
			rotM: [...this.rotM],
			cameraDistance: this.cameraDistance,
			baseCameraDistance: this.baseCameraDistance,
			viewScale: this.viewScale,
			viewX: this.viewX,
			viewY: this.viewY,
			camZ: this.camZ,
			totalSpin: this.totalSpin,
			primePitch: this.primePitch,
			userAdjustedView: this.userAdjustedView,
			autoFitCooldown: this.autoFitCooldown,
		};
	}

	private restoreCamera(s: CameraSnapshot): void {
		this.target = [...s.target] as [number, number, number];
		this.rotM = [...s.rotM];
		this.cameraDistance = s.cameraDistance;
		this.baseCameraDistance = s.baseCameraDistance;
		this.viewScale = s.viewScale;
		this.viewX = s.viewX;
		this.viewY = s.viewY;
		this.camZ = s.camZ;
		this.totalSpin = s.totalSpin;
		this.primePitch = s.primePitch;
		this.userAdjustedView = s.userAdjustedView;
		this.autoFitCooldown = s.autoFitCooldown;
		this.updateCameraMatrix();
		this.wake();
	}

	public isHologramPeeking(): boolean {
		return this.peekActive;
	}

	/**
	 * Temporarily view a hologram without committing the filter: only its nodes
	 * (plus any already-selected holograms, when the hovered tag is one of them)
	 * are drawn, the camera is fit to them, and they become selection candidates.
	 * Render-only — `peekTags` never touches settings until a commit.
	 */
	public peekHologram(tag: string): void {
		if (!this.settled) {
			return;
		}
		if (!this.peekActive) {
			this.peekCamera = this.snapshotCamera();
			this.peekActive = true;
		}
		// Suppress the in-settle auto-fit while peeking; restored on end/commit.
		this.userAdjustedView = true;
		const selected = this.plugin.settings.selectedHolograms;
		this.peekTags = selected.includes(tag) ? [...selected] : [tag];
		const peekNodes = this.nodes.filter((n) => this.nodeMatchesTags(n, this.peekTags));
		if (peekNodes.length === 0) {
			return;
		}
		// Assign directly rather than setCandidateNodes(), which recenters the camera.
		this.candidateNodes = new Set(peekNodes.map((n) => n.path));
		this.pressedKeys.clear();
		this.hoverIndex = -1;
		this.frameNodes(peekNodes, true, true);
	}

	/** Discard the peek and restore the exact pre-peek camera. */
	public endHologramPeek(): void {
		if (!this.peekActive) {
			return;
		}
		if (this.peekCamera) {
			this.restoreCamera(this.peekCamera);
		}
		this.peekActive = false;
		this.peekTags = [];
		this.peekCamera = null;
		this.candidateNodes.clear();
	}

	/**
	 * Commit the peeked hologram filter, replacing `selectedHolograms`, keeping
	 * the peeked camera and the candidate set live. Optionally select them.
	 */
	private commitHologramPeek(opts?: { select?: boolean }): void {
		if (!this.peekActive) {
			return;
		}
		this.plugin.settings.selectedHolograms = [...this.peekTags];
		void this.plugin.saveSettings();
		this.peekCamera = null;
		this.peekActive = false;
		this.peekTags = [];
		this.userAdjustedView = true;
		if (opts?.select) {
			this.selectCandidates();
		}
		this.refreshControlsPanel();
		this.wake();
	}

	/** Exit a peek but keep its camera (row click): discard the snapshot, drop candidates. */
	public keepHologramPeekCamera(): void {
		if (!this.peekActive) {
			return;
		}
		this.peekCamera = null;
		this.peekActive = false;
		this.peekTags = [];
		this.userAdjustedView = true;
		this.candidateNodes.clear();
		this.wake();
	}

	private selectCandidates(): void {
		if (this.candidateNodes.size === 0) {
			return;
		}
		for (let i = 0; i < this.nodes.length; i++) {
			const n = this.nodes[i];
			if (n && this.candidateNodes.has(n.path)) {
				n.selected = true;
				this.selected.add(i);
			}
		}
		this.candidateNodes.clear();
		this.updateCursor();
		this.wake();
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

	/**
	 * Push the current camera angles onto the controls panel's read-outs without
	 * rebuilding the panel. Used for per-frame changes (autorotation) where a
	 * full {@link refreshControlsPanel} re-render every frame would be wasteful.
	 */
	private syncControlsCamera(): void {
		for (const leaf of this.app.workspace.getLeavesOfType('semantic-hologram-controls')) {
			const view = leaf.view as any;
			if (view.onCameraChange) view.onCameraChange();
		}
	}

	requestRedraw(): void {
		this.settled = false;
		this.wake();
	}

	/**
	 * Ask for one (or more) redraw frames without re-arming physics. Used when
	 * settings change rendering (colors, labels, filter, etc.) but not layout.
	 */
	public requestRender(): void {
		this.wake();
	}

	showLevelTooltip(show: boolean): void {
		// Implement later
	}

	private updateAnglesFromMatrix(): void {
		// Row 1 is R_v = [sin(theta), 0, -cos(theta)], which depends on theta
		// ALONE. Reading theta from here instead of from F is what makes the
		// read-out exact over the full 0-360 range of phi.
		//
		// Reading theta from F as atan2(-Fz, -Fx) looks equivalent but is not:
		// F = [-cos(phi)cos(theta), sin(phi), -cos(phi)sin(theta)] is only
		// 2-to-1 in (theta, phi). For phi in (90, 270) the pair (theta, phi)
		// and (theta+180, 180-phi) yield the identical F with U_v negated, so
		// any F-based theta folds by 180 deg across the poles.
		const rx = this.rotM[0] ?? 0;
		const rz = this.rotM[2] ?? 0;
		let azimDeg = Math.atan2(rx, -rz) * 180 / Math.PI;

		const fx = this.rotM[6] ?? 0;
		const fy = this.rotM[7] ?? 0;
		const fz = this.rotM[8] ?? 0;

		// phi is the elevation of F above the focal point XZ plane, so home
		// reads 0 deg. The horizontal reference h is rebuilt from the theta we
		// just recovered, which keeps phi unambiguous through the poles: at
		// phi = +/-90 the horizontal term vanishes and atan2 collapses to
		// exactly 90 or 270 with no special case.
		const ar = azimDeg * Math.PI / 180;
		const cosPhi = -(fx * Math.cos(ar) + fz * Math.sin(ar));
		let elevDeg = Math.atan2(fy, cosPhi) * 180 / Math.PI;

		// Wrap after rounding so a value like 359.7 deg cannot round up to 360.
		azimDeg = ((Math.round(azimDeg) % 360) + 360) % 360;
		elevDeg = ((Math.round(elevDeg) % 360) + 360) % 360;
		this.currentAzimuth = azimDeg;
		this.currentElevation = elevDeg;
	}

	/**
	 * Trackball rotation. `dYaw` and `dPitch` are θ′ and φ′ in degrees, measured
	 * about the assembly's own axes — the two axes of the prime frame that are
	 * NOT the line of sight:
	 *
	 *   θ′  — yaw about y′, the screen-vertical axis
	 *   φ′  — pitch about x′, the screen-horizontal axis
	 *
	 * Both rotate the camera's world-space basis about the assembly's own axis
	 * (see {@link rotateAboutBodyAxis}), so a yaw is always a spin about the
	 * *current* screen-vertical axis and a pitch about the *current*
	 * screen-horizontal axis, at every elevation. There is deliberately NO
	 * re-level: projecting back onto a world-horizontal R_v would re-introduce a
	 * fixed (Y, y′) plane. We never rotate about z′, so the prime-frame roll stays
	 * zero; world roll accumulates, which is precisely what a spin about y′ is
	 * (docs section 6).
	 */
	private applyRotationDeltas(dYaw: number, dPitch: number): void {
		if (dYaw === 0 && dPitch === 0) {
			return;
		}
		const rad = Math.PI / 180;
		this.primePitch += dPitch;
		if (dYaw !== 0) {
			this.rotateAboutBodyAxis(1, dYaw * rad);
		}
		if (dPitch !== 0) {
			this.rotateAboutBodyAxis(0, dPitch * rad);
		}
		this.updateCameraMatrix();
		this.updateAnglesFromMatrix();
		this.markViewAdjusted(true);
	}

	/**
	 * Rotate the camera about one of its OWN axes, in world space.
	 *
	 * `bodyAxis` is 0 for x′ (screen-right) or 1 for y′ (screen-vertical). The
	 * corresponding world direction is the row of {@link rotM} that maps a world
	 * point to that view coordinate — row 0 for x′, row 1 for y′. Rotating every
	 * basis row about that world axis is a POST-multiplication
	 * (`rotM ← rotM · Rot(axis, −delta)`, since post-multiplying by `Pᵀ` applies
	 * `P` to the rows). This is the piece that pre-multiplying by a view-space
	 * rotation gets wrong: `rotM ← Rot_view · rotM` spins the camera about
	 * `rotMᵀ·axis_view`, which is a fixed world axis, not the body axis, off the
	 * home pose.
	 */
	private rotateAboutBodyAxis(bodyAxis: 0 | 1, delta: number): void {
		const m = this.rotM;
		const o = bodyAxis * 3;
		const ax = m[o] ?? (bodyAxis === 0 ? 1 : 0);
		const ay = m[o + 1] ?? (bodyAxis === 0 ? 0 : 1);
		const az = m[o + 2] ?? 0;
		const R = this.getRotationMatrixAboutAxis([ax, ay, az], -delta);
		this.rotM = this.multiplyMatrices(this.rotM, R);
	}

	public setCameraState(state: { elevation: number; azimuth: number; distance: number }): void {
		// Reject non-finite input at the boundary. This is a public entry point
		// (the plugin MCP calls it), and a single NaN angle poisons rotM, after
		// which cameraDistance, viewScale and target are all NaN too and never
		// recover: every downstream guard is a comparison, and NaN fails all of
		// them. The view then stays bricked until an app reload. Refusing the
		// write keeps one bad call from destroying a working camera.
		if (!Number.isFinite(state.elevation) || !Number.isFinite(state.azimuth) || !Number.isFinite(state.distance)) {
			console.warn('[SH] setCameraState ignored: non-finite state', state);
			return;
		}

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

		this.rebuildBasis(azim, elev);

		// Distance is unbounded (matches dolly()); the earlier finiteness guard
		// already rejected NaN/Infinity before we get here.
		this.cameraDistance = state.distance;
		this.viewScale = this.baseCameraDistance / this.cameraDistance;
		this.markViewAdjusted(true);
	}

	/**
	 * Reconstruct `rotM` exactly from the two read-out angles (docs section 7.3)
	 * rather than integrating a delta rotation, so the read-out and the basis can
	 * never disagree and no error accumulates. Used by {@link setCameraState} for
	 * absolute framing calls. The continuous rotation control deliberately does
	 * NOT use this — see {@link applyRotationDeltas}.
	 *
	 *   F     = [-cos(phi)cos(theta),  sin(phi), -cos(phi)sin(theta)]
	 *   U_v   = [ sin(phi)cos(theta),  cos(phi),  sin(phi)sin(theta)]
	 *   R_v   = [          sin(theta),       0,   -cos(theta)]
	 *
	 * Row 1 is stored negated (docs section 8.1): the canvas mapping stays a plain
	 * affine scale and det(R_rot) remains +1.
	 */
	private rebuildBasis(azim: number, elev: number): void {
		const elevRad = elev * Math.PI / 180;
		const azimRad = azim * Math.PI / 180;

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
	}

	public getCameraState(): { elevation: number; azimuth: number; distance: number } {
		return {
			elevation: this.currentElevation,
			azimuth: this.currentAzimuth,
			distance: Math.round(this.cameraDistance ?? 0)
		};
	}

	async dumpGraphState(nonce?: string): Promise<string> {
		console.log('[SH] DUMPING GRAPH STATE, target:', this.target);
		// Anchored through pluginDir(), not a hand-written '.obsidian/plugins/...'
		// string: the config folder name is user-configurable, so a guessed
		// fallback silently writes somewhere that is not this plugin.
		const path = join(this.plugin.pluginDir(), 'graph-state.json');
		const state = {
			// Echoed back so a reader can tell this dump from the previous one.
			// Without it, a stale file looks exactly like a fresh one — which is
			// how a 29-hour-old snapshot once got treated as live evidence.
			nonce: nonce ?? null,
			dumpedAt: Date.now(),
			// The camera read-out angles, so the documented hand-check
			//   azimuth   = atan2(m0, -m2)
			//   elevation = atan2(m7, -(m6*cos(theta) + m8*sin(theta)))
			// can actually be performed against a dump. Without these two, a
			// rotM alone cannot confirm whether the read-out is current code.
			azimuth: this.currentAzimuth,
			elevation: this.currentElevation,
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
			// NOT rounded. A dump exists to be checked: det and orthonormality are
			// exactness claims, and rounding each entry to 3 dp puts ~1e-3 of
			// error into det (measured 0.99968 for a basis that was in fact
			// 1 - 1e-16), which reads as drift that does not exist. Node
			// coordinates below stay rounded, since they are for layout reading
			// and their precision carries no such claim.
			rotM: (this.rotM ?? []).slice(),
			totalSpin: Math.round((this.totalSpin ?? 0) * 1000) / 1000,
			nodeCount: this.nodes?.length ?? 0,
			linkCount: this.links?.length ?? 0,
			avgEdgeLength: Math.round((this.avgEdgeLength?.() ?? 0) * 10) / 10,
			restLengthScaled:
				Math.round(((this.links?.reduce((s, l) => s + (l.restLen ?? 0), 0) ?? 0) / Math.max(1, this.links?.length ?? 1)) * (this.scale ?? 1) * 10) / 10,
			worldR: Math.round((this.worldR?.() ?? 0) * 10) / 10,
			settleEnergy: PHYS.settleEnergy,
			forceSettleFrames: PHYS.forceSettleFrames,
			nodes: this.nodes.slice(0, DUMP_ENTITY_LIMIT).map((n) => ({
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
			links: this.links.slice(0, DUMP_ENTITY_LIMIT).map((l) => ({
				a: l.a,
				b: l.b,
				dir: l.dir,
				relations: l.relations,
				restLen: Math.round(l.restLen * 10) / 10,
			})),
			// A bounded dump that reports only what it wrote tells the flattering
			// half of the truth. State the bound and the shortfall explicitly so a
			// reader can tell a truncated capture from a genuinely small graph.
			truncation: {
				limit: DUMP_ENTITY_LIMIT,
				nodesWritten: Math.min(this.nodes.length, DUMP_ENTITY_LIMIT),
				linksWritten: Math.min(this.links.length, DUMP_ENTITY_LIMIT),
				nodesTruncated: Math.max(0, this.nodes.length - DUMP_ENTITY_LIMIT),
				linksTruncated: Math.max(0, this.links.length - DUMP_ENTITY_LIMIT),
			},
		};
		writeFileSync(path, JSON.stringify(state, null, 2));
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

/** One note a delete would remove, with the metadata the confirm table shows. */
interface DeleteTarget {
	file: TFile;
	title: string;
	holograms: string[];
}

/** Renders the title/hologram table a delete would remove, shared by both confirm stages. */
function buildDeleteNodeTable(contentEl: HTMLElement, targets: DeleteTarget[]): void {
	const n = targets.length;
	contentEl.createDiv({
		cls: 'sh-split-desc',
		text: `${n} note${n === 1 ? '' : 's'} will be moved to the trash:`,
	});
	const table = contentEl.createEl('table', { cls: 'sh-delete-node-table' });
	const head = table.createEl('thead').createEl('tr');
	head.createEl('th', { text: 'Title' });
	head.createEl('th', { text: 'Hologram' });
	const body = table.createEl('tbody');
	for (const t of targets) {
		const row = body.createEl('tr');
		row.createEl('td', { text: t.title });
		row.createEl('td', { text: `[${t.holograms.join(', ')}]` });
	}
}

/** Stage 1 of node deletion: states the consequence, requires an explicit continue. */
class DeleteNodesModal extends Modal {
	private resolveStage: (ok: boolean) => void;
	private done = false;

	constructor(
		app: App,
		private targets: DeleteTarget[],
		resolve: (ok: boolean) => void,
	) {
		super(app);
		this.resolveStage = resolve;
	}

	private finish(ok: boolean): void {
		if (this.done) {
			return;
		}
		this.done = true;
		this.resolveStage(ok);
		this.close();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sh-split-modal');
		this.titleEl.setText('Are you sure?');
		buildDeleteNodeTable(contentEl, this.targets);
		contentEl.createDiv({ cls: 'sh-split-buttons' }, (el) => {
			el.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }, (btn) => {
				btn.addEventListener('click', () => this.finish(false));
			});
			el.createEl('button', { text: 'Continue', cls: 'mod-warning' }, (btn) => {
				btn.addEventListener('click', () => this.finish(true));
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) {
			this.done = true;
			this.resolveStage(false);
		}
	}
}

/** Stage 2 of node deletion: the irreversible-looking final gate. */
class DeleteNodesConfirmModal extends Modal {
	private resolveStage: (ok: boolean) => void;
	private done = false;

	constructor(
		app: App,
		private targets: DeleteTarget[],
		resolve: (ok: boolean) => void,
	) {
		super(app);
		this.resolveStage = resolve;
	}

	private finish(ok: boolean): void {
		if (this.done) {
			return;
		}
		this.done = true;
		this.resolveStage(ok);
		this.close();
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('sh-split-modal');
		this.titleEl.setText('Are you absolutely sure?');
		const n = this.targets.length;
		contentEl.createDiv({
			cls: 'sh-split-desc',
			text: `Last chance. ${n === 1 ? 'This note' : `These ${n} notes`} will leave the vault. You can restore ${n === 1 ? 'it' : 'them'} from the trash afterwards, but the graph will not offer an undo.`,
		});
		buildDeleteNodeTable(contentEl, this.targets);
		contentEl.createDiv({ cls: 'sh-split-buttons' }, (el) => {
			el.createEl('button', { text: 'Cancel', cls: 'mod-ghost' }, (btn) => {
				btn.addEventListener('click', () => this.finish(false));
			});
			el.createEl('button', { text: 'Delete', cls: 'mod-warning' }, (btn) => {
				btn.addEventListener('click', () => this.finish(true));
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.done) {
			this.done = true;
			this.resolveStage(false);
		}
	}
}
