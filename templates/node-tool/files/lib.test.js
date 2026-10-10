const test = require('node:test');
const assert = require('node:assert');
const { run } = require('./lib');

test('run returns a string', () => {
  assert.strictEqual(typeof run('x'), 'string');
});
