# 2D Virtual Screen — Reference Frames, Orientation, and Gizmos

This document covers the **2D mode** view: its coordinate frames, how they relate,
where its focal point is, what panning and magnification mean, which gizmos are
drawn, and what hides them.

For the 3D pinhole/trackball camera — which has rotation, a standoff-based
magnification and a perspective projection — see
[`untethered-trackball-pinhole-camera-system.md`](untethered-trackball-pinhole-camera-system.md).
The two modes share vocabulary but almost no mechanism; §7 spells out where they
diverge.

---

## 1. Why 2D needs its own frame model

2D has no world *space*. It has a world **area** — a flat surface with a 2D
coordinate system. That gives it three distinct reference frames where 3D has two,
because the canvas frame is the odd one out: it is y-down, and everything the user
cares about is y-up.

---

## 2. The three frames

### 2.1 Canvas reference frame

The browser's own coordinate system for the drawing surface.

- Origin `(0,0)` at the virtual screen's **upper-left**
- `+x` → right
- `+y` → **down**

This frame is what makes the words "right" and "up" unambiguous for the rest of
the system. Every other frame is defined relative to it.

### 2.2 2D world area reference frame — axes `x`, `y`

The coordinate system the graph's content lives in.

- Origin: the world area's `(0,0)`
- `+x` → right
- `+y` → **up**

### 2.3 2D prime reference frame — axes `x'`, `y'`

The frame the virtual screen itself is expressed in. **It always exists.**

- Origin: the virtual screen's midpoint — the **focal point** (§4)
- `+x'` → right
- `+y'` → **up**

Like 3D's prime frame (§7), it is screen-anchored and therefore cannot tilt or
rotate.

### 2.4 Orientation summary

| frame | axes | origin | x | y |
|---|---|---|---|---|
| canvas | — | virtual screen upper-left | right | **down** |
| 2D world area | `x`, `y` | world area `(0,0)` | right | **up** |
| 2D prime | `x'`, `y'` | virtual screen midpoint | right | **up** |

---

## 3. Relations between the frames

### 3.1 World area → prime: translate and scale only

There is **no reflection between these two frames**. They share an orientation.

```
x' = x - focalX
y' = y - focalY
```

A uniform scale applies on top, on the way to the canvas.

Consequently, when the focal point sits on the world area origin the two frames are
**identical**, not merely parallel — the transform collapses to pure scale. This is
the coincidence case the two gizmos expose (§6.3).

### 3.2 World area → canvas: the one reflection

The single reflection in the entire 2D system lives here, at the canvas boundary:

```
screenX = w/2 + x' * viewScale
screenY = h/2 - y' * viewScale      <-- the minus IS the flip
```

Inverse:

```
x' = (screenX - w/2) / viewScale
y' = (h/2 - screenY) / viewScale
```

The `screenY` minus sign is the entire flip. `+y'` is up, canvas `+y` is down.

> **Sign warning.** A 2D view built with this term unsigned renders *mirrored* while
> still looking plausible — node positions, hit-testing and the gizmos all stay
> self-consistent, because they all read the same helpers. Nothing crashes and
> nothing is obviously wrong. Assert the sign explicitly rather than inferring
> correctness from "it renders".

`viewX` and `viewY` keep their existing meanings — *world x at the canvas's left
edge*, *world y at the canvas's top edge* — so the flip is a pure sign change on the
`y` term and needs no canvas-height term:

```
toScreenY(y)  =  (viewY - y) * viewScale
toWorldY(sy)  =  viewY - sy / viewScale
```

Flipping `toScreenY`/`toWorldY` requires updating the five sites that solve for
`viewY` from a "put world point P at the canvas centre" intent; each `− h/(2·scale)`
becomes `+`. They are enumerated in §8.2.

---

## 4. The focal point

The focal point is **the midpoint of the virtual screen**.

- In **prime coordinates**: `(0, 0)` — it *is* the prime frame's origin by definition
- In **canvas coordinates**: `(w/2, h/2)` — `w/2` right and `h/2` **down** from the
  canvas origin

Those two are the same point but are **not the same vector**: the canvas `y`
component is positive because canvas `+y` runs downward, while prime `+y'` runs up.
§3.2 is where that is reconciled. Do not treat the canvas offset as a prime
coordinate.

**The focal point never moves relative to the virtual screen.** It is always the
centre. What changes is which world point occupies it:

| operation | focal point's screen position | focal point's world coordinates |
|---|---|---|
| pan | unchanged (centre) | **change** |
| magnify / demagnify | unchanged (centre) | unchanged |
| reset | unchanged (centre) | return to world `(0,0)` |

