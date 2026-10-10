#!/usr/bin/env node
const { run } = require('./lib');

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: my-tool <input>');
  process.exit(0);
}
console.log(run(args[0] || ''));
