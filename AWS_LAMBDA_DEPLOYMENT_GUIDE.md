# AWS Lambda Deployment Guide - Fix Cloud Solver Issues

## 🎯 What This Will Fix

After deploying this updated AWS Lambda code, you will have:

✅ **Progress tracking** - Smooth 0% → 100% instead of instant jump  
✅ **Proper S3 storage** - Files stored correctly with metadata  
✅ **Correct result numbering** - Result_1, Result_2, Result_3, etc.  
✅ **Persistent timestamps** - Creation time never changes  
✅ **Non-empty downloads** - ZIP files with actual content

---

## 📋 Prerequisites

1. AWS Account with access to:
   - AWS Lambda
   - AWS S3
   - AWS API Gateway
   - IAM Roles

2. AWS CLI installed and configured
3. Python 3.9+ locally for testing

---

## 🚀 Step-by-Step Deployment

### Step 1: Create S3 Bucket for Results

```bash
# Create S3 bucket
aws s3 mb s3://scheduling-solver-results --region us-east-1

# Enable versioning (optional but recommended)
aws s3api put-bucket-versioning \
  --bucket scheduling-solver-results \
  --versioning-configuration Status=Enabled

# Set CORS for downloads
aws s3api put-bucket-cors \
  --bucket scheduling-solver-results \
  --cors-configuration file://s3-cors.json
```

**Create `s3-cors.json`:**
```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST"],
      "AllowedHeaders": ["*"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```

### Step 2: Update Your Lambda Function Code

**Option A: Using AWS Console**

1. Go to AWS Lambda Console
2. Find your function (the one at `iiittt6g5f.execute-api.us-east-1.amazonaws.com`)
3. Click "Upload from" → ".zip file"
4. Upload the deployment package (see below)

**Option B: Using AWS CLI**

```bash
# Package your code
cd /path/to/lambda/code
zip -r lambda-deployment.zip .

# Update Lambda function
aws lambda update-function-code \
  --function-name YourSchedulingSolverFunction \
  --zip-file fileb://lambda-deployment.zip \
  --region us-east-1
```

### Step 3: Create Lambda Deployment Package

Your Lambda needs these files:

```
lambda-deployment/
├── lambda_function.py          # The AWS_LAMBDA_UPDATED_CODE.py (renamed)
├── your_solver_module.py       # Your actual solver logic
├── requirements.txt            # Python dependencies
└── python/                     # Installed packages
    └── lib/
        └── python3.9/
            └── site-packages/
```

**Create `requirements.txt`:**
```txt
fastapi==0.104.1
mangum==0.17.0
boto3==1.28.85
ortools==9.7.2996
pydantic==2.5.0
python-multipart==0.0.6
```

**Package script:**
```bash
#!/bin/bash
# package-lambda.sh

# Create clean directory
rm -rf lambda-deployment
mkdir -p lambda-deployment

# Copy your code
cp AWS_LAMBDA_UPDATED_CODE.py lambda-deployment/lambda_function.py
cp your_solver_logic.py lambda-deployment/your_solver_module.py

# Install dependencies
pip install -r requirements.txt -t lambda-deployment/python/lib/python3.9/site-packages/

# Create ZIP
cd lambda-deployment
zip -r ../lambda-deployment.zip .
cd ..

echo "✅ Lambda deployment package created: lambda-deployment.zip"
```

### Step 4: Update Lambda IAM Role

Your Lambda needs S3 permissions. Add this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::scheduling-solver-results",
        "arn:aws:s3:::scheduling-solver-results/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    }
  ]
}
```

**Apply via AWS CLI:**
```bash
aws iam put-role-policy \
  --role-name YourLambdaExecutionRole \
  --policy-name S3AccessPolicy \
  --policy-document file://lambda-s3-policy.json
```

### Step 5: Update Lambda Environment Variables

```bash
aws lambda update-function-configuration \
  --function-name YourSchedulingSolverFunction \
  --environment Variables="{S3_RESULTS_BUCKET=scheduling-solver-results,AWS_REGION=us-east-1}" \
  --region us-east-1
```

Or via AWS Console:
1. Go to Lambda → Configuration → Environment variables
2. Add:
   - `S3_RESULTS_BUCKET` = `scheduling-solver-results`
   - `AWS_REGION` = `us-east-1`

### Step 6: Increase Lambda Timeout

```bash
# Set timeout to 10 minutes (for complex optimizations)
aws lambda update-function-configuration \
  --function-name YourSchedulingSolverFunction \
  --timeout 600 \
  --region us-east-1
```

### Step 7: Increase Lambda Memory

```bash
# Set memory to 2GB (faster execution)
aws lambda update-function-configuration \
  --function-name YourSchedulingSolverFunction \
  --memory-size 2048 \
  --region us-east-1
```

---

## 🧪 Testing

### Test 1: Health Check
```bash
curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health
```

**Expected:**
```json
{
  "status": "ok",
  "message": "AWS Lambda Solver is running",
  "timestamp": "2025-10-29T...",
  "active_runs": 0,
  "s3_bucket": "scheduling-solver-results",
  "region": "us-east-1"
}
```

### Test 2: Start Optimization
```bash
curl -X POST https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/solve \
  -H "Content-Type: application/json" \
  -d @test_case.json
