import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { validateCredentials } from '@/lib/credentialsManager'
import { lockoutManager } from '@/lib/lockoutManager'
// import bcrypt from 'bcryptjs'

// Dynamic credentials managed by credentials manager

// Defensive runtime check: NextAuth requires a secret in production.
// If the secret is missing we return a clear 500 JSON response instead of
// letting NextAuth assert and produce an internal server error stack trace.
const isMissingSecretInProd = process.env.NODE_ENV === 'production' && !process.env.NEXTAUTH_SECRET

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handler: any

if (isMissingSecretInProd) {
  console.error('[SECURITY] NEXTAUTH_SECRET is not set in production. Please set NEXTAUTH_SECRET in your Vercel project settings or environment. See VERCEL_ENVIRONMENT_SETUP.md for instructions.')
  handler = async () => {
    return new Response(
      JSON.stringify({
        error: 'NEXTAUTH_SECRET not set in production. Please set NEXTAUTH_SECRET environment variable in your hosting provider.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
} else {
  handler = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
  ...(process.env.VERCEL_URL && {
    // Use Vercel URL if available, otherwise fall back to NEXTAUTH_URL
    url: process.env.NEXTAUTH_URL || `https://${process.env.VERCEL_URL}`
  }),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials, req) {
  console.log('[SECURITY] Auth attempt:', { 
          email: credentials?.email, 
          hasPassword: !!credentials?.password,
          environment: process.env.NODE_ENV
        })
        
        if (!credentials?.email || !credentials?.password) {
          console.log('[ERROR] Missing credentials')
          return null
        }

        // Check if client is locked out
        const lockoutInfo = lockoutManager.getLockoutInfo(req);
        if (lockoutInfo.isLockedOut) {
          console.log('[SECURITY] Login attempt blocked - client is locked out');
          const remainingTime = lockoutInfo.remainingTime 
            ? lockoutManager.getFormattedRemainingTime(lockoutInfo.remainingTime)
            : 'unknown time';
          throw new Error(`Too many failed attempts. Please wait ${remainingTime} before trying again.`);
        }

        // Load current credentials dynamically each time
        const isValid = await validateCredentials(credentials.email, credentials.password);
        console.log('[Info] Credential validation:', { 
          isValid,
          providedEmail: credentials.email,
          attemptCount: lockoutInfo.attemptCount
        });
        
        if (isValid) {
          console.log('[SUCCESS] Authentication successful')
          // Reset failed attempts on successful login
          lockoutManager.resetAttempts(req);
          return {
            id: '1',
            email: credentials.email, // Use the provided email as the current username
            name: 'Admin',
            role: 'admin'
          }
        }

        // Record failed attempt
        lockoutManager.recordFailedAttempt(req);
        const newLockoutInfo = lockoutManager.getLockoutInfo(req);
        
  console.log('[ERROR] Authentication failed', {
          attemptCount: newLockoutInfo.attemptCount,
          isNowLockedOut: newLockoutInfo.isLockedOut
        });

        if (newLockoutInfo.isLockedOut && newLockoutInfo.remainingTime) {
          const remainingTime = lockoutManager.getFormattedRemainingTime(newLockoutInfo.remainingTime);
          throw new Error(`Too many failed attempts. Please wait ${remainingTime} before trying again.`);
        }

        return null
      }
    })
  ],
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60 // 24 hours
  },
  callbacks: {
    async jwt({ token, user }) {
      console.log('[Info] JWT callback:', { user: !!user, token: { sub: token.sub, role: token.role } });
      if (user) {
        token.role = user.role;
  console.log('[SUCCESS] User added to token:', { role: user.role });
      }
      return token;
    },
    async session({ session, token }) {
      console.log('[Info] Session callback:', { token: { sub: token.sub, role: token.role }, session: !!session });
      if (token) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
  console.log('[SUCCESS] Session updated:', { userId: session.user.id, role: session.user.role });
      }
      return session;
    }
  },
  pages: {
    signIn: '/login',
    error: '/login'
  },
  debug: process.env.NODE_ENV === 'development',
  logger: {
    error(code, metadata) {
      console.error('NextAuth Error:', { code, metadata })
    },
    warn(code) {
      console.warn('NextAuth Warning:', code)
    },
    debug(code, metadata) {
      console.log('NextAuth Debug:', { code, metadata })
    }
  }
})

}

export { handler as GET, handler as POST }
