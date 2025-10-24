# Deploy to AWS Amplify - Quick Setup Guide

## Prerequisites Completed ✅
- AWS Lambda solver deployed: `https://iiittt6g5f.execute-api.us-east-1.amazonaws.com`
- Environment variables prepared in `amplify-env-variables.json`
- GitHub repository: `sapperberet/scheduling-webapp`

## Option 1: Deploy via AWS Console (Easiest)

### Step 1: Create Amplify App

1. Go to https://console.aws.amazon.com/amplify/
2. Click **"New app"** → **"Host web app"**
3. Select **GitHub** as your source
4. Click **"Connect to GitHub"** and authorize AWS Amplify
5. Select repository: `sapperberet/scheduling-webapp`
6. Select branch: `master`
7. Click **"Next"**

### Step 2: Configure Build Settings

Amplify should auto-detect Next.js. The build settings should look like:

```yaml
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

Click **"Next"**

### Step 3: Add Environment Variables

**IMPORTANT:** Before clicking "Save and deploy", add these environment variables:

1. Click **"Advanced settings"** (at bottom)
2. Scroll to **"Environment variables"** section
3. Add each variable one by one:

| Key | Value |
|-----|-------|
| `NEXTAUTH_URL` | `https://www.mlsched.com` |
| `NEXTAUTH_SECRET` | `kS/waPoqrQTStR9kjiJHnRoQ98ngdMLZVd7vWQflYYg=` |
| `ADMIN_EMAIL` | `admin@scheduling.com` |
| `ADMIN_PASSWORD` | `YOUR_ADMIN_PASSWORD` |
| `ADMIN_USERNAME` | `YOUR_ADMIN_USERNAME` |
| `ADMIN_BACKUP_EMAIL` | `your-backup-email@example.com` |
| `EMAIL_SERVICE` | `sendgrid` |
| `EMAIL_USER` | `apikey` |
| `EMAIL_PASS` | `YOUR_SENDGRID_API_KEY` |
| `EMAIL_FROM_NAME` | `Medical Scheduling System` |
| `EMAIL_FROM_ADDRESS` | `your-email@example.com` |
| `SENDGRID_API_KEY` | `YOUR_SENDGRID_API_KEY` |
| `BLOB_READ_WRITE_TOKEN` | `YOUR_VERCEL_BLOB_TOKEN` |
| `NEXT_PUBLIC_AWS_SOLVER_URL` | `https://iiittt6g5f.execute-api.us-east-1.amazonaws.com` |
| `NEXT_PUBLIC_AWS_REGION` | `us-east-1` |

4. Click **"Save and deploy"**

### Step 4: Wait for Deployment

Amplify will:
1. ✅ Provision (30 seconds)
2. ✅ Build (5-10 minutes)
3. ✅ Deploy (2-3 minutes)
4. ✅ Verify (30 seconds)

You'll get a URL like: `https://master.dxxxxxxxxxxxxx.amplifyapp.com`

### Step 5: Add Custom Domain (After Deployment Works)

**ONLY AFTER** the app is working on the default Amplify URL:

1. In Amplify Console → Your App → **"Domain management"** (left sidebar)
2. Click **"Add domain"**
3. Enter: `mlsched.com`
4. Configure:
   - ✅ `www.mlsched.com` → master branch
   - ✅ Redirect `mlsched.com` → `www.mlsched.com`
