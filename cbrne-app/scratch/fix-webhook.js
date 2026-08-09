
const fs = require('fs');
let file = fs.readFileSync('app/api/telegram-webhook/route.ts', 'utf8');

// 1. Add egress tracking wrapper
file = file.replace(
  '      // Log manual commands to SystemLog',
  '      let manualLogId: string | null = null;\n      let manualEgressBytes = 0;\n      \n      const trackEgress = async (bytes: number) => {\n         manualEgressBytes += bytes;\n         if (manualLogId) {\n            try {\n              await prisma.systemLog.update({\n                where: { id: manualLogId },\n                data: { details: \Triggered by \ (IP: \) | Egress: \ bytes\ }\n              });\n            } catch(e) {}\n         }\n      };\n\n      const sendTrackedMessage = async (c: string, t: string, o?: any) => {\n         try {\n           const payloadStr = JSON.stringify({ chat_id: c, text: t });\n           await trackEgress(Buffer.byteLength(payloadStr, \'utf8\'));\n         } catch(e) {}\n         return sendTelegramMessage(c, t, o);\n      };\n\n      // Log manual commands to SystemLog'
);

// 2. Modify manual logging to capture log ID
file = file.replace(
  '          await prisma.systemLog.create({',
  '          const log = await prisma.systemLog.create({'
);
file = file.replace(
  '            }\n          });\n        } catch (e) {',
  '            }\n          });\n          manualLogId = log.id;\n        } catch (e) {'
);

// 3. Replace all sendTelegramMessage calls with sendTrackedMessage
file = file.replace(/await sendTelegramMessage\(/g, 'await sendTrackedMessage(');

// 4. Handle snapshot photo size tracking
file = file.replace(
  '            const photoResponse = await fetch(https://api.telegram.org/bot/sendPhoto, {\n              method: \'POST\',\n              body: formData,\n            });',
  '            const photoResponse = await fetch(https://api.telegram.org/bot/sendPhoto, {\n              method: \'POST\',\n              body: formData,\n            });\n            await trackEgress(blob.size);'
);

// 5. Remove gemini-x and gemini-y from comments
file = file.replace(
  '// Tokens Consumed [Headline Selection: 10 [In: 5, Out: 5] (gemini-x) | Gemini Assessment: 20 [In: 10, Out: 10] (gemini-y)]',
  '// Tokens Consumed [Headline Selection: 10 [In: 5, Out: 5] (model-a) | Gemini Assessment: 20 [In: 10, Out: 10] (model-b)]'
);

// 6. Perform housekeeping (delete old SystemLogs) inside /resource BEFORE reading logs
file = file.replace(
  '          const oneDayAgo = DateTime.now().minus({ days: 1 }).toJSDate();\n          \n          const logs = await prisma.systemLog.findMany({',
  '          const oneDayAgo = DateTime.now().minus({ days: 1 }).toJSDate();\n\n          // Housekeeping: delete SystemLog older than 24 hours to save space\n          try {\n             await prisma.systemLog.deleteMany({ where: { createdAt: { lt: oneDayAgo } } });\n          } catch (e) {\n             console.error(\\\'Failed to delete old logs\\\', e);\n          }\n          \n          const logs = await prisma.systemLog.findMany({'
);

fs.writeFileSync('app/api/telegram-webhook/route.ts', file, 'utf8');
console.log('Done!');

