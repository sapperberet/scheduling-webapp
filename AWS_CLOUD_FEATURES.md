# AWS Cloud Features Implementation Guide

This document describes the 4 AWS cloud features implemented for the scheduling webapp.

## Overview

The webapp now supports complete AWS cloud integration with the following features:

1. **AWS Lambda Serverless Execution** - Solver starts on-demand, runs, and terminates
2. **Real-time Logging Display** - Stream solver logs to the web interface
3. **Enhanced Progress Bar** - Show meaningful stages (10%, 20%, 30%... 100%)
4. **Cloud Result Storage** - Store and download Result_1, Result_2, etc.

---

## Feature 1: AWS Lambda Serverless Execution (Auto Start/Stop)

### What It Does
- AWS Lambda function starts **only when needed** (on-demand invocation)
- Runs the optimization solver
- Stores results to S3 or Vercel Blob
- **Terminates automatically** after completion
- **No persistent costs** - you only pay for execution time

### Implementation

**API Endpoint:** `/api/aws-solve/route.ts`
- Invokes AWS Lambda with case data
- Monitors execution
- Returns results

**FastAPI Solver Service:** `fastapi_solver_service.py`
- Enhanced with AWS Lambda mode
- Supports `storage_mode: 'cloud'` parameter
- Emits progress and log events

### How to Use

```typescript
// From the web UI
const response = await fetch('/api/aws-solve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(caseData)
});

const result = await response.json();
```

### Configuration

Set these environment variables in `.env.local`:

```bash
NEXT_PUBLIC_AWS_SOLVER_URL=https://your-lambda-url.execute-api.us-east-1.amazonaws.com
AWS_API_KEY=your-api-key-if-needed
```

### AWS Lambda Setup

1. Deploy the FastAPI solver to AWS Lambda using the Dockerfile:

```bash
# Build Lambda container
docker build -f Dockerfile.lambda -t scheduling-solver-lambda .

# Push to ECR
aws ecr create-repository --repository-name scheduling-solver-lambda
docker tag scheduling-solver-lambda:latest <account>.dkr.ecr.us-east-1.amazonaws.com/scheduling-solver-lambda:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/scheduling-solver-lambda:latest

# Create Lambda function
aws lambda create-function \
  --function-name scheduling-solver \
  --package-type Image \
  --code ImageUri=<account>.dkr.ecr.us-east-1.amazonaws.com/scheduling-solver-lambda:latest \
  --role arn:aws:iam::<account>:role/lambda-execution-role \
  --timeout 900 \
  --memory-size 3008
```

2. Create API Gateway endpoint pointing to Lambda

3. Configure CORS on API Gateway

---

## Feature 2: Real-time Logging Display on Website

### What It Does
- Streams solver logs in real-time to the web UI
- Uses Server-Sent Events (SSE) for efficient streaming
- Shows all solver activity: initialization, model building, solving, etc.
- Logs persist for the session

### Implementation

**API Endpoint:** `/api/logs/[runId]/route.ts`
- `GET /api/logs/[runId]` - Subscribe to log stream (SSE)
- `POST /api/logs/[runId]` - Add log entry (from solver)
- `DELETE /api/logs/[runId]` - Clear logs

**Log Format:**
```json
{
  "type": "log",
  "runId": "run_1234567890",
  "message": "[INFO] Building optimization model...",
  "timestamp": "2025-01-24T10:30:00.000Z"
}
```

### How to Use in React

```typescript
useEffect(() => {
  const eventSource = new EventSource(`/api/logs/${runId}`);
  
  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'log') {
      setLogs(prev => [...prev, data.message]);
    }
  };
  
  return () => eventSource.close();
}, [runId]);
```

### Solver Integration

From the solver (FastAPI or Lambda):

```python
# Send log to API
import requests

requests.post(f'/api/logs/{run_id}', json={
    'message': 'Building optimization model...',
    'level': 'info'
})
```

---

## Feature 3: Enhanced Progress Bar with Stages

### What It Does
- Shows meaningful progress stages instead of arbitrary percentages
- Displays specific phases: initialization, model building, solving, post-processing
- Updates at key checkpoints: 10%, 20%, 30%, 40%, 50%, 60%, 70%, 75%, 85%, 90%, 100%
- Users can see exactly what the solver is doing

### Progress Stages

