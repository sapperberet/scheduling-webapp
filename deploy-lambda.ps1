# AWS Lambda Deployment Script for Scheduling Solver
# UPDATED VERSION - Deploys async solver with progress tracking

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     AWS Lambda Deployment - Async Solver               ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$ErrorActionPreference = "Continue"

# Configuration  
$REGION = "us-east-1"
$FUNCTION_NAME = "scheduling-solver"
$S3_BUCKET = "scheduling-solver-results"

Write-Host "`n[1/7] Getting AWS Account ID..." -ForegroundColor Yellow
$ACCOUNT_ID = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' sts get-caller-identity --query Account --output text
Write-Host "Account ID: $ACCOUNT_ID" -ForegroundColor Green

# ECR Repository already exists from ECS deployment
$ECR_REPO = "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/scheduling-solver"
Write-Host "Using existing ECR image: ${ECR_REPO}:latest" -ForegroundColor Green

Write-Host "`n[2/7] Creating IAM role for Lambda..." -ForegroundColor Yellow
# Create trust policy for Lambda
$lambdaTrustPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Service = "lambda.amazonaws.com"
            }
            Action = "sts:AssumeRole"
        }
    )
} | ConvertTo-Json -Depth 10

$lambdaTrustPolicy | Out-File -FilePath "lambda-trust-policy.json" -Encoding utf8

& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' iam create-role `
    --role-name $ROLE_NAME `
    --assume-role-policy-document file://lambda-trust-policy.json `
    --description "Execution role for scheduling solver Lambda function" 2>$null

if ($LASTEXITCODE -eq 0) {
    Write-Host "Created IAM role: $ROLE_NAME" -ForegroundColor Green
} else {
    Write-Host "Role already exists, continuing..." -ForegroundColor Yellow
}

Write-Host "`n[3/7] Attaching policies to Lambda role..." -ForegroundColor Yellow
# Attach necessary policies (ignore errors if already attached)
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' iam attach-role-policy `
    --role-name $ROLE_NAME `
    --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>$null

& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' iam attach-role-policy `
    --role-name $ROLE_NAME `
    --policy-arn "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly" 2>$null

Write-Host "Attached CloudWatch Logs and ECR policies" -ForegroundColor Green

# Wait for IAM role to propagate
Write-Host "`nWaiting 15 seconds for IAM role propagation..." -ForegroundColor Yellow
Start-Sleep -Seconds 15

$ROLE_ARN = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' iam get-role `
    --role-name $ROLE_NAME `
    --query Role.Arn `
    --output text

Write-Host "Role ARN: $ROLE_ARN" -ForegroundColor Green

Write-Host "`n[4/7] Creating Lambda function..." -ForegroundColor Yellow
try {
    $createResult = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' lambda create-function `
        --function-name $FUNCTION_NAME `
        --package-type Image `
        --code "ImageUri=${ECR_REPO}:latest" `
        --role $ROLE_ARN `
        --timeout 300 `
        --memory-size 2048 `
        --architectures x86_64 `
        --region $REGION `
        2>&1
    
    Write-Host "Lambda function created successfully!" -ForegroundColor Green
} catch {
    Write-Host "Function may already exist, updating instead..." -ForegroundColor Yellow
    & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' lambda update-function-code `
        --function-name $FUNCTION_NAME `
        --image-uri "${ECR_REPO}:latest" `
        --region $REGION `
        2>&1 | Out-Null
    
    & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' lambda update-function-configuration `
        --function-name $FUNCTION_NAME `
        --timeout 300 `
        --memory-size 2048 `
        --region $REGION `
        2>&1 | Out-Null
    
    Write-Host "Lambda function updated!" -ForegroundColor Green
}

Write-Host "`n[5/7] Creating API Gateway..." -ForegroundColor Yellow
# Check if API already exists
$existingApi = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' apigatewayv2 get-apis `
    --query "Items[?Name=='${API_NAME}'].ApiId" `
    --output text `
    --region $REGION

if ($existingApi) {
    $API_ID = $existingApi
    Write-Host "Using existing API: $API_ID" -ForegroundColor Yellow
} else {
    $apiResult = & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' apigatewayv2 create-api `
        --name $API_NAME `
        --protocol-type HTTP `
        --target "arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${FUNCTION_NAME}" `
        --region $REGION `
        | ConvertFrom-Json
    
    $API_ID = $apiResult.ApiId
    Write-Host "Created API Gateway: $API_ID" -ForegroundColor Green
}

Write-Host "`n[6/7] Granting API Gateway permission to invoke Lambda..." -ForegroundColor Yellow
try {
    & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' lambda add-permission `
        --function-name $FUNCTION_NAME `
        --statement-id apigateway-invoke `
        --action lambda:InvokeFunction `
        --principal apigateway.amazonaws.com `
        --source-arn "arn:aws:execute-api:${REGION}:${ACCOUNT_ID}:${API_ID}/*" `
        --region $REGION `
        2>&1 | Out-Null
    Write-Host "Permission granted" -ForegroundColor Green
} catch {
    Write-Host "Permission already exists (this is fine)" -ForegroundColor Yellow
}

Write-Host "`n[7/7] Getting API Gateway endpoint..." -ForegroundColor Yellow
$API_ENDPOINT = "https://${API_ID}.execute-api.${REGION}.amazonaws.com"

Write-Host "`n================================" -ForegroundColor Green
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "`nYour Lambda Solver URL:" -ForegroundColor Cyan
Write-Host $API_ENDPOINT -ForegroundColor White
Write-Host "`nUpdate your .env.local with:" -ForegroundColor Cyan
Write-Host "NEXT_PUBLIC_AWS_SOLVER_URL=$API_ENDPOINT" -ForegroundColor White
Write-Host "`nCost Estimate:" -ForegroundColor Cyan
Write-Host "  - ~`$0.15/month for 10 runs/day @ 30 seconds each" -ForegroundColor Yellow
Write-Host "  - First 1 million requests are free" -ForegroundColor Yellow
Write-Host "  - First 400,000 GB-seconds compute are free" -ForegroundColor Yellow
Write-Host "`nTest your endpoint:" -ForegroundColor Cyan
Write-Host "  Invoke-WebRequest ${API_ENDPOINT}/health" -ForegroundColor White

Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "OPTIONAL: Clean up old ECS resources" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host "To stop paying for ECS (~`$30/month), run:" -ForegroundColor Yellow
Write-Host "  & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' ecs update-service --cluster scheduling-cluster --service scheduling-solver-service --desired-count 0" -ForegroundColor White
Write-Host "  & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' ecs delete-service --cluster scheduling-cluster --service scheduling-solver-service --force" -ForegroundColor White
Write-Host "  & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' ecs delete-cluster --cluster scheduling-cluster" -ForegroundColor White
