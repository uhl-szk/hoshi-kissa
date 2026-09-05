const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const fixedNow = Date.parse('2026-09-05T13:00:00.000Z');

function snapshot(total = 768, bot = 33, updatedAt = fixedNow) {
  return { total, bot, human: total - bot, updatedAt: new Date(updatedAt).toISOString() };
}

function element(attributes = {}) {
  return {
    attributes,
    textContent: '',
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

function browser(responses) {
  let now = fixedNow;
  let timerId = 0;
  const timeouts = new Map();
  const intervals = [];
  const requests = [];
  const warnings = [];
  const total = element({ 'data-auto-count': 'true', 'data-invite-code': 'test-invite' });
  const breakdown = element();
  const document = {
    documentElement: element(),
    querySelector(selector) {
      if (selector === '[data-discord-total-count]') return total;
      if (selector === '[data-discord-breakdown]') return breakdown;
      return null;
    },
    querySelectorAll() { return []; }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }

  vm.runInNewContext(source, {
    document,
    window: {
      innerWidth: 1100,
      location: { search: '' },
      localStorage: { getItem() { return null; }, setItem() {} }
    },
    Date: FixedDate,
    Intl,
    URLSearchParams,
    AbortController,
    console: { warn(...args) { warnings.push(args.join(' ')); } },
    setInterval(callback, delay) { intervals.push({ callback, delay }); },
    setTimeout(callback, delay) {
      timeouts.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) { timeouts.delete(id); },
    fetch(url, options) {
      requests.push({ url, options });
      const response = responses[requests.length - 1];
      if (response === undefined) return Promise.reject(new Error('Unexpected request: ' + url));
      if (response instanceof Error) return Promise.reject(response);
      if (response && response.pending) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('Request aborted')), { once: true });
        });
      }
      return Promise.resolve({
        ok: !response?.httpStatus || response.httpStatus < 400,
        status: response?.httpStatus || 200,
        json() { return Promise.resolve(response); }
      });
    }
  }, { filename: 'main.js' });

  return {
    total, breakdown, requests, timeouts, warnings, intervals,
    async settle() { await new Promise(setImmediate); },
    advance(milliseconds) { now += milliseconds; },
    refresh() { intervals[0].callback(); },
    expireRequest() {
      const [id, timer] = timeouts.entries().next().value;
      assert.equal(timer.delay, 10_000);
      timeouts.delete(id);
      timer.callback();
    }
  };
}

function assertStatus(page, status) {
  assert.equal(page.total.attributes['data-discord-count-status'], status);
  assert.equal(page.breakdown.attributes['data-discord-count-status'], status);
}

test('fresh exact counts display all 768 members, 33 bots and 735 humans', async () => {
  const page = browser([snapshot()]);
  await page.settle();
  assert.equal(page.total.textContent, '現在の合計参加人数（Botを含む）：768人 (9/5 22:00確認)');
  assert.equal(page.breakdown.textContent, 'Bot：33人・人間：735人');
  assertStatus(page, 'ok');
  assert.deepEqual(page.requests.map(request => request.url), ['./bot-count.json']);
  assert.equal(page.requests[0].options.cache, 'no-store');
  assert.equal(page.timeouts.size, 0);
  assert.equal(page.intervals[0].delay, 5 * 60 * 1000);
});

test('periodic refresh replaces 525 with new exact counts and their source timestamp', async () => {
  const page = browser([snapshot(525, 39), snapshot(768, 33, fixedNow + 5 * 60 * 1000)]);
  await page.settle();
  assert.match(page.total.textContent, /525人/);
  assert.equal(page.breakdown.textContent, 'Bot：39人・人間：486人');
  page.advance(5 * 60 * 1000);
  page.refresh();
  await page.settle();
  assert.equal(page.total.textContent, '現在の合計参加人数（Botを含む）：768人 (9/5 22:05確認)');
  assert.equal(page.breakdown.textContent, 'Bot：33人・人間：735人');
  assertStatus(page, 'ok');
  assert.equal(page.requests.length, 2);
});

test('a snapshot exactly 60 minutes old is accepted', async () => {
  const page = browser([snapshot(768, 33, fixedNow - 60 * 60 * 1000)]);
  await page.settle();
  assertStatus(page, 'ok');
  assert.equal(page.requests.length, 1);
});

