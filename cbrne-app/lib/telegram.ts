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
      const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
      
      let photoUrl = '';
      if (googleMapsApiKey) {
        // Use Google Maps Static API (Centered on Singapore, hybrid map type)
        photoUrl = `https://maps.googleapis.com/maps/api/staticmap?center=1.3521,103.8198&zoom=10&size=600x400&maptype=hybrid&markers=color:red%7C${options.lat},${options.lon}&key=${googleMapsApiKey}`;
      } else {
        // Fallback to OpenStreetMap if no Google Maps API key is provided
        console.warn('GOOGLE_MAPS_API_KEY is not set. Falling back to OpenStreetMap static map.');
        photoUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=1.3521,103.8198&zoom=10&size=600x400&maptype=mapnik&markers=${options.lat},${options.lon},ol-marker`;
      }
      
      // Send photo first, without caption
      const photoResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
        }),
      });
      if (!photoResponse.ok) {
        console.error('Failed to send Telegram photo:', await photoResponse.text());
      }
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
