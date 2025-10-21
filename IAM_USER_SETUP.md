# IAM User Setup for AWS Deployment

## For IAM Users (Not Root Account)

If you received an IAM username and password from your organization/admin, follow this guide.

---

## What You Have vs What You Need

### ✅ What You Have:
- IAM Username (e.g., `john.smith`)
- IAM Password
- AWS Console access

### ❓ What You Need:
- **Access Key ID** (starts with `AKIA...`)
- **Secret Access Key** (long random string)

---

## How to Get Access Keys

### Step 1: Log In
Go to: https://console.aws.amazon.com/

**Sign-in options:**
- If you see "IAM user" option → Select it
- Enter your **IAM username** (not email)
- Enter your **password**
- If there's an "Account ID" field, ask your admin for it

### Step 2: Navigate to Your Security Settings

**Easiest way:**
1. Click your **username** in the top-right corner
2. Select **"Security credentials"** from dropdown
3. You're now on your security credentials page

### Step 3: Create Access Key

1. Scroll down to **"Access keys"** section
2. Click **"Create access key"** button

   **If button is grayed out or missing:**
   - Your admin may have restricted this
   - Contact your AWS administrator
   - They can either:
     - Give you permission to create keys
     - Create keys for you

3. **Select use case**: Command Line Interface (CLI)
4. Check the acknowledgment checkbox
5. Click **"Next"**
6. Add description (optional): "Local development - [Your Name]"
7. Click **"Create access key"**

### Step 4: Save Your Keys

**CRITICAL: The Secret Access Key is shown ONLY ONCE!**

You'll see:
```
Access Key ID:     AKIAIOSFODNN7EXAMPLE
Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**Save them by:**
1. Click **"Download .csv file"** ← BEST option
2. Or copy both values to a secure location

**Store in:**
- Password manager (1Password, LastPass, Bitwarden)
- Secure note on your computer (encrypted)
- Physical notebook (if no other option)

**Never:**
- ❌ Email them
- ❌ Share in chat/Slack
- ❌ Commit to Git
- ❌ Take screenshots and share

---

## Configure AWS CLI

### Open PowerShell (Windows) or Terminal (Mac/Linux)

```powershell
aws configure
```

### Enter Your Credentials:

```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

Replace the example values with your actual keys from the .csv file!

---

## Verify It Works

```powershell
aws sts get-caller-identity
```

**Success looks like:**
```json
{
    "UserId": "AIDAI23XYZEXAMPLE",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/your-username"
}
```

**If you see this, you're ready to deploy!** ✅

---

## Common Issues for IAM Users

### Issue 1: "Cannot create access key"

**Cause**: Your IAM user doesn't have permission

**Solution**: 
- Contact your AWS administrator
- Ask them to grant you `iam:CreateAccessKey` permission
- Or ask them to create keys for you

**Alternative**:
- Your admin can create keys and securely share them with you
- They should use AWS Secrets Manager or similar secure method

---

### Issue 2: "Access Denied" when deploying

**Cause**: Your IAM user lacks required permissions

**Required Permissions for Deployment:**
```
- AmazonEC2ContainerRegistryFullAccess (ECR)
- AmazonECS_FullAccess (ECS)
- IAMReadOnlyAccess (minimum)
- AmazonS3FullAccess (Storage)
- CloudWatchLogsFullAccess (Logging)
```

**Solution**:
- Contact your AWS administrator
- Share this list of required permissions
- They can attach these policies to your IAM user

**To check your current permissions:**
1. AWS Console → IAM → Users → Your username
2. Click "Permissions" tab
3. Screenshot and send to admin if needed

---

### Issue 3: "Invalid credentials" error

**Causes & Fixes:**

1. **Typo in keys**
   - Carefully re-copy from .csv file
   - Make sure no spaces before/after

2. **Incomplete Secret Key**
   - Secret keys are LONG (40 characters)
   - Make sure you copied the entire string

3. **Keys deactivated**
   - Your admin may have deactivated them
   - Create new keys or contact admin

