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
        
        // Send photo URL directly if Google Maps API Key is set
        const photoResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            photo: photoUrl,
          }),
        });
        if (!photoResponse.ok) {
          console.error('Failed to send Telegram photo (Google Maps):', await photoResponse.text());
        }
      } else {
        // Fallback to a reliable map if no Google Maps API key is provided
        console.warn('GOOGLE_MAPS_API_KEY is not set. Falling back to Yandex static map via local fetch buffer (forced English labels).');
        // Added lang=en_US to ensure no Russian names appear as per user request
        photoUrl = `https://static-maps.yandex.ru/1.x/?ll=${options.lon},${options.lat}&z=10&l=map&lang=en_US&size=600,400&pt=${options.lon},${options.lat},pm2rdm`;
        
        // Telegram often rejects direct OSM static map URLs. 
        // We bypass this by fetching the image ourselves on the server and uploading it as a Buffer to Telegram.
        try {
          const imageReq = await fetch(photoUrl);
          if (imageReq.ok) {
            const arrayBuffer = await imageReq.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: 'image/png' });
            
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('photo', blob, 'map.png');
            
            const photoResponse = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
              method: 'POST',
              body: formData,
            });
            if (!photoResponse.ok) {
               console.error('Failed to upload Telegram photo (OSM Buffer):', await photoResponse.text());
            }
          } else {
             console.error('Failed to fetch OSM static map:', await imageReq.text());
          }
        } catch (e) {
          console.error('Error fetching/uploading OSM map:', e);
        }
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
