import * as argon2 from 'argon2';
import { AppDataSource } from '../data-source';
import { User } from '../../users/entities/user.entity';
import { Channel } from '../../channels/entities/channel.entity';

const SEED_USER = {
  email: 'demo@streamtube.com',
  password: 'Demo@12345',
  channelName: 'Demo User',
  channelSlug: 'demo',
};

async function runSeed(): Promise<void> {
  await AppDataSource.initialize();
  console.log('Database connection initialized');

  const userRepo = AppDataSource.getRepository(User);
  const channelRepo = AppDataSource.getRepository(Channel);

  const existing = await userRepo.findOneBy({ email: SEED_USER.email });
  if (existing) {
    console.log(`Seed user already exists: ${SEED_USER.email}`);
    await AppDataSource.destroy();
    return;
  }

  const hashedPassword = await argon2.hash(SEED_USER.password);

  const user = userRepo.create({
    email: SEED_USER.email,
    password: hashedPassword,
    is_confirmed: true,
  });
  const savedUser = await userRepo.save(user);

  const channel = channelRepo.create({
    name: SEED_USER.channelName,
    slug: SEED_USER.channelSlug,
    user_id: savedUser.id,
  });
  await channelRepo.save(channel);

  console.log('');
  console.log('Seed user created:');
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
  console.log(`  Channel:  ${SEED_USER.channelSlug}`);
  console.log('');

  await AppDataSource.destroy();
  console.log('Database connection closed');
}

runSeed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
