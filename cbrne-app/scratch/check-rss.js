const Parser = require('rss-parser');
const parser = new Parser();

async function checkFeeds() {
  console.log("=== CNA RSS ===");
  try {
    const cnaFeed = await parser.parseURL('https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml');
    console.log(`Successfully fetched CNA. Total items: ${cnaFeed.items.length}`);
    cnaFeed.items.slice(0, 3).forEach(item => {
      console.log(`- [${item.pubDate}] ${item.title}`);
    });
  } catch (e) {
    console.error("CNA Error:", e.message);
  }

  console.log("\n=== ST RSS ===");
  try {
    const stFeed = await parser.parseURL('https://www.straitstimes.com/news/singapore/rss.xml');
    console.log(`Successfully fetched ST. Total items: ${stFeed.items.length}`);
    stFeed.items.slice(0, 3).forEach(item => {
      console.log(`- [${item.pubDate}] ${item.title}`);
    });
  } catch (e) {
    console.error("ST Error:", e.message);
  }
}

checkFeeds();
