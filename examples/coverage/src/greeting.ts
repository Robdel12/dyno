export function greeting(name: string): string {
  if (!name.trim()) return 'Please enter a name.';
  return `Hello, ${name.trim()}!`;
}
