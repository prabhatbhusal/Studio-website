import type { SceneDoc } from '../../@types/scene.types';

export interface RecoveryCopy { version: 1; account: string; scene: string; revision: number; at: string; doc: SceneDoc }
export const recoveryKey = (account: string, scene: string) => `studio-recovery:v1:${encodeURIComponent(account)}:${encodeURIComponent(scene)}`;
const vector = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

/** Reject incomplete or unrelated browser records before offering recovery. */
export function readRecovery(raw: string | null, account: string, scene: string): RecoveryCopy | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as RecoveryCopy;
    const d = r.doc;
    if (r.version !== 1 || r.account !== account || r.scene !== scene || d?.id !== scene ||
      !Number.isInteger(r.revision) || r.revision < 0 || !Number.isFinite(Date.parse(r.at)) ||
      typeof d.title !== 'string' || !Array.isArray(d.hotspots) || !Array.isArray(d.tracks) ||
      !Array.isArray(d.colliders) || !vector(d.transform?.position) || !vector(d.transform?.rotation) ||
      !(d.transform.scale > 0) || !Number.isFinite(d.transform.scale) || !(d.unitScale > 0) || !Number.isFinite(d.unitScale) ||
      !vector(d.spawn?.position) || !Number.isFinite(d.spawn.yaw) || (d.revision ?? 0) !== r.revision ||
      !d.hotspots.every(h => h && typeof h.id === 'string' && vector(h.position)) ||
      !d.colliders.every(c => c && typeof c.id === 'string' && vector(c.position) && vector(c.size)) ||
      !d.tracks.every(t => t && typeof t.id === 'string' && Array.isArray(t.keyframes) &&
        t.keyframes.every(k => k && vector(k.position) && vector(k.target) && Number.isFinite(k.t)))) return null;
    return r;
  } catch { return null; }
}

export const canRecover = (copy: RecoveryCopy, current: SceneDoc) =>
  copy.scene === current.id && copy.doc.propertyId === current.propertyId && copy.revision === (current.revision ?? 0);
