import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { adminRouter } from './routes/admin.routes';
import { mainBackendService } from './services/main-backend.service';
import { eventsService } from './services/events.service';
import { prisma, adminDb } from './services/db.service';

// Load root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();

const app = express();
const PORT = process.env.ADMIN_PORT || 4001;

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Serve uploads statically
const uploadsDir = path.resolve(process.cwd(), '..', '..', 'uploads');
app.use('/uploads', express.static(uploadsDir));
const localUploadsDir = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(localUploadsDir));

// Mount Admin API routes
app.use('/api/admin', adminRouter);

// Root fallback / info
app.get('/', (req, res) => {
  res.json({
    service: 'Dairy Marketplace Admin Backend',
    version: '1.0.0',
    status: 'ONLINE',
    adminApi: '/api/admin',
    healthCheck: '/api/admin/health',
    eventsStream: '/api/admin/events',
  });
});

// Periodic background poller to broadcast external order placements / delivery accepts
let lastKnownOrderIds = new Set<string>();
let lastKnownStatuses = new Map<string, string>();

async function initBackgroundPoller() {
  try {
    const merchantId = adminDb.getMerchantId();
    const existingOrders = await prisma.order.findMany({
      where: { merchantId },
      include: { delivery: true },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    existingOrders.forEach((o) => {
      lastKnownOrderIds.add(o.orderId);
      lastKnownStatuses.set(o.orderId, o.delivery?.status || o.status);
    });

    // Check every 3 seconds for new orders or delivery status updates
    setInterval(async () => {
      try {
        const latestOrders = await prisma.order.findMany({
          where: { merchantId },
          include: {
            customer: true,
            items: true,
            delivery: {
              include: {
                deliveryPartner: { include: { user: true } },
              },
            },
          },
          take: 20,
          orderBy: { createdAt: 'desc' },
        });

        for (const order of latestOrders) {
          // Detect brand new customer order
          if (!lastKnownOrderIds.has(order.orderId)) {
            lastKnownOrderIds.add(order.orderId);
            lastKnownStatuses.set(order.orderId, order.delivery?.status || order.status);

            console.log(`[AdminBackend] 🔔 NEW CUSTOMER ORDER DETECTED: #${order.orderId} (₹${order.total})`);
            const formatted = await adminDb.getOrder(order.orderId);
            eventsService.broadcast('NEW_ORDER', {
              orderId: order.orderId,
              customerName: order.customer?.name || 'Customer',
              total: order.total,
              itemCount: order.items.length,
              items: order.items.map((it) => it.productName),
              order: formatted,
            });
          } else {
            // Detect delivery accept or status change
            const currentStatus = order.delivery?.status || order.status;
            const prevStatus = lastKnownStatuses.get(order.orderId);

            if (prevStatus && prevStatus !== currentStatus) {
              lastKnownStatuses.set(order.orderId, currentStatus);

              const formatted = await adminDb.getOrder(order.orderId);
              if (currentStatus === 'ACCEPTED') {
                console.log(
                  `[AdminBackend] 🚴 DELIVERY ACCEPTED: Order #${order.orderId} by ${
                    order.delivery?.deliveryPartner?.user?.name || 'Partner'
                  }`,
                );
                eventsService.broadcast('DELIVERY_ACCEPTED', {
                  orderId: order.orderId,
                  status: currentStatus,
                  deliveryPartner: formatted?.deliveryPartner,
                  order: formatted,
                });
              } else {
                console.log(
                  `[AdminBackend] 📦 DELIVERY STATUS UPDATED: Order #${order.orderId} -> ${currentStatus}`,
                );
                eventsService.broadcast('DELIVERY_STATUS_UPDATED', {
                  orderId: order.orderId,
                  status: currentStatus,
                  deliveryPartner: formatted?.deliveryPartner,
                  timeline: formatted?.progressTimeline,
                  order: formatted,
                });
              }
            }
          }
        }
      } catch (err: any) {
        // Silent fail on background poll tick
      }
    }, 3000);
  } catch (err: any) {
    console.error('[AdminBackend] Poller init error:', err.message);
  }
}

// Start Server
app.listen(PORT, async () => {
  console.log(`\n=======================================================`);
  console.log(`🛡️  Dairy Admin Backend Server is running on port: ${PORT}`);
  console.log(`📡 Admin API: http://localhost:${PORT}/api/admin`);
  console.log(`⚡ Event Stream (SSE): http://localhost:${PORT}/api/admin/events`);
  console.log(`=======================================================`);

  // Step 1: Startup Check of Main Customer & Delivery Backend
  await mainBackendService.checkStartupConnection();

  // Step 2: Initialize background sync poller for instant order detection
  await initBackgroundPoller();
});
