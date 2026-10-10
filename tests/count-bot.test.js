const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'discord-count-bot.js');
const source = fs.readFileSync(script, 'utf8');
const dataFile = path.join(root, 'data', 'bot-count.json');
const siteScript = path.resolve(root, '..', 'hoshi-kissa', 'sync-bot-count.js');

function collection(botFlags) {
  const entries = new Map(botFlags.map((bot, index) => [String(index), { user: { bot } }]));
  entries.filter = predicate => new Map([...entries].filter(([, member]) => predicate(member)));
  return entries;
}

function harness(options = {}) {
  const previousData = JSON.stringify({ total: 9, bot: 1, human: 8, updatedAt: '2026-01-01T00:00:00Z' });
  const state = {
    files: new Map([[dataFile, previousData]]),
    previousData,
    events: [],
    executions: [],
    intervals: [],
    errors: [],
    guildFetches: 0,
    memberFetches: 0,
    members: collection([false, true, false]),
    cachedMembers: collection([false, true, false, false]),
    memberFetch: null,
    renameError: null,
    spawnError: null,
    ready: null,
    destroyed: false,
    clientEvents: {},
    dotenvOptions: null
  };
  class Client {
    constructor(options) {
      state.intents = options.intents;
      this.user = { tag: 'test-client' };
      this.guilds = {
        fetch: async guildId => {
          state.guildFetches++;
          assert.equal(guildId, 'test-guild');
          return {
            members: {
              cache: state.cachedMembers,
              fetch: async () => {
                state.memberFetches++;
                return state.memberFetch ? state.memberFetch() : state.members;
              }
            }
          };
        }
      };
    }
    once(event, callback) {
      assert.equal(event, 'clientReady');
      state.ready = callback;
    }
    on(event, callback) {
      state.clientEvents[event] = callback;
    }
    destroy() {
      state.destroyed = true;
    }
    login(token) {
      assert.equal(token, 'test-token');
      return options.loginError ? Promise.reject(options.loginError) : Promise.resolve();
    }
  }
  const mockFs = {
    existsSync: target => target === path.dirname(dataFile) || state.files.has(target),
    mkdirSync: target => state.events.push(['mkdir', target]),
    writeFileSync: (target, contents) => {
      state.events.push(['write', target]);
      state.files.set(target, contents);
    },
    renameSync: (from, to) => {
      state.events.push(['rename', from, to]);
      if (state.renameError) throw state.renameError;
      assert.ok(state.files.has(from));
      state.files.set(to, state.files.get(from));
      state.files.delete(from);
    }
  };
  const mockProcess = {
    execPath: process.execPath,
    argv: ['node', script, ...(options.once ? ['--once'] : [])],
    env: {
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_SERVER_ID: 'test-guild',
      BOT_COUNT_SOURCE_FILE: 'incorrect-inherited-source.json',
      SYNC_BOT_COUNT_TO_GIT: 'false',
      BOT_COUNT_RUN_ONCE: 'false',
      GIT_TERMINAL_PROMPT: '1',
      GCM_INTERACTIVE: 'always',
      TEST_INHERITED_VALUE: 'retained'
    },
    exit: code => assert.fail(`unexpected process exit: ${code}`)
  };
  state.process = mockProcess;
  const context = vm.createContext({
    __dirname: root,
    require: name => {
      if (name === 'dotenv') return { config(options) { state.dotenvOptions = options; } };
      if (name === 'discord.js') return {
        Client,
        GatewayIntentBits: { Guilds: 1, GuildMembers: 2 },
        Events: { ClientReady: 'clientReady', Error: 'error' }
      };
      if (name === 'fs') return mockFs;
      if (name === 'path') return path;
      if (name === 'child_process') {
        return {
          execFile: (executable, args, options, callback) => {
            if (state.spawnError) throw state.spawnError;
            state.events.push(['exec']);
            state.executions.push({ executable, args, options, callback });
          }
        };
      }
      assert.fail(`unexpected module access: ${name}`);
    },
    process: mockProcess,
    console: { log() {}, error: (...args) => state.errors.push(args.join(' ')) },
    setInterval: (callback, milliseconds) => state.intervals.push({ callback, milliseconds })
  });
  vm.runInContext(source, context, { filename: script });
  state.update = () => context.updateCount();
  state.finishSync = (index, error = null, stderr = '') => state.executions[index].callback(error, '', stderr);
  return state;
}