test('expired snapshot uses live approximate total without inventing human or bot counts', async () => {
  const page = browser([
    snapshot(525, 39, fixedNow - 60 * 60 * 1000 - 1),
    { approximate_member_count: 768 }
  ]);
  await page.settle();
  assert.equal(page.total.textContent, '現在の合計参加人数（Botを含む）：約768人 (9/5 22:00確認)');
  assert.equal(page.breakdown.textContent, 'Bot・人間の内訳：取得できません（合計は概数）');
  assert.doesNotMatch(page.breakdown.textContent, /735|33|35|39/);
  assertStatus(page, 'approximate');
  assert.match(page.requests[1].url, /\/invites\/test-invite\?with_counts=true$/);
});

test('expired snapshot remains visibly stopped when the invitation fails', async () => {
  const page = browser([snapshot(525, 39, fixedNow - 61 * 60 * 1000), { httpStatus: 404 }]);
  await page.settle();
  assert.equal(page.total.textContent, '最終確認の合計参加人数（Botを含む）：525人 (9/5 20:59確認・更新停止)');
  assert.equal(page.breakdown.textContent, 'Bot：39人・人間：486人');
  assertStatus(page, 'stale');
});

test('unknown, invalid and future timestamps never become the current time', async t => {
  for (const updatedAt of [undefined, null, '', 'invalid-date', new Date(fixedNow + 1000).toISOString()]) {
    await t.test(String(updatedAt), async () => {
      const page = browser([{ ...snapshot(), updatedAt }, { httpStatus: 404 }]);
      await page.settle();
      assertStatus(page, 'stale');
      assert.match(page.total.textContent, /確認日時不明・更新停止/);
      assert.doesNotMatch(page.total.textContent, /現在|22:00/);
      assert.equal(page.requests.length, 2);
    });
  }
});

test('inconsistent, missing, fractional and negative counts are not shown as exact data', async t => {
  for (const invalid of [
    { ...snapshot(), human: 734 },
    { ...snapshot(), bot: undefined },
    { ...snapshot(), bot: -1, human: 769 },
    { ...snapshot(), bot: 33.5, human: 734.5 },
    { ...snapshot(), total: '768' },
    { ...snapshot(), total: Number.MAX_SAFE_INTEGER + 1 },
    null
  ]) {
    await t.test(JSON.stringify(invalid), async () => {
      const page = browser([invalid, { httpStatus: 404 }]);
      await page.settle();
      assertStatus(page, 'error');
      assert.equal(page.total.textContent, '現在の合計参加人数：取得できませんでした');
      assert.equal(page.breakdown.textContent, 'Bot・人間の内訳：取得できませんでした');
    });
  }
});

test('failed refresh preserves the original confirmation time even after freshness expires', async () => {
  const page = browser([snapshot(), new Error('Offline'), new Error('Offline')]);
  await page.settle();
  page.advance(65 * 60 * 1000);
  page.refresh();
  await page.settle();
  assertStatus(page, 'stale');
  assert.equal(page.total.textContent, '最終確認の合計参加人数（Botを含む）：768人 (9/5 22:00確認・更新停止)');
  assert.equal(page.breakdown.textContent, 'Bot：33人・人間：735人');
});

test('invalid invitation counts cannot masquerade as an exact or approximate total', async () => {
  const page = browser([{ httpStatus: 404 }, { member_count: 768, approximate_member_count: -1 }]);
  await page.settle();
  assertStatus(page, 'error');
  assert.doesNotMatch(page.total.textContent, /768/);
});

test('timeouts abort both endpoints, overlapping refreshes are skipped, and the next refresh recovers', async () => {
  const page = browser([{ pending: true }, { pending: true }, snapshot()]);
  page.refresh();
  assert.equal(page.requests.length, 1);
  page.expireRequest();
  await page.settle();
  assert.equal(page.requests[0].options.signal.aborted, true);
  assert.equal(page.requests.length, 2);
  page.refresh();
  assert.equal(page.requests.length, 2);
  page.expireRequest();
  await page.settle();
  assert.equal(page.requests[1].options.signal.aborted, true);
  assertStatus(page, 'error');
  assert.equal(page.timeouts.size, 0);
  page.refresh();
  await page.settle();
  assertStatus(page, 'ok');
  assert.match(page.total.textContent, /768人/);
  assert.equal(page.requests.length, 3);
  assert.equal(page.timeouts.size, 0);
});
