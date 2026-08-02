import { sendTelegramMessage } from './lib/telegram';

async function testOSM() {
  const testAlert = {
    id: 9999,
    headline: 'TEST: Standard Map Reverted',
    summary: 'Testing the standard map rendering after reverting from Satellite hybrid view.',
    advisory: 'Testing map rendering...',
    lat: 1.0829, // Batam
    lon: 104.0305, // Batam
    type: 'Test',
    createdAt: new Date(),
  };
  console.log('Sending test message...');
  await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, testAlert.headline, { lat: testAlert.lat, lon: testAlert.lon });
  console.log('Done!');
}

testOSM().catch(console.error);
