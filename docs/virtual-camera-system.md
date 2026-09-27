# Virtual Camera System Architecture

This document outlines the virtual camera and viewing system architecture used in the Obsidian Semantic Hologram plugin, detailing standard industry camera models, our specific hybrid architecture, core interaction mechanics, and a complete glossary of defined terms.

---

## 1. Overview of Virtual Camera Systems

In computer graphics and game engines, virtual camera systems govern how a 3D virtual world is framed, projected, and rendered onto a 2D display. Standard industry camera models include:

1. **First-Person Camera (Look-At / Free-Look):** Rotates in place around its own center (pitch and yaw), commonly used for looking around from a fixed or walking standpoint.
2. **Flight / 6DoF Camera (Spaceship):** Provides full translational freedom along all three axes (forward/back, strafe, rise/sink) and full rotational freedom (pitch, yaw, roll) without being tethered to a target point.
3. **Follow / Chase Camera:** Tracks behind a moving target object at a fixed or flexible offset distance, common in third-person action and racing games.
4. **Orthographic 2D Pan-and-Zoom Camera:** A purely 2D viewing system handling 2D screen translation (`viewX`, `viewY`) and scaling (`viewScale`) without 3D depth or spherical rotation.
5. **Rail Camera:** Constrained strictly along a predefined 3D path or spline curve for cinematic framing.

### Our Chosen System: Custom Orthographic Orbit Camera Model
Our plugin uses a specialized hybrid architecture:
- **Orthographic Projection:** Renders without perspective foreshortening, maintaining parallel lines.
- **Virtual Screen:** A bounded 2D rectangular surface with Cartesian `+Y` up coordinates, positioned and oriented in 3D world space.
- **Spherical Orbit Mechanics:** Rotates dynamically around a designated 3D focal point rather than a fixed world center.

---

## 2. Detailed Breakdown of Our Chosen System

- **Virtual Screen:** A finite, bounded 2D rectangular surface (with its own 2D coordinate system where `+Y` points up) explicitly positioned and oriented within 3D world space, acting as a tangible display plane or UI surface.
- **Camera (Viewport Center):** Anchored at the 3D center of the virtual screen.
- **Stand-off Distance (Camera Distance):** The base distance between the camera and the focus point along the line orthogonal to the virtual screen's plane.
- **Focus Point (Interest / Look-At Point):** A 3D point situated at camera distance from the camera along the orthogonal viewing vector. It serves as the independent 3D target and orbit anchor point in world space.

---

## 3. Core Interaction Mechanics

- **Panning:** Translating the virtual screen and its focus point together along the plane of the virtual screen (its local X and Y axes), shifting the viewpoint across the 3D world while keeping the viewing angle unchanged.
- **3D Rotation (Spherical Orbit):** Pivoting or tumbling the virtual screen and camera in a spherical arc around the fixed focus point. The focus point remains centered in the virtual screen while you inspect objects from different angles.
- **Zooming:** Scaling the view (`viewScale`), which adjusts the viewport framing. In models where stand-off distance is tied to zoom, it alters the effective viewing distance.
- **Select-Drag:** Projecting a 2D mouse drag onto a plane parallel to the virtual screen's surface, translating the selected 3D world objects' actual absolute 3D coordinates in lockstep with the cursor.

---

## 4. Glossary of Defined Terms

* **Pane (Leaf):** Obsidian's window management container defining where the view sits in the workspace layout.
* **View:** The Obsidian GUI framework object (`SemanticHologramView`) handling application logic, lifecycle, settings, and animation loops.
* **Viewport:** The graphical rendering rectangle (`<canvas>` element) through which the 3D scene is projected, sharing identical 2D dimensions with the View, Pane, and Canvas.
* **Canvas:** The low-level HTML drawing element (`<canvas>`) where pixels are painted.
* **World Space:** The infinite 3D Cartesian coordinate space `(X, Y, Z)` anchored by a fixed `(0, 0, 0)` origin where all holograms exist.
* **Virtual Screen:** A finite, bounded 2D rectangular surface (with Cartesian `+Y` up coordinates) positioned and oriented in 3D world space.
* **Image Plane / Viewing Plane:** Theoretical or practical 2D flat planes embedded in 3D space used for projecting 3D scenes.
* **Stand-off Distance:** The base distance between the camera and the focus point at 0% zoom level.
* **Focus Point (Interest Point):** The 3D point located at camera distance along the orthogonal viewing line from the virtual screen center.
* **Home Position:** The defined default state where the focus point sits precisely at the absolute 3D world origin `(0, 0, 0)`, viewed at a camera distance/zoom level that frames and renders all nodes comfortably within the virtual screen area, with the virtual screen plane oriented parallel to the world XY plane (positive X pointing right, positive Y pointing up).
* **Spherical Orbit Camera System:** A camera architecture where the camera orbits dynamically in 3D space around a designated 3D focal point.
