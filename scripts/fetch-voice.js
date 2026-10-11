// Downloads speech recognition into vendor/voice so the installer can ship it.
const path = require('path');
process.env.EMBER_HOME = path.join(__dirname, '..', 'vendor');
const voice = require('../server/voice');

if (voice.status().installed) {
  console.log('speech recognition is already in vendor/voice');
} else {
  voice.bus.on('progress', (p) => {
    if (!p.done) return void process.stdout.write('\r' + p.status + ' ' + p.percent + '%');
    if (p.error) {
      console.error('\n' + p.error);
      process.exit(1);
    }
    console.log('\nspeech recognition is ready');
  });
  voice.install();
}
