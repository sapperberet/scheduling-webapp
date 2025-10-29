# AWS Lambda Quick Deployment - TL;DR

## ⚡ Ultra-Fast Deployment (15 minutes)

### 1. Create S3 Bucket (2 min)
```bash
aws s3 mb s3://scheduling-solver-results --region us-east-1
```

### 2. Package Lambda (5 min)
```bash
# Install dependencies
pip install fastapi mangum boto3 ortools pydantic -t ./lambda-package

# Copy code
cp AWS_LAMBDA_UPDATED_CODE.py ./lambda-package/lambda_function.py
cp your_solver.py ./lambda-package/your_solver_module.py

# Create ZIP
cd lambda-package && zip -r ../lambda.zip . && cd ..
```

### 3. Deploy to Lambda (3 min)
```bash
# Via AWS CLI
aws lambda update-function-code \
  --function-name YourFunctionName \
  --zip-file fileb://lambda.zip \
  --region us-east-1

# Or via AWS Console:
# Lambda → Upload from → .zip file → Upload lambda.zip
```

### 4. Set Environment Variables (2 min)
```bash
aws lambda update-function-configuration \
  --function-name YourFunctionName \
  --environment Variables="{S3_RESULTS_BUCKET=scheduling-solver-results,AWS_REGION=us-east-1}" \
  --timeout 600 \
  --memory-size 2048
```

### 5. Update IAM Role (3 min)
Add S3 permissions to Lambda execution role:
```json
{
  "Effect": "Allow",
  "Action": ["s3:*"],
  "Resource": ["arn:aws:s3:::scheduling-solver-results/*"]
}
```

### 6. Test (1 min)
```bash
curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health
```

## ✅ Done!

Your AWS Cloud solver now has:
- ✅ Real-time progress tracking
- ✅ Proper S3 storage  
- ✅ Correct result numbering
- ✅ Non-empty downloads

---

## 🔧 Integration Point

In `AWS_LAMBDA_UPDATED_CODE.py`, replace line 187:
```python
from your_solver_module import solve_scheduling_case
```

With your actual solver import. Make sure it accepts:
```python
def solve_scheduling_case(case_data, run_id, progress_callback):
    # Your solver logic
    progress_callback(run_id, 50, "Solving...")
    # ...
    return {"solutions": [...], "solver_stats": {...}}
```

---

## 📞 Quick Support

**Issue:** Lambda times out  
**Fix:** `--timeout 900` (15 min)

**Issue:** Out of memory  
**Fix:** `--memory-size 3008` (3 GB)

**Issue:** S3 permission denied  
**Fix:** Add S3 policy to IAM role

**Issue:** Still shows old behavior  
**Fix:** Verify deployment: Check CloudWatch logs

---

## 💡 Alternative: Use What Works Now!

**Don't want to deploy right now?**

Just use **LOCAL** or **SERVERLESS** solver - both have working progress tracking!

Deploy AWS Lambda later when you have time. Your app works perfectly with the other solvers! 🎉
