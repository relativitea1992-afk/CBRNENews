import { triageNewsArticle } from './lib/gemini';
import prisma from './lib/prisma';
import { sendTelegramMessage } from './lib/telegram';

async function main() {
  console.log('0. Removing all alerts from database...');
  await prisma.incident.deleteMany({});
  console.log('Database cleared.');

  const article = {
    title: 'BREAKING: Catastrophic Meltdown Reported at Batam Nuclear Facility; Radioactive Plume Drifting Towards Singapore',
    content: `SINGAPORE — Authorities have confirmed a full core meltdown at the Batam Experimental Energy Station early this morning, triggered by an unmitigated Loss of Coolant Accident (LOCA). The cascading thermal failure has resulted in a critical breach of primary and secondary containment structures, releasing a massive payload of aerosolized fission products into the atmosphere.
    
The National Environment Agency (NEA), which operates a network of over 40 environmental radiation monitoring stations islandwide, has detected highly elevated, non-linear spikes in ambient background radiation along the southern coastal sectors. Immediate shelter-in-place protocols have been activated for all residents in the Sentosa, Keppel, and Marina Bay districts.

Radiological Source Term and Dispersion Mechanics
The release is currently characterized by an intense emission of volatile radionuclides, predominantly Noble Gases and Iodine-131 ($^{131}\\text{I}$). The atmospheric dispersion of this unscrubbed radioactive plume is being dictated by current meteorological variables over the Singapore Strait.

Release Geometry: Ground-level and elevated releases combined, with an effective thermal buoyancy height ($H$) of 150 meters.
Meteorological Vectors: Prevailing winds are originating from 160° (South-Southeast) and pushing the plume directly toward a 340° (North-Northwest) trajectory.
Atmospheric Stability: Current conditions reflect Pasquill-Gifford Class D (neutral stability). When combined with a steady mean wind speed of 5.2 m/s (18.72 km/h), the plume is maintaining a dense, highly concentrated centerline with moderate lateral dispersion.

Time to First Arrival (TFA): Given the 22-kilometer distance from the release locus to the Sentosa coastline, transit time was accurately modeled at approximately 1.17 hours from the time of containment breach.`,
    url: 'https://example.com/cna-nuclear-meltdown-' + Date.now(),
    source: 'CNA / Multiple News APIs',
    publishedAt: new Date(),
  };

  console.log('1. Passing to Gemini for triage...');
  const triage = await triageNewsArticle(`Title: ${article.title}\n\nContent: ${article.content}`);
  console.log('Gemini Result:', triage);

  if (triage && triage.isRelevant) {
    console.log('2. Saving to Database...');
    await prisma.incident.create({
      data: {
        headline: triage.headline,
        summary: triage.summary,
        sourceUrl: article.url,
        sourceName: article.source,
        publishedAt: article.publishedAt,
        lat: triage.lat,
        lng: triage.lng,
        type: triage.type,
        advisory: triage.advisory,
        isRelevant: true,
      }
    });

    console.log('3. Sending Telegram Alert...');
    const alertMsg = `🚨 <b>NEW THREAT DETECTED (SIMULATION)</b> 🚨
    
<b>Headline:</b> ${triage.headline}
<b>Type:</b> ${triage.type}
<b>Source:</b> ${article.source}

<b>Impact Summary:</b>
${triage.summary}

${triage.advisory ? `<b>Advisory:</b>\n${triage.advisory}\n` : ''}
<b>Link:</b> ${article.url}`;

    await sendTelegramMessage(process.env.TELEGRAM_CHAT_ID!, alertMsg, { lat: triage.lat, lon: triage.lng });
    console.log('Done!');
  }
}

main().catch(console.error);
