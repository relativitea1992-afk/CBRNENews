import { triageNewsArticle } from '../lib/gemini.ts';

async function simulateHaze() {
  const article = `
    Singapore ready to roll out haze response plans as ASEAN monitoring centre raises alert level. 
    The ASEAN Specialised Meteorological Centre on Monday raised the alert to Level 2, the second-highest level, 
    signalling an increasing risk of transboundary haze in the region. 
    Minister for Sustainability and the Environment Grace Fu said the inter-agency haze task force is coordinating 
    action plans. Transboundary haze from forest fires in Indonesia typically affects Singapore during the dry season.
  `;
  
  console.log("Simulating haze article...");
  const result = await triageNewsArticle(article);
  console.log("Result:", JSON.stringify(result, null, 2));
}

simulateHaze();
