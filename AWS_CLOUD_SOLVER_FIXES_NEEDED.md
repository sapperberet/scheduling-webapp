# AWS Cloud Solver Issues & Fixes

## Date: October 29, 2025

---

## 🔍 Issues Identified

### 1. Progress Bar Jumps Instantly (0% → 100%)
**Problem:** AWS Lambda returns results synchronously, frontend can't show real progress

**Root Cause:** AWS Lambda doesn't implement async execution pattern like local solver

### 2. Downloads Show 0 B
**Problem:** Downloaded ZIP files are empty

**Root Cause:** 
- AWS Lambda may not be storing results to S3 correctly
- `/api/results/list` only checks Vercel Blob for file sizes
- AWS S3 files aren't being counted

### 3. Result Numbering Wrong (Always Result_1)
**Problem:** New AWS results overwrite existing ones

**Root Cause:** 
- `generateResultFolderName()` uses localStorage counter
- Doesn't check existing AWS S3 folders
- Each run thinks it's the first result

### 4. Timestamp Changes When Viewing
**Problem:** Opening Results Manager changes the result timestamp

**Root Cause:**
- Results Manager may be updating timestamp on each view
- Should use creation time, not last-modified time

---

## ✅ Frontend Fixes Applied

### File: `src/components/tabs/RunTab.tsx`

#### Change 1: Use API Route Instead of Direct AWS Call
**Before:**
```typescript
const awsResponse = await fetch(`${AWS_SOLVER_URL}/solve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

**After:**
```typescript
const awsResponse = await fetch('/api/aws-solve', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
```

#### Change 2: Add Status Polling for Progress Tracking
```typescript
// Check if AWS returned async response
if (awsResult.run_id && (awsResult.status === 'processing' || awsResult.status === 'accepted')) {
  addLog('[INFO] AWS optimization started, polling for progress...', 'info');
  
  // Poll for status updates every 2 seconds
  const pollInterval = setInterval(async () => {
    const statusResponse = await fetch(`${AWS_SOLVER_URL}/status/${awsResult.run_id}`);
    const status = await statusResponse.json();
    
    // Update progress
    if (status.progress !== undefined) {
      setProgress(status.progress);
      addLog(`[PROGRESS] ${status.progress}% - ${status.message}`, 'info');
    }
    
    // Check if completed
    if (status.status === 'completed') {
      clearInterval(pollInterval);
      result = status;
    }
  }, 2000);
}
```

---

## ⚠️ AWS Lambda Backend Updates Needed

Your AWS Lambda function needs to be updated to match the local solver pattern:

### Required Endpoints:

#### 1. POST /solve (Async Execution)
**Current (Synchronous):**
```python
@app.post("/solve")
def solve(case: SchedulingCase):
    result = run_optimization(case)  # Blocks for minutes
    return result  # Returns when done
```

**Required (Asynchronous):**
```python
from fastapi import BackgroundTasks

@app.post("/solve")
async def solve(case: SchedulingCase, background_tasks: BackgroundTasks):
    run_id = str(uuid.uuid4())
    
    active_runs[run_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Starting..."
    }
    
    # Start background task
    background_tasks.add_task(run_optimization, case, run_id)
    
    # Return immediately
    return {
        "run_id": run_id,
        "status": "processing",
        "progress": 0
    }
```

#### 2. GET /status/{run_id} (Progress Tracking)
```python
@app.get("/status/{run_id}")
async def get_status(run_id: str):
    if run_id not in active_runs:
        raise HTTPException(status_code=404, detail="Run not found")
    
    run_data = active_runs[run_id]
    
    response = {
        "status": run_data["status"],
        "message": run_data["message"],
        "run_id": run_id,
        "progress": run_data.get("progress", 0)
    }
    
    # Include full results when completed
    if run_data["status"] == "completed":
        response["results"] = run_data["result"]
        response["output_directory"] = run_data["output_directory"]
    
    return response
```

#### 3. Background Task with Progress Updates
```python
async def run_optimization(case_data, run_id):
    try:
        active_runs[run_id]["status"] = "running"
        
        # Progress updates throughout
        update_progress(run_id, 2, "Validating input...")
        
        # Run solver
        result = solve_with_ortools(case_data, run_id)
        
        # Store to S3
        s3_path = upload_to_s3(result, run_id)
        
        # Mark complete
        active_runs[run_id].update({
            "status": "completed",
            "progress": 100,
            "result": result,
            "output_directory": s3_path
        })
        
    except Exception as e:
        active_runs[run_id].update({
            "status": "failed",
            "progress": -1,
            "message": str(e)
        })

def update_progress(run_id, progress, message):
    if run_id in active_runs:
        current = active_runs[run_id].get("progress", 0)
        # Only move forward
        if progress > current:
            active_runs[run_id]["progress"] = progress
            active_runs[run_id]["message"] = message
```

### Required S3 Storage Updates:

