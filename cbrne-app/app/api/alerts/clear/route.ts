import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const deleted = await prisma.incident.deleteMany({
      where: {
        isRelevant: true
      }
    });

    return NextResponse.json({ success: true, count: deleted.count });
  } catch (error) {
    console.error('Failed to clear alerts:', error);
    return NextResponse.json({ success: false, error: 'Failed to clear alerts' }, { status: 500 });
  }
}
