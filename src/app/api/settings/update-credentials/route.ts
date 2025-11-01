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
    const currentCredentials = getCurrentCredentials();
    
    // Validate using current username from credentials file, not from token
    if (!validateCredentials(currentCredentials.username, currentPassword)) {
      return NextResponse.json(
        { message: 'Current password is incorrect' },
        { status: 400 }
      );
    }
    
    // Check if running in serverless environment
    const isServerless = !!(
      process.env.VERCEL || 
      process.env.AWS_LAMBDA_FUNCTION_NAME || 
      process.env.LAMBDA_TASK_ROOT ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.NODE_ENV === 'production'
    );

    if (isServerless) {
      // In serverless, cannot update - return error with guidance
      return NextResponse.json(
        { 
          message: 'Running on serverless (AWS Lambda). Credentials cannot be updated at runtime. Update environment variables instead: ADMIN_USERNAME, ADMIN_PASSWORD, CREDENTIALS_UPDATED_AT',
          isServerless: true,
          guidance: 'Set environment variables in AWS Lambda console or deployment configuration'
        },
        { status: 400 }
      );
    }

    // Update credentials using credentials manager (local only)
    const updateSuccess = updateCredentials(newUsername, newPassword);
    
    if (!updateSuccess) {
      return NextResponse.json(
        { message: 'Failed to update credentials' },
        { status: 500 }
      );
    }

    // Log the update (no emails are sent)
    console.log('[INFO] Credentials updated (email notifications disabled):', {
      oldUsername: currentCredentials.username,
      newUsername: newUsername,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(
      { 
        message: 'Credentials updated successfully. Email notifications have been disabled by configuration.',
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    );

  } catch (error) {
  console.error('[ERROR] Error updating credentials:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
