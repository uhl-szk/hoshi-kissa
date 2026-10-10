const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = path.resolve(__dirname, '..', 'count-bot.js');
const source = fs.readFileSync(script, 'utf8');
const legacyEnvironment = {
  BOT_COUNT_RUN_ONCE: 'true',
  SYNC_BOT_COUNT_TO_GIT: 'true',
  BOT_COUNT_SOURCE_FILE: 'source-counts.json'
};

function route(args = [], env = {}) {
  const required = [];
  vm.runInNewContext(source, {
    process: { argv: ['node', script, ...args], env },
    require(name) { required.push(name); }
  }, { filename: script });
  return required;
}

test('legacy publication invokes only the publisher without loading a Discord client', () => {
  assert.deepEqual(route(['--once'], legacyEnvironment), ['./sync-bot-count.js']);
});

test('ordinary launcher startup invokes only the collector', () => {
  assert.deepEqual(route(), ['./discord-count-bot.js']);
});

test('direct one-shot startup remains a Discord collection', () => {
  assert.deepEqual(route(['--once']), ['./discord-count-bot.js']);
});

test('a stale inherited source setting cannot change normal or one-shot collection into publication', () => {
  const env = { BOT_COUNT_SOURCE_FILE: 'obsolete-counts.json' };
  assert.deepEqual(route([], env), ['./discord-count-bot.js']);
  assert.deepEqual(route(['--once'], env), ['./discord-count-bot.js']);
});

test('partial legacy settings cannot invoke the publisher', () => {
  assert.deepEqual(route([], legacyEnvironment), ['./discord-count-bot.js']);
  for (const key of Object.keys(legacyEnvironment)) {
    const env = { ...legacyEnvironment };
    delete env[key];
    assert.deepEqual(route(['--once'], env), ['./discord-count-bot.js'], `missing ${key}`);
  }
  for (const key of ['BOT_COUNT_RUN_ONCE', 'SYNC_BOT_COUNT_TO_GIT']) {
    assert.deepEqual(route(['--once'], { ...legacyEnvironment, [key]: 'false' }),
      ['./discord-count-bot.js'], `${key} is disabled`);
  }
  assert.deepEqual(route(['--once'], { ...legacyEnvironment, BOT_COUNT_SOURCE_FILE: '' }),
    ['./discord-count-bot.js'], 'no source data was specified');
});
