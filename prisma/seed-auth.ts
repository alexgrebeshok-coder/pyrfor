// Seed Authentication Users with Hashed Passwords
// Run manually with:
//   SEED_AUTH_EMAIL=operator@example.com SEED_AUTH_PASSWORD='strong-password' npm run seed:auth

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Hash a password using bcrypt
 * @param password - Plain text password
 * @param saltRounds - Number of salt rounds (default: 10)
 * @returns Hashed password
 */
export async function hashPassword(password: string, saltRounds: number = 10): Promise<string> {
  return await bcrypt.hash(password, saltRounds);
}

export async function createTestUser(
  email: string,
  password: string,
  name?: string
) {
  const hashedPassword = await hashPassword(password, 10);
  
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      name: name || email.split('@')[0],
    },
    create: {
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      emailVerified: new Date(),
    },
  });
  
  return user;
}

async function main() {
  console.log('🔐 Seeding authentication users...');

  const email = process.env.SEED_AUTH_EMAIL?.trim();
  const password = process.env.SEED_AUTH_PASSWORD;
  const name = process.env.SEED_AUTH_NAME?.trim();

  if (!email || !password) {
    throw new Error(
      'SEED_AUTH_EMAIL and SEED_AUTH_PASSWORD are required. Refusing to create default credentials.'
    );
  }

  const testUser = await createTestUser(
    email,
    password,
    name
  );

  console.log('✅ Created auth user:', {
    id: testUser.id,
    email: testUser.email,
    name: testUser.name,
    emailVerified: testUser.emailVerified,
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
