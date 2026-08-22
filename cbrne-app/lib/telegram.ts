/**
 * Sanitize HTML for Telegram's strict HTML parser.
 *
 * 1. Converts <br>/<p> to newlines.
 * 2. Protects allowed Telegram tags (<b>, <i>, <a>, etc.) with placeholders.
 * 3. Strips all other HTML tags.
 * 4. Escapes stray <, >, & in plain text so they can't be misinterpreted as tags.
 * 5. Restores the allowed tags.
 * 6. Validates nesting: removes orphaned closing tags, auto-closes unclosed tags.
 */
export function sanitizeTgHtml(str: string): string {
  if (!str) return '';
  let result = String(str);

  // Step 1: Convert HTML line breaks and paragraphs to newlines
  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/p>/gi, '\n');
  result = result.replace(/<p\b[^>]*>/gi, '');

  // Step 2: Protect allowed Telegram HTML tags with null-byte placeholders
  const ALLOWED_TAGS = new Set([
    'b', '/b', 'strong', '/strong', 'i', '/i', 'em', '/em',
    'u', '/u', 'ins', '/ins', 's', '/s', 'strike', '/strike',
    'del', '/del', 'a', '/a', 'code', '/code', 'pre', '/pre',
    'tg-spoiler', '/tg-spoiler'
  ]);

  const placeholders: string[] = [];
  result = result.replace(/<(\/?[a-zA-Z][^>]*)>/g, (match, inner) => {
    const tagName = inner.toLowerCase().split(/\s/)[0];
    if (ALLOWED_TAGS.has(tagName)) {
      const idx = placeholders.length;
      placeholders.push(match);
      return `\x00TG${idx}\x00`;
    }
    return ''; // strip unsupported tags
  });


  // Step 3: Escape HTML-special characters remaining in plain text
  // (avoid double-escaping existing entities like &amp; &lt; &gt;)
  result = result.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');

  // Step 4: Restore protected allowed tags
  result = result.replace(/\x00TG(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx)]);

  // Step 5: Validate tag nesting
  const TAG_RE = /<(\/?)(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler)(\s[^>]*)?>/gi;
  const openStack: string[] = [];
  const orphanRanges: { start: number; end: number }[] = [];
  let m;

  while ((m = TAG_RE.exec(result)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (!isClose) {
      openStack.push(tag);
    } else {
      const idx = openStack.lastIndexOf(tag);
      if (idx !== -1) {
        // Valid close — pop everything from that index onward
        // (intermediate unclosed tags will be caught and closed at the end)
        openStack.splice(idx, 1);
      } else {
        // Orphaned closing tag — mark for removal
        orphanRanges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }

  // Remove orphaned closing tags (iterate in reverse to keep positions stable)
  for (let i = orphanRanges.length - 1; i >= 0; i--) {
    const { start, end } = orphanRanges[i];
    result = result.substring(0, start) + result.substring(end);
  }

  // Auto-close any remaining unclosed tags (in reverse order for proper nesting)
  while (openStack.length > 0) {
    result += `</${openStack.pop()}>`;
  }

  return result;
}

function chunkText(text: string, maxLength: number = 4000): string[] {
  if (text.length <= maxLength) return [text];
  
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    
    // Try to split at double newline
    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Try single newline
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Try space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Hard split
      splitIndex = maxLength;
    }
    
    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }
  
  return chunks;
}

export async function sendTelegramMessage(chatId: string, text: string, options?: { lat?: number | null, lon?: number | null, type?: string | null, reply_markup?: any }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  
  try {
    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://hazmat-scan.vercel.app';
    const linkStr = `\n\n<a href="${dashboardUrl}">🌐 View on Dashboard</a>`;
    const MAX_LEN = 4000;
    
    // Convert <br> and <p> to \n first so chunkText can split properly
    const preprocessedText = text.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<p\b[^>]*>/gi, '');
    
    let textChunks: string[] = [];
    if (preprocessedText.length + linkStr.length <= MAX_LEN) {
      textChunks = [preprocessedText];
    } else {
      textChunks = chunkText(preprocessedText, MAX_LEN - linkStr.length - 20);
    }
    
    const finalChunks = textChunks.map((chunk, index) => {
      let sanitized = sanitizeTgHtml(chunk);
      if (textChunks.length > 1) {
        sanitized = `<b>(Part ${index + 1}/${textChunks.length})</b>\n` + sanitized;
      }
      if (index === textChunks.length - 1) {
        sanitized += linkStr;
      }
      return sanitized;
    });

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
        // Fallback to Yandex static map with color-coded markers matching dashboard pictograms
        console.warn('GOOGLE_MAPS_API_KEY is not set. Falling back to Yandex static map with colored markers.');
        
        let markerColor = 'rd'; // default red
        if (options.type === 'Chemical') markerColor = 'gn'; // green
        if (options.type === 'Biological') markerColor = 'vv'; // violet/purple
        if (options.type === 'Radiological') markerColor = 'yw'; // yellow
        if (options.type === 'Explosive') markerColor = 'rd'; // red
        if (!options.type) markerColor = 'lb'; // light blue (general)

        const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
        const photoUrl = googleMapsKey 
          ? `https://maps.googleapis.com/maps/api/staticmap?center=${options.lat},${options.lon}&zoom=12&size=600x400&markers=color:red%7C${options.lat},${options.lon}&key=${googleMapsKey}`
          : `https://static-maps.yandex.ru/1.x/?ll=${options.lon},${options.lat}&z=10&l=map&lang=en_US&size=600,400&pt=${options.lon},${options.lat},pm2${markerColor}m`;
        
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
               console.error('Failed to upload Telegram photo (Yandex Buffer):', await photoResponse.text());
            }
          } else {
             console.error('Failed to fetch Yandex map:', await imageReq.text());
          }
        } catch (e) {
          console.error('Error fetching/uploading Yandex map:', e);
        }
      }
    }

    // Send the detailed text message chunks sequentially
    for (let i = 0; i < finalChunks.length; i++) {
      const messageBody: any = {
        chat_id: chatId,
        text: finalChunks[i],
        parse_mode: 'HTML',
      };
      // Only attach reply_markup to the final chunk
      if (options?.reply_markup && i === finalChunks.length - 1) {
        messageBody.reply_markup = options.reply_markup;
      }
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to send Telegram message (Part ${i + 1}):`, errorText);
        throw new Error(`Telegram API Error: ${errorText}`);
      }
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    throw error;
  }
}
