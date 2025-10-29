/**
 * AWS Lambda Solver API Route
 * 
 * This endpoint invokes AWS Lambda for serverless solver execution:
 * 1. Lambda starts on-demand (not always running)
 * 2. Runs the optimization solver
 * 3. Streams progress and logs back to client
 * 4. Stores results to S3/Vercel Blob
 * 5. Terminates after completion (no ongoing costs)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, createAuthResponse } from '@/lib/auth';

interface AWSLambdaRequest {
  constants: Record<string, unknown>;
  calendar: Record<string, unknown>;
  shifts: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  run?: Record<string, unknown>;
}

interface AWSLambdaResponse {
  status: string;
  run_id: string;
  progress: number;
  message: string;
  results?: unknown;
  output_directory?: string;
  logs?: string[];
}

export async function POST(request: NextRequest) {
  // Verify authentication
  const token = await verifyAuth(request);
  if (!token) {
    return createAuthResponse('Authentication required to access AWS solver');
  }

  try {
    const caseData: AWSLambdaRequest = await request.json();
    
    // Get AWS Lambda endpoint from environment
    const AWS_LAMBDA_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
    if (!AWS_LAMBDA_URL) {
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'AWS Lambda endpoint not configured',
          error: 'NEXT_PUBLIC_AWS_SOLVER_URL environment variable is missing'
        },
        { status: 500 }
      );
    }

    console.log('[AWS] Invoking Lambda function...');
    console.log(`[AWS] Endpoint: ${AWS_LAMBDA_URL}`);
    console.log(`[AWS] Shifts: ${caseData.shifts?.length || 0}, Providers: ${caseData.providers?.length || 0}`);

    // Generate unique run ID
    const runId = `run_${Date.now()}`;
    
    // Invoke AWS Lambda (serverless execution)
    // Lambda will:
    // 1. Start (cold start or warm)
    // 2. Execute solver
    // 3. Stream logs/progress
    // 4. Store results to S3
    // 5. Terminate
    const lambdaResponse = await fetch(`${AWS_LAMBDA_URL}/solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AWS_API_KEY ? { 'x-api-key': process.env.AWS_API_KEY } : {}),
      },
      body: JSON.stringify({
        ...caseData,
        run_id: runId,
        storage_mode: 'cloud', // Tells Lambda to store results in S3
        enable_streaming: true, // Enable progress/log streaming
      }),
      // Longer timeout for complex optimizations
      signal: AbortSignal.timeout(600000), // 10 minutes max
    });

    if (!lambdaResponse.ok) {
      const errorData = await lambdaResponse.json().catch(() => ({}));
      console.error('[AWS] Lambda invocation failed:', errorData);
      
      return NextResponse.json(
        { 
          status: 'error', 
          message: 'AWS Lambda solver failed',
          error: errorData.message || `HTTP ${lambdaResponse.status}`,
          details: errorData
        },
        { status: 500 }
      );
    }

    const result: AWSLambdaResponse = await lambdaResponse.json();
    console.log('[AWS] Lambda execution completed');
    console.log(`[AWS] Run ID: ${result.run_id}`);
    console.log(`[AWS] Status: ${result.status}`);
    console.log(`[AWS] Progress: ${result.progress}%`);

    // AWS Lambda stores results directly to S3
    // No need to duplicate to Vercel Blob - AWS handles all storage
    console.log('[AWS] Results stored in AWS S3 by Lambda function');

    return NextResponse.json({
      status: result.status,
      run_id: result.run_id,
      progress: result.progress,
      message: result.message,
      results: result.results,
      output_directory: result.output_directory, // Stored in AWS S3
      logs: result.logs || [],
      solver_type: 'aws_lambda',
      execution_mode: 'serverless',
      storage_location: 'aws_s3',
      statistics: {
        platform: 'AWS Lambda',
        pricing_model: 'pay-per-execution',
        persistent: false, // Lambda terminates after execution
        storage: 'AWS S3',
      }
    });

  } catch (error) {
    console.error('[AWS] Solver error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Failed to invoke AWS Lambda solver',
        error: errorMessage,
        solver_type: 'aws_lambda',
      },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET() {
  const AWS_LAMBDA_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
  
  if (!AWS_LAMBDA_URL) {
    return NextResponse.json({
      status: 'error',
      message: 'AWS Lambda endpoint not configured',
      configured: false,
    });
  }

  try {
    // Check if Lambda endpoint is reachable
    const healthResponse = await fetch(`${AWS_LAMBDA_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    const healthData = await healthResponse.json().catch(() => ({}));

    return NextResponse.json({
      status: 'ok',
      message: 'AWS Lambda solver is available',
      configured: true,
      endpoint: AWS_LAMBDA_URL,
      lambda_status: healthData,
      execution_mode: 'serverless (on-demand)',
      features: [
        'Auto start/stop (no persistent costs)',
        'Scalable compute resources',
        'Real-time progress streaming',
        'Cloud result storage (S3)',
        'Pay-per-execution pricing',
      ]
    });

  } catch (error) {
    return NextResponse.json({
      status: 'warning',
      message: 'AWS Lambda endpoint configured but not responding',
      configured: true,
      endpoint: AWS_LAMBDA_URL,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
