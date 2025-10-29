# Local Solver Progress Tracking API

## Overview
For real-time progress tracking, your local Python solver needs to implement a status endpoint.

## Required Changes to Python Solver

### 1. Modify `/solve` Endpoint

The `/solve` endpoint should return immediately with a `run_id` and `status: 'processing'`:

```python
@app.post("/solve")
async def solve(request: dict):
    # Generate unique run ID
    run_id = f"run_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    
    # Store request for background processing
    pending_jobs[run_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Optimization started",
        "started_at": time.time()
    }
    
    # Start background task
    background_tasks.add_task(run_optimization, run_id, request)
    
    # Return immediately
    return {
        "run_id": run_id,
        "status": "processing",
        "progress": 0,
        "message": "Optimization started - use /status/{run_id} to track progress"
    }
```

### 2. Add `/status/{run_id}` Endpoint

This endpoint provides real-time status updates:

```python
# Global dict to track jobs
pending_jobs = {}

@app.get("/status/{run_id}")
async def get_status(run_id: str):
    if run_id not in pending_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = pending_jobs[run_id]
    
    return {
        "run_id": run_id,
        "status": job["status"],  # 'processing', 'completed', 'failed'
        "progress": job["progress"],  # 0-100
        "message": job["message"],
        "results": job.get("results"),  # Only when completed
        "error": job.get("error")  # Only when failed
    }
```

### 3. Background Processing Function

```python
import asyncio
from fastapi import BackgroundTasks

async def run_optimization(run_id: str, request: dict):
    """Run optimization in background and update progress"""
    
    try:
        # Update: Starting
        pending_jobs[run_id]["status"] = "processing"
        pending_jobs[run_id]["progress"] = 10
        pending_jobs[run_id]["message"] = "Loading data..."
        
        # Parse input data
        shifts = request.get("shifts", [])
        providers = request.get("providers", [])
        
        # Update: Data loaded
        pending_jobs[run_id]["progress"] = 20
        pending_jobs[run_id]["message"] = f"Processing {len(shifts)} shifts and {len(providers)} providers..."
        
        # Run actual optimization (this is the long-running part)
        # Update progress periodically during optimization
        
        # Example: if using OR-Tools
        solver = pywraplp.Solver.CreateSolver('CBC')
        
        # ... build model ...
        
        pending_jobs[run_id]["progress"] = 40
        pending_jobs[run_id]["message"] = "Building optimization model..."
        
        # Solve
        pending_jobs[run_id]["progress"] = 50
        pending_jobs[run_id]["message"] = "Running solver (this may take hours)..."
        
        status = solver.Solve()
        
        # Extract results
        pending_jobs[run_id]["progress"] = 90
        pending_jobs[run_id]["message"] = "Extracting solution..."
        
        results = extract_solution(solver, shifts, providers)
        
        # Complete
        pending_jobs[run_id]["status"] = "completed"
        pending_jobs[run_id]["progress"] = 100
        pending_jobs[run_id]["message"] = "Optimization completed successfully"
        pending_jobs[run_id]["results"] = results
        
    except Exception as e:
        # Error handling
        pending_jobs[run_id]["status"] = "failed"
        pending_jobs[run_id]["progress"] = 0
        pending_jobs[run_id]["message"] = f"Optimization failed: {str(e)}"
        pending_jobs[run_id]["error"] = str(e)
```

## Frontend Integration (Already Done!)

The frontend now:
1. Sends request to `/solve`
2. Gets back `run_id` and `status: 'processing'`
3. Polls `/status/{run_id}` every 2 seconds
4. Updates progress bar with real-time progress
5. Shows completion when `status: 'completed'`

## Fallback Behavior

If your Python solver doesn't implement `/status/{run_id}`:
- The frontend will get a 404 error on status polls
- It will **automatically fall back** to synchronous behavior
- Progress bar will use simulation (like before)
- Everything still works, just no real-time progress

## Example Progress Updates

During a long optimization, update progress like this:

```python
# At various stages:
pending_jobs[run_id]["progress"] = 10  # Data loaded
pending_jobs[run_id]["progress"] = 25  # Model built
pending_jobs[run_id]["progress"] = 50  # Solving started
pending_jobs[run_id]["progress"] = 75  # Solution found
pending_jobs[run_id]["progress"] = 90  # Extracting results
pending_jobs[run_id]["progress"] = 100  # Complete
```

## Testing

1. Start your Python solver: `uvicorn main:app --reload --port 8000`
2. Test status endpoint: `curl http://localhost:8000/status/test_run_id`
3. Run optimization from frontend
4. Watch progress bar update in real-time!

## Complete Example Structure

```python
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Job tracking
pending_jobs = {}

@app.post("/solve")
async def solve(request: dict, background_tasks: BackgroundTasks):
    run_id = f"run_{int(time.time())}_{uuid.uuid4().hex[:8]}"
    
    pending_jobs[run_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Starting optimization..."
    }
    
    background_tasks.add_task(run_optimization, run_id, request)
    
    return {
        "run_id": run_id,
        "status": "processing",
        "progress": 0
    }

@app.get("/status/{run_id}")
async def get_status(run_id: str):
    if run_id not in pending_jobs:
        return {"error": "Job not found"}, 404
    
    return pending_jobs[run_id]

async def run_optimization(run_id: str, request: dict):
    # Your optimization logic here
    # Update pending_jobs[run_id]["progress"] periodically
    pass
```

## Benefits

✅ Real-time progress tracking  
✅ User knows optimization is running  
✅ Can estimate remaining time  
✅ Better user experience  
✅ No timeout issues  
✅ Frontend shows actual solver progress  

## Optional Enhancements

1. **Add time estimates:**
   ```python
   "estimated_completion": "2025-10-29T10:30:00Z"
   ```

2. **Add detailed logs:**
   ```python
   "logs": [
       "[10:00:00] Started optimization",
       "[10:05:00] Found initial solution",
       "[10:15:00] Improving solution..."
   ]
   ```

3. **Add cancellation:**
   ```python
   @app.post("/cancel/{run_id}")
   async def cancel_job(run_id: str):
       if run_id in pending_jobs:
           pending_jobs[run_id]["status"] = "cancelled"
       return {"cancelled": True}
   ```

---

**Note:** If you don't implement this, the frontend will still work - it just won't show real-time progress for the local solver. The progress bar will use simulation instead.
