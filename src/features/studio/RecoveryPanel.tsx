'use client';

import { useEffect, useState } from 'react';
import { useSession } from '../auth/useSession';
import { docLoaded, hasUnsavedChanges, sceneDocFor, recoverSceneEdits } from '../scene/sceneDoc';
import { canRecover, readRecovery, recoveryKey, type RecoveryCopy } from './draftRecovery';

/** sessionStorage isolates concurrent tabs and retains edits across reloads. */
export function DraftRecovery({ sceneId }: { sceneId: string }) {
  const [user] = useSession();
  const [pending, setPending] = useState<RecoveryCopy | null>(null);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const account = user?.id;

  useEffect(() => {
    setPending(null); setReady(false); setMessage('');
    if (!account) return;
    try {
      const raw = sessionStorage.getItem(recoveryKey(account, sceneId));
      const copy = readRecovery(raw, account, sceneId);
      setPending(copy);
      if (raw && !copy) setMessage('An unreadable recovery copy was found. Save this space to the server to protect your work.');
      setReady(!raw || !!copy);
    } catch { setMessage('Browser recovery is unavailable. Save this space to the server to protect your work.'); }
  }, [account, sceneId]);

  useEffect(() => {
    if (!account || !ready || pending) return;
    let last = '';
    const capture = () => {
      if (!docLoaded(sceneId)) return;
      try {
        const key = recoveryKey(account, sceneId);
        if (!hasUnsavedChanges(sceneId)) { sessionStorage.removeItem(key); if (last) setMessage(''); last = ''; return; }
        const doc = structuredClone(sceneDocFor(sceneId));
        const json = JSON.stringify(doc);
        if (last === json) return;
        sessionStorage.setItem(key, JSON.stringify({ version: 1, account, scene: sceneId, revision: doc.revision ?? 0, at: new Date().toISOString(), doc } satisfies RecoveryCopy));
        last = json;
        setMessage('Recovery copy kept in this browser tab. Save space to keep it on the server.');
      } catch { setMessage('Browser recovery could not be updated. Save this space to the server to protect your work.'); }
    };
    const timer = setInterval(capture, 1500);
    window.addEventListener('pagehide', capture);
    window.addEventListener('beforeunload', capture);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', capture); window.removeEventListener('beforeunload', capture); capture(); };
  }, [account, sceneId, ready, pending]);

  if (!account || (!pending && !message)) return null;
  const compatible = pending && docLoaded(sceneId) && canRecover(pending, sceneDocFor(sceneId));
  const clear = () => {
    try { sessionStorage.removeItem(recoveryKey(account, sceneId)); setPending(null); setMessage(''); }
    catch { setMessage('Could not remove the browser recovery copy.'); }
  };
  const restore = () => {
    if (!pending || hasUnsavedChanges(sceneId)) return;
    try { recoverSceneEdits(sceneId, pending.doc); setPending(null); setMessage('Recovered edits. Review the space, then save when ready.'); }
    catch (error) { setMessage((error as Error).message); }
  };
  const download = () => {
    if (!pending) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pending.doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'studio-draft-recovery.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="ed2-recovery" aria-label="Draft recovery">
    {pending && <>
      <span>Unsaved recovery copy from {new Date(pending.at).toLocaleString()}.</span>
      {!compatible && <span>The server draft differs or is still loading. Download the copy to review it.</span>}
      {compatible && hasUnsavedChanges(sceneId) && <span>Current edits must be saved before restoring an older copy.</span>}
      <button disabled={!compatible || hasUnsavedChanges(sceneId)} onClick={restore}>Restore edits</button>
      <button onClick={download}>Download copy</button>
      <button onClick={clear}>Discard copy</button>
    </>}
    {message && <span role="status">{message}</span>}
  </aside>;
}
