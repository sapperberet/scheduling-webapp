import * as fs from 'fs';
import * as path from 'path';
import bcrypt from 'bcryptjs';

interface UserCredentials {
  username: string;
  password: string;
  updatedAt: string;
}

const CREDENTIALS_FILE = path.join(process.cwd(), '.credentials.json');

// Check if we're running in a serverless environment
const isServerlessEnvironment = () => {
  return process.env.VERCEL || 
         process.env.AWS_LAMBDA_FUNCTION_NAME || 
         process.env.LAMBDA_TASK_ROOT ||
         process.env.AWS_EXECUTION_ENV || 
         process.env.NODE_ENV === 'production';
};

// Initialize default credentials if file doesn't exist (local development only)
function initializeCredentials() {
  if (isServerlessEnvironment()) {
    console.log('[INFO] Running in serverless environment - using environment variables or S3');
    return;
  }

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    const defaultCredentials: UserCredentials = {
      username: 'admin@scheduling.com',
      password: 'admin123',
      updatedAt: new Date().toISOString()
    };
    
    try {
      fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(defaultCredentials, null, 2));
      console.log('[OK] Initialized default user credentials');
    } catch (error) {
      console.error('[ERROR] Failed to create credentials file:', error);
    }
  }
}

/**
 * Get credentials from S3 (for AWS/Amplify deployments)
 * Falls back to environment variables
 */
async function getCredentialsFromS3(): Promise<UserCredentials | null> {
  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    
    const bucket = process.env.NEXT_PUBLIC_AWS_S3_BUCKET || process.env.AWS_S3_BUCKET || 'scheduling-solver-results';
    const region = process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
    
    // Use S3_ prefixed env vars (Amplify doesn't allow AWS_ prefix)
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      }
    });
    
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: 'system/credentials.json'
    });
    
    const response = await s3Client.send(command);
    const bodyContent = await response.Body?.transformToString();
    
    if (bodyContent) {
      const credentials = JSON.parse(bodyContent) as UserCredentials;
      console.log('[INFO] Loaded credentials from S3');
      return credentials;
    }
  } catch (error: unknown) {
    const err = error as { name?: string; Code?: string };
    if (err.name === 'NoSuchKey' || err.Code === 'NoSuchKey') {
      console.log('[INFO] Credentials not found in S3, using environment variables');
    } else {
      console.warn('[WARN] Error reading credentials from S3:', error);
    }
  }
  
  return null;
}

/**
 * Save credentials to S3 (for AWS/Amplify deployments)
 * Returns true on success, throws error on failure (instead of returning false)
 */
async function saveCredentialsToS3(credentials: UserCredentials): Promise<boolean> {
  try {
    console.log('[DEBUG] Starting S3 credentials save');
    console.log('[DEBUG] Environment check:', {
      isLambda: !!process.env.AWS_LAMBDA_FUNCTION_NAME,
      hasS3AccessKey: !!(process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID),
      region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.NEXT_PUBLIC_AWS_S3_BUCKET || process.env.AWS_S3_BUCKET || 'scheduling-solver-results'
    });
    
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    
    const bucket = process.env.NEXT_PUBLIC_AWS_S3_BUCKET || process.env.AWS_S3_BUCKET || 'scheduling-solver-results';
    const region = process.env.NEXT_PUBLIC_AWS_REGION || process.env.AWS_REGION || 'us-east-1';
    
    console.log('[DEBUG] Creating S3 client with explicit credentials (using S3_ prefix for Amplify)');
    
    // Use S3_ prefixed env vars (Amplify doesn't allow AWS_ prefix)
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
      }
    });
    
    console.log('[DEBUG] S3 Client created, preparing PutObjectCommand');
    
    const credentialsJson = JSON.stringify(credentials, null, 2);
    console.log('[DEBUG] Credentials to save:', {
      username: credentials.username,
      passwordLength: credentials.password.length,
      updatedAt: credentials.updatedAt,
      jsonLength: credentialsJson.length
    });
    
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: 'system/credentials.json',
      Body: credentialsJson,
      ContentType: 'application/json'
    });
    
    console.log('[DEBUG] Sending PutObjectCommand to S3');
    const result = await s3Client.send(command);
    console.log('[DEBUG] S3 PutObject response:', result);
    console.log('[OK] Credentials saved to S3 successfully');
    return true;
  } catch (error) {
    console.error('[ERROR] Failed to save credentials to S3:');
    console.error('[ERROR] Error details:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      code: (error as {Code?: string; code?: string})?.Code || (error as {Code?: string; code?: string})?.code,
      statusCode: (error as {$metadata?: {httpStatusCode?: number}})?.$metadata?.httpStatusCode,
      stack: error instanceof Error ? error.stack : undefined
    });
    // Re-throw the error so it can be caught by the API route
    throw error;
  }
}

