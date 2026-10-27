import http from 'http';

export interface BackendConnectionStatus {
  targetUrl: string;
  isOnline: boolean;
  latencyMs: number;
  lastCheckedAt: string;
  merchantStoreId: string;
  system: {
    customerAppApi: boolean;
    deliveryAppApi: boolean;
    database: boolean;
  };
}

export class MainBackendService {
  private targetUrl: string;
  private isOnline: boolean = false;
  private latencyMs: number = 0;
  private lastCheckedAt: Date = new Date();
  private checkInterval: NodeJS.Timeout | null = null;
  private listeners: ((status: BackendConnectionStatus) => void)[] = [];

  constructor(targetUrl?: string) {
    this.targetUrl = targetUrl ? targetUrl.replace(/\/+$/, '') : '';
  }

  public getTargetUrl(): string {
    return (this.targetUrl || process.env.MAIN_BACKEND_URL || 'http://localhost:4000').replace(/\/+$/, '');
  }

  /**
   * Run immediate check on Admin Backend startup
   */
  async checkStartupConnection(): Promise<boolean> {
    const target = this.getTargetUrl();
    console.log(`\n=======================================================`);
    console.log(`[AdminBackend] Checking Main Customer & Delivery Backend...`);
    console.log(`[AdminBackend] Target: ${target}/api/v1/categories`);
    
    const startTime = Date.now();
    try {
      const response = await this.ping();
      this.latencyMs = Date.now() - startTime;
      this.isOnline = response.statusCode >= 200 && response.statusCode < 400;
      this.lastCheckedAt = new Date();

      if (this.isOnline) {
        console.log(`[AdminBackend] ✅ MAIN BACKEND IS ONLINE (${this.latencyMs}ms)`);
        console.log(`[AdminBackend] 🔗 Connection established: Customer, Delivery & Admin now synced.`);
      } else {
        console.log(`[AdminBackend] ⚠️ Main Backend returned status ${response.statusCode}`);
      }
    } catch (err: any) {
      this.isOnline = false;
      this.latencyMs = 0;
      this.lastCheckedAt = new Date();
      console.log(`[AdminBackend] ⚠️ MAIN BACKEND IS CURRENTLY OFFLINE (${err.message})`);
      console.log(`[AdminBackend] 🔄 Background watcher active: will auto-connect once main backend starts.`);
    }
    console.log(`=======================================================\n`);

    // Start background health polling every 5 seconds
    this.startPeriodicWatcher();

    return this.isOnline;
  }

  private startPeriodicWatcher() {
    if (this.checkInterval) return;
    this.checkInterval = setInterval(async () => {
      const prevStatus = this.isOnline;
      const startTime = Date.now();
      try {
        const response = await this.ping();
        this.latencyMs = Date.now() - startTime;
        this.isOnline = response.statusCode >= 200 && response.statusCode < 400;
      } catch {
        this.isOnline = false;
        this.latencyMs = 0;
      }
      this.lastCheckedAt = new Date();

      if (prevStatus !== this.isOnline) {
        if (this.isOnline) {
          console.log(`[AdminBackend] 🟢 Main Backend RECONNECTED! (${this.latencyMs}ms)`);
        } else {
          console.log(`[AdminBackend] 🔴 Main Backend connection lost. Retrying...`);
        }
        this.notifyListeners();
      }
    }, 5000);
  }

  private ping(): Promise<{ statusCode: number }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.getTargetUrl()}/api/v1/categories`);
      const req = http.get(url, { timeout: 3000 }, (res) => {
        resolve({ statusCode: res.statusCode || 500 });
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timed out'));
      });
    });
  }

  getStatus(): BackendConnectionStatus {
    return {
      targetUrl: this.getTargetUrl(),
      isOnline: this.isOnline,
      latencyMs: this.latencyMs,
      lastCheckedAt: this.lastCheckedAt.toISOString(),
      merchantStoreId: process.env.ADMIN_MERCHANT_ID || 'MR-100001',
      system: {
        customerAppApi: this.isOnline,
        deliveryAppApi: this.isOnline,
        database: true,
      },
    };
  }

  onStatusChange(cb: (status: BackendConnectionStatus) => void) {
    this.listeners.push(cb);
  }

  private notifyListeners() {
    const status = this.getStatus();
    this.listeners.forEach((fn) => fn(status));
  }
}

export const mainBackendService = new MainBackendService();
