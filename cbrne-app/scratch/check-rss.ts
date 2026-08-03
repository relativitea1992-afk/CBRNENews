async function run() {
  const cnaFeeds = [
    { name: 'Latest', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml' },
    { name: 'Singapore', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=10416' },
    { name: 'Today', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=679471' },
    { name: 'World', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311' },
    { name: 'Asia', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511' }
  ];

  for (const feed of cnaFeeds) {
    try {
      const res = await fetch(feed.url);
      const xml = await res.text();
      const titleMatch = xml.match(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/i);
      if (titleMatch) {
        const title = titleMatch[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
        console.log(`[${feed.name}] Top Headline: ${title}`);
      } else {
        console.log(`[${feed.name}] No headline found`);
      }
    } catch (e) {
      console.log(`[${feed.name}] Error fetching feed`);
    }
  }
}
run();
