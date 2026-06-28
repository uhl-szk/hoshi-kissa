try {
  require('dotenv').config();
} catch (error) {
  // BOT_COUNT_SOURCE_FILE を使う同期モードでは dotenv は不要です。
}

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
const DEFAULT_SOURCE_FILE = path.resolve(__dirname, '..', 'web-node', 'data', 'bot-count.json');
const SOURCE_FILE = process.env.BOT_COUNT_SOURCE_FILE
  ? path.resolve(process.env.BOT_COUNT_SOURCE_FILE)
  : fs.existsSync(DEFAULT_SOURCE_FILE) ? DEFAULT_SOURCE_FILE : '';

// 環境変数から取得
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_SERVER_ID;

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
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null;
}

function normalizeCountData(data) {
  let total = readCount(data.total ?? data.member_count ?? data.approximate_member_count);
  let bot = readCount(data.bot ?? data.bot_count);
  let human = readCount(data.human ?? data.human_count);

  if (total === null && bot !== null && human !== null) {
    total = bot + human;
  }

  if (human === null && total !== null && bot !== null) {
    human = Math.max(total - bot, 0);
  }

  if (bot === null && total !== null && human !== null) {
    bot = Math.max(total - human, 0);
  }

  if (total === null || bot === null || human === null) {
    throw new Error('bot-count.json には total / bot / human の人数が必要です。');
  }

  return {
    total,
    bot,
    human,
    updatedAt: data.updatedAt || new Date().toISOString()
  };
}

function runGit(args) {
  execFileSync('git', args, {
    cwd: __dirname,
    stdio: 'inherit'
  });
}

function syncToGit() {
  const status = execFileSync('git', ['status', '--porcelain', '--', DATA_FILE_NAME], {
    cwd: __dirname,
    encoding: 'utf8'
  });

  if (!status.trim()) {
    console.log('Git同期する変更はありません。');
    return;
  }

  runGit(['add', '--', DATA_FILE_NAME]);
  runGit(['commit', '--only', '-m', 'Bot人数データを更新', '--', DATA_FILE_NAME]);
  runGit(['push', GIT_REMOTE, `HEAD:${GIT_BRANCH}`]);
}

function saveAndSync(data) {
  const currentData = readCurrentData();
  if (SYNC_TO_GIT && !SYNC_UNCHANGED && hasSameCounts(currentData, data)) {
    console.log('人数に変更がないため、Git同期をスキップしました:', data);
    return true;
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log('✅ Count updated:', data);

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

async function fetchDiscordCount(client) {
  console.log('Fetching member counts...');

  const guild = await client.guilds.fetch(GUILD_ID);

  // 全メンバーを取得
  await guild.members.fetch();

  // キャッシュからカウント
  const members = guild.members.cache;
  const totalMembers = members.size;
  const botCount = members.filter(m => m.user.bot).size;
  const humanCount = totalMembers - botCount;

  return {
    total: totalMembers,
    bot: botCount,
    human: humanCount,
    updatedAt: new Date().toISOString()
  };
}

async function updateCount(client) {
  try {
    return SOURCE_FILE ? updateFromSourceFile() : saveAndSync(await fetchDiscordCount(client));
  } catch (error) {
    console.error('❌ Error updating count:', error.message);
    return false;
  }
}

async function runSourceMode() {
  const succeeded = await updateCount(null);

  if (RUN_ONCE) {
    process.exit(succeeded ? 0 : 1);
  }

  setInterval(updateCount, 10 * 60 * 1000, null);
}

function runDiscordMode() {
  if (!TOKEN) {
    console.error('❌ DISCORD_BOT_TOKEN が設定されていません。.envファイルを確認してください。');
    process.exit(1);
  }
  if (!GUILD_ID) {
    console.error('❌ DISCORD_SERVER_ID が設定されていません。.envファイルを確認してください。');
    process.exit(1);
  }

  const { Client, GatewayIntentBits } = require('discord.js');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers
    ]
  });

  client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  const succeeded = await updateCount(client);

  if (RUN_ONCE) {
    client.destroy();
    process.exit(succeeded ? 0 : 1);
  }

  // 10分ごとに自動更新（レートリミット対策）
  setInterval(updateCount, 10 * 60 * 1000, client);
  });

  client.login(TOKEN);
}

if (SOURCE_FILE) {
  runSourceMode();
} else {
  runDiscordMode();
}
