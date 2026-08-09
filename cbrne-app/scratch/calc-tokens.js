const fs = require('fs');
const path = require('path');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\chaoq\\.gemini\\antigravity\\brain\\16c89f70-0d17-426b-a316-109a048d779f\\.system_generated\\logs\\transcript.jsonl';

async function calculateTokens() {
  const fileStream = fs.createReadStream(transcriptPath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let count = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      
      // Let's print the structure of the first few MODEL responses to see where token info is
      if (obj.source === 'MODEL' && count < 2) {
         console.log(JSON.stringify(obj, null, 2));
         count++;
      }
      
      if (obj.usage) {
        inputTokens += obj.usage.prompt_tokens || 0;
        outputTokens += obj.usage.completion_tokens || 0;
      } else if (obj.usageMetadata) {
        inputTokens += obj.usageMetadata.promptTokenCount || 0;
        outputTokens += obj.usageMetadata.candidatesTokenCount || 0;
      }
    } catch (e) {
       console.error("Error parsing line", e);
    }
  }

  console.log(`\nTotal Input Tokens: ${inputTokens}`);
  console.log(`Total Output Tokens: ${outputTokens}`);
}

calculateTokens();
