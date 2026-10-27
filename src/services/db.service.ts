import { PrismaClient, OrderStatus, DeliveryStatus } from '@prisma/client';

export const prisma = new PrismaClient();

export interface DeliveryPartnerProfile {
  deliveryPartnerId: string;
  name: string;
  phone: string | null;
  email: string;
  vehicleType: string | null;
  vehicleNumber: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: Date | null;
  isAvailable: boolean;
  rating: number;
}

export class AdminDbService {
  private merchantId: string;

  constructor() {
    this.merchantId = process.env.ADMIN_MERCHANT_ID || 'MR-100001';
  }

  getMerchantId() {
    return this.merchantId;
  }

  async getMerchantDetails() {
    return prisma.merchant.findUnique({
      where: { merchantId: this.merchantId },
      include: {
        user: { select: { name: true, email: true, phone: true } },
      },
    });
  }

  // --- PRODUCTS ---

  async listProducts() {
    return prisma.product.findMany({
      where: { merchantId: this.merchantId, isActive: true },
      include: {
        category: true,
        inventory: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProduct(productId: string) {
    return prisma.product.findFirst({
      where: { productId, merchantId: this.merchantId },
      include: { category: true, inventory: true },
    });
  }

  async createProduct(data: {
    name: string;
    description: string;
    categoryId: string;
    price: number;
    unit: string;
    quantityValue?: number;
    initialStock?: number;
    imageUrl?: string;
    images?: string[];
  }) {
    const nextNum = Date.now().toString().slice(-6);
    const productId = `PRD-ADM-${nextNum}`;

    return prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          productId,
          merchantId: this.merchantId,
          categoryId: data.categoryId,
          name: data.name,
          description: data.description || '',
          price: data.price,
          unit: data.unit || 'PACKET',
          quantityValue: data.quantityValue || 1,
          imageUrl: data.imageUrl || (data.images && data.images[0]) || null,
          images: data.images || (data.imageUrl ? [data.imageUrl] : []),
          subscriptionAllowed: true,
          availableSchedules: ['DAILY', 'SELECTED_DAYS', 'WEEKLY'],
          isActive: true,
        },
        include: {
          category: true,
        },
      });

      await tx.inventory.create({
        data: {
          merchantId: this.merchantId,
          productId: product.productId,
          availableQuantity: data.initialStock ?? 50,
          reservedQuantity: 0,
          stockStatus: (data.initialStock ?? 50) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        },
      });

      return product;
    });
  }

  async updateProduct(
    productId: string,
    data: {
      name?: string;
      description?: string;
      categoryId?: string;
      price?: number;
      unit?: string;
      stock?: number;
      imageUrl?: string;
      images?: string[];
      isActive?: boolean;
    },
  ) {
    return prisma.$transaction(async (tx) => {
      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.categoryId !== undefined) updateData.categoryId = data.categoryId;
      if (data.price !== undefined) updateData.price = data.price;
      if (data.unit !== undefined) updateData.unit = data.unit;
      if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
      if (data.images !== undefined) updateData.images = data.images;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      const updated = await tx.product.update({
        where: { productId },
        data: updateData,
        include: { category: true, inventory: true },
      });

      if (data.stock !== undefined) {
        await tx.inventory.upsert({
          where: { productId },
          update: {
            availableQuantity: data.stock,
            stockStatus: data.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
          },
          create: {
            merchantId: this.merchantId,
            productId,
            availableQuantity: data.stock,
            stockStatus: data.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
          },
        });
      }

      return updated;
    });
  }

  async deleteProduct(productId: string) {
    return prisma.product.update({
      where: { productId },
      data: { isActive: false },
    });
  }

  async listCategories() {
    return prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  // --- ORDERS & DELIVERIES (SCOPED TO ADMIN'S PRODUCTS ONLY) ---

  async listOrders() {
    // Return orders that belong to this merchant
    const orders = await prisma.order.findMany({
      where: { merchantId: this.merchantId },
      include: {
        customer: { select: { userId: true, name: true, phone: true, email: true } },
        address: true,
        items: {
          include: {
            product: { select: { productId: true, name: true, imageUrl: true, images: true, unit: true } },
          },
        },
        delivery: {
          include: {
            deliveryPartner: {
              include: {
                user: { select: { name: true, phone: true, email: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return orders.map((o) => this.formatOrderWithDelivery(o));
  }

  async getOrder(orderId: string) {
    const o = await prisma.order.findFirst({
      where: { orderId, merchantId: this.merchantId },
      include: {
        customer: { select: { userId: true, name: true, phone: true, email: true } },
        address: true,
        items: {
          include: {
            product: { select: { productId: true, name: true, imageUrl: true, images: true, unit: true } },
          },
        },
        delivery: {
          include: {
            deliveryPartner: {
              include: {
                user: { select: { name: true, phone: true, email: true } },
              },
            },
          },
        },
      },
    });

    return o ? this.formatOrderWithDelivery(o) : null;
  }

  private formatOrderWithDelivery(o: any) {
    const partner = o.delivery?.deliveryPartner;
    const partnerProfile: DeliveryPartnerProfile | null = partner
      ? {
          deliveryPartnerId: partner.deliveryPartnerId,
          name: partner.user?.name || 'Rider Partner',
          phone: partner.user?.phone || null,
          email: partner.user?.email || '',
          vehicleType: partner.vehicleType || 'Motorcycle',
          vehicleNumber: partner.vehicleNumber || 'KA-01-AB-1234',
          currentLatitude: partner.currentLatitude ?? 16.5062,
          currentLongitude: partner.currentLongitude ?? 80.648,
          lastLocationAt: partner.lastLocationAt,
          isAvailable: partner.isAvailable,
          rating: 4.9,
        }
      : null;

    // Delivery progress steps
    const status = o.delivery?.status || 'AVAILABLE';
    const progressTimeline = [
      { step: 'ORDER_PLACED', label: 'Order Placed', completed: true, timestamp: o.createdAt },
      {
        step: 'ACCEPTED',
        label: 'Accepted by Partner',
        completed: ['ACCEPTED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status),
        timestamp: o.delivery?.acceptedAt,
      },
      {
        step: 'PICKED_UP',
        label: 'Order Picked Up',
        completed: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(status),
        timestamp: o.delivery?.pickedUpAt,
      },
      {
        step: 'OUT_FOR_DELIVERY',
        label: 'Out for Delivery',
        completed: ['OUT_FOR_DELIVERY', 'DELIVERED'].includes(status),
        timestamp: o.delivery?.pickedUpAt,
      },
      {
        step: 'DELIVERED',
        label: 'Delivered to Customer',
        completed: status === 'DELIVERED',
        timestamp: o.delivery?.deliveredAt,
      },
    ];

    return {
      orderId: o.orderId,
      merchantId: o.merchantId,
      customer: {
        name: o.customer?.name || 'Customer',
        phone: o.customer?.phone || null,
        email: o.customer?.email || '',
      },
      address: o.address
        ? `${o.address.title || 'Address'}: ${o.address.addressLine1}, ${o.address.city}`
        : 'Saved Delivery Address',
      status: o.status,
      deliveryStatus: status,
      total: o.total,
      subtotal: o.subtotal,
      discount: o.discount,
      deliverySlot: `${o.deliverySlotStartTime || '06:00'} - ${o.deliverySlotEndTime || '08:00'}`,
      deliveryDate: o.deliveryDate,
      createdAt: o.createdAt,
      items: o.items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        unit: it.product?.unit || 'Pack',
        imageUrl: it.product?.imageUrl || null,
        images: it.product?.images || [],
      })),
      deliveryPartner: partnerProfile,
      progressTimeline,
    };
  }

  // --- DELIVERY PARTNERS ---

  async listDeliveryPartners() {
    return prisma.deliveryPartner.findMany({
      where: { merchantId: this.merchantId, isActive: true },
      include: {
        user: { select: { name: true, phone: true, email: true } },
      },
    });
  }

  // --- SIMULATION / TESTING HELPERS FOR USER EXPERIENCE ---

  async simulateAcceptOrder(orderId: string, deliveryPartnerId?: string) {
    let partnerId = deliveryPartnerId;
    if (!partnerId) {
      const defaultPartner = await prisma.deliveryPartner.findFirst({
        where: { merchantId: this.merchantId },
      });
      partnerId = defaultPartner?.deliveryPartnerId || 'DEL-100001';
    }

    const updated = await prisma.delivery.update({
      where: { orderId },
      data: {
        deliveryPartnerId: partnerId,
        status: DeliveryStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
      include: {
        order: true,
        deliveryPartner: { include: { user: true } },
      },
    });

    await prisma.order.update({
      where: { orderId },
      data: { status: OrderStatus.READY },
    });

    return this.getOrder(orderId);
  }

  async updateDeliveryProgress(orderId: string, status: DeliveryStatus) {
    const updateData: any = { status };
    if (status === DeliveryStatus.PICKED_UP) updateData.pickedUpAt = new Date();
    if (status === DeliveryStatus.DELIVERED) updateData.deliveredAt = new Date();

    await prisma.delivery.update({
      where: { orderId },
      data: updateData,
    });

    if (status === DeliveryStatus.OUT_FOR_DELIVERY) {
      await prisma.order.update({
        where: { orderId },
        data: { status: OrderStatus.OUT_FOR_DELIVERY },
      });
    } else if (status === DeliveryStatus.DELIVERED) {
      await prisma.order.update({
        where: { orderId },
        data: { status: OrderStatus.DELIVERED },
      });
    }

    return this.getOrder(orderId);
  }

  // --- DAIRY PLANS / RECURRING SUBSCRIPTIONS ---

  async listDairyPlans() {
    const plans = await prisma.dairyPlan.findMany({
      where: { merchantId: this.merchantId },
      include: {
        customer: { select: { userId: true, name: true, phone: true, email: true } },
        address: true,
        items: {
          include: {
            product: {
              select: {
                productId: true,
                name: true,
                unit: true,
                price: true,
                imageUrl: true,
                images: true,
              },
            },
          },
        },
        actions: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return plans.map((p) => ({
      planId: p.planId,
      merchantId: p.merchantId,
      customerId: p.customerId,
      customerName: p.customer.name,
      customerPhone: p.customer.phone || 'Phone verified',
      customerEmail: p.customer.email,
      address: p.address
        ? `${p.address.addressLine1}, ${p.address.addressLine2 || ''} ${p.address.city} - ${p.address.postalCode}`.trim()
        : 'Store Address',
      status: p.status,
      frequency: p.frequency,
      selectedDays: p.selectedDays,
      startDate: p.startDate,
      endDate: p.endDate,
      createdAt: p.createdAt,
      items: p.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product?.name || 'Dairy Product',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        unit: i.product?.unit || 'Pack',
        imageUrl: i.product?.imageUrl || null,
      })),
      totalDailyCost: p.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      actionsCount: p.actions.length,
      latestAction: p.actions[0] || null,
    }));
  }

  async getDairyPlan(planId: string) {
    const p = await prisma.dairyPlan.findFirst({
      where: { planId, merchantId: this.merchantId },
      include: {
        customer: { select: { userId: true, name: true, phone: true, email: true } },
        address: true,
        items: {
          include: { product: true },
        },
        actions: {
          orderBy: { createdAt: 'desc' },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!p) return null;

    return {
      planId: p.planId,
      merchantId: p.merchantId,
      customerId: p.customerId,
      customerName: p.customer.name,
      customerPhone: p.customer.phone,
      customerEmail: p.customer.email,
      address: p.address
        ? `${p.address.addressLine1}, ${p.address.addressLine2 || ''} ${p.address.city} - ${p.address.postalCode}`.trim()
        : 'Store Address',
      status: p.status,
      frequency: p.frequency,
      selectedDays: p.selectedDays,
      startDate: p.startDate,
      endDate: p.endDate,
      pausedAt: p.pausedAt,
      resumedAt: p.resumedAt,
      cancelledAt: p.cancelledAt,
      createdAt: p.createdAt,
      items: p.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.product?.name || 'Dairy Product',
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        unit: i.product?.unit || 'Pack',
        imageUrl: i.product?.imageUrl || null,
      })),
      actions: p.actions,
      orders: p.orders,
      totalDailyCost: p.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    };
  }

  async updateDairyPlanStatus(planId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    const updateData: any = { status };
    if (status === 'PAUSED') updateData.pausedAt = new Date();
    if (status === 'ACTIVE') updateData.resumedAt = new Date();
    if (status === 'CANCELLED') updateData.cancelledAt = new Date();

    await prisma.dairyPlan.update({
      where: { planId },
      data: updateData,
    });

    return this.getDairyPlan(planId);
  }
}

export const adminDb = new AdminDbService();