5. Amplify will show you name servers (they're the same ones you already have)
6. Click **"Save"**

**Wait 15-30 minutes for SSL certificate to be issued.**

---

## Option 2: Deploy via AWS CLI (Advanced)

If you prefer command line:

```powershell
# 1. Create Amplify app
$APP_ID = (& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' amplify create-app `
    --name "scheduling-webapp" `
    --repository "https://github.com/sapperberet/scheduling-webapp" `
    --platform WEB `
    --query 'app.appId' --output text)

# 2. Connect GitHub branch
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' amplify create-branch `
    --app-id $APP_ID `
    --branch-name master `
    --framework 'Next.js - SSR'

# 3. Add environment variables (one at a time)
Get-Content amplify-env-variables.json | ConvertFrom-Json | `
    ForEach-Object { 
        $_.PSObject.Properties | ForEach-Object {
            & 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' amplify update-app `
                --app-id $APP_ID `
                --environment-variables $_.Name=$_.Value
        }
    }

# 4. Start deployment
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' amplify start-job `
    --app-id $APP_ID `
    --branch-name master `
    --job-type RELEASE

# 5. Check status
& 'C:\Program Files\Amazon\AWSCLIV2\aws.exe' amplify get-job `
    --app-id $APP_ID `
    --branch-name master `
    --job-id <JOB_ID_FROM_PREVIOUS_COMMAND>
```

---

## Option 3: Test Locally First (Recommended Before Deploy)

Make sure everything works locally with AWS Lambda solver:

```powershell
cd C:\Werk\Webapp\Webapp7aramoy\scheduling-webapp

# Update .env.local with production values
# (Keep NEXTAUTH_URL as localhost for local testing)

# Install dependencies
npm install

# Run dev server
npm run dev
```

Visit `http://localhost:3000` and test:
1. ✅ Login works
2. ✅ AWS Cloud solver button works
3. ✅ Email notifications work
4. ✅ All features functional

---

## Troubleshooting

### Build Fails with "NEXTAUTH_SECRET not set"
- ✅ Make sure you added ALL environment variables in Step 3
- ✅ Trigger a new deployment: Amplify Console → Redeploy

### Custom Domain SSL Stuck
- ⚠️ **Current Issue:** Your domain uses GoDaddy name servers, not AWS Route 53
- **Solution:** Either:
  - Update name servers at your domain registrar to AWS ones
  - OR skip custom domain and use default Amplify URL for now

### App Loads but Solver Doesn't Work
- Check browser console for CORS errors
- Lambda endpoint is: `https://iiittt6g5f.execute-api.us-east-1.amazonaws.com`
- Test Lambda health: `curl https://iiittt6g5f.execute-api.us-east-1.amazonaws.com/health`

### Email Notifications Not Working
- Verify SendGrid API key is still valid
- Check SendGrid dashboard for blocked sends
- Verify `EMAIL_FROM_ADDRESS` is verified in SendGrid

---

## What I Recommend

**Step-by-step approach:**

1. ✅ Deploy to Amplify using default URL first (Option 1 above)
2. ✅ Test the app thoroughly on `https://master.dxxxx.amplifyapp.com`
3. ✅ Fix any issues before adding custom domain
4. ⏳ Wait for domain name servers to propagate (if you updated them)
5. ✅ Add custom domain `mlsched.com` once everything works

This way, you can test immediately without waiting for DNS/SSL issues!

---

## Quick Copy-Paste for Environment Variables

If you're adding them manually in Amplify Console, here's the quick format:

```
NEXTAUTH_URL=https://www.mlsched.com
NEXTAUTH_SECRET=YOUR_NEXTAUTH_SECRET
ADMIN_EMAIL=admin@scheduling.com
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
ADMIN_USERNAME=YOUR_ADMIN_USERNAME
ADMIN_BACKUP_EMAIL=your-backup-email@example.com
EMAIL_SERVICE=sendgrid
EMAIL_USER=apikey
EMAIL_PASS=YOUR_SENDGRID_API_KEY
EMAIL_FROM_NAME=Medical Scheduling System
EMAIL_FROM_ADDRESS=your-email@example.com
SENDGRID_API_KEY=YOUR_SENDGRID_API_KEY
BLOB_READ_WRITE_TOKEN=YOUR_VERCEL_BLOB_TOKEN
NEXT_PUBLIC_AWS_SOLVER_URL=https://iiittt6g5f.execute-api.us-east-1.amazonaws.com
NEXT_PUBLIC_AWS_REGION=us-east-1
```

**Ready to deploy!** Which option would you like to use? I recommend Option 1 (AWS Console) as it's the easiest.