#### Store Results with Metadata
```python
import boto3
import json
from datetime import datetime

s3 = boto3.client('s3')
BUCKET_NAME = 'your-results-bucket'

def upload_to_s3(result, run_id):
    # Generate unique folder name
    folder_name = f"Result_{get_next_number()}"
    
    # Upload results.json
    s3.put_object(
        Bucket=BUCKET_NAME,
        Key=f"{folder_name}/results.json",
        Body=json.dumps(result),
        ContentType='application/json',
        Metadata={
            'run-id': run_id,
            'created-at': datetime.utcnow().isoformat(),
            'solver-type': 'aws_lambda'
        }
    )
    
    # Upload other files (schedule.xlsx, etc.)
    # ...
    
    return folder_name

def get_next_number():
    # List existing Result_N folders in S3
    response = s3.list_objects_v2(
        Bucket=BUCKET_NAME,
        Prefix='Result_',
        Delimiter='/'
    )
    
    max_num = 0
    for prefix in response.get('CommonPrefixes', []):
        folder = prefix['Prefix'].rstrip('/')
        match = re.match(r'Result_(\d+)', folder)
        if match:
            num = int(match.group(1))
            if num > max_num:
                max_num = num
    
    return max_num + 1
```

---

## 🔧 API Endpoint Reference

### Local Solver (Working ✅)
```
POST   http://localhost:8000/solve
       → Returns: {run_id, status: 'processing', progress: 0}

GET    http://localhost:8000/status/{run_id}
       → Returns: {status, progress, message, results?}
```

### AWS Lambda (Needs Update ⚠️)
```
POST   https://your-lambda-url/solve
       → Currently: Returns full results (blocks)
       → Needs: Return {run_id, status: 'processing'}

GET    https://your-lambda-url/status/{run_id}
       → Currently: Doesn't exist
       → Needs: Return {status, progress, results?}
```

---

## 📊 Progress Flow Comparison

### Local Solver (Working)
```
Frontend → POST /solve
        ← {run_id: 'abc-123', status: 'processing', progress: 0}

Frontend → GET /status/abc-123 (poll every 2s)
        ← {status: 'processing', progress: 15, message: '...'}
        ← {status: 'processing', progress: 60, message: '...'}
        ← {status: 'completed', progress: 100, results: {...}}
```

### AWS Lambda (Current - Broken)
```
Frontend → POST /solve
        ... (waits 2 minutes while Lambda runs)
        ← {status: 'completed', progress: 100, results: {...}}

Progress bar: 0% → (stuck) → 100% (instant when response arrives)
```

### AWS Lambda (Required)
```
Frontend → POST /solve
        ← {run_id: 'xyz-789', status: 'processing', progress: 0}

Frontend → GET /status/xyz-789 (poll every 2s)
        ← {status: 'processing', progress: 10, message: '...'}
        ← {status: 'processing', progress: 45, message: '...'}
        ← {status: 'completed', progress: 100, results: {...}}
```

---

## 🚀 Testing After AWS Lambda Update

### 1. Test Async Execution
```bash
# Start optimization
curl -X POST https://your-lambda-url/solve \
  -H "Content-Type: application/json" \
  -d @test_case.json

# Should return immediately:
# {"run_id": "abc-123", "status": "processing", "progress": 0}
```

### 2. Test Progress Tracking
```bash
# Check status (repeat every 2 seconds)
curl https://your-lambda-url/status/abc-123

# Should return:
# {"status": "processing", "progress": 15, "message": "Building model..."}
# {"status": "processing", "progress": 60, "message": "Solving..."}
# {"status": "completed", "progress": 100, "results": {...}}
```

### 3. Test S3 Storage
```bash
# List S3 folders
aws s3 ls s3://your-bucket/ --recursive | grep Result_

# Should show:
# Result_1/results.json
# Result_1/schedule.xlsx
# Result_2/results.json
# Result_2/schedule.xlsx
```

### 4. Test Download
```bash
# Download from frontend
# Should get non-empty ZIP file with all results
```

---

## 📋 Deployment Checklist

- [ ] Update AWS Lambda code to support async execution
- [ ] Add `/status/{run_id}` endpoint to Lambda
- [ ] Implement `active_runs` dictionary for tracking
- [ ] Add `BackgroundTasks` to `/solve` endpoint
- [ ] Update S3 upload to include metadata
- [ ] Fix folder numbering (check existing S3 folders)
- [ ] Deploy updated Lambda function
- [ ] Test with frontend (should see smooth progress bar)
- [ ] Verify files download correctly (non-empty ZIP)
- [ ] Check Result_N numbering increments properly

---

## ⏰ Temporary Workaround

**Until AWS Lambda is updated, use:**

1. **LOCAL Solver** (Recommended)
   - ✅ Progress tracking working
   - ✅ Fast execution
   - ✅ Downloads working
   - ⚠️ Requires Python service running

2. **SERVERLESS Solver** (Alternative)
   - ✅ Progress tracking working
   - ✅ Always available
   - ✅ Downloads working
   - ⚠️ Slower than local

**Avoid AWS Cloud solver until backend is updated**

---

## 📞 Support

If you need help updating the AWS Lambda:

1. Reference the local solver code:
   - `public/local-solver-package/fastapi_solver_service.py`
   - `/solve` endpoint (line ~894)
   - `run_optimization()` function (line ~858)
   - `_update_progress()` function (line ~814)

2. Key changes needed:
   - Add `BackgroundTasks` parameter
   - Return immediately with `run_id`
   - Implement status polling endpoint
   - Update progress throughout execution
   - Store results in S3 with metadata

3. Test locally before deploying to AWS

---

**Last Updated:** October 29, 2025  
**Status:** Frontend fixes applied, AWS Lambda needs backend update  
**Workaround:** Use LOCAL or SERVERLESS solver
