/**
 * Fase 14: renders a Scene3D to a video file with the viewer's own builder: each frame is drawn
 * at full size on a hidden canvas, read back and streamed to FFmpeg in the main process.
 */
import {
  AgXToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  SRGBColorSpace,
  WebGLRenderer,
  type Scene,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  cameraAt,
  frameCount,
  frameTime,
  straightTopDown,
  type Render3DFormat,
  type Scene3D,
} from '../../../shared/scene3d';
import type { Render3DResult } from '../../../shared/api';
import { api } from '../../store';
import { SceneBuilder } from './build3d';

/** Same look in the editor and the render: AgX tone mapping (as Blender) and a soft studio reflection. */
export function setupRenderer(r: WebGLRenderer, scene: Scene): () => void {
  r.outputColorSpace = SRGBColorSpace;
  r.toneMapping = AgXToneMapping; // Blender's default view transform too
  r.toneMappingExposure = 1;
  const pmrem = new PMREMGenerator(r);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();
  return () => env.dispose();
}

export function poseCamera(cam: PerspectiveCamera, s: Scene3D, t: number): void {
  const c = cameraAt(s.camera, t);
  cam.fov = c.fov;
  cam.position.set(...c.position);
  cam.lookAt(...c.target);
  cam.updateProjectionMatrix();
}

export async function renderToFile(
  s: Scene3D,
  o: {
    name: string;
    format: Render3DFormat;
    onProgress?: (k: number) => void;
    signal?: AbortSignal;
  },
): Promise<Render3DResult> {
  const { width: W, height: H } = s;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const r = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  r.setClearColor(0x000000, 0);
  const builder = new SceneBuilder();
  const disposeEnv = setupRenderer(r, builder.scene);
  const cam = new PerspectiveCamera(s.camera.fov, W / H, 0.05, 2000);
  const gl = r.getContext();
  const raw = new Uint8Array(W * H * 4);
  const job = await api().scene3d.begin({
    width: W,
    height: H,
    fps: s.fps,
    format: o.format,
    name: o.name,
  });
  try {
    builder.sync(s, 0);
    await builder.ready();
    builder.sync(s, 0);
    const n = frameCount(s);
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new DOMException('canceled', 'AbortError');
      const t = frameTime(s, i);
      builder.sync(s, t);
      poseCamera(cam, s, t);
      r.render(builder.scene, cam);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
      // A fresh buffer per frame: IPC copies it, and the next frame must not overwrite it first.
      await api().scene3d.frame(job.id, straightTopDown(raw, W, H, new Uint8Array(W * H * 4)));
      o.onProgress?.((i + 1) / n);
    }
    return await api().scene3d.end(job.id);
  } catch (e) {
    await api()
      .scene3d.cancel(job.id)
      .catch(() => {});
    throw e;
  } finally {
    disposeEnv();
    builder.dispose();
    r.dispose();
    r.forceContextLoss();
  }
}
