# Simple AWS Solver Deployment for Windows
# Requires: AWS CLI, Docker, AWS credentials configured

$awsPath = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$EcrRepo = "scheduling-solver"
$Region = "us-east-1"

Write-Host "Getting AWS Account ID..." -ForegroundColor Yellow
$AccountId = (& $awsPath sts get-caller-identity --query Account --output text)
Write-Host "Account: $AccountId" -ForegroundColor Green

Write-Host "`nStep 1: Create ECR repository" -ForegroundColor Yellow
& $awsPath ecr create-repository --repository-name $EcrRepo --region $Region 2>&1 | Out-Null

Write-Host "Step 2: Login to ECR" -ForegroundColor Yellow
$pwd = & $awsPath ecr get-login-password --region $Region
$pwd | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com" 2>&1 | Out-Null

Write-Host "Step 3: Build Docker image" -ForegroundColor Yellow
docker build -f Dockerfile.solver -t ${EcrRepo}:latest .

Write-Host "Step 4: Tag image" -ForegroundColor Yellow
$imageTag = "$AccountId.dkr.ecr.$Region.amazonaws.com/${EcrRepo}:latest"
docker tag "${EcrRepo}:latest" $imageTag

Write-Host "Step 5: Push to ECR" -ForegroundColor Yellow
docker push $imageTag

Write-Host "`n=== DONE ===" -ForegroundColor Green
Write-Host "Image: $imageTag" -ForegroundColor Green
