const { extract } = require('@extractus/article-extractor');
const { config } = require('dotenv');
config();

const urls = [
  { source: 'CNA', url: 'https://www.channelnewsasia.com/world/colombia-earthquake-ecuador-injuries-damage-venezuela-6309936' },
  { source: 'ST', url: 'https://www.straitstimes.com/singapore/water-power-fuel-services-temporarily-interrupted-at-sentosa-cove-marina-after-yacht-hits-pontoon' },
  { source: 'NewsAPI', url: 'https://www.huffpost.com/entry/japan-nagasaki-atomic-bomb-anniversary_n_6a788662e4b0a6d70bb1f34a' }
];

// disable proxy cert issues for local test
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function runTest() {
  for (const item of urls) {
    console.log(`\n======================================`);
    console.log(`Testing Extraction for [${item.source}]`);
    console.log(`URL: ${item.url}`);
    try {
      const start = Date.now();
      const articleData = await extract(item.url);
      const elapsed = Date.now() - start;
      
      if (articleData && articleData.content) {
         const plainText = articleData.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
         console.log(`SUCCESS (${elapsed}ms)`);
         console.log(`Extracted text length: ${plainText.length} characters`);
         console.log(`Preview (first 300 chars):\n${plainText.substring(0, 300)}...\n`);
      } else {
         console.log('FAILED: No content returned.');
      }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
}
runTest();
