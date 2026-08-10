const fs = require('fs');
const routePath = 'app/api/cron/hourly-report/route.ts';
let code = fs.readFileSync(routePath, 'utf8');

const startIdx = code.indexOf('export async function generateHourlyReport() {');
const nextExportIdx = code.indexOf('\nlet isHourlyColdStart = true;');

const generateHourlyReportStr = code.substring(startIdx, nextExportIdx).trim();

// Keep everything else
const newRouteCode = code.substring(0, startIdx) + code.substring(nextExportIdx + 1);
fs.writeFileSync(routePath, newRouteCode);

const libCode = `import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { geminiGenerate, checkAllModels } from '@/lib/gemini-client';

export const maxDuration = 300;
export const preferredRegion = 'sin1';

${generateHourlyReportStr}
`;
fs.writeFileSync('lib/report-generator.ts', libCode);
console.log('done');