```

**Expected (Immediate Response):**
```json
{
  "run_id": "abc-123-def-456",
  "status": "processing",
  "progress": 0,
  "message": "Optimization started"
}
```

### Test 3: Check Progress
```bash
curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/status/abc-123-def-456
```

**Expected (While Running):**
```json
{
  "run_id": "abc-123-def-456",
  "status": "processing",
  "progress": 45,
  "message": "Solving optimization model..."
}
```

**Expected (When Complete):**
```json
{
  "run_id": "abc-123-def-456",
  "status": "completed",
  "progress": 100,
  "message": "Optimization completed successfully",
  "results": { ... },
  "output_directory": "Result_1"
}
```

### Test 4: List Results
```bash
curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/results/folders
```

**Expected:**
```json
{
  "folders": [
    {
      "name": "Result_2",
      "created": "2025-10-29T12:30:00Z",
      "solver_type": "aws_lambda",
      "solutions_count": 5
    },
    {
      "name": "Result_1",
      "created": "2025-10-29T12:00:00Z",
      "solver_type": "aws_lambda",
      "solutions_count": 3
    }
  ]
}
```

### Test 5: Download Results
```bash
curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/download/folder/Result_1 \
  --output Result_1.zip

# Check file size (should NOT be 0 B)
ls -lh Result_1.zip
```

### Test 6: Check S3
```bash
# List S3 contents
aws s3 ls s3://scheduling-solver-results/ --recursive

# Should show:
# Result_1/results.json
# Result_1/metadata.json
# Result_2/results.json
# Result_2/metadata.json
```

---

## 🔧 Integration with Your Solver Logic

In `AWS_LAMBDA_UPDATED_CODE.py`, replace this line:

```python
from your_solver_module import solve_scheduling_case
```

With your actual solver import. Your solver function should:

**Input:**
```python
def solve_scheduling_case(
    case_data: Dict[str, Any],
    run_id: str,
    progress_callback: Callable[[str, int, str], None]
) -> Dict[str, Any]:
    """
    Your solver logic here
    
    Args:
        case_data: The scheduling case
        run_id: Unique run identifier
        progress_callback: Function to update progress
                          progress_callback(run_id, percentage, message)
    
    Returns:
        {
            "solutions": [...],
            "solver_stats": {...},
            "statistics": {...}
        }
    """
    # Your existing solver code
    # Call progress_callback at key stages:
    
    progress_callback(run_id, 10, "Building model...")
    # ... build model ...
    
    progress_callback(run_id, 50, "Solving...")
    # ... run solver ...
    
    progress_callback(run_id, 80, "Processing results...")
    # ... process results ...
    
    return {
        "solutions": solutions,
        "solver_stats": stats
    }
```

---

## 🎯 Verification Checklist

After deployment, verify in your web app:

- [ ] AWS Cloud solver shows smooth progress (0% → 15% → 60% → 100%)
- [ ] Progress doesn't jump instantly to 100%
- [ ] Downloads produce non-empty ZIP files
- [ ] Results persist after page refresh
- [ ] Result numbering increments (Result_1, Result_2, Result_3...)
- [ ] Timestamps don't change when viewing results
- [ ] Multiple runs create separate Result_N folders
- [ ] S3 bucket contains all result files

---

## 🐛 Troubleshooting

### Issue: Lambda times out
**Solution:** Increase timeout to 15 minutes
```bash
aws lambda update-function-configuration \
  --function-name YourSchedulingSolverFunction \
  --timeout 900
```

### Issue: Out of memory
**Solution:** Increase memory to 3GB
```bash
aws lambda update-function-configuration \
  --function-name YourSchedulingSolverFunction \
  --memory-size 3008
```

### Issue: S3 permission denied
**Solution:** Check IAM role has S3 permissions (see Step 4)

### Issue: Still shows 0 B downloads
**Solution:** 
1. Check S3 bucket: `aws s3 ls s3://scheduling-solver-results/`
2. Verify files exist: `aws s3 ls s3://scheduling-solver-results/Result_1/`
3. Check CloudWatch logs for errors

### Issue: Progress still jumps instantly
**Solution:**
1. Verify Lambda is using new code: Check CloudWatch logs for "Started optimization run"
2. Test status endpoint directly: `curl .../status/{run_id}`
3. Check frontend is polling (see browser Network tab)

---

## 📊 Monitoring

### CloudWatch Logs
```bash
# Stream logs
aws logs tail /aws/lambda/YourSchedulingSolverFunction --follow

# Should see:
# [INFO] Started optimization run: abc-123
# [INFO] Run abc-123: 10% - Building model...
# [INFO] Run abc-123: 50% - Solving...
# [INFO] Run abc-123: 90% - Uploading to S3...
# [INFO] Run abc-123 completed successfully
```

### S3 Metrics
Monitor in AWS Console → S3 → Metrics:
- Storage (should increase with each run)
- Requests (PUT for uploads, GET for downloads)

---

## 💰 Cost Estimate

With this async setup:

- **Lambda:** ~$0.20 per 1000 requests + compute time
- **S3:** ~$0.023 per GB/month storage
- **API Gateway:** ~$3.50 per million requests

**Example:** 100 optimizations/month:
- Lambda: ~$2-5 (depending on complexity)
- S3: ~$0.50 (for ~20 GB results)
- **Total: ~$3-6/month**

Much cheaper than keeping a server running 24/7!

---

## 🎉 Success!

Once deployed, your AWS Cloud solver will:

✅ Show real-time progress like local solver  
✅ Store results properly in S3  
✅ Number results correctly (Result_1, Result_2, ...)  
✅ Maintain consistent timestamps  
✅ Provide non-empty downloads  

**Your web app will have 3 fully working solvers:**
- ✅ LOCAL (fastest, requires Python)
- ✅ SERVERLESS (always available)
- ✅ AWS CLOUD (scalable, persistent)

---

**Need help?** Check CloudWatch logs or test endpoints individually!
