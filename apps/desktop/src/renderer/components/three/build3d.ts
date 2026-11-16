/**
 * Fase 14: turns a Scene3D (plain JSON) into three.js objects and poses them at a time.
 * The editor viewport and the video render use the same builder, so what you see is what
 * gets rendered (the editor only adds helpers on layer 1, which the render camera skips).
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
// Droid Sans (Apache-2.0, NOTICE in three/examples/fonts/droid) for the 3D text.
import fontUrl from 'three/examples/fonts/droid/droid_sans_bold.typeface.json?url';
import { poseAt, type Material3D, type Node3D, type Scene3D } from '../../../shared/scene3d';
import { api } from '../../store';

export const HELPER_LAYER = 1;

let fontP: Promise<Font> | null = null;
export const loadFont = (): Promise<Font> => (fontP ??= new FontLoader().loadAsync(fontUrl));

/** Loaded models by path (each node gets a clone). */
const models = new Map<string, Promise<Object3D>>();

async function loadModel(path: string): Promise<Object3D> {
  const url = await api().scene3d.modelUrl(path);
  if (!url) throw new Error(`No se encuentra el modelo ${path}`);
  const ext = path.toLowerCase().split('.').pop();
  if (ext === 'glb' || ext === 'gltf') return (await new GLTFLoader().loadAsync(url)).scene;
  if (ext === 'obj') return new OBJLoader().loadAsync(url);
  if (ext === 'fbx') return new FBXLoader().loadAsync(url);
  throw new Error('Formato de modelo no compatible');
}

const modelOf = (path: string) => {
  let p = models.get(path);
  if (!p) {
    p = loadModel(path);
    p.catch(() => models.delete(path));
    models.set(path, p);
  }
  return p;
};

function geometryOf(n: Node3D, font: Font | null): BufferGeometry {
  switch (n.shape) {
    case 'sphere':
      return new SphereGeometry(0.5, 48, 24);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1, 48);
    case 'cone':
      return new ConeGeometry(0.5, 1, 48);
    case 'torus':
      return new TorusGeometry(0.5, 0.18, 24, 96);
    case 'plane':
      return new PlaneGeometry(1, 1);
    case 'text': {
      if (!font) return new BoxGeometry(0.01, 0.01, 0.01);
      const g = new TextGeometry(n.text || ' ', {
        font,
        size: 1,
        depth: n.depth ?? 0.25,
        curveSegments: 10,
        bevelEnabled: true,
        bevelThickness: 0.01,
        bevelSize: 0.01,
        bevelSegments: 2,
      });
      g.center();
      return g;
    }
    default:
      return new BoxGeometry(1, 1, 1);
  }
}

function materialOf(m: Material3D): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: new Color(m.color),
    metalness: m.metalness,
    roughness: m.roughness,
    emissive: new Color(m.emissive),
    emissiveIntensity: m.emissiveIntensity,
    transparent: m.opacity < 1,
    opacity: m.opacity,
    side: 2, // DoubleSide: planes and open models read from both sides
  });
}

/** What forces a rebuild (everything but the pose). */
const shapeSig = (n: Node3D) =>
  JSON.stringify([
    n.kind,
    n.shape,
    n.text,
    n.depth,
    n.model,
    n.material,
    n.light?.type,
    n.light?.color,
  ]);

interface Built {
  sig: string;
  root: Object3D;
  /** The light (for intensity), when the node is one. */
  light?: AmbientLight | DirectionalLight | PointLight;
  /** Objects outside root (a directional light's target). */
  extra?: Object3D;
}

function disposeTree(o: Object3D) {
  o.traverse((x) => {
    const m = x as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as Material | Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((y) => y.dispose());
    else mat?.dispose();
  });
}

/** Fits a loaded model to 2 m and centres it (Blender's bridge does the same). */
function fitted(src: Object3D): Object3D {
  const holder = new Group();
  const copy = src.clone(true);
  const box = new Box3().setFromObject(copy);
  const size = box.getSize(new Vector3());
  const c = box.getCenter(new Vector3());
  const s = 2 / (Math.max(size.x, size.y, size.z) || 1);
  copy.position.sub(c);
  holder.scale.setScalar(s);
  holder.add(copy);
  return holder;
}

