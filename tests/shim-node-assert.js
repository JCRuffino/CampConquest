// Browser stand-in for `node:assert/strict` (see browser-harness.html).
function fail(msg) { throw new Error(msg); }

const assert = {
  ok(v, msg) { if (!v) fail(msg || 'expected truthy, got ' + v); },
  equal(a, b, msg) { if (a !== b) fail(msg || a + ' !== ' + b); },
  notEqual(a, b, msg) { if (a === b) fail(msg || a + ' === ' + b); },
  deepEqual(a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fail(msg || JSON.stringify(a) + ' != ' + JSON.stringify(b));
    }
  },
};

export default assert;
