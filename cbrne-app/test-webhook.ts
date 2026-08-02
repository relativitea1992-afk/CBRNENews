import { POST } from './app/api/telegram-webhook/route';

async function testWebhook() {
  const mockRequest = new Request(`http://localhost:3000/api/telegram-webhook?secret=${process.env.TELEGRAM_WEBHOOK_SECRET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        text: '/test',
        chat: { id: process.env.TELEGRAM_CHAT_ID }
      }
    })
  });

  // Since NextRequest extends Request, this should mostly work for this simple route, 
  // but we might need to cast to any or construct a NextRequest if it uses nextUrl.
  // The route uses request.nextUrl.searchParams so we need NextRequest.
  // NextRequest cannot be easily constructed in a raw node script without Next.js environment.
  // Instead, let's just make a real HTTP POST request to the Next.js dev server if we could.
  // Actually we can just start it, or I can mock it using standard Request and monkeypatch nextUrl.
}

testWebhook().catch(console.error);