4. **Wrong region**
   - Try `us-east-1` (most common)
   - Ask your admin which region to use

---

### Issue 4: "You are not authorized to perform this operation"

**For specific AWS services:**

1. **ECR (Docker registry)**
   - Need: `AmazonEC2ContainerRegistryFullAccess`

2. **ECS (Container service)**
   - Need: `AmazonECS_FullAccess`

3. **IAM (Creating roles)**
   - Need: `IAMFullAccess` or at minimum `iam:CreateRole`, `iam:AttachRolePolicy`

4. **S3 (Storage)**
   - Need: `AmazonS3FullAccess`

**Solution**: Contact your admin with the specific service name

---

## Working with Restricted IAM Users

If your admin has given you limited permissions, you have options:

### Option 1: Request Minimum Permissions

Send this to your admin:

```
Hi [Admin Name],

I need the following AWS permissions to deploy our scheduling application:

1. AmazonEC2ContainerRegistryFullAccess - To store Docker images
2. AmazonECS_FullAccess - To run containers
3. AmazonS3FullAccess - To store result files
4. CloudWatchLogsFullAccess - For application logging
5. IAM permissions to create service roles

Could you please attach these policies to my IAM user?

Thanks!
```

### Option 2: Admin Deploys Infrastructure

- Your admin can run the deployment scripts
- They create the infrastructure
- You only deploy code updates later
- More secure for production

### Option 3: Use Temporary Credentials

- Admin can use AWS STS to give you temporary credentials
- More secure, credentials expire after 1-12 hours
- Ask admin about `AssumeRole` permissions

---

## Best Practices for IAM Users

### ✅ DO:
- Create separate access keys for different purposes
- Name keys descriptively ("Windows Laptop", "CI/CD")
- Rotate keys every 90 days
- Delete unused keys immediately
- Use MFA (Multi-Factor Authentication) if available
- Test with `aws sts get-caller-identity` after setup

### ❌ DON'T:
- Share keys with teammates (each person gets their own)
- Use root account keys (always use IAM)
- Hard-code keys in scripts
- Commit keys to Git repositories
- Reuse the same keys everywhere

---

## Security Checklist

Before deploying:

- [ ] Access keys created and saved securely
- [ ] Keys NOT committed to Git
- [ ] `aws configure` completed successfully
- [ ] `aws sts get-caller-identity` works
- [ ] Required permissions verified with admin
- [ ] MFA enabled on IAM user (if supported)
- [ ] Key rotation reminder set (90 days)

---

## Quick Command Reference

```powershell
# Configure AWS CLI
aws configure

# Test credentials
aws sts get-caller-identity

# List your access keys
aws iam list-access-keys --user-name YOUR_USERNAME

# Check your permissions
aws iam list-attached-user-policies --user-name YOUR_USERNAME

# Get your username
aws sts get-caller-identity --query "Arn" --output text
```

---

## Getting Help from Your Admin

**Email template:**

```
Subject: AWS Access for Deployment

Hi [Admin],

I'm deploying our scheduling application to AWS and need help with my IAM user setup.

Current status:
- IAM Username: [your-username]
- Console access: ✅ Working
- Access keys: ❓ Need to create OR ❓ Need permissions

What I need:
1. Permission to create access keys (or keys created for me)
2. Permissions for: ECR, ECS, S3, CloudWatch, IAM (service roles)
3. Confirmation of which AWS region to use

Deployment guide: AWS_QUICK_START.md
Permissions needed: See IAM_USER_SETUP.md

Thanks!
[Your Name]
```

---

## Summary

1. ✅ You have: IAM username + password
2. ✅ You need: Access Key ID + Secret Access Key
3. ✅ How to get them: Security credentials → Create access key
4. ✅ How to use them: `aws configure`
5. ✅ Verify: `aws sts get-caller-identity`
6. ✅ If blocked: Contact your AWS admin

---

**Ready?** 
- Keys created: ✅
- AWS CLI configured: ✅
- Permissions verified: ✅
- **Let's deploy!** → See `AWS_QUICK_START.md`
