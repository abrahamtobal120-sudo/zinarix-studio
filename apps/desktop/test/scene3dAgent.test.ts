import { describe, expect, it } from 'vitest';
import { newScene, poseAt } from '../src/shared/scene3d';
import { applyScene3dOps, describeOps, findNode, sceneStateText } from '../src/shared/scene3dAgent';
import { scene3dPreview } from '../src/main/scene3dTools';

describe('scene3d agent ops', () => {
  it('adds, names, colours and animates in one call', () => {
    const s = newScene();
    const r = applyScene3dOps(s, [
      { op: 'add', shape: 'sphere', name: 'Bola', color: '#ff0000', position: [0, 1, 0] },
      { op: 'key', id: 'Bola', prop: 'py', t: 0, v: 1 },
      { op: 'key', id: 'Bola', prop: 'py', t: 2, v: 3, ease: 'bounce' },
    ]);
    const b = findNode(r.scene, 'bola')!;
    expect(b.shape).toBe('sphere');
    expect(b.material!.color).toBe('#ff0000');
    expect(poseAt(b, 2).position[1]).toBeCloseTo(3);
    expect(r.lastAdded).toBe(b.id);
    expect(r.scene.nodes.length).toBe(s.nodes.length + 1);
    expect(r.summary).toContain('agregó');
  });

  it('sets, duplicates and deletes by id or name', () => {
    const s = newScene();
    const box = s.nodes.find((n) => n.shape === 'box')!;
    const r = applyScene3dOps(s, [
      { op: 'set', id: box.id, scale: [2, 2, 2], metalness: 1 },
      { op: 'duplicate', id: box.id, name: 'Copia', position: [3, 0, 0] },
      { op: 'delete', id: 'Luz ambiente' },
    ]);
    expect(findNode(r.scene, box.id)!.scale).toEqual([2, 2, 2]);
    expect(findNode(r.scene, box.id)!.material!.metalness).toBe(1);
    expect(findNode(r.scene, 'Copia')!.position).toEqual([3, 0, 0]);
    expect(r.scene.nodes.some((n) => n.light?.type === 'ambient')).toBe(false);
  });

  it('moves and animates the camera, changes scene settings', () => {
    const r = applyScene3dOps(newScene(), [
      { op: 'camera', position: [0, 2, 8], fov: 50 },
      { op: 'key', id: 'camera', prop: 'px', t: 0, v: -4 },
      { op: 'key', id: 'camera', prop: 'px', t: 4, v: 4 },
      { op: 'scene', duration: 6, background: '#202020' },
    ]);
    expect(r.scene.camera.fov).toBe(50);
    expect(r.scene.camera.keys!.px!.length).toBe(2);
    expect(r.scene.duration).toBe(6);
    expect(r.scene.transparent).toBe(false);
  });

  it('a bad op changes nothing and says which op failed', () => {
    const s = newScene();
    expect(() =>
      applyScene3dOps(s, [
        { op: 'add', shape: 'sphere' },
        { op: 'set', id: 'nope' },
      ]),
    ).toThrow(/op 2: no node/);
    expect(() => applyScene3dOps(s, [{ op: 'add', shape: 'teapot' }])).toThrow(/shape/);
    expect(() => applyScene3dOps(s, [{ op: 'key', id: 'camera', prop: 'rx', v: 1 }])).toThrow();
    expect(() => applyScene3dOps(s, [])).toThrow();
  });

  it('clamps values through sanitizeScene and refuses non-absolute models', () => {
    const r = applyScene3dOps(newScene(), [{ op: 'add', position: [1e9, 0, 0], opacity: 5 }]);
    const n = r.scene.nodes[r.scene.nodes.length - 1]!;
    expect(n.position[0]).toBe(1000);
    expect(n.material!.opacity).toBe(1);
    expect(() =>
      applyScene3dOps(newScene(), [{ op: 'add', kind: 'model', model: 'x.glb' }]),
    ).toThrow(/absolute/);
  });

  it('clears keys and replaces with a template', () => {
    let s = applyScene3dOps(newScene(), [
      { op: 'add', name: 'A' },
      { op: 'key', id: 'A', prop: 'ry', t: 0, v: 0 },
      { op: 'key', id: 'A', prop: 'ry', t: 1, v: 90 },
    ]).scene;
    s = applyScene3dOps(s, [{ op: 'clear_keys', id: 'A' }]).scene;
    expect(findNode(s, 'A')!.keys).toBeUndefined();
    const t = applyScene3dOps(s, [{ op: 'template', template: 'logo', text: 'Hola' }]).scene;
    expect(t.nodes.some((n) => n.text === 'Hola')).toBe(true);
  });

  it('describes the state and the ops for the model and the approval card', () => {
    const s = newScene();
    const txt = sceneStateText(s, null, true);
    for (const n of s.nodes) expect(txt).toContain(n.id);
    expect(describeOps([{ op: 'add', shape: 'sphere', name: 'Bola' }])).toContain('Bola');
    expect(scene3dPreview('scene3d_state', {})).toBeNull();
    expect(scene3dPreview('scene3d_edit', { ops: [{ op: 'delete', id: 'x' }] }).allowKey).toBe(
      'scene3d_edit',
    );
  });
});