test('ready update counts the fetched collection and publishes only after atomic JSON replacement', async () => {
  const state = harness();
  state.ready();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(state.memberFetches, 1);
  assert.equal(state.cachedMembers.size, 4);
  const saved = JSON.parse(state.files.get(dataFile));
  assert.deepEqual({ total: saved.total, bot: saved.bot, human: saved.human }, { total: 3, bot: 1, human: 2 });
  assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
  assert.deepEqual(state.events, [['write', dataFile + '.tmp'], ['rename', dataFile + '.tmp', dataFile], ['exec']]);
  assert.equal(state.intervals.length, 1);
  assert.equal(state.intervals[0].milliseconds, 15 * 60 * 1000);

  const execution = state.executions[0];
  assert.equal(execution.executable, process.execPath);
  assert.deepEqual(Array.from(execution.args), [siteScript, '--once']);
  assert.ok(path.isAbsolute(execution.args[0]));
  assert.equal(execution.options.cwd, path.dirname(siteScript));
  assert.equal(execution.options.windowsHide, true);
  assert.equal(execution.options.timeout, 5 * 60 * 1000);
  assert.equal(execution.options.env.BOT_COUNT_SOURCE_FILE, dataFile);
  assert.equal(execution.options.env.SYNC_BOT_COUNT_TO_GIT, 'true');
  assert.equal(execution.options.env.BOT_COUNT_RUN_ONCE, 'true');
  assert.equal(execution.options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(execution.options.env.GCM_INTERACTIVE, 'never');
  assert.equal(execution.options.env.TEST_INHERITED_VALUE, 'retained');
  assert.equal(state.dotenvOptions.path, path.join(root, '.env'));
});

test('a failed publication is retried on the next interval even when counts are unchanged', async () => {
  const state = harness();
  state.ready();
  await new Promise(resolve => setImmediate(resolve));
  state.finishSync(0, new Error('git push failed'), 'temporary remote failure');
  assert.ok(state.errors.some(message => message.includes('temporary remote failure')));

  await state.intervals[0].callback();
  assert.equal(state.memberFetches, 2);
  assert.equal(state.executions.length, 2);
  const saved = JSON.parse(state.files.get(dataFile));
  assert.equal(saved.total, 3);
  state.finishSync(1);
});

test('overlapping fetches and publications are suppressed without blocking the next completed cycle', async () => {
  const state = harness();
  let resolveMembers;
  state.memberFetch = () => new Promise(resolve => { resolveMembers = resolve; });
  const firstUpdate = state.update();
  await new Promise(resolve => setImmediate(resolve));
  await state.update();
  assert.equal(state.guildFetches, 1);
  assert.equal(state.memberFetches, 1);
  resolveMembers(state.members);
  await firstUpdate;
  assert.equal(state.executions.length, 1);

  state.memberFetch = null;
  state.members = collection([false, true, false, false, false]);
  await state.update();
  assert.equal(JSON.parse(state.files.get(dataFile)).total, 5);
  assert.equal(state.executions.length, 1);

  state.finishSync(0);
  await state.update();
  assert.equal(state.executions.length, 2);
});

test('member-fetch failure preserves existing JSON and permits a later successful update', async () => {
  const state = harness();
  state.memberFetch = async () => { throw new Error('Discord fetch failed'); };
  await state.update();
  assert.equal(state.files.get(dataFile), state.previousData);
  assert.equal(state.executions.length, 0);
  assert.deepEqual(state.events, []);
  assert.ok(state.errors.some(message => message.includes('Discord fetch failed')));

  state.memberFetch = null;
  await state.update();
  assert.equal(JSON.parse(state.files.get(dataFile)).total, 3);
  assert.equal(state.executions.length, 1);
});

test('failed JSON replacement preserves the last complete file and never starts publication', async () => {
  const state = harness();
  state.renameError = new Error('temporary file replacement failed');
  await state.update();
  assert.equal(state.files.get(dataFile), state.previousData);
  assert.equal(state.executions.length, 0);
  assert.ok(state.errors.some(message => message.includes('temporary file replacement failed')));

  state.renameError = null;
  await state.update();
  assert.equal(JSON.parse(state.files.get(dataFile)).total, 3);
  assert.equal(state.executions.length, 1);
});

test('a synchronous publication launch error releases the guard for the next update', async () => {
  const state = harness();
  state.spawnError = new Error('publication process could not start');
  await state.update();
  assert.equal(JSON.parse(state.files.get(dataFile)).total, 3);
  assert.equal(state.executions.length, 0);
  assert.ok(state.errors.some(message => message.includes('publication process could not start')));

  state.spawnError = null;
  await state.update();
  assert.equal(state.executions.length, 1);
});

test('one-shot waits for publication and disconnects with the publication result', async () => {
  for (const error of [null, new Error('publication failed')]) {
    const state = harness({ once: true });
    const ready = state.ready();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.destroyed, false);
    assert.equal(state.process.exitCode, undefined);
    state.finishSync(0, error);
    await ready;
    assert.equal(state.destroyed, true);
    assert.equal(state.process.exitCode, error ? 1 : 0);
    assert.equal(state.intervals.length, 0);
  }
});

test('one-shot member-fetch failure disconnects without publishing or replacing data', async () => {
  const state = harness({ once: true });
  state.memberFetch = async () => { throw new Error('members unavailable'); };
  await state.ready();
  assert.equal(state.files.get(dataFile), state.previousData);
  assert.equal(state.executions.length, 0);
  assert.equal(state.destroyed, true);
  assert.equal(state.process.exitCode, 1);
  assert.equal(state.intervals.length, 0);
});

test('login rejection reports failure and disconnects without publishing', async () => {
  const state = harness({ loginError: new Error('disallowed intents') });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.destroyed, true);
  assert.equal(state.process.exitCode, 1);
  assert.equal(state.executions.length, 0);
  assert.ok(state.errors.some(message => message.includes('disallowed intents')));
});
