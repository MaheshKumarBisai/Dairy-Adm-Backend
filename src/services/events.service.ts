import { Response } from 'express';

export interface AdminEvent {
  id: string;
  type: 'NEW_ORDER' | 'DELIVERY_ACCEPTED' | 'DELIVERY_STATUS_UPDATED' | 'PRODUCT_UPDATED' | 'BACKEND_STATUS';
  timestamp: string;
  data: any;
}

export class EventsService {
  private clients: Set<Response> = new Set();
  private eventHistory: AdminEvent[] = [];

  addClient(res: Response) {
    this.clients.add(res);

    // Initial keepalive comment
    res.write(`: connected\n\n`);

    // Send recent events
    if (this.eventHistory.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'SYNC_HISTORY', events: this.eventHistory.slice(-5) })}\n\n`);
    }

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  broadcast(type: AdminEvent['type'], data: any) {
    const event: AdminEvent = {
      id: `evt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    this.eventHistory.push(event);
    if (this.eventHistory.length > 50) {
      this.eventHistory.shift();
    }

    const payload = `data: ${JSON.stringify(event)}\n\n`;

    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  getActiveClientCount(): number {
    return this.clients.size;
  }
}

export const eventsService = new EventsService();
