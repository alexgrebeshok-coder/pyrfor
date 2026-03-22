# CEOClaw Deployment Guide

## Prerequisites
- Vercel account
- Neon PostgreSQL database
- Environment variables configured

## Steps

### 1. Setup Neon PostgreSQL
1. Go to https://neon.tech
2. Create new project
3. Copy connection strings

### 2. Configure Vercel Environment Variables
In Vercel dashboard:
- `DATABASE_URL` = "postgresql://..."
- `DIRECT_URL` = "postgresql://..."
- `NEXT_PUBLIC_APP_URL` = "https://ceoclaw.vercel.app"

### 3. Deploy
```bash
# Switch to PostgreSQL schema
./scripts/switch-db.sh

# Generate Prisma Client
npx prisma generate

# Push schema to Neon
npx prisma db push

# Build locally to verify
npm run build

# Deploy to Vercel
# vercel --prod
```

### 4. Post-deploy
1. Run seed script: `npx prisma db seed`
2. Verify database connection
3. Test all pages

## Troubleshooting
- Build fails: Check environment variables
- Database error: Verify Neon connection
- 500 error: Check Vercel logs
