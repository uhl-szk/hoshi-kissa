require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// 環境変数から取得
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_SERVER_ID;

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

// Botクライアントの初期化
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

async function updateCount() {
  console.log('Fetching member counts...');
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    
    // 全メンバーを取得
    await guild.members.fetch(); 
    
    // キャッシュからカウント
    const members = guild.members.cache;
    const totalMembers = members.size;
    const botCount = members.filter(m => m.user.bot).size;
    const humanCount = totalMembers - botCount;

    const data = {
      total: totalMembers,
      bot: botCount,
      human: humanCount,
      updatedAt: new Date().toISOString()
    };

    // ディレクトリ作成（なければ）
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // JSONファイルに保存
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('✅ Count updated:', data);
  } catch (error) {
    console.error('❌ Error updating count:', error.message);
  }
}

client.once('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  updateCount();
  
  // 10分ごとに自動更新（レートリミット対策）
  setInterval(updateCount, 10 * 60 * 1000); 
});

client.login(TOKEN);
