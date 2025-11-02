#!/usr/bin/env pwsh
# Quick script to commit and push testcase_gui.py changes for GitHub Actions deployment

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   Deploy testcase_gui.py Changes via GitHub Actions    ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Change to repo directory
Set-Location $PSScriptRoot

Write-Host "[1/5] Checking git status..." -ForegroundColor Yellow
git status --short

Write-Host "`n[2/5] Files to be committed:" -ForegroundColor Yellow
Write-Host "  ✓ testcase_gui.py (fixed model.minimize)" -ForegroundColor Green
Write-Host "  ✓ Dockerfile.api (cache invalidation)" -ForegroundColor Green
Write-Host "  ✓ Dockerfile.worker (cache invalidation)" -ForegroundColor Green
Write-Host "  ✓ GITHUB_ACTIONS_DEPLOY.md (deployment guide)" -ForegroundColor Green

Write-Host "`n[3/5] Adding files to git..." -ForegroundColor Yellow
git add testcase_gui.py
git add public/local-solver-package/testcase_gui.py
git add Dockerfile.api
git add Dockerfile.worker
git add GITHUB_ACTIONS_DEPLOY.md
git add lambda-package/testcase_gui.py
git add lambda-package/solver_core_real.py
git add lambda-package/lambda_handler.py

Write-Host "  ✓ Files staged for commit" -ForegroundColor Green

Write-Host "`n[4/5] Creating commit..." -ForegroundColor Yellow
$commitMessage = "Fix: Update testcase_gui.py - model.minimize() API compliance

- Fixed model.Minimize() → model.minimize() (OR-Tools API)
- Updated Dockerfiles with cache invalidation
- Synced changes to lambda-package for cloud deployment
- Ready for GitHub Actions deployment to AWS Lambda"

git commit -m $commitMessage

if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Commit created successfully" -ForegroundColor Green
} else {
    Write-Host "  ⚠ No changes to commit or commit failed" -ForegroundColor Yellow
    Write-Host "`nYou may need to manually commit if files haven't changed." -ForegroundColor Gray
}

Write-Host "`n[5/5] Ready to push!" -ForegroundColor Green
Write-Host "`nDo you want to push to GitHub and trigger deployment? (y/n): " -ForegroundColor Yellow -NoNewline
$confirm = Read-Host

if ($confirm -eq 'y' -or $confirm -eq 'Y') {
    Write-Host "`nPushing to GitHub..." -ForegroundColor Yellow
    git push origin master
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✅ Successfully pushed to GitHub!" -ForegroundColor Green
        Write-Host "`n🚀 GitHub Actions will now:" -ForegroundColor Cyan
        Write-Host "   1. Build Docker images with your updated testcase_gui.py" -ForegroundColor White
        Write-Host "   2. Push images to Amazon ECR" -ForegroundColor White
        Write-Host "   3. Update Lambda functions:" -ForegroundColor White
        Write-Host "      • scheduling-solver (API handler)" -ForegroundColor Gray
        Write-Host "      • scheduling-solver-worker (Worker handler)" -ForegroundColor Gray
        
        Write-Host "`n📊 Monitor deployment at:" -ForegroundColor Cyan
        Write-Host "   https://github.com/sapperberet/scheduling-webapp/actions" -ForegroundColor Blue
        
        Write-Host "`n⏱️  Deployment typically takes 5-10 minutes" -ForegroundColor Yellow
        
        Write-Host "`n🔍 After deployment, test with:" -ForegroundColor Cyan
        Write-Host "   curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health" -ForegroundColor Gray
        
        Write-Host "`n✨ Deployment initiated successfully!`n" -ForegroundColor Green
    } else {
        Write-Host "`n❌ Push failed!" -ForegroundColor Red
        Write-Host "   Check your git configuration and network connection." -ForegroundColor Yellow
        Write-Host "   You may need to authenticate with GitHub." -ForegroundColor Yellow
    }
} else {
    Write-Host "`nPush cancelled. You can push manually later with:" -ForegroundColor Yellow
    Write-Host "   git push origin master" -ForegroundColor Gray
    Write-Host "`nOr run this script again: .\deploy-to-github.ps1`n" -ForegroundColor Gray
}

Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