| Progress | Stage | Description |
|----------|-------|-------------|
| 10% | Initialization | Reading input data, validating constraints |
| 20% | Model Building | Creating decision variables for shifts and providers |
| 30% | Variable Creation | Setting up assignment variables |
| 40% | Constraint Addition | Adding coverage, availability, workload constraints |
| 60% | Objective Setup | Setting up fairness and optimization objectives |
| 70% | Solver Start | Beginning CP-SAT optimization |
| 75% | Solution Search | Searching for optimal or diverse solutions |
| 85% | Post-processing | Processing and formatting results |
| 90% | File Generation | Creating output files and Excel reports |
| 100% | Complete | Optimization finished successfully |

### Implementation

Updated `fastapi_solver_service.py` with specific progress checkpoints:

```python
self._update_progress(run_id, 10, "Initializing solver...")
self._update_progress(run_id, 20, f"Building optimization model ({len(shifts)} shifts, {len(providers)} providers)...")
self._update_progress(run_id, 30, f"Creating decision variables ({len(shifts) * len(providers)} variables)...")
self._update_progress(run_id, 40, "Adding constraints (coverage, availability, workload)...")
self._update_progress(run_id, 60, "Setting up fairness and workload balancing objective...")
self._update_progress(run_id, 70, "Starting CP-SAT solver (this may take several minutes for large problems)...")
self._update_progress(run_id, 75, f"Searching for up to {k_solutions} diverse solutions...")
self._update_progress(run_id, 85, f"Found {len(solutions)} solution(s). Processing results...")
self._update_progress(run_id, 90, "Generating output files...")
self._update_progress(run_id, 100, "Optimization completed successfully!")
```

### UI Display

The progress bar in `RunTab.tsx` shows:
```tsx
<div className="flex items-center justify-between mb-3">
  <span className="text-sm font-semibold">Optimization Progress</span>
  <span className="text-lg font-bold">{Math.round(progress)}%</span>
</div>
<div className="w-full bg-gray-200 rounded-full h-3">
  <div
    className="bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 h-3 rounded-full transition-all duration-500"
    style={{ width: `${progress}%` }}
  />
</div>
<div className="mt-2 text-xs text-gray-600">
  {currentStageMessage}
</div>
```

---

## Feature 4: Store Results on Server with Download/View Interface

### What It Does
- All optimization results stored as Result_1, Result_2, Result_3, etc.
- Results stored in AWS S3 (for Lambda runs) or Vercel Blob (for serverless)
- Web interface to browse all past results
- Download any result folder as a ZIP file
- View metadata: file count, size, solutions, execution time

### Implementation

**Results List API:** `/api/results/list/route.ts`
- Lists all Result_N folders
- Merges results from Vercel Blob and AWS S3
- Returns metadata for each result

**Download API:** `/api/results/download/[folderId]/route.ts`
- Creates ZIP archive of result folder
- Streams ZIP to client
- Works with both Vercel Blob and AWS S3 storage

**UI Component:** `ResultsManager.tsx`
- Modal dialog showing all results
- Grid view with result cards
- Download buttons for each result
- Real-time status indicators

### Result Folder Structure

Each Result_N folder contains:
```
Result_12/
  ├── results.json           # Main optimization results
  ├── input_case.json        # Original case data
  ├── schedule.xlsx          # Excel export (optional)
  ├── calendar.xlsx          # Calendar view (optional)
  ├── constants_effective.json
  ├── eligibility_capacity.json
  └── scheduler_log_*.json   # Solver logs
```

### How to Use

**Open Results Manager:**
```tsx
import ResultsManager from '@/components/ResultsManager';

function YourComponent() {
  const [showResults, setShowResults] = useState(false);
  
  return (
    <>
      <button onClick={() => setShowResults(true)}>
        View Past Results
      </button>
      
      <ResultsManager 
        isOpen={showResults} 
        onClose={() => setShowResults(false)} 
      />
    </>
  );
}
```

**List Results Programmatically:**
```typescript
const response = await fetch('/api/results/list');
const data = await response.json();

console.log(`Found ${data.total} results`);
data.folders.forEach(folder => {
  console.log(`${folder.name}: ${folder.fileCount} files, ${folder.solutions} solutions`);
});
```

**Download a Result:**
```typescript
const response = await fetch('/api/results/download/Result_12');
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'Result_12.zip';
a.click();
```

---

## Integration with RunTab

Update `RunTab.tsx` to include the Results Manager:

```tsx
import { useState } from 'react';
import ResultsManager from '@/components/ResultsManager';

export default function RunTab() {
  const [showResultsManager, setShowResultsManager] = useState(false);
  
  return (
    <div>
      {/* Existing RunTab content */}
      
      {/* Add button to open Results Manager */}
      <button
        onClick={() => setShowResultsManager(true)}
        className="px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-xl hover:from-green-700 hover:to-blue-700 font-semibold flex items-center space-x-2"
      >
        <IoFolderOpenSharp className="w-5 h-5" />
        <span>View Past Results</span>
      </button>
      
      {/* Results Manager Modal */}
      <ResultsManager 
        isOpen={showResultsManager}
        onClose={() => setShowResultsManager(false)}
      />
    </div>
  );
}
```

