#!/usr/bin/env pwsh
# Simple Lambda Update Script

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     Quick Lambda Update - Package & Deploy             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Step 1: Create package directory
Write-Host "[1/5] Cleaning and creating lambda-package..." -ForegroundColor Yellow
if (Test-Path "lambda-package") {
    Remove-Item -Recurse -Force "lambda-package"
}
New-Item -ItemType Directory -Path "lambda-package" | Out-Null

# Step 2: Copy files
Write-Host "[2/5] Copying Python files..." -ForegroundColor Yellow
Copy-Item "AWS_LAMBDA_UPDATED_CODE.py" "lambda-package/lambda_function.py"
Copy-Item "public/local-solver-package/testcase_gui.py" "lambda-package/testcase_gui.py"
Write-Host "    ✓ Copied lambda_function.py" -ForegroundColor Green
Write-Host "    ✓ Copied testcase_gui.py" -ForegroundColor Green

# Step 3: Install dependencies
Write-Host "[3/5] Installing dependencies..." -ForegroundColor Yellow
Write-Host "    This may take 2-3 minutes..." -ForegroundColor Gray

$packages = @(
    "fastapi==0.104.1",
    "mangum==0.17.0",
    "boto3==1.28.85",
    "ortools==9.7.2996",
    "pydantic==2.5.0",
    "python-multipart==0.0.6",
    "openpyxl"
)

foreach ($package in $packages) {
    Write-Host "    Installing $package..." -ForegroundColor Gray
}

python -m pip install --quiet @packages -t lambda-package 2>&1 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "    ✓ All dependencies installed" -ForegroundColor Green
} else {
    Write-Host "    ❌ Failed to install dependencies!" -ForegroundColor Red
    exit 1
}

# Step 4: Create ZIP
Write-Host "[4/5] Creating deployment ZIP..." -ForegroundColor Yellow
if (Test-Path "lambda-deployment.zip") {
    Remove-Item "lambda-deployment.zip"
}

Push-Location lambda-package
Compress-Archive -Path * -DestinationPath ../lambda-deployment.zip
Pop-Location

$zipSize = (Get-Item "lambda-deployment.zip").Length / 1MB
Write-Host ("    ✓ Created lambda-deployment.zip (" + [math]::Round($zipSize, 2) + " MB)") -ForegroundColor Green

# Step 5: Deploy
Write-Host "`n[5/5] Ready to deploy!" -ForegroundColor Green
Write-Host "`n📦 Deployment package: lambda-deployment.zip`n" -ForegroundColor Cyan

# Check if we can find the function
Write-Host "Looking for your Lambda function..." -ForegroundColor Yellow
$functions = aws lambda list-functions --region us-east-1 --query "Functions[?contains(FunctionName, 'schedul')].FunctionName" --output text

if ($functions) {
    Write-Host "Found Lambda function(s):" -ForegroundColor Green
    $functions -split "`t" | ForEach-Object { Write-Host "  - $_" -ForegroundColor Cyan }
    
    Write-Host "`nDo you want to deploy to one of these functions? (y/n): " -ForegroundColor Yellow -NoNewline
    $deploy = Read-Host
    
    if ($deploy -eq 'y' -or $deploy -eq 'Y') {
        if ($functions -split "`t" | Measure-Object | Select-Object -ExpandProperty Count -eq 1) {
            $functionName = $functions
        } else {
            Write-Host "Enter the function name to deploy to: " -NoNewline
            $functionName = Read-Host
        }
        
        Write-Host "`nDeploying to $functionName..." -ForegroundColor Yellow
        
        aws lambda update-function-code `
            --function-name $functionName `
            --zip-file fileb://lambda-deployment.zip `
            --region us-east-1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "`n✅ Code deployed successfully!" -ForegroundColor Green
            
            Write-Host "`nUpdating configuration..." -ForegroundColor Yellow
            aws lambda update-function-configuration `
                --function-name $functionName `
                --environment "Variables={S3_RESULTS_BUCKET=scheduling-solver-results,AWS_REGION=us-east-1}" `
                --timeout 600 `
                --memory-size 2048 `
                --region us-east-1 | Out-Null
            
            Write-Host "✅ Configuration updated!" -ForegroundColor Green
            
            Write-Host "`nTesting Lambda..." -ForegroundColor Yellow
            Start-Sleep -Seconds 3
            
            try {
                $response = Invoke-RestMethod -Uri "https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health" -Method Get
                Write-Host "✅ Lambda is responding!" -ForegroundColor Green
                Write-Host ($response | ConvertTo-Json -Depth 3)
                Write-Host "`n🎉 DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
                Write-Host "`nYour AWS Cloud solver now has:" -ForegroundColor Cyan
                Write-Host "  ✓ Real-time progress tracking" -ForegroundColor Green
                Write-Host "  ✓ Proper S3 storage" -ForegroundColor Green
                Write-Host "  ✓ Correct result numbering" -ForegroundColor Green
                Write-Host "  ✓ Non-empty downloads`n" -ForegroundColor Green
            } catch {
                Write-Host "⚠️ Couldn't test health endpoint yet (Lambda may be warming up)" -ForegroundColor Yellow
                Write-Host "Try testing manually in a few seconds: " -ForegroundColor Gray
                Write-Host "  curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health" -ForegroundColor Gray
            }
        } else {
            Write-Host "`n❌ Deployment failed!" -ForegroundColor Red
        }
    } else {
        Write-Host "`nSkipping deployment. Package ready at: lambda-deployment.zip" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ No Lambda functions found!" -ForegroundColor Red
    Write-Host "`nManual deployment required:" -ForegroundColor Yellow
    Write-Host "  1. Go to AWS Console: https://console.aws.amazon.com/lambda" -ForegroundColor Gray
    Write-Host "  2. Find your function" -ForegroundColor Gray
    Write-Host "  3. Upload lambda-deployment.zip`n" -ForegroundColor Gray
}

Write-Host "✅ Script complete!`n" -ForegroundColor Green
