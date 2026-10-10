const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Client, GatewayIntentBits, Events } = require('discord.js');

require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

// 環境変数から取得
const TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const GUILD_ID = process.env.DISCORD_SERVER_ID?.trim();
const RUN_ONCE = process.argv.includes('--once');

// 環境変数のチェック
if (!TOKEN) {
  console.error('❌ DISCORD_BOT_TOKEN が設定されていません。.envファイルを確認してください。');
  process.exit(1);
}
if (!GUILD_ID) {
  console.error('❌ DISCORD_SERVER_ID が設定されていません。.envファイルを確認してください。');
  process.exit(1);
}

// 保存先ディレクトリ
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'bot-count.json');
const JST_OFFSET_MINUTES = 9 * 60;
const SITE_SYNC_SCRIPT = path.resolve(__dirname, '..', 'hoshi-kissa', 'sync-bot-count.js');
let syncInFlight = false;
let updateInFlight = false;

function syncWebsiteCount() {
  if (syncInFlight) {
    console.log('Webへの人数同期は実行中です。次回再試行します。');
    return Promise.resolve(false);
  }

  syncInFlight = true;
  return new Promise(resolve => {
    try {
      execFile(process.execPath, [SITE_SYNC_SCRIPT, '--once'], {
        cwd: path.dirname(SITE_SYNC_SCRIPT),
        windowsHide: true,
        timeout: 5 * 60 * 1000,
        env: {
          ...process.env,
          BOT_COUNT_SOURCE_FILE: DATA_FILE,
          SYNC_BOT_COUNT_TO_GIT: 'true',
          BOT_COUNT_RUN_ONCE: 'true',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never'
        }
      }, (error, stdout, stderr) => {
        syncInFlight = false;
        if (stdout.trim()) console.log(stdout.trim());
        if (error) {
          console.error('❌ Webへの人数同期に失敗しました。次回再試行します:', stderr.trim() || error.message);
        }
        resolve(!error);
      });
    } catch (error) {
      syncInFlight = false;
      console.error('❌ Webへの人数同期を起動できませんでした。次回再試行します:', error.message);
      resolve(false);
    }
  });
}

// Botクライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

function formatJstIsoString(date) {
  const jstDate = new Date(date.getTime() + JST_OFFSET_MINUTES * 60 * 1000);
  return jstDate.toISOString().replace('Z', '+09:00');
}

async function updateCount() {
  if (updateInFlight) return false;
  updateInFlight = true;
  console.log('🔄 人数をアップデート中...');
  try {
    const guild = await client.guilds.fetch(GUILD_ID);

    // 全メンバーを取得
    const members = await guild.members.fetch({ time: 45000 });
    const totalMembers = members.size;
    const botCount = members.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;

    const data = {
      total: totalMembers,
      bot: botCount,
      human: humanCount,
      updatedAt: formatJstIsoString(new Date())
    };

    // ディレクトリ作成（なければ）
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // JSONファイルに保存
    const temporaryFile = DATA_FILE + '.tmp';
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryFile, DATA_FILE);
    console.log('✅ 人数をアップデートしました：', data);
    const publication = syncWebsiteCount();
    return RUN_ONCE ? await publication : true;
  } catch (error) {
    console.error('❌ アップデート時にエラーが発生しました：', error.message);
    return false;
  } finally {
    updateInFlight = false;
  }
}

client.on(Events.Error, error => {
  console.error('❌ Discord接続エラー:', error.message);
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  const succeeded = await updateCount();

  if (RUN_ONCE) {
    client.destroy();
    process.exitCode = succeeded ? 0 : 1;
    return;
  }

  // 15分ごとに自動更新（レートリミット対策）
  setInterval(updateCount, 15 * 60 * 1000);
});

client.login(TOKEN).catch(error => {
  console.error('❌ Discordログインに失敗しました:', error.message);
  client.destroy();
  process.exitCode = 1;
});
