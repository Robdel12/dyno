export let defaultViewport = Object.freeze({ width: 1280, height: 800 });

export function validViewport(value, limit = 16384) {
  return Boolean(
    value && ['width', 'height'].every((key) => Number.isInteger(value[key]) && value[key] > 0 && value[key] <= limit)
  );
}

export function normalizeViewport(value) {
  if (!validViewport(value)) throw new Error('App viewport dimensions must be integers between 1 and 16384 CSS pixels.');
  return Object.freeze({ width: value.width, height: value.height });
}
