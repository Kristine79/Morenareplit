export {};

declare module "express" {
  interface Request {
    user?: { userId: number; firstName: string; username?: string };
  }
}

declare module "@prisma/client" {
  export interface Subscription {
    id: string;
    telegramUserId: bigint;
    vpnKey: string;
    tariffId: string;
    expiresAt: Date;
    createdAt: Date;
  }

  export interface User {
    id: bigint;
    username?: string | null;
    balance: number;
    referredById?: bigint | null;
    hasUsedTrial: boolean;
    lastActivityAt?: Date | null;
    createdAt: Date;
  }

  export interface Payment {
    id: string;
    telegramUserId: bigint;
    amount: number;
    tariffId: string;
    status: string;
    createdAt: Date;
  }

  export interface Promocode {
    id: string;
    bonusAmount: number;
    maxUses: number;
    usesCount: number;
  }

  class PrismaClient {
    constructor(options?: { log?: ("query" | "info" | "warn" | "error")[] });
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $on(event: string, callback: (event: any) => void): void;
    user: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      findFirst(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      updateMany(args?: any): Promise<any>;
      upsert(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      deleteMany(args?: any): Promise<any>;
    };
    subscription: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      findFirst(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      updateMany(args?: any): Promise<any>;
      upsert(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      deleteMany(args?: any): Promise<any>;
    };
    payment: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      findFirst(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      updateMany(args?: any): Promise<any>;
      upsert(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      deleteMany(args?: any): Promise<any>;
      aggregate(args?: any): Promise<any>;
    };
    promocode: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      findFirst(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      updateMany(args?: any): Promise<any>;
      upsert(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      deleteMany(args?: any): Promise<any>;
    };
    usedPromocode: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      findFirst(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      updateMany(args?: any): Promise<any>;
      upsert(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      deleteMany(args?: any): Promise<any>;
    };
    $transaction<P extends Promise<any>[]>(args: [...P]): Promise<any>;
    $transaction<T>(fn: (prisma: PrismaClient) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
  }
  export { PrismaClient };
}
