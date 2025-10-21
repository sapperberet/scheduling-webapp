# AWS Solver Deployment Script for Windows
# Prerequisites: AWS CLI, Docker, AWS credentials configured

param(
    [string]$AwsRegion = "us-east-1",
    [string]$EcrRepoName = "scheduling-solver"
)

$awsPath = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
if (-Not (Test-Path $awsPath)) {
    Write-Host "Error: AWS CLI not found at $awsPath" -ForegroundColor Red
    exit 1
}

Write-Host "Getting AWS Account ID..." -ForegroundColor Yellow
$AccountId = (& $awsPath sts get-caller-identity --query Account --output text)
Write-Host "Account ID: $AccountId" -ForegroundColor Green

Write-Host "
Step 1: Creating ECR repository..." -ForegroundColor Yellow
try {
    & $awsPath ecr create-repository --repository-name $EcrRepoName --region $AwsRegion 2>&1 | Out-Null
    Write-Host "ECR repo created: $EcrRepoName" -ForegroundColor Green
} catch {
    Write-Host "ECR repo may already exist" -ForegroundColor Yellow
}

Write-Host "
Step 2: Logging into ECR..." -ForegroundColor Yellow
$password = & $awsPath ecr get-login-password --region $AwsRegion
$password | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$AwsRegion.amazonaws.com" 2>&1 | Out-Null
Write-Host "Logged in to ECR" -ForegroundColor Green

Write-Host "
Step 3: Building Docker image..." -ForegroundColor Yellow
docker build -f Dockerfile.solver -t $EcrRepoName:latest .
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "
Step 4: Tagging image..." -ForegroundColor Yellow
docker tag $EcrRepoName:latest $AccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepoName:latest

Write-Host "
Step 5: Pushing to ECR..." -ForegroundColor Yellow
docker push $AccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepoName:latest
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "
=== DEPLOYMENT COMPLETE ===" -ForegroundColor Green
Write-Host "ECR Image: $AccountId.dkr.ecr.$AwsRegion.amazonaws.com/$EcrRepoName:latest" -ForegroundColor Green
