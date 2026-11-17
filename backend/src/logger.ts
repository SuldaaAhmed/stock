import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password',
      '*.password',
      '*.newPassword',
    ],
    censor: '[redacted]',
  },
});
