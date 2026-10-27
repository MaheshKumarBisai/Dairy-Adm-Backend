import { Router, Request, Response } from 'express';
import multer from 'multer';
import { adminDb, prisma } from '../services/db.service';
import { imageProcessor } from '../services/image-processor';
import { mainBackendService } from '../services/main-backend.service';
import { eventsService } from '../services/events.service';
import { DeliveryStatus } from '@prisma/client';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per image
});

export const adminRouter = Router();

// -------------------------------------------------------------
// 1. HEALTH & CONNECTION STATUS
// -------------------------------------------------------------
adminRouter.get('/health', (req: Request, res: Response) => {
  const status = mainBackendService.getStatus();
  res.json({
    status: 'ONLINE',
    adminBackendPort: process.env.ADMIN_PORT || 4001,
    mainBackendConnection: status,
    activeSseClients: eventsService.getActiveClientCount(),
    timestamp: new Date().toISOString(),
  });
});

// -------------------------------------------------------------
// 2. REAL-TIME EVENT STREAM (Server-Sent Events)
// -------------------------------------------------------------
adminRouter.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  eventsService.addClient(res);
});

// -------------------------------------------------------------
// 3. DASHBOARD STATS
// -------------------------------------------------------------
adminRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const merchantId = adminDb.getMerchantId();
    const [productsCount, orders, partnersCount, plansCount, activePlansCount] = await Promise.all([
      prisma.product.count({ where: { merchantId, isActive: true } }),
      prisma.order.findMany({
        where: { merchantId },
        select: { total: true, status: true, createdAt: true },
      }),
      prisma.deliveryPartner.count({ where: { merchantId, isActive: true } }),
      prisma.dairyPlan.count({ where: { merchantId } }),
      prisma.dairyPlan.count({ where: { merchantId, status: 'ACTIVE' } }),
    ]);

    const totalRevenue = orders.reduce((acc, o) => acc + o.total, 0);
    const activeOrders = orders.filter((o) =>
      ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'].includes(
        o.status,
      ),
    ).length;

    res.json({
      success: true,
      data: {
        productsCount,
        totalOrders: orders.length,
        activeOrders,
        totalRevenue,
        partnersCount,
        plansCount,
        activePlansCount,
        backendStatus: mainBackendService.getStatus(),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 4. PRODUCT MANAGEMENT & MULTI-IMAGE UPLOAD WITH WHITE BACKGROUND
// -------------------------------------------------------------

// Upload up to 3 raw images (front, back, detail) and convert to pure white background
adminRouter.post(
  '/upload-product-images',
  upload.fields([
    { name: 'frontImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
    { name: 'detailImage', maxCount: 1 },
    { name: 'images', maxCount: 3 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const merchantId = adminDb.getMerchantId();
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files || Object.keys(files).length === 0) {
        return res.status(400).json({ success: false, error: 'No files uploaded' });
      }

      console.log(`[AdminBackend] Processing uploaded raw product images for pure white background...`);
      const processedResults = await imageProcessor.processBatch(merchantId, files);

      const urls = processedResults.map((r) => r.processedUrl);
      const primaryUrl = urls[0] || null;

      res.json({
        success: true,
        message: 'Images processed with clean white background',
        data: {
          primaryUrl,
          images: urls,
          details: processedResults,
        },
      });
    } catch (err: any) {
      console.error('[AdminBackend] Error processing images:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

adminRouter.get('/categories', async (req: Request, res: Response) => {
  try {
    const categories = await adminDb.listCategories();
    res.json({ success: true, data: categories });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.get('/products', async (req: Request, res: Response) => {
  try {
    const products = await adminDb.listProducts();
    res.json({ success: true, data: products });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.post('/products', async (req: Request, res: Response) => {
  try {
    const { name, description, categoryId, price, unit, initialStock, imageUrl, images } =
      req.body;

    if (!name || !categoryId || price === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required product fields: name, categoryId, price',
      });
    }

    const product = await adminDb.createProduct({
      name,
      description: description || '',
      categoryId,
      price: Number(price),
      unit: unit || 'PACKET',
      initialStock: initialStock !== undefined ? Number(initialStock) : 50,
      imageUrl: imageUrl || (images && images[0]) || null,
      images: images || (imageUrl ? [imageUrl] : []),
    });

    eventsService.broadcast('PRODUCT_UPDATED', { action: 'CREATED', product });

    console.log(`[AdminBackend] ✨ Product "${product.name}" created and synced to customer app catalog.`);
    res.json({ success: true, data: product });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.put('/products/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    const { name, description, categoryId, price, unit, stock, imageUrl, images, isActive } =
      req.body;

    const updated = await adminDb.updateProduct(productId, {
      name,
      description,
      categoryId,
      price: price !== undefined ? Number(price) : undefined,
      unit,
      stock: stock !== undefined ? Number(stock) : undefined,
      imageUrl,
      images,
      isActive,
    });

    eventsService.broadcast('PRODUCT_UPDATED', { action: 'UPDATED', product: updated });
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.delete('/products/:productId', async (req: Request, res: Response) => {
  try {
    const { productId } = req.params;
    await adminDb.deleteProduct(productId);
    eventsService.broadcast('PRODUCT_UPDATED', { action: 'DEACTIVATED', productId });
    res.json({ success: true, message: 'Product deactivated successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 5. ORDER MANAGEMENT & LIVE DELIVERY TRACKER
// -------------------------------------------------------------

adminRouter.get('/orders', async (req: Request, res: Response) => {
  try {
    const orders = await adminDb.listOrders();
    res.json({ success: true, data: orders });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.get('/orders/:orderId', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const order = await adminDb.getOrder(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    res.json({ success: true, data: order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.get('/deliveries/partners', async (req: Request, res: Response) => {
  try {
    const partners = await adminDb.listDeliveryPartners();
    res.json({ success: true, data: partners });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulated delivery acceptance (used for testing or admin manual dispatch)
adminRouter.post('/orders/:orderId/simulate-accept', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { deliveryPartnerId } = req.body || {};

    const order = await adminDb.simulateAcceptOrder(orderId, deliveryPartnerId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    eventsService.broadcast('DELIVERY_ACCEPTED', {
      orderId: order.orderId,
      deliveryPartner: order.deliveryPartner,
      status: order.deliveryStatus,
      items: order.items,
      message: `Delivery partner ${order.deliveryPartner?.name || 'Rider'} accepted order #${orderId}`,
    });

    res.json({ success: true, data: order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulated delivery progress step (ACCEPTED -> PICKED_UP -> OUT_FOR_DELIVERY -> DELIVERED)
adminRouter.post('/orders/:orderId/simulate-progress', async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const { status } = (req.body || {}) as { status: DeliveryStatus };

    if (!status) {
      return res.status(400).json({ success: false, error: 'Missing status parameter' });
    }

    const order = await adminDb.updateDeliveryProgress(orderId, status);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    eventsService.broadcast('DELIVERY_STATUS_UPDATED', {
      orderId: order.orderId,
      status: order.deliveryStatus,
      deliveryPartner: order.deliveryPartner,
      timeline: order.progressTimeline,
      message: `Order #${orderId} is now ${order.deliveryStatus.replace(/_/g, ' ')}`,
    });

    res.json({ success: true, data: order });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simulate incoming customer order (for testing real-time notification chime & alert)
adminRouter.post('/orders/simulate-customer-order', async (req: Request, res: Response) => {
  try {
    const merchantId = adminDb.getMerchantId();
    const products = await prisma.product.findMany({
      where: { merchantId, isActive: true },
      take: 2,
    });

    if (products.length === 0) {
      return res.status(400).json({ success: false, error: 'No products in catalog to place order' });
    }

    const customer = await prisma.user.findFirst({
      where: { role: 'CUSTOMER' },
      include: { addresses: true },
    });

    if (!customer) {
      return res.status(400).json({ success: false, error: 'No customer user found' });
    }

    const address = customer.addresses[0];
    const orderNum = Date.now().toString().slice(-5);
    const orderId = `ORD-ADM-${orderNum}`;

    let subtotal = 0;
    const orderItemsData = products.map((p) => {
      const lineTotal = p.price * 1;
      subtotal += lineTotal;
      return {
        productId: p.productId,
        productName: p.name,
        unitPrice: p.price,
        quantity: 1,
        totalPrice: lineTotal,
      };
    });

    const newOrder = await prisma.order.create({
      data: {
        orderId,
        merchantId,
        customerId: customer.userId,
        addressId: address?.addressId || 'ADDR-DEFAULT',
        status: 'PENDING',
        subtotal,
        discount: 0,
        deliveryFee: 0,
        tax: 0,
        total: subtotal,
        deliveryDate: new Date(),
        deliverySlotStartTime: '06:00',
        deliverySlotEndTime: '08:00',
        items: {
          create: orderItemsData,
        },
        delivery: {
          create: {
            merchantId,
            status: 'AVAILABLE',
          },
        },
      },
      include: {
        customer: true,
        items: true,
        delivery: true,
      },
    });

    const formatted = await adminDb.getOrder(orderId);

    // Broadcast SSE to all connected admin portals
    eventsService.broadcast('NEW_ORDER', {
      orderId,
      customerName: customer.name,
      total: subtotal,
      itemCount: products.length,
      items: products.map((p) => p.name),
      order: formatted,
    });

    res.json({ success: true, data: formatted });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 7. DAIRY PLANS / RECURRING SUBSCRIPTIONS MANAGEMENT
// -------------------------------------------------------------
adminRouter.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = await adminDb.listDairyPlans();
    res.json({ success: true, data: plans });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.get('/plans/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const plan = await adminDb.getDairyPlan(planId);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Dairy plan not found' });
    }
    res.json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

adminRouter.patch('/plans/:planId/status', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const { status } = req.body;
    if (!['ACTIVE', 'PAUSED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    const updated = await adminDb.updateDairyPlanStatus(planId, status);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
