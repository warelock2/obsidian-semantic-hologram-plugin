# Virtual Screen

**Virtual Screen** — A finite, bounded 2D rectangular surface (with its own 2D coordinate system where `+Y` points up) that is explicitly positioned and oriented within 3D world space, acting as a tangible display plane or UI surface in a 3D environment.

> **Not to be confused with the 2D mode's virtual screen.** The definition above
> describes a rectangle *embedded in 3D world space*. The plugin's **2D mode** uses
> the same word for a different thing: the canvas rectangle mapped into a flat 2D
> **world area**, with its own prime reference frame, a focal point at its midpoint,
> and no rotation. Those are distinct concepts sharing a name.
>
> See [`2d-virtual-screen-frames.md`](2d-virtual-screen-frames.md) for the 2D
> frames, orientation conventions, gizmos and visibility control.
