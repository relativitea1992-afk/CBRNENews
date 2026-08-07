const cnaFeeds = [
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416',
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=679471',
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311',
  'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511'
];

const stFeeds = [
  'https://www.straitstimes.com/news/singapore/rss.xml',
  'https://www.straitstimes.com/news/world/rss.xml',
  'https://www.straitstimes.com/news/asia/rss.xml'
];

async function measureLatencies() {
  console.log('Testing CNA Feeds (Parallel)...');
  const cnaStart = Date.now();
  await Promise.all(cnaFeeds.map(async f => {
    const s = Date.now();
    await fetch(f);
    console.log(`CNA Feed: ${Date.now() - s}ms`);
  }));
  console.log(`CNA Total Parallel Time: ${Date.now() - cnaStart}ms\n`);

  console.log('Testing ST Feeds (Parallel)...');
  const stStart = Date.now();
  await Promise.all(stFeeds.map(async f => {
    const s = Date.now();
    await fetch(f);
    console.log(`ST Feed: ${Date.now() - s}ms`);
  }));
  console.log(`ST Total Parallel Time: ${Date.now() - stStart}ms\n`);
}

measureLatencies();
