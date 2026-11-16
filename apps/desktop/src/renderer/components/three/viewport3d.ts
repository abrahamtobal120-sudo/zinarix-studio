/**
 * Fase 14: the interactive 3D viewport. Free orbit view (or the render camera), a move / rotate
 * / scale gizmo on the selection, click to select. Editor-only things (grid, light bulbs, the
 * camera outline, the gizmo) live on HELPER_LAYER, which the render camera never sees.
 */
import {
  CameraHelper,
  GridHelper,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { Scene3D, Vec3 } from '../../../shared/scene3d';
import { HELPER_LAYER, SceneBuilder } from './build3d';
import { poseCamera, setupRenderer } from './render3d';
import type { Gizmo } from './store3d';

export interface ViewportEvents {
  select(id: string | null): void;
  /** The gizmo moved the selection (degrees for rotation). */
  transform(id: string, position: Vec3, rotation: Vec3, scale: Vec3): void;
}

const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

function onHelperLayer(o: Object3D) {
  o.traverse((x) => x.layers.set(HELPER_LAYER));
}

export class Viewport {
  readonly builder = new SceneBuilder();
  readonly renderer: WebGLRenderer;
  private readonly editorCam = new PerspectiveCamera(45, 16 / 9, 0.05, 2000);
  private readonly renderCam = new PerspectiveCamera(40, 16 / 9, 0.05, 2000);
  private readonly controls: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly camHelper: CameraHelper;
  /** A short copy of the render camera, so its outline is a small pyramid, not 2 km of lines. */
  private readonly camProxy = new PerspectiveCamera(40, 16 / 9, 0.1, 0.8);
  private readonly disposeEnv: () => void;
  private raf = 0;
  private dragging = false;
  private down: { x: number; y: number } | null = null;
  private scene3d: Scene3D | null = null;
  private time = 0;
  private selected: string | null = null;
  private viewCam = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly on: ViewportEvents,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);
    const scene = this.builder.scene;
    this.disposeEnv = setupRenderer(this.renderer, scene);
    this.editorCam.position.set(5, 3.5, 7);
    this.editorCam.layers.enable(HELPER_LAYER);
    this.controls = new OrbitControls(this.editorCam, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 0);
    this.gizmo = new TransformControls(this.editorCam, canvas);
    this.gizmo.setSize(0.9);
    const helper = this.gizmo.getHelper();
    onHelperLayer(helper);
    scene.add(helper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.dragging = !!(e as unknown as { value: boolean }).value;
      this.controls.enabled = !this.dragging;
    });
    this.gizmo.addEventListener('objectChange', () => this.emitTransform());
    const grid = new GridHelper(20, 20, 0x666c78, 0x3a3f48);
    onHelperLayer(grid);
    scene.add(grid);
    this.camHelper = new CameraHelper(this.camProxy);
    onHelperLayer(this.camHelper);
    scene.add(this.camHelper);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointerup', this.onUp);
    this.builder.onChange = () => this.attach();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  private frame() {
    this.controls.update();
    if (this.scene3d) poseCamera(this.renderCam, this.scene3d, this.time);
    this.renderCam.aspect = this.editorCam.aspect;
    this.renderCam.updateProjectionMatrix();
    this.camProxy.position.copy(this.renderCam.position);
    this.camProxy.quaternion.copy(this.renderCam.quaternion);
    this.camProxy.fov = this.renderCam.fov;
    this.camProxy.aspect = this.renderCam.aspect;
    this.camProxy.updateProjectionMatrix();
    this.camProxy.updateMatrixWorld();
    this.camHelper.update();
    this.camHelper.visible = !this.viewCam;
    this.renderer.render(this.builder.scene, this.viewCam ? this.renderCam : this.editorCam);
  }

  /** The scene, the playhead, the selection, the camera choice and the gizmo mode. */
  update(s: Scene3D, t: number, selected: string | null, viewCam: boolean, mode: Gizmo): void {
    this.scene3d = s;
    this.time = t;
    this.viewCam = viewCam;
    // While dragging, the store already holds what the gizmo shows: no re-pose fighting it.
    if (!this.dragging) this.builder.sync(s, t);
    this.selected = selected;
    this.gizmo.setMode(mode);
    // Through the render camera the gizmo would move with it: only in the free view.
    this.gizmo.camera = this.editorCam;
    this.gizmo.enabled = !viewCam;
    this.attach();
  }

  private attach() {
    const n = this.scene3d?.nodes.find((x) => x.id === this.selected);
    const obj = n && n.visible && !this.viewCam ? this.builder.objectOf(n.id) : undefined;
    // Ambient light has no place to move; directional and point lights only move.
    if (n && obj && !(n.kind === 'light' && n.light?.type === 'ambient')) {
      if (this.gizmo.object !== obj) this.gizmo.attach(obj);
      if (n.kind === 'light') this.gizmo.setMode('translate');
    } else if (this.gizmo.object) this.gizmo.detach();
  }

  private emitTransform() {
    const o = this.gizmo.object;
    const id = o?.userData.nodeId as string | undefined;
    if (!o || !id) return;
    this.on.transform(
      id,
      [r4(o.position.x), r4(o.position.y), r4(o.position.z)],
      [deg(o.rotation.x), deg(o.rotation.y), deg(o.rotation.z)],
      [r4(o.scale.x), r4(o.scale.y), r4(o.scale.z)],
    );
  }

  private onDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || this.dragging || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const rect = this.canvas.getBoundingClientRect();
    const p = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new Raycaster();
    ray.layers.enableAll();
    ray.setFromCamera(p, this.viewCam ? this.renderCam : this.editorCam);
    for (const hit of ray.intersectObjects(this.builder.scene.children, true)) {
      let o: Object3D | null = hit.object;
      while (o && !o.userData.nodeId) o = o.parent;
      if (o && o.visible) {
        this.on.select(o.userData.nodeId as string);
        return;
      }
    }
    this.on.select(null);
  };

  /** Fits the canvas to its box at the scene's aspect (what you see is the frame). */
  resize(boxW: number, boxH: number, aspect: number): { w: number; h: number } {
    let w = boxW;
    let h = w / aspect;
    if (h > boxH) {
      h = boxH;
      w = h * aspect;
    }
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.editorCam.aspect = aspect;
    this.editorCam.updateProjectionMatrix();
    return { w, h };
  }

  /** The free view as a camera position and target (for "use current view"). */
  editorView(): { position: Vec3; target: Vec3 } {
    const p = this.editorCam.position;
    const t = this.controls.target;
    return { position: [r4(p.x), r4(p.y), r4(p.z)], target: [r4(t.x), r4(t.y), r4(t.z)] };
  }

  /** Frames the selection (F). */
  focus(id: string | null): void {
    const o = id ? this.builder.objectOf(id) : undefined;
    const target = o
      ? o.getWorldPosition(this.controls.target.clone())
      : this.controls.target.set(0, 0, 0);
    const dir = this.editorCam.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(target);
    this.editorCam.position.copy(target.clone().add(dir.multiplyScalar(6)));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.gizmo.detach();
    this.gizmo.dispose();
    this.controls.dispose();
    this.builder.dispose();
    this.disposeEnv();
    this.renderer.dispose();
  }
}
