const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Connecting to database...');
  
  const headline = 'Simulated Catastrophic Escalation: USS Nimitz Struck at RSS Singapura';
  const summary = 'In a simulated catastrophic escalation scenario, a United States Navy Nimitz-class nuclear aircraft carrier docked at RSS Singapura (Changi Naval Base) has suffered a direct kinetic strike from a salvo of Iranian ballistic missiles. The simulated impact has resulted in a critical breach of the primary containment vessel of the ship\'s onboard nuclear reactors, initiating an uncontained Loss-of-Coolant Accident (LOCA). Target Coordinates: RSS Singapura – Changi Naval Base, 1° 19\' 16" N, 104° 01\' 33" E.';
  const type = 'Nuclear';
  const sourceName = 'CNA Digital Desk (Simulated)';
  const sourceUrl = 'https://example.com/cna-nimitz-simulation-' + Date.now();
  const advisory = 'IMMEDIATE EVACUATION ORDERED. All personnel within a 50km radius of Changi Naval Base must seek immediate radiological shelter. Do not consume local water or exposed food. Follow official channels for emergency decontamination procedures.';
  const modelUsed = 'gemini-1.5-pro';

  const inc = await prisma.incident.create({
    data: {
      headline,
      summary,
      type,
      sourceName,
      sourceUrl,
      lat: 1.3211, // Changi Naval Base Lat
      lng: 104.0258, // Changi Naval Base Lng
      isRelevant: true,
      advisory,
      modelUsed,
      publishedAt: new Date()
    }
  });
  console.log('Inserted:', inc.id);

  console.log('Sending to Telegram...');
  const alertMsg = `🚨 <b>NEW THREAT DETECTED</b> 🚨
    
<b>Headline:</b> ${headline}
<b>Type:</b> ${type}
<b>Source:</b> ${sourceName}

<b>Impact Summary:</b>
${summary}

<b>Advisory:</b>
${advisory}

<b>Model Used:</b> ${modelUsed}
<b>Link:</b> <a href="${sourceUrl}">${sourceUrl}</a>`;

  const { sendTelegramMessage } = await import('./lib/telegram');
  await sendTelegramMessage('243352759', alertMsg, { lat: inc.lat, lon: inc.lng, type: inc.type as any });
  console.log('Telegram sent successfully');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