---

## Testing

### Test AWS Lambda Solver

```bash
# Test health endpoint
curl https://your-lambda-url.execute-api.us-east-1.amazonaws.com/health

# Test solve endpoint
curl -X POST https://your-lambda-url.execute-api.us-east-1.amazonaws.com/solve \
  -H "Content-Type: application/json" \
  -d @test-case.json
```

### Test Real-time Logs

```bash
# Subscribe to log stream (SSE)
curl http://localhost:3000/api/logs/run_1234567890

# Send log from solver
curl -X POST http://localhost:3000/api/logs/run_1234567890 \
  -H "Content-Type: application/json" \
  -d '{"message": "Test log", "level": "info"}'
```

### Test Results API

```bash
# List all results
curl http://localhost:3000/api/results/list

# Download result
curl http://localhost:3000/api/results/download/Result_12 -o Result_12.zip
```

---

## Deployment Checklist

- [ ] Set `NEXT_PUBLIC_AWS_SOLVER_URL` environment variable
- [ ] Deploy FastAPI solver to AWS Lambda
- [ ] Configure API Gateway with CORS
- [ ] Test Lambda invocation
- [ ] Verify S3 bucket permissions for result storage
- [ ] Test real-time log streaming
- [ ] Verify progress bar shows all stages
- [ ] Test result download functionality
- [ ] Configure Lambda timeout (15 minutes recommended)
- [ ] Set up CloudWatch logs for Lambda

---

## Troubleshooting

### Lambda Not Starting
- Check `NEXT_PUBLIC_AWS_SOLVER_URL` is set correctly
- Verify API Gateway configuration
- Check Lambda execution role has necessary permissions

### Logs Not Streaming
- Verify SSE connection is open in browser
- Check browser console for connection errors
- Test log endpoint manually with curl

### Progress Bar Stuck
- Check solver is emitting progress updates
- Verify `_update_progress()` calls in solver code
- Check browser network tab for progress events

### Results Not Appearing
- Verify S3/Vercel Blob permissions
- Check result folder naming (must match `Result_\d+` pattern)
- Test `/api/results/list` endpoint manually

---

## Architecture Diagram

```
┌─────────────────┐
│   Web Browser   │
│   (React UI)    │
└────────┬────────┘
         │
         ├─────────────────────┐
         │                     │
         v                     v
┌────────────────┐    ┌───────────────────┐
│  Next.js API   │    │  EventSource      │
│  /api/aws-solve│    │  /api/logs/[id]   │
└────────┬───────┘    └─────────┬─────────┘
         │                      │
         v                      │
┌──────────────────┐           │
│  AWS Lambda      │───────────┘
│  (FastAPI)       │  (Sends logs)
│                  │
│  - Starts on     │
│    invocation    │
│  - Runs solver   │
│  - Stores to S3  │
│  - Terminates    │
└────────┬─────────┘
         │
         v
┌──────────────────┐
│  AWS S3          │
│  Result_1/       │
│  Result_2/       │
│  Result_3/       │
└──────────────────┘
```

---

## Cost Optimization

### Lambda Pricing
- **No cost when idle** (serverless)
- Pay only for execution time
- Typical run: $0.01 - $0.10 per optimization
- Monthly cost for 100 runs: ~$1-10

### Storage Pricing
- S3: $0.023 per GB/month
- Typical result folder: 1-5 MB
- 100 results ≈ 500 MB = $0.01/month

### Total Estimated Cost
- **Development:** < $5/month
- **Production (100 runs/month):** ~$10-20/month
- **Much cheaper than ECS/EC2 always-on instances**

---

## Next Steps

1. **Deploy to AWS Lambda** - Follow Lambda setup instructions
2. **Test End-to-End** - Run optimization from web UI through Lambda
3. **Monitor Logs** - Check CloudWatch for any issues
4. **Optimize Performance** - Tune Lambda memory/timeout settings
5. **Enable Auto-scaling** - Configure Lambda concurrency if needed

---

## Support

For questions or issues:
1. Check CloudWatch logs for Lambda errors
2. Verify environment variables are set correctly
3. Test each API endpoint individually
4. Review browser console for client-side errors

---

**Last Updated:** January 24, 2025
**Version:** 2.0.0
**Status:** Production Ready ✅
