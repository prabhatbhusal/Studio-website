# Studio draft recovery

Implemented on 2026-10-29. The open editor stores unsaved scene edits in sessionStorage every 1.5 seconds, on page exit, and when switching spaces. Keys include account and scene IDs; browser tabs remain independent. This protects reloads, not guaranteed recovery after closing the tab or clearing browser data. It does not autosave to the API or publish anything.

On reopening a space, the inspector offers Restore edits, Download copy, and Discard copy. Restoration requires a loaded draft with matching revision and project, and no current unsaved edits. Editable scene fields are restored; server-owned asset and ownership fields stay intact. The existing server revision check still protects the eventual save. Quota or storage failures show a message directing the user to save to the server.

Verification: full test suite 202 passed, one skipped; targeted recovery tests cover account isolation, malformed copies, and revision/project conflicts. TypeScript passed; targeted lint has only the existing EditorShell image warning. Browser fixture checks cover capture, explicit restoration after reload, removal after save, discard, and revision conflict at 1440px and 390px. No real project data was used.

Browser evidence: evidence/recovery-browser.json and recovery-390.png / recovery-1440.png. The temporary route was removed before the final production build. To reproduce that fixture-only browser check, temporarily place recovery-fixture.tsx.txt at src/app/recovery-check/page.tsx, build .next-new, run preview-recovery.mjs, then remove the temporary route and rebuild. The saved script mocks read requests and rejects API writes.
