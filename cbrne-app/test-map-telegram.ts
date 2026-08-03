import { sendTelegramMessage } from './lib/telegram';

async function testMap() {
  process.env.NEXT_PUBLIC_APP_URL = 'https://hazmat-scan.vercel.app';
  console.log('Sending test map to Telegram...');
  
  // A test coordinate in Singapore
  const lat = 1.3521;
  const lon = 103.8198;
  const type = 'Biological';
  
  const text = `🧪 <b>TEST: Telegram Map with OG Image Overlay</b>
  
Testing the custom Lucide React icons over the Yandex map image.
Marker should display a purple Biohazard icon!`;
  
  await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID || '', text, {
    lat,
    lon,
    type,
  });
  
  console.log('Message sent!');
}

testMap().catch(console.error);
