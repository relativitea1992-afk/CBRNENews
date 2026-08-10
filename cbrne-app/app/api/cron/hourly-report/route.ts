import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sendTelegramMessage } from '@/lib/telegram';
import { geminiGenerate, checkAllModels } from '@/lib/gemini-client';
import { generateHourlyReport } from '@/lib/report-generator';

export const maxDuration = 300; // Allow up to 5 minutes for AI processing
export const preferredRegion = 'sin1';

let isHourlyColdStart = true;

import { after } from 'next/server';

export async function GET(request: Request) {
  const startTime = Date.now();
  const isCold = isHourlyColdStart;
  isHourlyColdStart = false;

  // 1. Verify Cron Secret
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret');

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && secretParam !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Return immediately to prevent cron-job.org from timing out at 30 seconds,
    // and run the heavy report generation safely in the background on Vercel
    after(async () => {
      try {
        const metrics = await generateHourlyReport();
        const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        
        const tokenStr = `Tokens Consumed [Headline Selection: ${metrics.totalSelectionTokens} [In: ${metrics.selectionPromptTokens}, Out: ${metrics.selectionCandidateTokens}] (${metrics.selectionModel}) | Gemini Assessment: ${metrics.totalAssessmentTokens} [In: ${metrics.assessmentPromptTokens}, Out: ${metrics.assessmentCandidateTokens}] (${metrics.assessmentModel})]`;
        const bandwidthStr = `Ingress: ${metrics.ingressBytes} bytes | Egress: ${metrics.egressBytes} bytes`;
        
        const duration = Date.now() - startTime;
        const computeStr = `\nCompute: ${duration}ms, ${memoryMB}MB RAM, ${isCold ? 'Cold' : 'Warm'} Start`;
        
        await prisma.systemLog.create({
          data: {
            jobName: 'hourly-report',
            status: 'SUCCESS',
            details: `Heartbeat sent successfully. ${tokenStr} | ${bandwidthStr} ${computeStr}`
          }
        });
        
      } catch (e: any) {
        console.error('Background hourly report failed:', e);
        try {
          await prisma.systemLog.create({
            data: {
              jobName: 'hourly-report',
              status: 'ERROR',
              details: e.message || 'Unknown error'
            }
          });
        } catch (logErr) {
          console.error('Failed to write hourly report error to log:', logErr);
        }
      }
    });
    
    return NextResponse.json({ success: true, message: 'Hourly report processing in background' });
  } catch (error: any) {
    console.error('Failed to init hourly report:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