Panning translates the *world* under a fixed frame. It does not drag the focal
point around the screen.

---

## 5. Pan and magnification

### 5.1 The rectangle model

The canvas is a `w × h` rectangle, which through the prime frame maps to a
**world-area rectangle** — the region of the world the virtual screen can see.

With the focal point on the world origin at **standard zoom** (`viewScale = 1`),
that region's corners sit at `±w/2` and `±h/2` from the origin, so exactly `w` world
units are visible across and `h` down.

### 5.2 Panning

Panning translates the world-area rectangle along `+x` or `+y`. The visible **area**
and **orientation** are unchanged — only which part of the world sits under the
screen.

Pan and magnification are fully independent. Panning never alters scale.

### 5.3 Magnification

`viewScale` is literally **screen pixels per world unit**.

| | world rectangle | apparent object size |
|---|---|---|
| magnify | contracts | objects **larger** |
| demagnify | expands | objects **smaller** |

Magnification is **anchored at the focal point — the canvas centre — and never at
the cursor.** `applyScaleAboutFocalPoint()` captures the focal point's world
coordinate, changes `viewScale`, then re-solves `viewX`/`viewY` so the focal point
lands back on `w/2, h/2`. The cursor is never consulted.

Two properties hold together as a consequence of that anchoring, and both are
load-bearing:

1. **Uniform scale** — every node grows or shrinks by the same factor, so relative
   positions and spacing are preserved.
2. **Centred spread** — content expands symmetrically about the canvas centre
   rather than drifting toward one side.

The correct invariant to assert, from `AGENTS.md`:

```
px_after - c  ==  k * (px_before - c)     for every node,  c = (w/2, h/2)
```

In prime coordinates this reduces to `x'` and `y'` scaling uniformly about `(0,0)`.

Zoom-to-cursor and screen-plane compensation are forbidden in this codebase. They
were not reintroduced here.

---

## 6. The two gizmos

Both are two-arrow axis gizmos sharing a single vertex, drawn with fixed pixel
length (`s = 24`, head `6`, label offset `s + 9`) so they match the 3D triad's
arrow size rather than scaling with magnification.

### 6.1 Prime reference frame gizmo

| property | value |
|---|---|
| vertex | the focal point — canvas `(w/2, h/2)` |
| arrows | `+x'` right, `+y'` **up** |
| labels | **`x'`**, **`y'`** |
| colour | **red** `rgba(255, 0, 0, 0.9)` |
| on pan | stays at the canvas centre |

### 6.2 World reference frame gizmo

| property | value |
|---|---|
| vertex | the world area's `(0,0)` |
| arrows | `+x` right, `+y` **up** |
| labels | **`x`**, **`y`** |
| colour | **blue** `#43AA8B` |
| on pan | **slides across the canvas**, and can leave it |

Its vertex is the world origin projected into canvas coordinates — prime
coordinates `(−focalX, −focalY)`.

### 6.3 The coincidence case

When the focal point is on the world area origin, the world gizmo's prime
coordinates are `(0,0)` and it lands **exactly on top of** the prime gizmo. The
two gizmos appear as one. Panning separates them: the prime gizmo stays at the
centre, the world gizmo drifts off.

This is the usual reason a single gizmo appears to be "the world origin gizmo" —
after a reset the two coincide, and only panning reveals that they are distinct.

### 6.4 Colour convention

Colours match 3D deliberately, so colour encodes the same meaning in both modes:

| | 2D | 3D |
|---|---|---|
| world frame | blue `#43AA8B` | world triad, blue `#43AA8B` |
| prime frame | red `rgba(255, 0, 0, 0.9)` | prime-frame gizmo, red |

Note the runtime gizmo currently wears blue while actually being the *prime* frame
— §8.1 corrects both its colour and its labels.

---

## 7. How 2D diverges from the 3D camera

| | 2D | 3D |
|---|---|---|
| world extent | world **area** | world **space** |
| rotation | none possible | prime-frame trackball |
| magnification | `viewScale`, screen pixels per world unit | standoff `R`, `viewScale = base/R` |
| projection | axis-aligned affine | pinhole or orthographic |
| frames | canvas, world area, prime | canvas, world space, prime |

**2D cannot rotate.** `toScreenX`/`toScreenY` bypass `rotM` entirely, so rotation
state has no visual effect. The view does still carry `totalSpin`,
`rotateAboutAxis` and the `autoRotating` setting in 2D, where they can only spin a
basis that nothing reads. This is pre-existing and out of scope for the frame work,
but it means "orientation" is not a meaningful degree of freedom in 2D — which is
why panning can preserve it trivially.

---

## 8. Implementation surface

