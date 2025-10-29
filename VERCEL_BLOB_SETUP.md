# Vercel Blob Storage Setup Guide

## Problem
You're seeing errors like:
```
Error: Vercel Blob: No token found. Either configure the `BLOB_READ_WRITE_TOKEN` environment variable
```

This means your app can't save/load results from cloud storage.

## Solution: Get Your Vercel Blob Token

### Step 1: Create a Vercel Blob Store

1. Go to https://vercel.com/dashboard
2. Log in to your Vercel account
3. Select your project (or create one if you haven't deployed yet)
4. Click on **Storage** tab in the left sidebar
5. Click **Create Database** or **Connect Store**
6. Choose **Blob** as the storage type
7. Name it (e.g., "scheduling-results")
8. Click **Create**

### Step 2: Get Your Token

1. After creating the Blob store, you'll see connection details
2. Look for **Environment Variables** section
3. Copy the value of `BLOB_READ_WRITE_TOKEN`
4. It will look something like: `vercel_blob_rw_XXXXXXXXXXXXX`

### Step 3: Add Token to Your Project

#### For Local Development:
1. Open `.env.local` file in your project root
2. Add or update this line:
   ```
   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_XXXXXXXXXXXXX
   ```
3. Replace `vercel_blob_rw_XXXXXXXXXXXXX` with your actual token
4. Save the file
5. **Restart your dev server** (Ctrl+C, then `npm run dev`)

#### For Production (Vercel Deployment):
1. Go to your project on Vercel dashboard
2. Click **Settings** > **Environment Variables**
3. Add a new variable:
   - Name: `BLOB_READ_WRITE_TOKEN`
   - Value: `vercel_blob_rw_XXXXXXXXXXXXX`
   - Environment: All (Production, Preview, Development)
4. Click **Save**
5. **Redeploy** your project for changes to take effect

### Step 4: Verify It Works

1. Restart your application
2. Run an optimization
3. Check the Results Manager - you should now see saved results
4. Download should work without "empty file" errors
5. No more "No token found" errors in console

## Alternative: Use AWS S3 Instead

If you prefer AWS over Vercel Blob:

1. The app already supports AWS S3 through your Lambda function
2. Just make sure `NEXT_PUBLIC_AWS_SOLVER_URL` is configured
3. Results will be stored in S3 automatically
4. You can disable Vercel Blob by not setting the token

## Troubleshooting

### Token Not Working
- Make sure there are no extra spaces before/after the token
- Check that you copied the complete token
- Verify the token starts with `vercel_blob_rw_`

### Still Getting Errors
- Try creating a new Blob store
- Regenerate the token from Vercel dashboard
- Make sure `.env.local` is in your project root (not inside `src/`)
- Don't commit `.env.local` to Git (it should be in `.gitignore`)

### Results Still Not Persisting
- Check browser console for errors
- Verify Blob store is active in Vercel dashboard
- Try deleting and recreating the Blob store
- Check Vercel project logs for detailed error messages

## Security Notes

⚠️ **Never commit your token to Git!**
- The `.env.local` file should be in `.gitignore`
- Use Vercel's environment variables for production
- Don't share your token publicly

## What This Fixes

✅ Results persist after page refresh
✅ Download works correctly (no empty files)
✅ Results are accessible across devices
✅ Delete functionality works
✅ Results numbered correctly (Result_1, Result_2, etc.)
