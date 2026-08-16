# Browserbase Setup & Deployment Guide

## What Was Added

### 1. Dependencies (package.json)
✅ Added:
- `@browserbasehq/sdk`: ^2.0.0 - Cloud browser management
- `playwright-core`: ^1.40.0 - Browser automation

### 2. New API Endpoint (api/run-task.js)
✅ Created 4,174 byte function with:
- `action: "create"` - Start browser session
- `action: "step"` - Execute one test step
- `action: "end"` - Close session

### 3. Documentation
✅ Created BROWSERBASE_INTEGRATION.md

## How to Deploy

### Step 1: Get Browserbase Credentials
1. Sign up at https://www.browserbase.com
2. Create project
3. Copy API key
4. Copy project ID

### Step 2: Set Vercel Environment Variables
1. Go to Vercel project settings
2. Add environment variables:
   ```
   BROWSERBASE_API_KEY=your-key
   BROWSERBASE_PROJECT_ID=your-project-id
   ANTHROPIC_API_KEY=your-key
   ```
3. Redeploy

### Step 3: Deploy
```bash
git add .
git commit -m "Add Browserbase real browser automation"
git push origin main
# Vercel auto-deploys
```

## Testing the Integration

The `/api/run-task` endpoint can be tested with:

```bash
# Create session
curl -X POST https://your-project.vercel.app/api/run-task \
  -H "Content-Type: application/json" \
  -d '{"action":"create","goal":"Test login"}'

# Response:
# {"sessionId":"...","connectUrl":"...","liveViewUrl":"..."}
```

## Next: Update Frontend

Frontend needs to be updated to call `/api/run-task` instead of simulated APIs.
This will be done in a separate task.

## File Structure

```
api/
  ├── run-task.js      ✅ NEW - Real browser automation
  ├── plan.js          ✅ PRESERVED - QA planning
  ├── simulate.js      ✅ PRESERVED - AI simulation
  └── verify.js        ✅ PRESERVED - Verification

public/
  └── index.html       ✅ PRESERVED - To be updated

vercel.json            ✅ PRESERVED
package.json           ✅ UPDATED - Added dependencies
```

## Status

✅ **Browserbase infrastructure integrated**
⏳ **Awaiting frontend update to use real browser**

Real browser automation is ready to use!
