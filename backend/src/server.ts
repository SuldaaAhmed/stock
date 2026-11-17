import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { seedDatabase } from './db/seed';
import { authRouter } from './routes/authRoutes';
import { dashboardRouter } from './routes/dashboardRoutes';
import { productRouter } from './routes/productRoutes';
import { stockInRouter } from './routes/stockInRoutes';
import { stockOutRouter } from './routes/stockOutRoutes';
import { receiptRouter } from './routes/receiptRoutes';
import { healthRouter } from './routes/healthRoute';
import { authMiddleware } from './middlewares/auth';
import { csrfProtection } from './middlewares/csrf';
import { idempotencyMiddleware } from './middlewares/idempotency';
import { errorHandler } from './middlewares/errorHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize database and seed
seedDatabase();

// Global Middlewares
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow any incoming origin for preview/development with credentials
      callback(null, true);
    },
    credentials: true,
  })
);

app.use(cookieParser());
app.use(express.json());

// Request ID header tracking
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.headers['x-request-id'] = reqId;
  res.setHeader('X-Request-Id', reqId);
  next();
});

// Health endpoint (root)
app.use(healthRouter);

// API v1 Router
const apiV1 = express.Router();

// Apply auth, CSRF, and Idempotency to API routes
apiV1.use('/auth', authRouter);
apiV1.use(authMiddleware);
apiV1.use(csrfProtection);
apiV1.use(idempotencyMiddleware);

apiV1.use('/dashboard', dashboardRouter);
apiV1.use('/products', productRouter);
apiV1.use('/stock-ins', stockInRouter);
apiV1.use('/stock-outs', stockOutRouter);
apiV1.use('/receipts', receiptRouter);

app.use('/api/v1', apiV1);

// Error Handler
app.use(errorHandler);

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
});
