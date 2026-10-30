import { AsyncLocalStorage } from 'node:async_hooks';

// JSON stores have no transactions. Serialize mutations within the single API
// process, including nested calls, so a whole-file write cannot lose a patch.
const context = new AsyncLocalStorage();
const tails = new Map();
export function serialMutation(fn, key = 'data') {
  return (...args) => {
    const current = context.getStore();
    if (current?.active && current.key === key) return fn(...args);
    const run = (tails.get(key) ?? Promise.resolve()).then(async () => {
      const scope = { active: true, key };
      try { return await context.run(scope, () => fn(...args)); }
      finally { scope.active = false; }
    });
    tails.set(key, run.catch(() => {}));
    return run;
  };
}
