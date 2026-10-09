// ─────────────────────────────────────────────────────────────────────────────
// ASCENDA — Development seed
//
// Creates a demo organisation, an OWNER user and their membership so the sign-in
// flow can be exercised locally.
//
// Run with:  pnpm --filter @ascenda/db db:seed
// (or `npx prisma db seed` from packages/db, which loads packages/db/.env)
// ─────────────────────────────────────────────────────────────────────────────
import {
  BillingPeriod,
  PrismaClient,
  OrganisationType,
  SystemRole,
} from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

// Annual prices in NGN; stored as integer minor units (kobo).
const PLANS = [
  {
    code: 'free',
    name: 'Free',
    description: 'For a single user getting started.',
    priceMinorUnits: 0,
    minHeadcount: 1,
    maxHeadcount: 1,
    maxSeats: 1,
    sortOrder: 0,
    isFree: true,
    features: ['1 user', 'Core people records', 'Community support'],
  },
  {
    code: 'starter',
    name: 'Starter',
    description: 'For small teams up to 20 people.',
    priceMinorUnits: 2_500_000, // ₦25,000 / year
    minHeadcount: 1,
    maxHeadcount: 20,
    maxSeats: 20,
    sortOrder: 1,
    isFree: false,
    features: [
      'Up to 20 users',
      'Payroll runs',
      'Leave management',
      'Email support',
    ],
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For growing organisations of 21–100 people.',
    priceMinorUnits: 3_500_000, // ₦35,000 / year
    minHeadcount: 21,
    maxHeadcount: 100,
    maxSeats: 100,
    sortOrder: 2,
    isFree: false,
    features: [
      'Up to 100 users',
      'Everything in Starter',
      'Approval workflows',
      'Priority support',
    ],
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'For established teams of 101–500 people.',
    priceMinorUnits: 5_000_000, // ₦50,000 / year
    minHeadcount: 101,
    maxHeadcount: 500,
    maxSeats: 500,
    sortOrder: 3,
    isFree: false,
    features: [
      'Up to 500 users',
      'Everything in Growth',
      'Advanced analytics',
      'Dedicated onboarding',
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'For large organisations of 501+ people.',
    priceMinorUnits: 10_000_000, // ₦100,000 / year
    minHeadcount: 501,
    maxHeadcount: null,
    maxSeats: null,
    sortOrder: 4,
    isFree: false,
    features: [
      'Unlimited users',
      'Everything in Scale',
      'SLA & audit exports',
      'Account manager',
    ],
  },
] as const;

const DEMO = {
  organisation: {
    name: 'Grace Chapel Demo',
    slug: 'grace-chapel-demo',
    type: OrganisationType.CHURCH,
    country: 'NG',
    currency: 'NGN',
    timezone: 'Africa/Lagos',
    terminology: { Department: 'Ministry', Employee: 'Pastor' },
  },
  owner: {
    email: 'owner@ascenda.dev',
    password: 'AscendaDemo123!',
    firstName: 'Jane',
    lastName: 'Doe',
  },
} as const;

async function main() {
  const passwordHash = await argon2.hash(DEMO.owner.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const organisation = await prisma.organisation.upsert({
    where: { slug: DEMO.organisation.slug },
    update: {},
    create: DEMO.organisation,
  });

  const owner = await prisma.user.upsert({
    where: { email: DEMO.owner.email },
    update: { passwordHash, isPlatformAdmin: true },
    create: {
      email: DEMO.owner.email,
      passwordHash,
      firstName: DEMO.owner.firstName,
      lastName: DEMO.owner.lastName,
      // Demo convenience: the seeded owner is also Ascenda platform staff so
      // the access-request review/approval flow can be exercised locally.
      isPlatformAdmin: true,
    },
  });

  await prisma.membership.upsert({
    where: {
      organisationId_userId: {
        organisationId: organisation.id,
        userId: owner.id,
      },
    },
    update: { role: SystemRole.OWNER, isActive: true, acceptedAt: new Date() },
    create: {
      organisationId: organisation.id,
      userId: owner.id,
      role: SystemRole.OWNER,
      acceptedAt: new Date(),
      createdBy: owner.id,
    },
  });

  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        description: plan.description,
        priceMinorUnits: plan.priceMinorUnits,
        currency: 'NGN',
        billingPeriod: BillingPeriod.ANNUALLY,
        minHeadcount: plan.minHeadcount,
        maxHeadcount: plan.maxHeadcount,
        maxSeats: plan.maxSeats,
        features: [...plan.features],
        isFree: plan.isFree,
        isActive: true,
        sortOrder: plan.sortOrder,
      },
      create: {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMinorUnits: plan.priceMinorUnits,
        currency: 'NGN',
        billingPeriod: BillingPeriod.ANNUALLY,
        minHeadcount: plan.minHeadcount,
        maxHeadcount: plan.maxHeadcount,
        maxSeats: plan.maxSeats,
        features: [...plan.features],
        isFree: plan.isFree,
        isActive: true,
        sortOrder: plan.sortOrder,
      },
    });
  }

  console.log('✓ Seeded demo organisation and owner');
  console.log(`  organisation: ${organisation.name} (${organisation.slug})`);
  console.log(`  email:        ${DEMO.owner.email}`);
  console.log(`  password:     ${DEMO.owner.password}`);
  console.log(`✓ Seeded ${PLANS.length} plans`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
