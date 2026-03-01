import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderStatus,
  CallStatus,
  CashOperationType,
  MISSED_CALL_STATUSES,
} from '../common/constants/order-statuses';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  private readonly DEFAULT_LIMIT: number;

  private readonly CACHE_TTL = {
    OPERATOR: 60000,
    OVERALL: 120000,
    DASHBOARD: 30000,
  };

  // Cache for status code → ID mapping
  private statusCodeToId: Map<string, number> = new Map();
  private statusCacheExpiry = 0;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.DEFAULT_LIMIT = this.configService.get<number>('STATS_DEFAULT_LIMIT', 1000);
  }

  private buildCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `stats:${prefix}:${sortedParams || 'all'}`;
  }

  private async getStatusId(code: string): Promise<number | undefined> {
    const now = Date.now();
    if (this.statusCacheExpiry < now || this.statusCodeToId.size === 0) {
      try {
        const statuses = await this.prisma.$queryRaw<{ id: number; code: string }[]>`
          SELECT id, code FROM references_service.order_statuses
        `;
        this.statusCodeToId = new Map(statuses.map(s => [s.code, s.id]));
        this.statusCacheExpiry = now + 5 * 60 * 1000; // 5 min
      } catch (err) {
        this.logger.error('Failed to load status IDs', err);
      }
    }
    return this.statusCodeToId.get(code);
  }

  private async getStatusIds(codes: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const code of codes) {
      const id = await this.getStatusId(code);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }

  async getOperatorStats(operatorId: number, startDate?: string, endDate?: string) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('operator', { operatorId, startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOperatorStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const operator = await this.prisma.operator.findUnique({
      where: { id: operatorId },
      select: {
        id: true,
        name: true,
        cityIds: true,
        status: true,
      },
    });

    if (!operator) {
      throw new NotFoundException('Оператор не найден');
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date();

    const callWhere = {
      operatorId,
      createdAt: { gte: start, lte: end },
    };

    const orderWhere = {
      operatorId,
      createdAt: { gte: start, lte: end },
    };

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);
    const completedStatusIds = completedStatusId ? [completedStatusId] : [];

    const [callsStats, ordersByStatus, dailyStats, cityStats, rkStats] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['status'],
        where: callWhere,
        _count: { id: true },
      }),
      this.prisma.order.groupBy({
        by: ['statusId'],
        where: orderWhere,
        _count: { id: true },
      }),
      this.prisma.call.groupBy({
        by: ['createdAt'],
        where: {
          operatorId,
          status: CallStatus.ANSWERED,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            lte: end,
          },
        },
        _count: { id: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.call.groupBy({
        by: ['cityId'],
        where: { ...callWhere, status: CallStatus.ANSWERED },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['rkId'],
        where: { ...callWhere, status: CallStatus.ANSWERED },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    const [avgCallDuration, ordersStats, totalRevenue] = await Promise.all([
      this.prisma.call.aggregate({
        where: { ...callWhere, duration: { not: null } },
        _avg: { duration: true },
      }),
      this.prisma.order.aggregate({
        where: orderWhere,
        _count: { id: true },
      }),
      this.prisma.order.aggregate({
        where: { ...orderWhere, result: { not: null } },
        _sum: { result: true },
      }),
    ]);

    // Lookup city names
    const cityIds = cityStats.map(s => s.cityId);
    const rkIds = rkStats.map(s => s.rkId);
    const [cities, rks] = await Promise.all([
      cityIds.length > 0 ? this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      rkIds.length > 0 ? this.prisma.rk.findMany({ where: { id: { in: rkIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const cityNameMap = new Map(cities.map(c => [c.id, c.name]));
    const rkNameMap = new Map(rks.map(r => [r.id, r.name]));

    const acceptedCalls = callsStats
      .filter(stat => stat.status === CallStatus.ANSWERED)
      .reduce((sum, stat) => sum + stat._count.id, 0);

    const missedCalls = callsStats
      .filter(stat => MISSED_CALL_STATUSES.includes(stat.status as any))
      .reduce((sum, stat) => sum + stat._count.id, 0);

    const totalCalls = acceptedCalls + missedCalls;

    const completedOrders = completedStatusIds.length > 0
      ? ordersByStatus.filter(s => completedStatusIds.includes(s.statusId)).reduce((sum, s) => sum + s._count.id, 0)
      : 0;

    const revenueSum = totalRevenue._sum.result ? Number(totalRevenue._sum.result) : 0;

    const response = {
      operator: {
        id: operator.id,
        name: operator.name,
        cityIds: operator.cityIds,
        status: operator.status,
      },
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      calls: {
        total: totalCalls,
        accepted: acceptedCalls,
        missed: missedCalls,
        acceptanceRate: totalCalls > 0 ? Math.round((acceptedCalls / totalCalls) * 100) : 0,
        avgDuration: Math.round(avgCallDuration._avg.duration || 0),
      },
      orders: {
        total: ordersStats._count.id,
        completed: completedOrders,
        byStatusId: ordersByStatus.reduce((acc, item) => {
          acc[item.statusId] = item._count.id;
          return acc;
        }, {} as Record<number, number>),
      },
      dailyStats: (dailyStats as any[]).map(stat => ({
        date: new Date(stat.createdAt).toISOString().split('T')[0],
        calls: stat._count?.id || 0,
      })),
      cityStats: cityStats.map(stat => ({
        cityId: stat.cityId,
        cityName: cityNameMap.get(stat.cityId) || String(stat.cityId),
        calls: stat._count?.id || 0,
      })),
      rkStats: rkStats.map(stat => ({
        rkId: stat.rkId,
        rkName: rkNameMap.get(stat.rkId) || String(stat.rkId),
        calls: stat._count?.id || 0,
      })),
      revenue: revenueSum,
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getOperatorStats completed in ${duration}ms`, {
      operatorId,
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.OPERATOR);

    return response;
  }

  async getOverallStats(startDate?: string, endDate?: string) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('overall', { startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOverallStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date();

    const callWhere = { createdAt: { gte: start, lte: end } };
    const orderWhere = { createdAt: { gte: start, lte: end } };

    const [operatorStats, cityStats, rkStats] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['operatorId'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['cityId'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['rkId'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    const [totalCalls, acceptedCalls, missedCalls, totalOrders] = await Promise.all([
      this.prisma.call.count({ where: callWhere }),
      this.prisma.call.count({ where: { ...callWhere, status: CallStatus.ANSWERED } }),
      this.prisma.call.count({ where: { ...callWhere, status: { in: MISSED_CALL_STATUSES } } }),
      this.prisma.order.count({ where: orderWhere }),
    ]);

    const operatorIds = operatorStats.map(stat => stat.operatorId);
    const operators = await this.prisma.operator.findMany({
      where: { id: { in: operatorIds } },
      select: { id: true, name: true },
    });
    const operatorMap = new Map(operators.map(op => [op.id, op.name]));

    const cityIds = cityStats.map(s => s.cityId);
    const rkIds = rkStats.map(s => s.rkId);
    const [cities, rks] = await Promise.all([
      cityIds.length > 0 ? this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      rkIds.length > 0 ? this.prisma.rk.findMany({ where: { id: { in: rkIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const cityNameMap = new Map(cities.map(c => [c.id, c.name]));
    const rkNameMap = new Map(rks.map(r => [r.id, r.name]));

    const response = {
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      calls: {
        total: totalCalls,
        accepted: acceptedCalls,
        missed: missedCalls,
        acceptanceRate: totalCalls > 0 ? Math.round((acceptedCalls / totalCalls) * 100) : 0,
      },
      orders: { total: totalOrders },
      operatorStats: operatorStats.map(stat => ({
        operatorName: operatorMap.get(stat.operatorId) || 'Не указан',
        calls: stat._count?.id || 0,
      })),
      cityStats: cityStats.map(stat => ({
        cityId: stat.cityId,
        cityName: cityNameMap.get(stat.cityId) || String(stat.cityId),
        calls: stat._count?.id || 0,
      })),
      rkStats: rkStats.map(stat => ({
        rkId: stat.rkId,
        rkName: rkNameMap.get(stat.rkId) || String(stat.rkId),
        calls: stat._count?.id || 0,
      })),
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getOverallStats completed in ${duration}ms`, {
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.OVERALL);

    return response;
  }

  async getDashboardStats() {
    const startTime = Date.now();

    const cacheKey = 'stats:dashboard:current-month';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getDashboardStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [completedStatusId, cancelledStatusId, notOrderStatusId] = await Promise.all([
      this.getStatusId(OrderStatus.COMPLETED),
      this.getStatusId(OrderStatus.CANCELLED),
      this.getStatusId(OrderStatus.NOT_ORDER),
    ]);

    const [
      operatorCount,
      directors,
      masters,
      orders,
      notOrders,
      cancellations,
      completedInMoney,
      revenueSum,
      incomeSum,
      expenseSum,
    ] = await this.prisma.$transaction([
      this.prisma.operator.count({ where: { status: 'active' } }),
      this.prisma.director.count(),
      this.prisma.master.count({ where: { status: 'active' } }),
      this.prisma.order.count({
        where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          ...(notOrderStatusId ? { statusId: notOrderStatusId } : {}),
        },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          ...(cancelledStatusId ? { statusId: cancelledStatusId } : {}),
        },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: startOfMonth, lte: endOfMonth },
          ...(completedStatusId || cancelledStatusId
            ? { statusId: { in: [completedStatusId, cancelledStatusId].filter(Boolean) as number[] } }
            : {}),
          result: { gt: 0 },
        },
      }),
      this.prisma.order.aggregate({
        where: {
          ...(completedStatusId ? { statusId: completedStatusId } : {}),
          clean: { not: null },
          closingAt: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { clean: true },
      }),
      this.prisma.cash.aggregate({
        where: {
          type: CashOperationType.INCOME,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.cash.aggregate({
        where: {
          type: CashOperationType.EXPENSE,
          createdAt: { gte: startOfMonth, lte: endOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);

    const revenue = revenueSum._sum.clean ? Number(revenueSum._sum.clean) : 0;
    const profit = incomeSum._sum.amount ? Number(incomeSum._sum.amount) : 0;
    const expenses = expenseSum._sum.amount ? Number(expenseSum._sum.amount) : 0;

    const response = {
      employees: {
        operators: operatorCount,
        directors,
        masters,
      },
      orders,
      notOrders,
      cancellations,
      completedInMoney,
      finance: {
        revenue: Math.round(revenue),
        profit: Math.round(profit),
        expenses: Math.round(expenses),
      },
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getDashboardStats completed in ${duration}ms`, {
      period: `${startOfMonth.toISOString()} - ${endOfMonth.toISOString()}`,
      employees: response.employees,
      orders: response.orders,
      finance: response.finance,
    });

    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.DASHBOARD);

    return response;
  }
}
