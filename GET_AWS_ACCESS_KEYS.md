# 🔑 How to Get AWS Access Keys

If you're an IAM user with a username and password, you need to create **Access Keys** to use the AWS CLI and deployment scripts.

---

## Quick Steps

### 1. Log In to AWS Console
- Go to: https://console.aws.amazon.com/
- Sign in with your **IAM username** and **password**
- (Not your email - use the IAM username you were given)

### 2. Navigate to Security Credentials

**Option A (Easiest):**
1. Click your **username** in the top-right corner
2. Click **"Security credentials"**

**Option B:**
1. Click **"Services"** in the top menu
2. Type "IAM" and select it
3. Click **"Users"** in the left sidebar
4. Click your **username**
5. Click the **"Security credentials"** tab

### 3. Create Access Key

1. Scroll down to the **"Access keys"** section
2. Click **"Create access key"** button
3. Select use case: **"Command Line Interface (CLI)"**
4. Check the confirmation checkbox
5. Click **"Next"**
6. (Optional) Add a description like "Local development"
7. Click **"Create access key"**

### 4. Save Your Keys ⚠️ CRITICAL

You'll see two values:

```
Access Key ID:     AKIAIOSFODNN7EXAMPLE
Secret Access Key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**⚠️ WARNING**: The Secret Access Key is shown **ONLY ONCE**!

**Do ONE of these:**
- Click **"Download .csv file"** (recommended)
- Copy both keys to a secure password manager
- Write them down securely (if no other option)

**NEVER:**
- ❌ Commit them to Git
- ❌ Share them publicly
- ❌ Email them
- ❌ Post them in forums/chat

### 5. Use the Keys

Now you can configure AWS CLI:

```powershell
aws configure
```

Enter when prompted:
```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

---

## Visual Guide

```
AWS Console
    │
    ├── [Your Username ▼] (top-right corner)
    │       │
    │       └── Security credentials
    │               │
    │               └── Access keys section
    │                       │
    │                       └── [Create access key]
    │                               │
    │                               ├── Select: CLI
    │                               │
    │                               └── [Download .csv file] ⬅️ DO THIS!
    │
    └── Your keys are ready! 🎉
```

---

## What Each Key Does

### Access Key ID (Public)
- Like a username
- Starts with `AKIA...`
- Can be seen in AWS Console
- Safe to store in config files (but still keep private)

### Secret Access Key (Private)
- Like a password
- Long random string
- **Never shown again after creation**
- Must be kept absolutely secret
- Treat like a password!

---

## Security Best Practices

### ✅ DO:
- Download the .csv file immediately
- Store in a password manager (1Password, LastPass, etc.)
- Use different keys for different purposes
- Rotate keys every 90 days
- Delete unused keys

### ❌ DON'T:
- Hard-code in source code
- Commit to Git repositories
- Share via email or chat
- Use root account keys (use IAM instead)
- Reuse across multiple projects

---

## If You Lost Your Secret Key

**You cannot recover it!** You must:

1. Delete the old access key
2. Create a new access key
3. Update all places using the old key

### To Delete Old Key:
1. Security credentials → Access keys
2. Find the key (by Access Key ID)
3. Click **"Actions"** → **"Deactivate"** (test first)
4. If everything works, click **"Delete"**

---

## Key Permissions

Your IAM user needs these permissions for deployment:

### Required for Deployment:
```
- AmazonEC2ContainerRegistryFullAccess (for ECR)
- AmazonECS_FullAccess (for ECS)
- IAMFullAccess (to create roles)
- AmazonS3FullAccess (for storage)
- CloudWatchLogsFullAccess (for logging)
```

### Ask your AWS admin if you don't have these!

To check your permissions:
1. IAM Console → Users → Your username
2. Click **"Permissions"** tab
3. Review attached policies

---

## Testing Your Keys

After configuring AWS CLI, test with:

```powershell
# Test basic connection
aws sts get-caller-identity

# Should show:
{
    "UserId": "AIDAI...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/YourUsername"
}
```

If this works, you're ready to deploy! 🚀

---

## Troubleshooting

### "Unable to locate credentials"
**Fix**: Run `aws configure` again with correct keys

### "Access Denied" errors
**Fix**: Your IAM user needs more permissions. Contact AWS admin.

### "Invalid credentials"
**Fix**: 
- Check for typos in Access Key ID or Secret
- Make sure you copied the complete Secret Access Key
- Keys might be deactivated - create new ones

### "Region not found"
**Fix**: Use a valid region like `us-east-1`, `us-west-2`, `eu-west-1`

---

## Alternative: Using IAM Roles (Advanced)

If you're deploying from EC2 or Cloud9, you can use IAM Roles instead of Access Keys:

1. Attach IAM role to your EC2 instance
2. No need for `aws configure`
3. Credentials automatically available
4. More secure (no keys to manage)

---

## Key Rotation (Every 90 Days)

For production:

1. Create new access key (you can have 2 active keys)
2. Update AWS CLI with new key
3. Test everything works
4. Deactivate old key
5. Monitor for issues
6. Delete old key after 1 week

```powershell
# Update to new key
aws configure

# List your keys
aws iam list-access-keys --user-name YourUsername
```

---

## Summary

1. ✅ Log in to AWS Console (IAM username/password)
2. ✅ Go to Security credentials
3. ✅ Create access key for CLI
4. ✅ **Download .csv file immediately**
5. ✅ Run `aws configure` and paste keys
6. ✅ Keep keys secret and secure
7. ✅ Ready to deploy!

---

**Need Help?**
- AWS IAM Documentation: https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
- Your AWS administrator
- This guide: Read it carefully! 😊
