declare module "@prisma/client" {
  class PrismaClient {
    constructor(options?: { log?: ("query" | "info" | "warn" | "error")[] });
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $on(event: string, callback: (event: any) => void): void;
    user: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
    };
    subscription: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
    };
    payment: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
      aggregate(args?: any): Promise<any>;
    };
    promocode: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
    };
    usedPromocode: {
      count(args?: any): Promise<number>;
      findMany(args?: any): Promise<any[]>;
      findUnique(args?: any): Promise<any | null>;
      create(args?: any): Promise<any>;
      update(args?: any): Promise<any>;
      delete(args?: any): Promise<any>;
    };
    $transaction<P extends Promise<any>[]>(args: [...P]): Promise<any>;
  }
  export { PrismaClient };
}

declare namespace Express {
  interface Request {
    user?: { userId: number; firstName: string; username?: string };
  }
}
