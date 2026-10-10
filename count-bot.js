// 旧収集Botからの公開呼び出しにも対応し、BotLauncherの起動名を維持します。
const legacyPublication = process.argv.includes('--once') &&
  process.env.BOT_COUNT_RUN_ONCE === 'true' &&
  process.env.SYNC_BOT_COUNT_TO_GIT === 'true' &&
  Boolean(process.env.BOT_COUNT_SOURCE_FILE);

if (legacyPublication) {
  require('./sync-bot-count.js');
} else {
  require('./discord-count-bot.js');
}
