const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 保存先ファイル
const DATA_FILE = path.join(__dirname, 'bot-count.json');
const DATA_FILE_NAME = 'bot-count.json';

// 実行オプション
const RUN_ONCE = process.argv.includes('--once') || process.env.BOT_COUNT_RUN_ONCE === 'true';
const SYNC_TO_GIT = process.env.SYNC_BOT_COUNT_TO_GIT === 'true';
const SYNC_UNCHANGED = process.env.SYNC_BOT_COUNT_ALWAYS === 'true';
const GIT_REMOTE = process.env.BOT_COUNT_GIT_REMOTE || 'origin';
const GIT_BRANCH = process.env.BOT_COUNT_GIT_BRANCH || 'main';
const PUBLISH_HEARTBEAT_MS = 30 * 60 * 1000;
const MAX_SOURCE_AGE_MS = 60 * 60 * 1000;
const DEFAULT_SOURCE_FILE = path.resolve(__dirname, '..', 'web-node', 'data', 'bot-count.json');
const SOURCE_FILE = path.resolve(process.env.BOT_COUNT_SOURCE_FILE || DEFAULT_SOURCE_FILE);

function readCurrentData() {
  if (!fs.existsSync(DATA_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
    return null;
  }
}

function hasSameCounts(currentData, nextData) {
  return Boolean(currentData) &&
    Number(currentData.total) === nextData.total &&
    Number(currentData.bot) === nextData.bot &&
    Number(currentData.human) === nextData.human;
}

function readCount(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const count = Number(value);
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      !Number.isSafeInteger(count) || count < 0) {
    throw new Error('人数には0以上の整数が必要です。');
  }
  return count;
}

function normalizeCountData(data) {
  let total = readCount(data.total ?? data.member_count ?? data.approximate_member_count);
  let bot = readCount(data.bot ?? data.bot_count);
  let human = readCount(data.human ?? data.human_count);

  if (total === null && bot !== null && human !== null) {
    total = bot + human;
  }

  if (human === null && total !== null && bot !== null) {
    human = total - bot;
  }

  if (bot === null && total !== null && human !== null) {
    bot = total - human;
  }

  if (total === null || bot === null || human === null) {
    throw new Error('bot-count.json には total / bot / human の人数が必要です。');
  }

  if (bot < 0 || human < 0 || !Number.isSafeInteger(total) || total !== bot + human) {
    throw new Error('合計人数と Bot / 人間の内訳が一致しません。');
  }

  const updatedAt = typeof data.updatedAt === 'string' ? Date.parse(data.updatedAt) : NaN;
  const age = Date.now() - updatedAt;
  if (!Number.isFinite(updatedAt) || age > MAX_SOURCE_AGE_MS || age < -5 * 60 * 1000) {
    throw new Error('人数データの更新日時が不正、または1時間以上更新されていません。');
  }

  return {
    total,
    bot,
    human,
    updatedAt: data.updatedAt
  };
}

function runGit(args) {
  execFileSync('git', args, {
    cwd: __dirname,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000
  });
}

function syncToGit() {
  const status = execFileSync('git', ['status', '--porcelain', '--', DATA_FILE_NAME], {
    cwd: __dirname,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000
  });

  if (!status.trim()) {
    console.log('Git同期する変更はありません。');
  } else {
    runGit(['add', '--', DATA_FILE_NAME]);
    runGit(['commit', '--only', '-m', 'Bot人数データを更新', '--', DATA_FILE_NAME]);
  }

  // コミット後の push が失敗していても、次回必ず再試行します。
  runGit(['push', GIT_REMOTE, `HEAD:${GIT_BRANCH}`]);
}

function saveAndSync(data) {
  const currentData = readCurrentData();
  const timestampDelta = Date.parse(data.updatedAt) - Date.parse(currentData?.updatedAt);
  const skipWrite = SYNC_TO_GIT && !SYNC_UNCHANGED && hasSameCounts(currentData, data) &&
    Number.isFinite(timestampDelta) && timestampDelta >= 0 && timestampDelta < PUBLISH_HEARTBEAT_MS;
  if (skipWrite) {
    console.log('人数に変更がないため、公開日時の更新を次回に持ち越します。');
  } else {
    const temporaryFile = DATA_FILE + '.tmp';
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryFile, DATA_FILE);
    console.log('✅ Count updated:', data);
  }

  if (SYNC_TO_GIT) {
    syncToGit();
  }

  return true;
}

function updateFromSourceFile() {
  console.log(`Reading count data from ${SOURCE_FILE}`);

  const sourceData = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  return saveAndSync(normalizeCountData(sourceData));
}

async function updateCount() {
  try {
    return updateFromSourceFile();
  } catch (error) {
    console.error('❌ Error updating count:', error.message);
    return false;
  }
}

async function runSourceMode() {
  const succeeded = await updateCount();

  if (RUN_ONCE) {
    process.exit(succeeded ? 0 : 1);
  }

  setInterval(updateCount, 10 * 60 * 1000);
}

// 公開処理は保存済みJSONだけを使い、Discordへは接続しません。
runSourceMode();
