# Complete AWS ECS Deployment Script
# This creates: ECR repo, ECS cluster, task definition, and service

$awsPath = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
$Region = "us-east-1"
$AccountId = "433864970068"
$EcrRepo = "scheduling-solver"
$ClusterName = "scheduling-cluster"
$TaskFamily = "scheduling-solver-task"
$ServiceName = "scheduling-solver-service"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AWS ECS Complete Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Verify Docker image exists
Write-Host "`n[1/6] Verifying Docker image in ECR..." -ForegroundColor Yellow
$images = & $awsPath ecr describe-images --repository-name $EcrRepo --region $Region 2>&1 | ConvertFrom-Json
if ($images.imageDetails.Count -gt 0) {
    $imageSize = [math]::Round($images.imageDetails[0].imageSizeInBytes / 1MB, 1)
    Write-Host "  OK Image found: ${imageSize}MB" -ForegroundColor Green
} else {
    Write-Host "  ERROR: No image found in ECR!" -ForegroundColor Red
    exit 1
}

# Step 2: Create ECS Cluster
Write-Host "`n[2/6] Creating ECS cluster..." -ForegroundColor Yellow
$clusterCheck = & $awsPath ecs describe-clusters --clusters $ClusterName --region $Region 2>&1 | ConvertFrom-Json
if ($clusterCheck.clusters.Count -gt 0 -and $clusterCheck.clusters[0].status -eq "ACTIVE") {
    Write-Host "  OK Cluster already exists: $ClusterName" -ForegroundColor Green
} else {
    & $awsPath ecs create-cluster --cluster-name $ClusterName --region $Region | Out-Null
    Write-Host "  OK Cluster created: $ClusterName" -ForegroundColor Green
}

# Step 3: Create IAM Role for ECS Task Execution
Write-Host "`n[3/6] Creating IAM execution role..." -ForegroundColor Yellow
$RoleName = "ecsTaskExecutionRole-scheduling"
$trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
"@

try {
    & $awsPath iam get-role --role-name $RoleName 2>&1 | Out-Null
    Write-Host "  OK Role already exists: $RoleName" -ForegroundColor Green
} catch {
    $trustPolicy | Set-Content "$env:TEMP\trust-policy.json" -Encoding UTF8
    & $awsPath iam create-role --role-name $RoleName --assume-role-policy-document "file://$env:TEMP\trust-policy.json" | Out-Null
    & $awsPath iam attach-role-policy --role-name $RoleName --policy-arn "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy" | Out-Null
    Write-Host "  OK Role created: $RoleName" -ForegroundColor Green
    Start-Sleep -Seconds 10  # Wait for IAM propagation
}

# Step 4: Register Task Definition
Write-Host "`n[4/6] Registering ECS task definition..." -ForegroundColor Yellow
$taskDef = @"
{
  "family": "$TaskFamily",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::${AccountId}:role/$RoleName",
  "containerDefinitions": [
    {
      "name": "scheduling-solver",
      "image": "${AccountId}.dkr.ecr.${Region}.amazonaws.com/${EcrRepo}:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8000,
          "protocol": "tcp"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/scheduling-solver",
          "awslogs-region": "$Region",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      },
      "environment": [
        {
          "name": "PORT",
          "value": "8000"
        }
      ]
    }
  ]
}
"@

$taskDef | Set-Content "$env:TEMP\task-definition.json" -Encoding UTF8
& $awsPath ecs register-task-definition --cli-input-json "file://$env:TEMP\task-definition.json" --region $Region | Out-Null
Write-Host "  OK Task definition registered: $TaskFamily" -ForegroundColor Green

# Step 5: Get Default VPC and Subnets
Write-Host "`n[5/6] Getting VPC and subnet information..." -ForegroundColor Yellow
$vpcs = & $awsPath ec2 describe-vpcs --filters "Name=isDefault,Values=true" --region $Region | ConvertFrom-Json
if ($vpcs.Vpcs.Count -eq 0) {
    Write-Host "  ERROR: No default VPC found!" -ForegroundColor Red
    Write-Host "  You need to create a VPC first or specify one manually." -ForegroundColor Yellow
    exit 1
}
$vpcId = $vpcs.Vpcs[0].VpcId
Write-Host "  OK VPC: $vpcId" -ForegroundColor Green

$subnets = & $awsPath ec2 describe-subnets --filters "Name=vpc-id,Values=$vpcId" --region $Region | ConvertFrom-Json
if ($subnets.Subnets.Count -eq 0) {
    Write-Host "  ERROR: No subnets found in VPC!" -ForegroundColor Red
    exit 1
}
$subnetIds = ($subnets.Subnets | Select-Object -First 2 | ForEach-Object { $_.SubnetId }) -join ','
Write-Host "  OK Subnets: $subnetIds" -ForegroundColor Green

