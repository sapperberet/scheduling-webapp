/**
 * Central Case Service - S3-based case configuration storage
 * 
 * This service manages the centralized case configuration stored in AWS S3.
 * All devices load the same case data from S3 instead of using local storage.
 * Only the admin can save changes, which are immediately visible to all users.
 */

import { SchedulingCase } from '@/types/scheduling';

export class CentralCaseService {
  private static readonly AWS_SOLVER_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;

  /**
   * Load the active case configuration from S3
   * This is called on app startup to get the centralized case data
   */
  static async loadActiveCase(): Promise<SchedulingCase | null> {
    try {
      if (!this.AWS_SOLVER_URL) {
        console.warn('[CASE] AWS Solver URL not configured, using local storage fallback');
        return null;
      }

      const response = await fetch(`${this.AWS_SOLVER_URL}/case/active`);
      
      if (response.status === 404) {
        console.log('[CASE] No active case in S3 yet, will use default case');
        return null;
      }

      if (!response.ok) {
        throw new Error(`Failed to load active case: ${response.status}`);
      }

      const data = await response.json();
      console.log('[CASE] ✅ Loaded active case from S3');
      console.log('[CASE] Last modified:', data.last_modified);
      
      return data.case;
    } catch (error) {
      console.error('[CASE] Error loading active case from S3:', error);
      return null;
    }
  }

  /**
   * Save the active case configuration to S3 (admin only)
   * This makes the case immediately available to all devices
   */
  static async saveActiveCase(caseData: SchedulingCase): Promise<boolean> {
    try {
      if (!this.AWS_SOLVER_URL) {
        console.error('[CASE] AWS Solver URL not configured');
        return false;
      }

      const response = await fetch(`${this.AWS_SOLVER_URL}/case/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(caseData),
      });

      if (!response.ok) {
        throw new Error(`Failed to save case: ${response.status}`);
      }

      const result = await response.json();
      console.log('[CASE] ✅ Saved active case to S3');
      console.log('[CASE] Backup created:', result.backup_key);
      
      return true;
    } catch (error) {
      console.error('[CASE] Error saving active case to S3:', error);
      return false;
    }
  }

  /**
   * Check if central case storage is available
   */
  static isAvailable(): boolean {
    return !!this.AWS_SOLVER_URL;
  }
}