export class SceneBuilder {
  readonly scene = new Scene();
  private built = new Map<string, Built>();
  private pending = new Set<Promise<unknown>>();
  private font: Font | null = null;
  onChange: () => void = () => {};
  /** Node id → its root object (for picking and the gizmo). */
  objectOf = (id: string): Object3D | undefined => this.built.get(id)?.root;

  constructor() {
    const p = loadFont().then((f) => {
      this.font = f;
      // Text built before the font arrived: rebuild it.
      for (const [id, b] of this.built) if (b.sig.includes('"text"')) this.drop(id);
      this.onChange();
    });
    this.track(p);
  }

  private track(p: Promise<unknown>) {
    this.pending.add(p);
    void p.catch(() => {}).finally(() => this.pending.delete(p));
  }

  /** Resolves when fonts and models requested so far are loaded. */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private drop(id: string) {
    const b = this.built.get(id);
    if (!b) return;
    b.root.removeFromParent();
    b.extra?.removeFromParent();
    // Model clones share geometry with the cache: only shapes are disposed.
    if (!b.sig.startsWith('["model"')) disposeTree(b.root);
    this.built.delete(id);
  }

  private build(n: Node3D): Built {
    const root = new Group();
    root.name = n.name;
    root.userData.nodeId = n.id;
    if (n.kind === 'light' && n.light) {
      const c = new Color(n.light.color);
      const light =
        n.light.type === 'ambient'
          ? new AmbientLight(c, n.light.intensity)
          : n.light.type === 'directional'
            ? new DirectionalLight(c, n.light.intensity)
            : new PointLight(c, n.light.intensity, 0, 2);
      root.add(light);
      // A directional light shines from its position towards the origin.
      const extra = light instanceof DirectionalLight ? light.target : undefined;
      if (extra) this.scene.add(extra);
      if (n.light.type !== 'ambient') {
        const bulb = new Mesh(
          new SphereGeometry(0.12, 16, 8),
          new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1 }),
        );
        bulb.layers.set(HELPER_LAYER);
        bulb.userData.nodeId = n.id;
        root.add(bulb);
      }
      return { sig: shapeSig(n), root, light, extra };
    }
    if (n.kind === 'model' && n.model) {
      const p = modelOf(n.model).then((src) => {
        // Dropped (or rebuilt) while loading.
        if (this.built.get(n.id)?.root !== root) return;
        const fit = fitted(src);
        if (n.material) {
          const mat = materialOf(n.material);
          fit.traverse((x) => {
            if ((x as Mesh).isMesh) (x as Mesh).material = mat;
          });
        }
        fit.traverse((x) => (x.userData.nodeId = n.id));
        root.add(fit);
        this.onChange();
      });
      this.track(p);
      return { sig: shapeSig(n), root };
    }
    const mesh = new Mesh(geometryOf(n, this.font), materialOf(n.material!));
    mesh.userData.nodeId = n.id;
    root.add(mesh);
    return { sig: `${shapeSig(n)}${n.shape === 'text' && !this.font ? '#nofont' : ''}`, root };
  }

  /** Builds what changed and poses everything at scene time t. */
  sync(s: Scene3D, t: number): void {
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const id of [...this.built.keys()]) if (!ids.has(id)) this.drop(id);
    for (const n of s.nodes) {
      let b = this.built.get(n.id);
      const sig = shapeSig(n);
      if (b && b.sig !== sig && !(b.sig === `${sig}#nofont` && !this.font)) {
        this.drop(n.id);
        b = undefined;
      }
      if (!b) {
        b = this.build(n);
        this.built.set(n.id, b);
        this.scene.add(b.root);
      }
      const pose = poseAt(n, t);
      b.root.visible = n.visible;
      b.root.position.set(...pose.position);
      b.root.rotation.set(
        (pose.rotation[0] * Math.PI) / 180,
        (pose.rotation[1] * Math.PI) / 180,
        (pose.rotation[2] * Math.PI) / 180,
        'XYZ',
      );
      if (n.kind !== 'light') b.root.scale.set(...pose.scale);
      if (b.light) b.light.intensity = Math.max(0, pose.intensity);
    }
    this.scene.background = s.transparent ? null : new Color(s.background);
  }

  dispose(): void {
    for (const id of [...this.built.keys()]) this.drop(id);
  }
}
