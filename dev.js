const os = require('os');
const path = require('path');
process.env.EMBER_HOME = path.join(os.tmpdir(), 'ember-dev-home');
process.env.EMBER_PROJECTS = path.join(os.tmpdir(), 'ember-dev-projects');
require('./server/index.js')
  .start(Number(process.env.PORT) || 4317)
  .then(({ url }) => console.log('Ember (dev): ' + url));
