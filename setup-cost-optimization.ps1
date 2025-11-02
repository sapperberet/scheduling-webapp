# Cost Optimization Setup Guide
# ==============================

# This guide walks you through setting up on-demand ECS tasks
# to eliminate 24/7 polling costs (~95% savings!)

# STEP 1: Get VPC Configuration
# ------------------------------
Write-Host "`n=== STEP 1: Getting VPC Configuration ===" -ForegroundColor Cyan

# Get default VPC subnets
Write-Host "`nFetching default VPC subnets..." -ForegroundColor Yellow
$subnets = aws ec2 describe-subnets --filters "Name=default-for-az,Values=true" --query "Subnets[*].SubnetId" --output text
Write-Host "Subnets: $subnets" -ForegroundColor Green

# Get default security group
Write-Host "`nFetching default security group..." -ForegroundColor Yellow
$securityGroup = aws ec2 describe-security-groups --filters "Name=group-name,Values=default" --query "SecurityGroups[0].GroupId" --output text
Write-Host "Security Group: $securityGroup" -ForegroundColor Green

# STEP 2: Create SQS Trigger Lambda
# ----------------------------------
Write-Host "`n=== STEP 2: Creating SQS Trigger Lambda ===" -ForegroundColor Cyan

# Check if Lambda already exists
Write-Host "`nChecking if Lambda function exists..." -ForegroundColor Yellow
$functionExists = $false
try {
    aws lambda get-function --function-name scheduling-solver-sqs-trigger --region us-east-1 2>$null
    $functionExists = $true
    Write-Host "Lambda function already exists - will update" -ForegroundColor Yellow
} catch {
    Write-Host "Lambda function doesn't exist - will create" -ForegroundColor Yellow
}

