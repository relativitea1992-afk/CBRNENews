import { sendTelegramMessage } from './lib/telegram';

async function testOSM() {
  console.log('Sending test message...');
  await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, 'Test Message', { lat: 1.3521, lon: 103.8198 });
  console.log('Done!');
}

testOSM().catch(console.error);
