/**
 * INTEGRATION SNIPPET FOR RunTab.tsx
 * 
 * Add this code to integrate the Results Manager and AWS Cloud features
 */

// 1. Add import at the top of RunTab.tsx (around line 1-30)
import ResultsManager from '@/components/ResultsManager';

// 2. Add state variable in RunTab component (around line 90-110)
const [showResultsManager, setShowResultsManager] = useState(false);
const [logStreamUrl, setLogStreamUrl] = useState<string | null>(null);

// 3. Add useEffect to connect to log stream when running
useEffect(() => {
  if (isRunning && lastResults?.run_id) {
    const runId = lastResults.run_id;
    const eventSource = new EventSource(`/api/logs/${runId}`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
          addLog(data.message, 'info');
        } else if (data.type === 'progress' && data.progress) {
          setProgress(data.progress);
        }
      } catch (error) {
        console.error('Error parsing log event:', error);
      }
    };
    
    eventSource.onerror = () => {
      console.error('Log stream connection error');
      eventSource.close();
    };
    
    return () => {
      eventSource.close();
    };
  }
}, [isRunning, lastResults?.run_id]);

// 4. Add AWS Cloud Solver option to handleRunOptimization function
// Around line 765 where AWS solver logic exists, ensure it calls /api/aws-solve:

const handleRunAWSSolver = async () => {
  setSolverState('connecting');
  setIsRunning(true);
  setProgress(0);
  clearLogs();
  addLog('[AWS] Invoking AWS Lambda solver...', 'info');
  addLog('[INFO] Solver will start on-demand and terminate after completion', 'info');
  
  try {
    const payload = buildSchedulingPayload();
    
    const response = await fetch('/api/aws-solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'AWS Lambda invocation failed');
    }
    
    const result = await response.json();
    
    addLog('[SUCCESS] AWS Lambda completed successfully!', 'success');
    addLog(`[INFO] Run ID: ${result.run_id}`, 'info');
    addLog(`[INFO] Results stored in: ${result.output_directory}`, 'info');
    
    setProgress(100);
    setSolverState('finished');
    
    // Store results
    dispatch({
      type: 'SET_RESULTS',
      payload: {
        run_id: result.run_id,
        output_directory: result.output_directory,
        timestamp: new Date().toISOString(),
        solver_type: 'aws_lambda',
        results: result.results,
        caseSnapshot: schedulingCase,
        statistics: result.statistics
      }
    });
    
  } catch (error) {
    console.error('[AWS] Error:', error);
    addLog(`[ERROR] AWS Lambda error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    setSolverState('error');
  } finally {
    setIsRunning(false);
  }
};

// 5. Add "View Past Results" button in the button section (around line 2176-2200)
// Add this button after the AWS Cloud Solver button:

<button
  onClick={() => setShowResultsManager(true)}
  className="relative px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 font-semibold flex items-center justify-center space-x-2 transition-all duration-300 shadow-lg hover:shadow-xl hover:scale-105 overflow-hidden group"
  title="View and download past optimization results"
>
  <div className="absolute inset-0 bg-gradient-to-r from-green-400/20 to-emerald-400/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
  <IoFolderOpenSharp className="w-5 h-5 relative z-10" />
  <span className="relative z-10">View Past Results</span>
</button>

// 6. Add Results Manager component at the end of the return statement (before closing </div>)
// Around line 2490:

{/* Results Manager Modal */}
<ResultsManager 
  isOpen={showResultsManager}
  onClose={() => setShowResultsManager(false)}
/>

// 7. Update the progress bar to show more detailed stages (around line 2288-2310)
// Replace the existing progress message with:

<div className="mt-2 text-xs text-gray-600 dark:text-gray-400 text-center">
  {progress < 15 && "[INFO] Initializing solver..."}
  {progress >= 15 && progress < 25 && "[INFO] Building optimization model..."}
  {progress >= 25 && progress < 35 && "[INFO] Creating decision variables..."}
  {progress >= 35 && progress < 50 && "[INFO] Adding constraints..."}
  {progress >= 50 && progress < 65 && "[INFO] Setting up objectives..."}
  {progress >= 65 && progress < 75 && "[INFO] Solving optimization problem..."}
  {progress >= 75 && progress < 90 && "[INFO] Processing solutions..."}
  {progress >= 90 && progress < 100 && "[INFO] Generating output files..."}
  {progress >= 100 && "[SUCCESS] Optimization complete!"}
</div>

/**
 * SUMMARY OF CHANGES:
 * 
 * 1. Import ResultsManager component
 * 2. Add state for results manager modal
 * 3. Connect to real-time log stream (SSE)
 * 4. Add AWS Lambda solver handler
 * 5. Add "View Past Results" button
 * 6. Add ResultsManager component to JSX
 * 7. Enhance progress bar with stage descriptions
 * 
 * TESTING:
 * 
 * 1. Click "AWS Cloud Solver" button
 * 2. Verify Lambda starts, runs, and terminates
 * 3. Watch real-time logs stream to UI
 * 4. Monitor progress bar through all stages
 * 5. Click "View Past Results" to see stored results
 * 6. Download a result folder as ZIP
 * 
 * ENVIRONMENT VARIABLES NEEDED:
 * 
 * NEXT_PUBLIC_AWS_SOLVER_URL=https://your-lambda-url.execute-api.us-east-1.amazonaws.com
 * AWS_API_KEY=optional-api-key
 */
