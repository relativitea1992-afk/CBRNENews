import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { DateTime } from 'luxon';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Purge records older than 3 days
    const threeDaysAgo = DateTime.now().minus({ days: 3 }).toJSDate();
    
    const result = await prisma.incident.deleteMany({
      where: {
        createdAt: {
          lt: threeDaysAgo,
        },
      },
    });

    return NextResponse.json({ success: true, deletedCount: result.count });
  } catch (error) {
    console.error('Error purging data:', error);
    return NextResponse.json({ error: 'Failed to purge data' }, { status: 500 });
  }
}