### 8.1 Implemented behaviour

The 2D axis drawing consists of two named methods:
- `draw2DPrimeFrameGizmo()` draws the prime reference frame at the canvas centre
  with labels `x'`/`y'`, coloured red, `+y` up.
- `draw2DWorldFrameGizmo()` draws the world reference frame at the projected
  world origin with labels `x`/`y`, coloured blue (`#43AA8B`), `+y` up.
Both methods are gated on `plugin.settings.showRotationCenter` and called from
`draw2DGizmos(w, h)` inside `drawOriginIndicator()`.

The 2D projection includes the y-flip: `toScreenY(y) = (viewY - y) * viewScale`,
so `+y` renders upward (negative canvas y).

### 8.2 Verified changes

Projection:

- `toScreenY` (view.ts:2727), `toWorldY` (view.ts:2744) — added the reflection

Dependent `viewY` solves, each `− h/(2·scale)` → `+`:
  - `resetView` — 2D branch (view.ts:2831)
  - `applyViewScale` — 2D branch (view.ts:2969)
  - `applyScaleAboutFocalPoint` (view.ts:960) — `+ halfH/scale`
  - `frameNodes` — 2D anchor computation, `cy = viewY - vp.h/(2·scale)` (view.ts:2999)
  - the pan handler — `viewY = worldY + midY/scale` (view.ts:4440)
  - Arrow-key pan — `viewY -= panY` (view.ts:2504)
  - Pointer pan deltas — `viewY = panViewY + dScreenY` (view.ts:4643/4941)
  - `rotCy` computations — `viewY - h/(2·scale)` (view.ts:3345/4647/4945)
  - World origin anchors — `viewY + h/(2·scale)` for `viewCenterWorld` (view.ts:734)
  - Search pick — `viewY = node.y + h/(2·scale)` (view.ts:6562)
  - Focal point set — `viewY = ty + h/(2·scale)` (view.ts:6148)

`measureFit`'s 2D math is `|·|` throughout, so it is symmetric and needed no change.

Gizmos:

- Extracted the inline block into `draw2DGizmos(w, h)` and `draw2DAxisGizmo()`
- Prime gizmo: labels `x'`/`y'`, `+y'` mapped to `(0, -1)`, colour `rgba(255,0,0,0.9)`
- World gizmo: labels `x`/`y`, `+y` mapped to `(0, -1)`, colour `#43AA8B`
- Both gated on `plugin.settings.showRotationCenter`

`toScreenX`/`toWorldX` are untouched — the `x` sense is already correct.

### 8.3 Visibility control

A single existing control, `showRotationCenter`, labelled **"Show indicators"** in
the controls panel (`controlsView.ts:767`).

It is read at exactly one place today (view.ts:4107, inside the 3D branch), so both
2D gizmos need their own checks rather than inheriting one.

After this work the toggle covers:

- 3D prime-frame gizmo — already gated
- 2D prime reference frame gizmo — new gate
- 2D world reference frame gizmo — new gate

**No settings or schema change is needed** — the toggle already exists.

The 3D **world triad** remains ungated. That is deliberate: the control was scoped to
the two 2D gizmos, and extending it to the 3D world triad is a separate decision.

### 8.4 Explicitly out of scope

- **2D fit semantics.** Unchanged: fit zooms out only and never moves the focal
  point, identically in both modes. A 2D-only variant that pans to the visible
  centroid and zooms in *or* out was raised and never confirmed, so it is not built.
- **3D**, in its entirety — including the negated up-row, which is deliberate
  (see `AGENTS.md`) and must not be "fixed".

### 8.5 Verification notes

Two traps specific to this work, both learned the hard way elsewhere in this
codebase:

- **Do not straddle a rebuild.** An incremental rebuild changes node radii and
  therefore the required framing, so a fit measured in a separate tick from the fit
  call reads marginally wrong. Measure fit and result atomically, or assert that no
  rebuild occurred between them.
- **Project at each node's own depth.** Probing screen position with the focal
  plane's scale under-measures under perspective, producing a false "fit is broken"
  reading.

The single-common-factor invariant (§5.3) is checkable numerically: measure `k`
across every node after a magnification and assert one common value.

---

## 9. See also

- [`virtual-screen.md`](virtual-screen.md) — "Virtual Screen" as a plane in **3D**
  world space. A different concept from this document's 2D virtual screen frame;
  the shared name is a common source of confusion.
- [`untethered-trackball-pinhole-camera-system.md`](untethered-trackball-pinhole-camera-system.md)
  — the 3D camera: §2 two reference frames, §6.3 magnification centred on the
  focal point, §7 prime-frame rotation, §9 home position.