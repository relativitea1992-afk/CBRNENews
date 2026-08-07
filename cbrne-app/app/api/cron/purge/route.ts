import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DateTime } from 'luxon';

export const preferredRegion = 'sin1';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const url = new URL(request.url);
  const secretParam = url.searchParams.get('secret');

  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}` && secretParam !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Purge records older than 1 year
    const oneYearAgo = DateTime.now().minus({ years: 1 }).toJSDate();
    
    const result = await prisma.incident.deleteMany({
      where: {
        createdAt: {
          lt: oneYearAgo,
        },
      },
    });

    const logResult = await prisma.systemLog.deleteMany({
      where: {
        createdAt: {
          lt: oneYearAgo,
        },
      },
    });

    await prisma.systemLog.create({
      data: {
        jobName: 'purge',
        status: 'SUCCESS',
        details: `Purged ${result.count} incidents and ${logResult.count} system logs older than 1 year.`
      }
    });

    return NextResponse.json({ success: true, deletedIncidents: result.count, deletedLogs: logResult.count });
  } catch (error) {
    console.error('Error purging data:', error);
    return NextResponse.json({ error: 'Failed to purge data' }, { status: 500 });
  }
}
