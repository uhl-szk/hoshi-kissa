const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('count publishing preserves freshness and retries a failed push with unchanged counts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hoshi-count-test-'));
  const repo = path.join(root, 'site');
  const remote = path.join(root, 'remote.git');
  const source = path.join(root, 'source.json');
  fs.mkdirSync(repo);
  fs.copyFileSync(path.resolve(__dirname, '..', 'count-bot.js'), path.join(repo, 'count-bot.js'));

  function git(args, cwd = repo) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  function publish(data, expectedStatus = 0) {
    fs.writeFileSync(source, JSON.stringify(data));
    const result = spawnSync(process.execPath, ['count-bot.js', '--once'], {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        BOT_COUNT_SOURCE_FILE: source,
        SYNC_BOT_COUNT_TO_GIT: 'true',
        SYNC_BOT_COUNT_ALWAYS: 'false',
        BOT_COUNT_GIT_REMOTE: 'origin',
        BOT_COUNT_GIT_BRANCH: 'main',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never'
      }
    });
    assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
  }
  const timestamp = minutesAgo => new Date(Date.now() - minutesAgo * 60000).toISOString();
  try {
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Count test']);
    git(['config', 'user.email', 'count-test@example.invalid']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['init', '--bare', remote]);
    git(['remote', 'add', 'origin', remote]);
    const first = { total: 768, bot: 33, human: 735, updatedAt: timestamp(45) };
    publish(first);
    const firstHead = git(['rev-parse', 'HEAD']);
    assert.equal(git(['rev-parse', 'refs/heads/main'], remote), firstHead);

    // Unchanged counts need no new commit before the heartbeat is due.
    publish({ ...first, updatedAt: timestamp(30) });
    assert.equal(git(['rev-parse', 'HEAD']), firstHead);

    // The timestamp must advance even if no one has joined or left.
    const refreshed = { ...first, updatedAt: timestamp(10) };
    publish(refreshed);
    const heartbeatHead = git(['rev-parse', 'HEAD']);
    assert.notEqual(heartbeatHead, firstHead);
    assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'bot-count.json'))).updatedAt, refreshed.updatedAt);

    // A failed push leaves a commit. Retrying identical data must push that commit.
    git(['remote', 'set-url', 'origin', path.join(root, 'missing.git')]);
    const joined = { total: 769, bot: 33, human: 736, updatedAt: timestamp(0) };
    publish(joined, 1);
    const pendingHead = git(['rev-parse', 'HEAD']);
    assert.notEqual(pendingHead, heartbeatHead);
    assert.equal(git(['rev-parse', 'refs/heads/main'], remote), heartbeatHead);
    git(['remote', 'set-url', 'origin', remote]);
    publish(joined);
    assert.equal(git(['rev-parse', 'HEAD']), pendingHead);
    assert.equal(git(['rev-parse', 'refs/heads/main'], remote), pendingHead);

    // Invalid/stale snapshots must not replace the last valid published data.
    for (const invalid of [
      { ...joined, updatedAt: timestamp(65) },
      { ...joined, updatedAt: undefined },
      { ...joined, updatedAt: 'invalid' },
      { ...joined, updatedAt: timestamp(-10) },
      { ...joined, human: 500 },
      { ...joined, bot: -1 },
      { ...joined, total: 769.5 }
    ]) {
      publish(invalid, 1);
      assert.equal(git(['rev-parse', 'HEAD']), pendingHead);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, 'bot-count.json'))), joined);
    }
  } finally {
    // Only remove the fixture directory returned by mkdtemp under the OS temp root.
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('hoshi-count-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
