// Browser stand-in for `node:test` (see browser-harness.html).
// Runs each test synchronously and records the outcome.
export const results = [];

export default function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: String(e) });
  }
}
