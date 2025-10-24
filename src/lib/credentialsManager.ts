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
         process.env.AWS_EXECUTION_ENV || // AWS Amplify/Lambda
         process.env.NODE_ENV === 'production'; // Treat all production as serverless
};

// Initialize default credentials if file doesn't exist (local development only)
function initializeCredentials() {
  if (isServerlessEnvironment()) {
    console.log('[INFO] Running in serverless environment - using environment variables');
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

// Read current credentials from environment variables or file
export function getCurrentCredentials(): UserCredentials {
  // In serverless environments, use environment variables
  if (isServerlessEnvironment()) {
    console.log('[INFO] Loading credentials from environment variables');
    
    // Prioritize ADMIN_USERNAME over ADMIN_EMAIL for consistency
    const username = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || 'admin@scheduling.com';
    // Prioritize plaintext password over hash for easier configuration
    const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || 'admin123';
  console.log('[INFO] Environment variable mapping:', {
      username,
      passwordSource: process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD (plaintext)' : 
                     process.env.ADMIN_PASSWORD_HASH ? 'ADMIN_PASSWORD_HASH (bcrypt)' : 'default',
      hasPasswordHash: !!process.env.ADMIN_PASSWORD_HASH,
      hasPlaintextPassword: !!process.env.ADMIN_PASSWORD
    });
    
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
      const fileCredentials = JSON.parse(data);
      console.log('[INFO] Loaded credentials from file');
      return fileCredentials;
    }
  } catch (error) {
    console.error('[ERROR] Error reading credentials file:', error);
  }

  // Fallback to environment variables even in development
  console.log('[INFO] Falling back to environment variables');
  
  const username = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || 'admin@scheduling.com';
  // Prioritize plaintext password over hash for easier configuration
  const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD_HASH || 'admin123';
  return {
    username,
    password,
    updatedAt: process.env.CREDENTIALS_UPDATED_AT || new Date().toISOString()
  };
}

// Update credentials
export function updateCredentials(username: string, password: string): boolean {
  // In serverless environments, credentials cannot be updated at runtime
  if (isServerlessEnvironment()) {
    console.log('[WARN] Cannot update credentials in serverless environment - use environment variables instead');
    console.log('[INFO] To update credentials in production:');
    console.log('   - Set ADMIN_USERNAME environment variable');
    console.log('   - Set ADMIN_PASSWORD environment variable');
    console.log('   - Set ADMIN_BACKUP_EMAIL environment variable (optional)');
    console.log('   - Set CREDENTIALS_UPDATED_AT environment variable');
    return false;
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
    return false;
  }
}

// Validate credentials
export function validateCredentials(username: string, password: string): boolean {
  try {
    const currentCredentials = getCurrentCredentials();
    
    // Check username match first
    const usernameMatch = currentCredentials.username === username;
    if (!usernameMatch) {
  console.log('[INFO] Credential validation:', {
        environment: isServerlessEnvironment() ? 'serverless' : 'local',
        providedUsername: username,
        expectedUsername: currentCredentials.username,
        isValid: false,
        reason: 'username_mismatch'
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
