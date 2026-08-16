# OmnyGO Vercel Serverless Setup

## ✅ Created Files

### 1. api/plan.js
- Generates QA test plan from goal description
- Endpoint: POST /api/plan
- Uses Claude Sonnet 4.5 to break down testing into 3-6 steps

### 2. api/simulate.js
- Simulates execution of a single test step
- Endpoint: POST /api/simulate
- Returns realistic action descriptions under 15 words

### 3. api/verify.js
- Verifies test coverage and completeness
- Endpoint: POST /api/verify
- Returns: verified (bool), confidence (high/medium/low), reason (string)

### 4. vercel.json
- Deployment configuration for Vercel
- Builds Node.js serverless functions from api/*.js
- Routes /api/* to functions, / to public/index.html

## ✅ Updated Files

### 1. package.json
- Simplified to Vercel-compatible version
- Only dependency: @anthropic-ai/sdk ^0.30.0
- Removed: express, playwright, ws, dotenv, openai

### 2. .gitignore
- Added: .vercel, sessions/, reports/
- Keeps: node_modules/, .env

## 📋 Architecture

```
Browser (public/index.html)
       ↓
   HTTP POST to Vercel
       ↓
   ┌───────────────────────┐
   │ Serverless Functions  │
   ├───────────────────────┤
   │ • /api/plan           │
   │ • /api/simulate       │
   │ • /api/verify         │
   └───────────────────────┘
       ↓
  Anthropic Claude API
  (claude-sonnet-4-5)
```

## 🚀 Deployment

1. Push to GitHub
2. Connect to Vercel
3. Set environment variable: ANTHROPIC_API_KEY
4. Deploy (automatic)

## 🧪 Local Testing

```bash
npm install
vercel dev
```

Then test:
```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{"goal":"Test login functionality"}'
```

## ⏭️ Next Step

Modify public/index.html to call these APIs instead of WebSocket

