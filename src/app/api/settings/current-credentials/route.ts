import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getCurrentCredentials } from '@/lib/credentialsManager';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ req: request });
    if (!token || token.role !== 'admin') {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get current credentials
    const credentials = await getCurrentCredentials();
    
    return NextResponse.json(
      { 
        username: credentials.username,
        updatedAt: credentials.updatedAt
      },
      { status: 200 }
    );

  } catch (error) {
  console.error('[ERROR] Error getting credentials:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