if (-not $functionExists) {
    Write-Host "`nCreating IAM role for Lambda..." -ForegroundColor Yellow
    
    # Create trust policy
    $trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
"@
    
    $trustPolicy | Out-File -FilePath trust-policy.json -Encoding utf8
    
    # Create role
    aws iam create-role --role-name lambda-sqs-ecs-trigger-role --assume-role-policy-document file://trust-policy.json
    
    # Attach policies
    Write-Host "Attaching IAM policies..." -ForegroundColor Yellow
    aws iam attach-role-policy --role-name lambda-sqs-ecs-trigger-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    aws iam attach-role-policy --role-name lambda-sqs-ecs-trigger-role --policy-arn arn:aws:iam::aws:policy/AmazonECS_FullAccess
    aws iam attach-role-policy --role-name lambda-sqs-ecs-trigger-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
    aws iam attach-role-policy --role-name lambda-sqs-ecs-trigger-role --policy-arn arn:aws:iam::aws:policy/AmazonSQSFullAccess
    
    Write-Host "Waiting 10 seconds for IAM role to propagate..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    # Create deployment package
    Write-Host "`nCreating deployment package..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path package | Out-Null
    pip install --target ./package boto3 --quiet
    Copy-Item sqs_ecs_trigger.py package/
    
    # Create zip (PowerShell compatible)
    Compress-Archive -Path package/* -DestinationPath sqs_trigger_lambda.zip -Force
    
    # Create Lambda
    Write-Host "Creating Lambda function..." -ForegroundColor Yellow
    aws lambda create-function `
        --function-name scheduling-solver-sqs-trigger `
        --runtime python3.11 `
        --role arn:aws:iam::433864970068:role/lambda-sqs-ecs-trigger-role `
        --handler sqs_ecs_trigger.lambda_handler `
        --zip-file fileb://sqs_trigger_lambda.zip `
        --timeout 60 `
        --memory-size 256 `
        --region us-east-1
}

# STEP 3: Update Lambda Environment Variables
# --------------------------------------------
Write-Host "`n=== STEP 3: Configuring Lambda Environment ===" -ForegroundColor Cyan

$envVars = @"
{
  "Variables": {
    "ECS_CLUSTER": "scheduling-solver-cluster",
    "ECS_TASK_DEFINITION": "solver-worker",
    "S3_RESULTS_BUCKET": "scheduling-solver-results",
    "AWS_REGION": "us-east-1",
    "ECS_SUBNETS": "$($subnets -replace ' ', ',')",
    "ECS_SECURITY_GROUPS": "$securityGroup"
  }
}
"@

$envVars | Out-File -FilePath env-vars.json -Encoding utf8

Write-Host "Setting environment variables..." -ForegroundColor Yellow
aws lambda update-function-configuration `
    --function-name scheduling-solver-sqs-trigger `
    --environment file://env-vars.json `
    --region us-east-1

# STEP 4: Create SQS Event Source Mapping
# ----------------------------------------
Write-Host "`n=== STEP 4: Creating SQS Trigger ===" -ForegroundColor Cyan

Write-Host "Checking existing event source mappings..." -ForegroundColor Yellow
$existingMappings = aws lambda list-event-source-mappings --function-name scheduling-solver-sqs-trigger --region us-east-1 | ConvertFrom-Json

if ($existingMappings.EventSourceMappings.Count -eq 0) {
    Write-Host "Creating SQS event source mapping..." -ForegroundColor Yellow
    aws lambda create-event-source-mapping `
        --function-name scheduling-solver-sqs-trigger `
        --event-source-arn arn:aws:sqs:us-east-1:433864970068:scheduling-solver-jobs `
        --batch-size 1 `
        --region us-east-1
} else {
    Write-Host "SQS trigger already exists" -ForegroundColor Green
}

# STEP 5: Scale Down Old ECS Service
# -----------------------------------
Write-Host "`n=== STEP 5: Stopping 24/7 Polling Service ===" -ForegroundColor Cyan

Write-Host "Scaling ECS service to 0 tasks..." -ForegroundColor Yellow
aws ecs update-service `
    --cluster scheduling-solver-cluster `
    --service solver-worker `
    --desired-count 0 `
    --region us-east-1

Write-Host "Waiting for service to scale down..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Verify
$service = aws ecs describe-services --cluster scheduling-solver-cluster --services solver-worker --region us-east-1 | ConvertFrom-Json
$runningCount = $service.services[0].runningCount
$desiredCount = $service.services[0].desiredCount

Write-Host "`nECS Service Status:" -ForegroundColor Cyan
Write-Host "  Desired Tasks: $desiredCount" -ForegroundColor Green
Write-Host "  Running Tasks: $runningCount" -ForegroundColor Green

# STEP 6: Cleanup
# ---------------
Write-Host "`n=== STEP 6: Cleanup ===" -ForegroundColor Cyan
Remove-Item trust-policy.json -ErrorAction SilentlyContinue
Remove-Item env-vars.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force package -ErrorAction SilentlyContinue
Remove-Item sqs_trigger_lambda.zip -ErrorAction SilentlyContinue

# Summary
Write-Host "`n============================================" -ForegroundColor Green
Write-Host "✅ COST OPTIMIZATION COMPLETE!" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green

Write-Host "`n📊 What Changed:" -ForegroundColor Cyan
Write-Host "  Before: ECS service running 24/7 (polling SQS every 20s)" -ForegroundColor Yellow
Write-Host "  After:  ECS tasks start on-demand when jobs arrive" -ForegroundColor Green
Write-Host "`n💰 Cost Savings:" -ForegroundColor Cyan
Write-Host "  ~95% reduction in ECS costs" -ForegroundColor Green
Write-Host "  Only pay when solver is actually running!" -ForegroundColor Green

Write-Host "`n🧪 Test It:" -ForegroundColor Cyan
Write-Host "  1. Submit a solver job from your web app"
Write-Host "  2. Watch Lambda logs:"
Write-Host "     aws logs tail /aws/lambda/scheduling-solver-sqs-trigger --follow"
Write-Host "  3. Watch ECS task start:"
Write-Host "     aws ecs list-tasks --cluster scheduling-solver-cluster"
Write-Host "  4. Task should complete and stop automatically"

Write-Host "`n📝 Rollback (if needed):" -ForegroundColor Cyan
Write-Host "  aws ecs update-service --cluster scheduling-solver-cluster --service solver-worker --desired-count 1"

Write-Host "`n"
