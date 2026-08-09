const { PrismaClient } = require('../node_modules/.prisma/client');
const prisma = new PrismaClient();

async function checkST() {
  const feeds = [
    'https://www.straitstimes.com/news/singapore/rss.xml',
    'https://www.straitstimes.com/news/world/rss.xml',
    'https://www.straitstimes.com/news/asia/rss.xml'
  ];

  let stHeadlines = [];

  for (const feed of feeds) {
    try {
      const res = await fetch(feed);
      if (!res.ok) continue;
      const xml = await res.text();
      
      const itemRegex = /<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;
      let match;
      while ((match = itemRegex.exec(xml)) !== null) {
        const title = match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
        const pubDate = match[2].trim();
        const link = match[3].trim();
        stHeadlines.push({ title, pubDate, link });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Sort by pubDate descending
  stHeadlines.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  console.log("Top 10 most recent ST RSS items:");
  stHeadlines.slice(0, 10).forEach(h => {
    console.log(`[${new Date(h.pubDate).toLocaleString()}] ${h.title}`);
  });

  console.log("\nChecking database for ST incidents...");
  const recentDB = await prisma.incident.findMany({
    where: { sourceName: 'Straits Times RSS' },
    orderBy: { createdAt: 'desc' },
    take: 10
  });
  
  if (recentDB.length === 0) {
    console.log("No ST incidents found in the DB!");
  } else {
    recentDB.forEach(db => {
      console.log(`[DB] Created: ${db.createdAt.toLocaleString()} | Pub: ${db.publishedAt.toLocaleString()} | ${db.headline}`);
    });
  }

  await prisma.$disconnect();
}

checkST().catch(console.error);
