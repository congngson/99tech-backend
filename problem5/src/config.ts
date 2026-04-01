import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3005),
  JWT_SECRET: z.string().min(32).default('change-me-in-production-must-be-32-chars!!'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  ROOT_USERNAME: z.string().default('root'),
  ROOT_PASSWORD: z.string().min(8).default('Root@123456'),
  NODE_ENV: z.string().default('development'),
});

export const config = EnvSchema.parse(process.env);
