export async function createAdapter({ perform }) {
  return Object.freeze({
    name: 'direct-playwright',
    clock: 'node',
    invoke: perform,
    dispose: async () => {},
  });
}
