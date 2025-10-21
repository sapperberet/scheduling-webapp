# AWS Deployment Guide for Scheduling Application

## Overview
This guide will help you deploy your scheduling application to AWS with:
- **Frontend**: Next.js application hosted on AWS Amplify or CloudFront
- **Solver API**: Python FastAPI solver on AWS Lambda or ECS
- **Storage**: S3 for result files and outputs
- **Domain**: Custom domain via Route 53

---

## Architecture Options

### Option 1: Serverless (Recommended for Cost Efficiency)
- **Frontend**: AWS Amplify
- **Solver API**: AWS Lambda + API Gateway
- **Storage**: S3
- **Cost**: Pay per use, ideal for variable workload

### Option 2: Container-based (Recommended for Performance)
- **Frontend**: ECS Fargate + CloudFront
- **Solver API**: ECS Fargate with Application Load Balancer
- **Storage**: S3 + EFS (for large computations)
- **Cost**: Higher baseline, better for consistent heavy workload

---

## Prerequisites

1. **AWS Account**: Create at AWS Console (https://aws.amazon.com)
2. **AWS CLI**: Install and configure
   ```bash
   # Install AWS CLI
   # Windows: Download from https://aws.amazon.com/cli/
   # Mac: brew install awscli
   
   # Configure credentials
   aws configure
   # Enter: Access Key ID, Secret Access Key, Region (e.g., us-east-1)
   ```

3. **Domain Name**: You mentioned you have one
   - Transfer to Route 53 or configure DNS delegation

4. **Docker** (for Option 2): Install Docker Desktop

---

## Part 1: Deploy Solver API to AWS

### Option 1A: AWS Lambda (Serverless Solver)

#### Step 1: Prepare Lambda Function

Create a Lambda-compatible handler:

```python
# aws_lambda_handler.py
import json
import sys
from fastapi_solver_service import app as fastapi_app
from mangum import Mangum

# Mangum adapter for AWS Lambda
handler = Mangum(fastapi_app, lifespan="off")
```

#### Step 2: Package Dependencies

```bash
# Create deployment package
pip install -r requirements.txt -t package/
cp aws_lambda_handler.py package/
cp fastapi_solver_service.py package/
cd package
zip -r ../solver-lambda.zip .
cd ..
```

#### Step 3: Deploy via AWS Console

1. Go to AWS Lambda Console
2. Create Function → "Author from scratch"
3. Function name: `scheduling-solver`
4. Runtime: Python 3.11
5. Architecture: x86_64
6. Upload `solver-lambda.zip`
7. Set Handler: `aws_lambda_handler.handler`
8. Memory: 3008 MB (max for complex optimizations)
9. Timeout: 15 minutes (max for Lambda)

#### Step 4: Create API Gateway

1. Go to API Gateway Console
2. Create REST API
3. Create Resource: `/solve`
4. Create Method: POST → Lambda Function: `scheduling-solver`
5. Enable CORS
6. Deploy API → Stage: `prod`
7. Note the Invoke URL: `https://xxxxx.execute-api.us-east-1.amazonaws.com/prod`

---

### Option 1B: ECS Fargate (Container-based, Better for Long Jobs)

#### Step 1: Create Dockerfile for Solver

```dockerfile
# Dockerfile.solver
FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy solver code
COPY fastapi_solver_service.py .
COPY local_solver.py .

# Expose port
EXPOSE 8000

# Run FastAPI with uvicorn
CMD ["uvicorn", "fastapi_solver_service:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### Step 2: Build and Push to ECR

```bash
# Create ECR repository
aws ecr create-repository --repository-name scheduling-solver

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <your-account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build Docker image
docker build -f Dockerfile.solver -t scheduling-solver .

# Tag and push
docker tag scheduling-solver:latest <your-account-id>.dkr.ecr.us-east-1.amazonaws.com/scheduling-solver:latest
docker push <your-account-id>.dkr.ecr.us-east-1.amazonaws.com/scheduling-solver:latest
```

#### Step 3: Create ECS Cluster and Service

```bash
# Create cluster
aws ecs create-cluster --cluster-name scheduling-cluster

# Create task definition (see aws-ecs-task-definition.json)
aws ecs register-task-definition --cli-input-json file://aws-ecs-task-definition.json

# Create service with Application Load Balancer
# (Use AWS Console ECS wizard for easier setup)
```

---

## Part 2: Deploy Frontend to AWS

### Option 2A: AWS Amplify (Easiest)

#### Step 1: Connect Git Repository

1. Go to AWS Amplify Console
2. New App → Host web app
3. Connect your GitHub/GitLab repository
4. Select branch: `master`

#### Step 2: Configure Build Settings

Amplify will auto-detect Next.js. Update build settings if needed:

```yaml
# amplify.yml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
```

#### Step 3: Environment Variables

Add in Amplify Console → App Settings → Environment Variables:
- `NEXT_PUBLIC_AWS_SOLVER_URL`: Your API Gateway or ALB URL
- `AWS_REGION`: e.g., `us-east-1`
- `AWS_S3_BUCKET`: Your S3 bucket name for results

#### Step 4: Deploy

Amplify will auto-deploy on every push to master.

---

### Option 2B: S3 + CloudFront (More Control)

#### Step 1: Build Static Export

```bash
# Update next.config.ts for static export
npm run build
```

#### Step 2: Create S3 Bucket

```bash
aws s3 mb s3://your-domain-name
aws s3 website s3://your-domain-name --index-document index.html
```

#### Step 3: Upload Build

```bash
aws s3 sync .next s3://your-domain-name
```

#### Step 4: Create CloudFront Distribution

1. Go to CloudFront Console
2. Create Distribution
3. Origin: Your S3 bucket
4. Viewer Protocol: Redirect HTTP to HTTPS
5. Alternate Domain Names: your-domain.com
6. SSL Certificate: Request via ACM (Certificate Manager)

---

## Part 3: Configure Custom Domain

### Step 1: Route 53 Hosted Zone

```bash
# Create hosted zone for your domain
aws route53 create-hosted-zone --name your-domain.com --caller-reference $(date +%s)
```

### Step 2: Update Domain Nameservers

1. Go to Route 53 Console
2. Copy the 4 nameservers from your hosted zone
3. Update your domain registrar with these nameservers

### Step 3: Create DNS Records

For Amplify:
- Amplify will auto-create SSL cert and DNS records

For CloudFront:
1. Request SSL certificate in ACM (us-east-1 region)
2. Create A record (Alias) pointing to CloudFront distribution

For Solver API:
1. Create A record (Alias) pointing to API Gateway or ALB
2. Example: `api.your-domain.com`

---

## Part 4: Update Frontend to Use AWS Solver

### Update API Endpoints

```typescript
// src/lib/config.ts
export const API_CONFIG = {
  solverUrl: process.env.NEXT_PUBLIC_AWS_SOLVER_URL || 'http://localhost:8000',
  mode: process.env.NEXT_PUBLIC_SOLVER_MODE || 'aws', // 'aws' or 'local'
};
```

### Update RunTab.tsx

The code needs to support calling AWS solver instead of just local/serverless:

```typescript
// In handleRunSolver function
const AWS_SOLVER_URL = process.env.NEXT_PUBLIC_AWS_SOLVER_URL;

if (solverMode === 'aws' && AWS_SOLVER_URL) {
  const awsResponse = await fetch(`${AWS_SOLVER_URL}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  
  if (awsResponse.ok) {
    result = await awsResponse.json();
    addLog('[SUCCESS] Using AWS cloud solver', 'success');
    actualSolver = 'aws';
  }
}
```

---

## Part 5: S3 Storage for Results

### Create S3 Bucket

```bash
aws s3 mb s3://scheduling-results-your-domain
```

### Configure CORS

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT"],
    "AllowedOrigins": ["https://your-domain.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### Update Solver to Store in S3

```python
import boto3

s3_client = boto3.client('s3')

def save_results_to_s3(results, folder_name):
    bucket = 'scheduling-results-your-domain'
    key = f'{folder_name}/results.json'
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(results),
        ContentType='application/json'
    )
```

---

## Cost Estimation

### Option 1 (Serverless - Lambda)
- Lambda: ~$0.20 per 1 million requests + compute time
- API Gateway: ~$1 per million requests
- S3: ~$0.023 per GB/month
- Amplify: ~$0.15 per build minute + $0.023/GB served
- **Estimated**: $10-50/month for low-medium usage

### Option 2 (ECS Fargate)
- ECS Fargate: ~$30-100/month (0.25 vCPU, 0.5 GB RAM, always on)
- ALB: ~$16/month + data transfer
- S3: ~$0.023 per GB/month
- CloudFront: ~$0.085 per GB transfer
- **Estimated**: $60-150/month

---

## Security Best Practices

1. **API Authentication**: Add API keys or Cognito auth
2. **HTTPS Only**: Enforce SSL/TLS
3. **IAM Roles**: Use least privilege access
4. **VPC**: Place solver in private subnet
5. **WAF**: Enable AWS WAF for DDoS protection
6. **Secrets**: Use AWS Secrets Manager for credentials

---

## Monitoring and Logging

1. **CloudWatch**: Enable logging for Lambda/ECS
2. **X-Ray**: Trace requests across services
3. **Alarms**: Set up alerts for errors/high usage

---

## Next Steps

1. Choose architecture (Serverless vs Container)
2. Set up AWS account and CLI
3. Deploy solver API
4. Deploy frontend
5. Configure domain
6. Test end-to-end
7. Monitor and optimize

---

## Support Files

See the following files created for you:
- `aws-ecs-task-definition.json` - ECS task configuration
- `Dockerfile.solver` - Solver container
- `Dockerfile.frontend` - Frontend container
- `aws-lambda-requirements.txt` - Lambda dependencies
- `src/lib/aws-solver-client.ts` - AWS solver integration

---

## Troubleshooting

### Lambda Timeout
- Increase timeout to 15 minutes (max)
- Consider switching to ECS for longer jobs

### CORS Issues
- Ensure API Gateway has CORS enabled
- Check CloudFront cache behavior

### High Costs
- Use Lambda for variable workload
- Set up CloudWatch billing alarms

---

**Need help?** Contact AWS Support or refer to AWS documentation:
- https://docs.aws.amazon.com/lambda/
- https://docs.aws.amazon.com/ecs/
- https://docs.aws.amazon.com/amplify/
