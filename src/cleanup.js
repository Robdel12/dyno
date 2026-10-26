async function runCleanups(steps) {
  let errors = [];
  for (let step of steps.toReversed()) {
    try { await step(); } catch (error) { errors = [...errors, error]; }
  }
  return Object.freeze(errors);
}

export function createCleanup() {
  let steps = [];
  let completion;
  return Object.freeze({
    add(step) {
      if (completion) throw new Error('Cleanup has already started.');
      if (typeof step !== 'function') throw new Error('Cleanup requires a function.');
      steps = [...steps, step];
    },
    run() {
      completion ??= runCleanups(steps);
      return completion;
    }
  });
}
