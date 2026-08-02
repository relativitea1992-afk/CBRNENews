export async function sendTelegramMessage(chatId: string, text: string, options?: { lat?: number | null, lon?: number | null }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  
  try {
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cbrne-app.vercel.app';
    const finalMessage = `${text}\n\n<a href="${dashboardUrl}">🌐 View on Dashboard</a>`;

    if (options?.lat && options?.lon) {
      // Use Yandex Static Maps (Satellite + Landmarks/Skeleton + Marker)
      const photoUrl = `https://static-maps.yandex.ru/1.x/?ll=${options.lon},${options.lat}&z=14&l=sat,skl&pt=${options.lon},${options.lat},pm2rdm`;
      
      // Send photo first, without caption
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
        }),
      });
    }

    // Send the detailed text message (allows up to 4096 chars)
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: finalMessage,
        parse_mode: 'HTML',
      }),
    });
    
    if (!response.ok) {
      console.error('Failed to send Telegram message:', await response.text());
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error);
  }
}
