// Seed a production-ready auth user with hashed password, organization, workspace, and membership.
// Run manually with:
//   SEED_AUTH_EMAIL=operator@example.com SEED_AUTH_PASSWORD='strong-password' npm run seed:auth

import { PrismaClient } from '@prisma/client';

import { provisionAuthUser } from '../lib/auth/provision-user';

const prisma = new PrismaClient();

async function main() {
  console.log('🔐 Seeding authentication users...');

  const email = process.env.SEED_AUTH_EMAIL?.trim();
  const password = process.env.SEED_AUTH_PASSWORD;
  const name = process.env.SEED_AUTH_NAME?.trim();
  const role = process.env.SEED_AUTH_ROLE?.trim() || 'EXEC';

  if (!email || !password) {
    throw new Error(
      'SEED_AUTH_EMAIL and SEED_AUTH_PASSWORD are required. Refusing to create default credentials.'
    );
  }

  const testUser = await provisionAuthUser(prisma, { email, password, name, role });

  console.log('✅ Created auth user:', {
    id: testUser.id,
    email: testUser.email,
    name: testUser.name,
    emailVerified: testUser.emailVerified,
    role,
  });
}

main()
  .catch((e) => {
    console.error('❌ Error seeding auth users:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
