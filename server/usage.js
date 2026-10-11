const fs = require('fs');
const os = require('os');
const path = require('path');

// A small diary of how much the app was used, one entry per day. It never leaves the computer.
const FILE = path.join(process.env.EMBER_HOME || path.join(os.homedir(), '.ember'), 'usage.json');

let days = {};
try {
  days = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    try {
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(days));
      fs.renameSync(FILE + '.tmp', FILE);
    } catch {}
  }, 2000);
}

function today() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (!days[key]) days[key] = { messages: 0, in: 0, out: 0, chats: [], hours: {}, models: {} };
  return days[key];
}

function message(chatId) {
  const day = today();
  const hour = new Date().getHours();
  day.messages++;
  day.hours[hour] = (day.hours[hour] || 0) + 1;
  if (chatId && !day.chats.includes(chatId)) day.chats.push(chatId);
  save();
}

function tokens(model, tokensIn, tokensOut) {
  const day = today();
  day.in += tokensIn;
  day.out += tokensOut;
  const m = day.models[model] || (day.models[model] = { in: 0, out: 0 });
  m.in += tokensIn;
  m.out += tokensOut;
  save();
}

module.exports = { message, tokens, read: () => days };
