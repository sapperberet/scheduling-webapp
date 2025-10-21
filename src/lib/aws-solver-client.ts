// AWS Solver Client for scheduling application
// This module handles communication with the AWS-hosted solver

export interface AWSSolverConfig {
  apiUrl: string;
  region: string;
  apiKey?: string;
}

export interface SolveRequest {
  case: any;
  options?: {
    timeout?: number;
    maxSolutions?: number;
  };
}

export interface SolveResponse {
  status: 'completed' | 'error' | 'timeout';
  results?: any;
  error?: string;
  message?: string;
  run_id?: string;
  output_directory?: string;
  statistics?: any;
  packaged_files?: Array<{ name: string; data: string }>;
}

export class AWSSolverClient {
  private config: AWSSolverConfig;

  constructor(config: AWSSolverConfig) {
    this.config = config;
  }

  /**
   * Solve the scheduling problem using AWS cloud solver
   */
  async solve(request: SolveRequest): Promise<SolveResponse> {
    const url = `${this.config.apiUrl}/solve`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API key if configured
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.case),
        signal: AbortSignal.timeout(request.options?.timeout || 3600000), // 1 hour default
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result: SolveResponse = await response.json();
      return result;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            status: 'timeout',
            error: 'Request timed out',
            message: 'The solver operation exceeded the maximum allowed time',
          };
        }
        
        return {
          status: 'error',
          error: error.message,
          message: `Failed to communicate with AWS solver: ${error.message}`,
        };
      }
      
      return {
        status: 'error',
        error: 'Unknown error',
        message: 'An unexpected error occurred',
      };
    }
  }

  /**
   * Check health status of AWS solver
   */
  async health(): Promise<{ status: string; solver_type?: string; capabilities?: string[] }> {
    const url = `${this.config.apiUrl}/health`;
    
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`AWS solver health check failed: ${error}`);
    }
  }

  /**
   * Download results from S3
   */
  async downloadResults(runId: string, fileName: string): Promise<Blob> {
    const url = `${this.config.apiUrl}/results/${runId}/${fileName}`;
    
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to download results: ${response.status}`);
    }

    return await response.blob();
  }

  /**
   * List available result folders in S3
   */
  async listResults(): Promise<Array<{ name: string; created: string; fileCount: number }>> {
    const url = `${this.config.apiUrl}/results/folders`;
    
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to list results: ${response.status}`);
    }

    const data = await response.json();
    return data.folders || [];
  }
}

/**
 * Create AWS solver client from environment variables
 */
export function createAWSSolverClient(): AWSSolverClient | null {
  const apiUrl = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;
  const region = process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
  const apiKey = process.env.NEXT_PUBLIC_AWS_API_KEY;

  if (!apiUrl) {
    return null;
  }

  return new AWSSolverClient({
    apiUrl,
    region,
    apiKey,
  });
}
