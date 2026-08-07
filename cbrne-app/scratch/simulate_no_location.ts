import { triageNewsArticle } from '../lib/gemini.ts';
import fs from 'fs';
import path from 'path';

async function simulateNoLocation() {
  const article = `
    URGENT NEWS: A massive chemical cloud has enveloped the entirety of Singapore. The toxic smog is causing respiratory distress across the island. The source of the cloud is completely unknown and no location can be pinpointed.
  `;
  
  console.log("Simulating article with no location...");
  const result = await triageNewsArticle(article);
  console.log("Result:", JSON.stringify(result, null, 2));
}

simulateNoLocation();
