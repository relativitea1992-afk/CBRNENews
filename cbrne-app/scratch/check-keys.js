const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\chaoq\\.gemini\\antigravity\\brain\\16c89f70-0d17-426b-a316-109a048d779f\\.system_generated\\logs\\transcript_full.jsonl';

async function checkKeys() {
  const fileStream = fs.createReadStream(transcriptPath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      
      if (obj.source === 'MODEL') {
         console.log(Object.keys(obj));
         if (obj.usageMetadata) console.log(obj.usageMetadata);
         if (obj.usage) console.log(obj.usage);
         break;
      }
    } catch (e) {
    }
  }
}

checkKeys();
