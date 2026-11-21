/**
 * Fase 7: the 3D view of CAD models and mesh files. Z is up (STL / OpenSCAD); Y-up objects
 * (glTF) are turned on load. It draws only when something changes (orbit, resize, new mesh).
 * The front of each face is the theme accent, the back is red: holes and inside-out models show.
 */
import {
  AmbientLight,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  BackSide,
  FrontSide,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  SphereGeometry,
  Vector2,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEME_EVENT } from '../../themes';

export type ViewName = 'iso' | 'front' | 'top' | 'right';

/** Two picked points and the distance between them (model units). */
export interface Measure {
  a: [number, number, number];
  b?: [number, number, number];
  distance?: number;
}

function cssColor(name: string, fallback: number): Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!v) return new Color(fallback);
  try {
    return new Color(v);
  } catch {
    return new Color(fallback);
  }
}

/** Triangles of every mesh of an object, in world space (for the print check of a GLB / FBX). */
export function trisOf(o: Object3D): Float32Array {
  o.updateMatrixWorld(true);
  const out: number[] = [];
  const v = new Vector3();
  o.traverse((c) => {
    const m = c as Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return;
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  });
  return Float32Array.from(out);
}

export class MeshViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.01, 1e6);
  private readonly controls: OrbitControls;
  private readonly root = new Group();
  private readonly bedGroup = new Group();
  private readonly front: MeshStandardMaterial;
  private readonly back: MeshStandardMaterial;
  private readonly obs: ResizeObserver;
  private frame = 0;
  private bed: [number, number] = [220, 220];
  private wireframe = false;
  private disposed = false;
  private readonly onTheme = () => this.applyTheme();
  // G-code toolpaths: done layers, the current layer (brighter) and travel moves.
  private paths: { done: LineSegments; current: LineSegments; travel: LineSegments } | null = null;
  // G-code is in printer coordinates: frame the part (not the purge line), bed from 0,0.
  private frameBox: Box3 | null = null;
  // Measuring: picked points, their markers and the line between them.
  private measuring: ((m: Measure | null) => void) | null = null;
  private picks: Vector3[] = [];
  private readonly marks = new Group();
  private downAt: { x: number; y: number } | null = null;
  // Section: hides everything above this height (null = off).
  private cut: Plane | null = null;
  private readonly onDown = (e: PointerEvent) => (this.downAt = { x: e.clientX, y: e.clientY });
  private readonly onUp = (e: PointerEvent) => this.pick(e);

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'cad-canvas';
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.draw());
    this.front = new MeshStandardMaterial({ color: 0xf0a640, roughness: 0.55, metalness: 0.05, side: FrontSide, flatShading: false });
    this.back = new MeshStandardMaterial({ color: 0xd04848, roughness: 0.8, side: BackSide });
    this.scene.add(new HemisphereLight(0xffffff, 0x444444, 1.4));
    this.scene.add(new AmbientLight(0xffffff, 0.25));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(0.4, -0.6, 1);
    this.camera.add(key);
    this.scene.add(this.camera);
    this.scene.add(this.root, this.bedGroup, this.marks);
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.addEventListener('pointerdown', this.onDown);
    this.renderer.domElement.addEventListener('pointerup', this.onUp);
    this.applyTheme();
    this.obs = new ResizeObserver(() => this.resize());
    this.obs.observe(host);
    window.addEventListener(THEME_EVENT, this.onTheme);
    this.resize();
  }

  private applyTheme(): void {
    this.scene.background = cssColor('--bg-2', 0x1e2127);
    this.front.color = cssColor('--accent', 0xf0a640);
    if (this.paths) {
      (this.paths.done.material as LineBasicMaterial).color = cssColor('--accent', 0xf0a640);
      (this.paths.current.material as LineBasicMaterial).color = cssColor('--fg', 0xffffff);
      (this.paths.travel.material as LineBasicMaterial).color = cssColor('--info', 0x4aa3ff);
    }
    this.buildBed();
    this.draw();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.draw();
  }

  draw(): void {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }

  /** Model bounds in world space (empty box = no model). */
  bounds(): Box3 {
    return this.frameBox ? this.frameBox.clone() : new Box3().setFromObject(this.root);
  }

  private clearModel(): void {
    for (const c of [...this.root.children]) {
      this.root.remove(c);
      c.traverse((x) => {
        const m = x as Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    if (this.paths) {
      for (const l of Object.values(this.paths)) (l.material as LineBasicMaterial).dispose();
      this.paths = null;
    }
    this.frameBox = null;
    this.clearMarks();
  }

  /**
   * G-code: extrusion and travel segments (x0 y0 z0 x1 y1 z1 each). Shown layer by layer with
   * showLayers; the camera frames the extrusion.
   */
  setToolpath(extrude: Float32Array, travel: Float32Array, refit: boolean, frame?: [number, number, number, number, number, number] | null): void {
    this.clearModel();
    if (frame) this.frameBox = new Box3(new Vector3(frame[0], frame[1], Math.min(frame[2], 0)), new Vector3(frame[3], frame[4], frame[5]));
    const attr = new BufferAttribute(extrude, 3);
    const geo = () => {
      const g = new BufferGeometry();
      g.setAttribute('position', attr);
      return g;
    };
    const tg = new BufferGeometry();
    tg.setAttribute('position', new BufferAttribute(travel, 3));
    this.paths = {
      done: new LineSegments(geo(), new LineBasicMaterial({ color: cssColor('--accent', 0xf0a640) })),
      current: new LineSegments(geo(), new LineBasicMaterial({ color: cssColor('--fg', 0xffffff) })),
      travel: new LineSegments(tg, new LineBasicMaterial({ color: cssColor('--info', 0x4aa3ff), transparent: true, opacity: 0.35 })),
    };
    this.root.add(this.paths.done, this.paths.current, this.paths.travel);
    this.buildBed();
    if (refit) this.view('iso');
    else this.draw();
  }

  /**
   * Draws extrusion segments [from, to) with the current layer [curFrom, to) highlighted, and
   * travel [travelFrom, travelTo) when shown. Counts are segments.
   */
  showLayers(o: { from: number; curFrom: number; to: number; travelFrom: number; travelTo: number; travel: boolean }): void {
    if (!this.paths) return;
    this.paths.done.geometry.setDrawRange(o.from * 2, Math.max(0, o.curFrom - o.from) * 2);
    this.paths.current.geometry.setDrawRange(o.curFrom * 2, Math.max(0, o.to - o.curFrom) * 2);
    this.paths.travel.visible = o.travel;
    this.paths.travel.geometry.setDrawRange(o.travelFrom * 2, Math.max(0, o.travelTo - o.travelFrom) * 2);
    this.draw();
  }

  /** Measuring mode: clicks on the model pick two points (cb gets them; null = cleared). */
  setMeasure(cb: ((m: Measure | null) => void) | null): void {
    this.measuring = cb;
    this.picks = [];
    this.clearMarks();
    cb?.(null);
    this.renderer.domElement.style.cursor = cb ? 'crosshair' : '';
    this.draw();
  }

  private clearMarks(): void {
    for (const c of [...this.marks.children]) {
      this.marks.remove(c);
      const m = c as Mesh;
      m.geometry?.dispose();
      (m.material as MeshStandardMaterial | LineBasicMaterial | undefined)?.dispose?.();
    }
  }

  private pick(e: PointerEvent): void {
    const d = this.downAt;
    this.downAt = null;
    // A drag orbits the camera; only a click picks.
    if (!this.measuring || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || e.button !== 0) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const meshes: Object3D[] = [];
    this.root.traverse((x) => {
      if ((x as Mesh).isMesh && (x as Mesh).material !== this.back) meshes.push(x);
    });
    const hit = ray.intersectObjects(meshes, false).find((h) => !this.cut || this.cut.distanceToPoint(h.point) >= -1e-6);
    if (!hit) return;
    if (this.picks.length >= 2) {
      this.picks = [];
      this.clearMarks();
    }
    this.picks.push(hit.point.clone());
    const size = Math.max(this.bounds().getSize(new Vector3()).length(), 1e-3);
    const dot = new Mesh(new SphereGeometry(size / 160, 12, 8), new MeshStandardMaterial({ color: cssColor('--fg', 0xffffff), depthTest: false }));
    dot.position.copy(hit.point);
    dot.renderOrder = 10;
    this.marks.add(dot);
    const [a, b] = this.picks;
    if (a && b) {
      const g = new BufferGeometry().setFromPoints([a, b]);
      const line = new LineSegments(g, new LineBasicMaterial({ color: cssColor('--fg', 0xffffff), depthTest: false }));
      line.renderOrder = 10;
      this.marks.add(line);
    }
    const t = (v: Vector3): [number, number, number] => [v.x, v.y, v.z];
    this.measuring(b ? { a: t(a!), b: t(b), distance: a!.distanceTo(b) } : { a: t(a!) });
    this.draw();
  }

  /** Cuts the model at height z (shows what is below); null = whole model. */
  setSection(z: number | null): void {
    this.cut = z === null ? null : new Plane(new Vector3(0, 0, -1), z);
    const planes = this.cut ? [this.cut] : [];
    this.front.clippingPlanes = planes;
    this.back.clippingPlanes = planes;
    // Inside the cut the inner faces show: neutral, not the red of a broken mesh.
    this.back.color = this.cut ? cssColor('--fg-dim', 0x888888) : new Color(0xd04848);
    this.root.traverse((x) => {
      const m = x as Mesh;
      if (!m.isMesh || m.material === this.front || m.material === this.back) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (mat) mat.clippingPlanes = planes;
    });
    this.draw();
  }

  /** A mesh from triangles (Z up). Keeps the camera unless `refit` or the size changed a lot. */
  setTris(t: Float32Array, refit: boolean): void {
    const before = this.bounds();
    const was = before.isEmpty() ? 0 : before.getSize(new Vector3()).length();
    this.clearModel();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(t, 3));
    g.computeVertexNormals();
    const solid = new Mesh(g, this.front);
    const inside = new Mesh(g, this.back);
    this.root.add(solid, inside);
    this.applyWire();
    this.buildBed();
    const now = this.bounds();
    const size = now.isEmpty() ? 0 : now.getSize(new Vector3()).length();
    // A parameter that makes the model much bigger or smaller frames it again.
    if (refit || !was || size > was * 1.2 || size < was * 0.6) this.view('iso');
    else this.draw();
  }

  /** Any three.js object (a loaded GLB / FBX / 3MF); `yUp` turns it to Z up. */
  setObject(o: Object3D, yUp: boolean, refit = true): void {
    this.clearModel();
    const holder = new Group();
    if (yUp) holder.rotation.x = Math.PI / 2;
    holder.add(o);
    o.traverse((x) => {
      const m = x as Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (mat) mat.side = DoubleSide;
      }
    });
    this.root.add(holder);
    this.applyWire();
    this.buildBed();
    if (refit) this.view('iso');
    else this.draw();
  }

  /** Triangles of what is shown, in world space (Z up). */
  modelTris(): Float32Array {
    this.root.updateMatrixWorld(true);
    return trisOf(this.root);
  }

  clear(): void {
    this.clearModel();
    this.buildBed();
    this.draw();
  }

  setBed(size: [number, number]): void {
    this.bed = size;
    this.buildBed();
    this.draw();
  }

  setWire(on: boolean): void {
    this.wireframe = on;
    this.applyWire();
    this.draw();
  }

  private applyWire(): void {
    this.front.wireframe = this.wireframe;
    this.back.visible = !this.wireframe;
    this.root.traverse((x) => {
      const m = x as Mesh;
      if (m.isMesh && m.material !== this.front && m.material !== this.back) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) if (mat && 'wireframe' in mat) (mat as MeshStandardMaterial).wireframe = this.wireframe;
      }
    });
  }

  /** Print bed under the model: a grid of 10 mm cells (or 1 cm when the bed is in metres). */
  private buildBed(): void {
    for (const c of [...this.bedGroup.children]) {
      this.bedGroup.remove(c);
      (c as LineSegments).geometry?.dispose();
    }
    const b = this.bounds();
    const [bx, by] = this.bed;
    const abs = !!this.paths;
    const cx = abs ? this.bed[0] / 2 : b.isEmpty() ? 0 : (b.min.x + b.max.x) / 2;
    const cy = abs ? this.bed[1] / 2 : b.isEmpty() ? 0 : (b.min.y + b.max.y) / 2;
    const z = abs ? 0 : b.isEmpty() ? 0 : b.min.z;
    const step = bx >= 50 ? 10 : bx / 22;
    const pts: number[] = [];
    for (let x = -bx / 2; x <= bx / 2 + 1e-9; x += step) pts.push(cx + x, cy - by / 2, z, cx + x, cy + by / 2, z);
    for (let y = -by / 2; y <= by / 2 + 1e-9; y += step) pts.push(cx - bx / 2, cy + y, z, cx + bx / 2, cy + y, z);
    const grid = new BufferGeometry();
    grid.setAttribute('position', new BufferAttribute(Float32Array.from(pts), 3));
    this.bedGroup.add(new LineSegments(grid, new LineBasicMaterial({ color: cssColor('--border', 0x3a3f48), transparent: true, opacity: 0.7 })));
    // The outline turns red when the model sticks out of the bed.
    const fits = b.isEmpty() || (abs ? b.min.x >= -1 && b.min.y >= -1 && b.max.x <= bx + 1 && b.max.y <= by + 1 : b.max.x - b.min.x <= bx && b.max.y - b.min.y <= by);
    const o = [
      [-1, -1], [1, -1], [1, -1], [1, 1], [1, 1], [-1, 1], [-1, 1], [-1, -1],
    ].flatMap(([sx, sy]) => [cx + (sx! * bx) / 2, cy + (sy! * by) / 2, z]);
    const outline = new BufferGeometry();
    outline.setAttribute('position', new BufferAttribute(Float32Array.from(o), 3));
    this.bedGroup.add(new LineSegments(outline, new LineBasicMaterial({ color: fits ? cssColor('--fg-dim', 0x888888) : new Color(0xe05050) })));
  }

  view(v: ViewName): void {
    const b = this.bounds();
    const center = b.isEmpty() ? new Vector3() : b.getCenter(new Vector3());
    const size = b.isEmpty() ? 50 : Math.max(b.getSize(new Vector3()).length(), 1e-3);
    const dir =
      v === 'front' ? new Vector3(0, -1, 0.0001) : v === 'top' ? new Vector3(0, -0.0001, 1) : v === 'right' ? new Vector3(1, 0, 0.0001) : new Vector3(1, -1.2, 0.9);
    dir.normalize();
    // Fit the bounding sphere in the narrower of the two angles (a tall, thin view cuts the sides).
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    // Some air around it: the measure / cut bar sits over the bottom of the view.
    const dist = (size / 2 / Math.sin(Math.min(vHalf, hHalf))) * 1.2;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, 1e-4);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this.draw();
  }

  /** PNG of what is on screen. */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.obs.disconnect();
    window.removeEventListener(THEME_EVENT, this.onTheme);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.clearModel();
    this.front.dispose();
    this.back.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