# Get/Create Security Group
$sgName = "scheduling-solver-sg"
$sgs = & $awsPath ec2 describe-security-groups --filters "Name=group-name,Values=$sgName" "Name=vpc-id,Values=$vpcId" --region $Region 2>&1 | ConvertFrom-Json
if ($sgs.SecurityGroups.Count -gt 0) {
    $sgId = $sgs.SecurityGroups[0].GroupId
    Write-Host "  OK Security Group exists: $sgId" -ForegroundColor Green
} else {
    $sgResult = & $awsPath ec2 create-security-group --group-name $sgName --description "Security group for scheduling solver" --vpc-id $vpcId --region $Region | ConvertFrom-Json
    $sgId = $sgResult.GroupId
    
    # Allow inbound port 8000
    & $awsPath ec2 authorize-security-group-ingress --group-id $sgId --protocol tcp --port 8000 --cidr 0.0.0.0/0 --region $Region | Out-Null
    # Allow all outbound (default)
    Write-Host "  OK Security Group created: $sgId" -ForegroundColor Green
}

# Step 6: Create ECS Service
Write-Host "`n[6/6] Creating ECS service..." -ForegroundColor Yellow
$serviceCheck = & $awsPath ecs describe-services --cluster $ClusterName --services $ServiceName --region $Region 2>&1 | ConvertFrom-Json
if ($serviceCheck.services.Count -gt 0 -and $serviceCheck.services[0].status -eq "ACTIVE") {
    Write-Host "  Service already exists, updating..." -ForegroundColor Yellow
    & $awsPath ecs update-service `
        --cluster $ClusterName `
        --service $ServiceName `
        --task-definition $TaskFamily `
        --force-new-deployment `
        --region $Region | Out-Null
    Write-Host "  OK Service updated and redeploying" -ForegroundColor Green
} else {
    & $awsPath ecs create-service `
        --cluster $ClusterName `
        --service-name $ServiceName `
        --task-definition $TaskFamily `
        --desired-count 1 `
        --launch-type FARGATE `
        --network-configuration "awsvpcConfiguration={subnets=[$subnetIds],securityGroups=[$sgId],assignPublicIp=ENABLED}" `
        --region $Region | Out-Null
    Write-Host "  OK Service created: $ServiceName" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

Write-Host "`nDeployment Summary:" -ForegroundColor Cyan
Write-Host "  Region:          $Region" -ForegroundColor White
Write-Host "  Cluster:         $ClusterName" -ForegroundColor White
Write-Host "  Service:         $ServiceName" -ForegroundColor White
Write-Host "  Task Definition: $TaskFamily" -ForegroundColor White
Write-Host "  Security Group:  $sgId" -ForegroundColor White

Write-Host "`nWaiting for task to start (this may take 1-2 minutes)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30

# Get task information
$tasks = & $awsPath ecs list-tasks --cluster $ClusterName --service-name $ServiceName --region $Region | ConvertFrom-Json
if ($tasks.taskArns.Count -gt 0) {
    $taskArn = $tasks.taskArns[0]
    $taskDetails = & $awsPath ecs describe-tasks --cluster $ClusterName --tasks $taskArn --region $Region | ConvertFrom-Json
    $eni = $taskDetails.tasks[0].attachments[0].details | Where-Object { $_.name -eq "networkInterfaceId" } | Select-Object -ExpandProperty value
    
    if ($eni) {
        $eniDetails = & $awsPath ec2 describe-network-interfaces --network-interface-ids $eni --region $Region | ConvertFrom-Json
        $publicIp = $eniDetails.NetworkInterfaces[0].Association.PublicIp
        
        if ($publicIp) {
            Write-Host "`nSolver API URL:" -ForegroundColor Green
            Write-Host "  http://${publicIp}:8000" -ForegroundColor Cyan
            Write-Host "`nTest the health endpoint:" -ForegroundColor Yellow
            Write-Host "  curl http://${publicIp}:8000/health" -ForegroundColor White
            Write-Host "`nUpdate your frontend .env file:" -ForegroundColor Yellow
            Write-Host "  NEXT_PUBLIC_AWS_SOLVER_URL=http://${publicIp}:8000" -ForegroundColor White
        }
    }
}

Write-Host "`nNext Steps:" -ForegroundColor Cyan
Write-Host "  1. Wait 1-2 minutes for the task to fully start" -ForegroundColor White
Write-Host "  2. Test the health endpoint above" -ForegroundColor White
Write-Host "  3. Update your frontend environment variables" -ForegroundColor White
Write-Host "  4. (Optional) Set up Application Load Balancer for production" -ForegroundColor White
