import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getCurrentCredentials, updateCredentials, validateCredentials } from '@/lib/credentialsManager';

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const token = await getToken({ req: request });
    if (!token || token.role !== 'admin') {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { currentPassword, newUsername, newPassword } = await request.json();

    // Validate input (backupEmail removed)
    if (!currentPassword || !newUsername || !newPassword) {
      return NextResponse.json(
        { message: 'Current password, new username, and new password are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { message: 'New password must be at least 6 characters' },
        { status: 400 }
      );
    }

    // Verify current password with dynamic credentials
    const currentCredentials = await getCurrentCredentials();
    
    // Validate using current username from credentials, not from token
    const isValid = await validateCredentials(currentCredentials.username, currentPassword);
    if (!isValid) {
      return NextResponse.json(
        { message: 'Current password is incorrect' },
        { status: 400 }
      );
    }
    
    // Update credentials (saves to S3 on AWS, local file on dev)
    const updateSuccess = await updateCredentials(newUsername, newPassword);
    
    if (!updateSuccess) {
      return NextResponse.json(
        { message: 'Failed to update credentials - check server logs for details' },
        { status: 500 }
      );
    }

    // Log the update
    console.log('[INFO] Credentials updated successfully:', {
      oldUsername: currentCredentials.username,
      newUsername: newUsername,
      timestamp: new Date().toISOString(),
      location: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'AWS S3' : 'Local file'
    });

    return NextResponse.json(
      { 
        message: 'Credentials updated successfully. You will be automatically logged out.',
        timestamp: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      { status: 200 }
    );

  } catch (error) {
  console.error('[ERROR] Error updating credentials:', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString(),
    errorType: error instanceof Error ? error.constructor.name : typeof error
  });
    return NextResponse.json(
      { 
        message: 'Internal server error', 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? error.stack : String(error)
      },
      { status: 500 }
    );
  }
}
