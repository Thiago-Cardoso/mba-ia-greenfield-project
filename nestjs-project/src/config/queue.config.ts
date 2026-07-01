import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => {
  const port = parseInt(process.env.REDIS_PORT ?? '6379', 10);
  if (isNaN(port)) {
    throw new Error(
      `REDIS_PORT must be a valid integer, got: ${process.env.REDIS_PORT}`,
    );
  }
  return {
    host: process.env.REDIS_HOST ?? 'redis',
    port,
  };
});
