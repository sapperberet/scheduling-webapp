# Deploy ECS Fargate Worker - NO TIME LIMIT
# This replaces the Lambda worker which has a 15-minute limit

$ErrorActionPreference = "Stop"

# Configuration
$AWS_REGION = "us-east-1"
$ECR_REPO = "scheduling-solver-ecs-worker"
$ECS_CLUSTER = "scheduling-solver-cluster"
$ECS_SERVICE = "solver-worker"
$ECS_TASK = "solver-worker-task"
$S3_BUCKET = "scheduling-solver-results"
$SQS_QUEUE_NAME = "scheduling-solver-jobs"

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "DEPLOYING ECS FARGATE WORKER (NO TIME LIMIT)" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan

# Step 1: Create ECR repository if it doesn't exist
Write-Host "`n[1/8] Creating ECR repository..." -ForegroundColor Yellow
try {
    aws ecr describe-repositories --repository-names $ECR_REPO --region $AWS_REGION 2>$null
    Write-Host "ECR repository exists" -ForegroundColor Green
} catch {
    Write-Host "Creating new ECR repository..." -ForegroundColor Yellow
    aws ecr create-repository `
        --repository-name $ECR_REPO `
        --region $AWS_REGION `
        --image-scanning-configuration scanOnPush=true
}

# Get ECR repository URI
$ECR_URI = (aws ecr describe-repositories --repository-names $ECR_REPO --region $AWS_REGION --query "repositories[0].repositoryUri" --output text)
Write-Host "ECR URI: $ECR_URI" -ForegroundColor Green

# Step 2: Build Docker image
Write-Host "`n[2/8] Building Docker image..." -ForegroundColor Yellow
docker build -f Dockerfile.ecs-worker -t ${ECR_REPO}:latest .
if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }

# Step 3: Login to ECR
Write-Host "`n[3/8] Logging into ECR..." -ForegroundColor Yellow
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI
if ($LASTEXITCODE -ne 0) { throw "ECR login failed" }

# Step 4: Tag and push image
Write-Host "`n[4/8] Pushing Docker image to ECR..." -ForegroundColor Yellow
docker tag ${ECR_REPO}:latest ${ECR_URI}:latest
docker push ${ECR_URI}:latest
if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }

# Step 5: Get SQS Queue URL
Write-Host "`n[5/8] Getting SQS queue URL..." -ForegroundColor Yellow
$SQS_QUEUE_URL = (aws sqs get-queue-url --queue-name $SQS_QUEUE_NAME --region $AWS_REGION --query "QueueUrl" --output text)
Write-Host "Queue URL: $SQS_QUEUE_URL" -ForegroundColor Green

# Step 6: Create ECS cluster if it doesn't exist
Write-Host "`n[6/8] Creating ECS cluster..." -ForegroundColor Yellow
try {
    aws ecs describe-clusters --clusters $ECS_CLUSTER --region $AWS_REGION --query "clusters[0].status" --output text 2>$null
    Write-Host "ECS cluster exists" -ForegroundColor Green
} catch {
    Write-Host "Creating new ECS cluster..." -ForegroundColor Yellow
    aws ecs create-cluster --cluster-name $ECS_CLUSTER --region $AWS_REGION
}

# Step 7: Create/update task definition
Write-Host "`n[7/8] Registering ECS task definition..." -ForegroundColor Yellow

$TaskDefinition = @{
    family = $ECS_TASK
    networkMode = "awsvpc"
    requiresCompatibilities = @("FARGATE")
    cpu = "2048"  # 2 vCPU
    memory = "8192"  # 8 GB RAM
    executionRoleArn = "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskExecutionRole"
    taskRoleArn = "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/ecsTaskRole"
    containerDefinitions = @(
        @{
            name = "solver-worker"
            image = "${ECR_URI}:latest"
            essential = $true
            environment = @(
                @{ name = "S3_RESULTS_BUCKET"; value = $S3_BUCKET },
                @{ name = "AWS_REGION"; value = $AWS_REGION },
                @{ name = "SQS_QUEUE_URL"; value = $SQS_QUEUE_URL }
            )
            logConfiguration = @{
                logDriver = "awslogs"
                options = @{
                    "awslogs-group" = "/ecs/solver-worker"
                    "awslogs-region" = $AWS_REGION
                    "awslogs-stream-prefix" = "ecs"
                    "awslogs-create-group" = "true"
                }
            }
        }
    )
} | ConvertTo-Json -Depth 10

$TaskDefinition | Out-File -FilePath "task-definition.json" -Encoding utf8
aws ecs register-task-definition --cli-input-json file://task-definition.json --region $AWS_REGION

# Step 8: Create or update ECS service
Write-Host "`n[8/8] Creating/updating ECS service..." -ForegroundColor Yellow

# Get default VPC and subnets
$VPC_ID = (aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --region $AWS_REGION --query "Vpcs[0].VpcId" --output text)
$SUBNETS = (aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --region $AWS_REGION --query "Subnets[*].SubnetId" --output text) -split '\s+'
$SECURITY_GROUP = (aws ec2 describe-security-groups --filters "Name=vpc-id,Values=$VPC_ID" "Name=group-name,Values=default" --region $AWS_REGION --query "SecurityGroups[0].GroupId" --output text)

try {
    # Try to update existing service
    aws ecs update-service `
        --cluster $ECS_CLUSTER `
        --service $ECS_SERVICE `
        --task-definition $ECS_TASK `
        --region $AWS_REGION `
        --force-new-deployment
    Write-Host "ECS service updated" -ForegroundColor Green
} catch {
    # Create new service
    Write-Host "Creating new ECS service..." -ForegroundColor Yellow
    aws ecs create-service `
        --cluster $ECS_CLUSTER `
        --service-name $ECS_SERVICE `
        --task-definition $ECS_TASK `
        --desired-count 1 `
        --launch-type FARGATE `
        --network-configuration "awsvpcConfiguration={subnets=[$($SUBNETS -join ',')],securityGroups=[$SECURITY_GROUP],assignPublicIp=ENABLED}" `
        --region $AWS_REGION
}

Write-Host "`n" + ("=" * 80) -ForegroundColor Cyan
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "`nECS Fargate worker is now running and can process jobs for HOURS!" -ForegroundColor Green
Write-Host "The Lambda worker has been replaced with an unlimited-time ECS service." -ForegroundColor Green
Write-Host "`nTo monitor:" -ForegroundColor Yellow
Write-Host "  aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION" -ForegroundColor White
Write-Host "  aws logs tail /ecs/solver-worker --region $AWS_REGION --follow" -ForegroundColor White