// Read current credentials from environment variables, S3, or file
export async function getCurrentCredentials(): Promise<UserCredentials> {
  // In serverless environments, try S3 first, then environment variables as fallback
  if (isServerlessEnvironment()) {
    console.log('[INFO] Loading credentials from serverless environment');
    
    // Try S3 first
    const s3Credentials = await getCredentialsFromS3();
    if (s3Credentials) {
      console.log('[INFO] Using credentials from S3');
      return s3Credentials;
    }
    
    // Fallback to environment variables (ONLY if S3 file doesn't exist)
    console.log('[INFO] S3 credentials not found, using environment variables as fallback');
    const username = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || 'admin@scheduling.com';
    const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || 'admin123';
    
    return {
      username,
      password,
      updatedAt: process.env.CREDENTIALS_UPDATED_AT || new Date().toISOString()
    };
  }

  // For local development, try file-based storage first
  try {
    initializeCredentials();
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const fileCredentials = JSON.parse(data) as UserCredentials;
      console.log('[INFO] Loaded credentials from file');
      return fileCredentials;
    }
  } catch (error) {
    console.error('[ERROR] Error reading credentials file:', error);
  }

  // Fallback to environment variables even in development
  console.log('[INFO] Falling back to environment variables');
  const username = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || 'admin@scheduling.com';
  const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || 'admin123';
  
  return {
    username,
    password,
    updatedAt: process.env.CREDENTIALS_UPDATED_AT || new Date().toISOString()
  };
}

// Update credentials
export async function updateCredentials(username: string, password: string): Promise<boolean> {
  // In serverless environments, save to S3
  if (isServerlessEnvironment()) {
    console.log('[INFO] Updating credentials in serverless environment - saving to S3');
    
    const newCredentials: UserCredentials = {
      username,
      password,
      updatedAt: new Date().toISOString()
    };
    
    // This will now throw an error if S3 save fails, instead of returning false
    await saveCredentialsToS3(newCredentials);
    console.log('[OK] Credentials updated successfully in S3');
    return true;
  }

  // For local development, update the file
  try {
    const newCredentials: UserCredentials = {
      username,
      password,
      updatedAt: new Date().toISOString()
    };
    
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(newCredentials, null, 2));
    console.log('[OK] Credentials updated successfully in local file');
    return true;
  } catch (error) {
    console.error('[ERROR] Error updating credentials:', error);
    throw error; // Re-throw so API can handle it
  }
}

// Validate credentials
export async function validateCredentials(username: string, password: string): Promise<boolean> {
  try {
    const currentCredentials = await getCurrentCredentials();
    
    // Check username match first
    const usernameMatch = currentCredentials.username === username;
    if (!usernameMatch) {
      console.log('[INFO] Credential validation failed: username_mismatch', {
        environment: isServerlessEnvironment() ? 'serverless' : 'local',
        providedUsername: username,
        expectedUsername: currentCredentials.username,
        isValid: false
      });
      return false;
    }

    // Check if password is a bcrypt hash (starts with $2a$, $2b$, or $2y$)
    const isHashedPassword = /^\$2[aby]\$/.test(currentCredentials.password);
    
    let passwordMatch: boolean;
    if (isHashedPassword) {
      // Use bcrypt to compare hashed password
      passwordMatch = bcrypt.compareSync(password, currentCredentials.password);
      console.log('[INFO] Credential validation (bcrypt):', {
        environment: isServerlessEnvironment() ? 'serverless' : 'local',
        providedUsername: username,
        usedBcrypt: true,
        isValid: passwordMatch
      });
    } else {
      // Plain text password comparison (for development)
      passwordMatch = currentCredentials.password === password;
      console.log('[INFO] Credential validation (plaintext):', {
        environment: isServerlessEnvironment() ? 'serverless' : 'local',
        providedUsername: username,
        usedBcrypt: false,
        isValid: passwordMatch,
        warning: 'Using plaintext password - consider using bcrypt hash in production'
      });
    }
    
    return passwordMatch;
  } catch (error) {
    console.error('[ERROR] Error validating credentials:', error);
    return false;
  }
}

// Get backup email (for security, only return if it exists)
export function getBackupEmail(): string | null {
  try {
    // Backup email support has been removed. Return null for compatibility.
    return null;
  } catch (error) {
    console.error('[ERROR] Error retrieving backup email:', error);
    return null;
  }
}

// Check if backup email is configured
export function isBackupEmailConfigured(): boolean {
  try {
    // Backup email support removed - always return false
    console.log('[INFO] Backup email check: feature removed - returning false');
    return false;
  } catch (error) {
    console.error('[ERROR] Error checking backup email configuration:', error);
    return false;
  }
}

// Generate a secure recovery token (for additional security)
export function generateRecoveryToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
