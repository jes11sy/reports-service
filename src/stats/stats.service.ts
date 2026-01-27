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

  // Лимиты из конфигурации
  private readonly DEFAULT_LIMIT: number;

  // ✅ FIX: TTL кеширования для разных типов запросов
  private readonly CACHE_TTL = {
    OPERATOR: 60000,    // 1 минута для статистики оператора
    OVERALL: 120000,    // 2 минуты для общей статистики
    DASHBOARD: 30000,   // 30 секунд для дашборда (часто обновляется)
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.DEFAULT_LIMIT = this.configService.get<number>('STATS_DEFAULT_LIMIT', 1000);
  }

  /**
   * ✅ Ключ кеша
   */
  private buildCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `stats:${prefix}:${sortedParams || 'all'}`;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Получить статистику оператора с кешированием
   */
  async getOperatorStats(operatorId: number, startDate?: string, endDate?: string) {
    const startTime = Date.now();

    // ✅ Проверяем кеш
    const cacheKey = this.buildCacheKey('operator', { operatorId, startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOperatorStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    // Проверяем существование оператора
    const operator = await this.prisma.callcentreOperator.findUnique({
      where: { id: operatorId },
      select: {
        id: true,
        name: true,
        city: true,
        statusWork: true,
      },
    });

    if (!operator) {
      throw new NotFoundException('Оператор не найден');
    }

    // Парсинг дат
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date();

    const callWhere = {
      operatorId,
      dateCreate: {
        gte: start,
        lte: end,
      },
    };

    const orderWhere = {
      operatorNameId: operatorId,
      createDate: {
        gte: start,
        lte: end,
      },
    };

    // groupBy запросы вынесены из $transaction из-за ограничений типизации Prisma
    const [
      callsStats,
      ordersByStatus,
      dailyStats,
      cityStats,
      rkStats,
    ] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['status'],
        where: callWhere,
        _count: { id: true },
      }),
      this.prisma.order.groupBy({
        by: ['statusOrder'],
        where: orderWhere,
        _count: { id: true },
      }),
      this.prisma.call.groupBy({
        by: ['dateCreate'],
        where: {
          operatorId,
          status: CallStatus.ANSWERED,
          dateCreate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            lte: end,
          },
        },
        _count: { id: true },
        orderBy: { dateCreate: 'asc' },
      }),
      this.prisma.call.groupBy({
        by: ['city'],
        where: {
          ...callWhere,
          status: CallStatus.ANSWERED,
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['rk'],
        where: {
          ...callWhere,
          status: CallStatus.ANSWERED,
        },
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

    const acceptedCalls = callsStats
      .filter(stat => stat.status === CallStatus.ANSWERED)
      .reduce((sum, stat) => sum + stat._count.id, 0);
    
    const missedCalls = callsStats
      .filter(stat => MISSED_CALL_STATUSES.includes(stat.status as any))
      .reduce((sum, stat) => sum + stat._count.id, 0);
    
    const totalCalls = acceptedCalls + missedCalls;

    const dailyStatsFormatted = dailyStats.map(stat => ({
      date: stat.dateCreate.toISOString().split('T')[0],
      calls: stat._count?.id || 0,
    }));

    const completedOrders = ordersByStatus.find(s => s.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
    const revenueSum = totalRevenue._sum.result ? Number(totalRevenue._sum.result) : 0;

    const response = {
      operator: {
        id: operator.id,
        name: operator.name,
        city: operator.city,
        statusWork: operator.statusWork,
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
        byStatus: ordersByStatus.reduce((acc, item) => {
          acc[item.statusOrder] = item._count.id;
          return acc;
        }, {} as Record<string, number>),
      },
      dailyStats: dailyStatsFormatted,
      cityStats: cityStats.map(stat => ({
        city: stat.city || 'Не указан',
        calls: stat._count?.id || 0,
      })),
      rkStats: rkStats.map(stat => ({
        rk: stat.rk || 'Не указан',
        calls: stat._count?.id || 0,
      })),
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getOperatorStats completed in ${duration}ms`, {
      operatorId,
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    // ✅ Кешируем результат
    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.OPERATOR);

    return response;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Получить общую статистику с кешированием
   */
  async getOverallStats(startDate?: string, endDate?: string) {
    const startTime = Date.now();

    // ✅ Проверяем кеш
    const cacheKey = this.buildCacheKey('overall', { startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOverallStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate + 'T23:59:59.999Z') : new Date();

    const callWhere = {
      dateCreate: {
        gte: start,
        lte: end,
      },
    };

    const orderWhere = {
      createDate: {
        gte: start,
        lte: end,
      },
    };

    // groupBy запросы вынесены из $transaction из-за ограничений типизации Prisma
    const [operatorStats, cityStats, rkStats] = await Promise.all([
      this.prisma.call.groupBy({
        by: ['operatorId'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['city'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.call.groupBy({
        by: ['rk'],
        where: callWhere,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    const [totalCalls, acceptedCalls, missedCalls, totalOrders] = await Promise.all([
      this.prisma.call.count({ where: callWhere }),
      this.prisma.call.count({
        where: { ...callWhere, status: CallStatus.ANSWERED },
      }),
      this.prisma.call.count({
        where: {
          ...callWhere,
          status: { in: MISSED_CALL_STATUSES },
        },
      }),
      this.prisma.order.count({ where: orderWhere }),
    ]);

    // Получаем имена операторов
    const operatorIds = operatorStats.map(stat => stat.operatorId);
    const operators = await this.prisma.callcentreOperator.findMany({
      where: { id: { in: operatorIds } },
      select: { id: true, name: true },
    });

    const operatorMap = operators.reduce((acc, op) => {
      acc[op.id] = op.name;
      return acc;
    }, {} as Record<number, string>);

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
      orders: {
        total: totalOrders,
      },
      operatorStats: operatorStats.map(stat => ({
        operatorName: operatorMap[stat.operatorId] || 'Не указан',
        calls: stat._count?.id || 0,
      })),
      cityStats: cityStats.map(stat => ({
        city: stat.city || 'Не указан',
        calls: stat._count?.id || 0,
      })),
      rkStats: rkStats.map(stat => ({
        rk: stat.rk || 'Не указан',
        calls: stat._count?.id || 0,
      })),
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getOverallStats completed in ${duration}ms`, {
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    // ✅ Кешируем результат
    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.OVERALL);

    return response;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Статистика для дашборда с кешированием
   */
  async getDashboardStats() {
    const startTime = Date.now();

    // ✅ Проверяем кеш
    const cacheKey = 'stats:dashboard:current-month';
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getDashboardStats from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    // Определяем границы текущего месяца
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // ✅ Транзакция для согласованности
    const [
      callCenterEmployees,
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
      // Сотрудники
      this.prisma.callcentreOperator.count({
        where: { status: 'active' }
      }),
      this.prisma.director.count(),
      this.prisma.master.count({
        where: { statusWork: 'работает' }
      }),
      // Заказы
      this.prisma.order.count({
        where: { createDate: { gte: startOfMonth, lte: endOfMonth } }
      }),
      this.prisma.order.count({
        where: {
          createDate: { gte: startOfMonth, lte: endOfMonth },
          statusOrder: OrderStatus.NOT_ORDER
        }
      }),
      this.prisma.order.count({
        where: {
          createDate: { gte: startOfMonth, lte: endOfMonth },
          statusOrder: OrderStatus.CANCELLED
        }
      }),
      this.prisma.order.count({
        where: {
          createDate: { gte: startOfMonth, lte: endOfMonth },
          statusOrder: { in: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
          result: { gt: 0 }
        }
      }),
      // Оборот
      this.prisma.order.aggregate({
        where: {
          statusOrder: OrderStatus.COMPLETED,
          clean: { not: null },
          closingData: { gte: startOfMonth, lte: endOfMonth }
        },
        _sum: { clean: true }
      }),
      // Касса - приход
      this.prisma.cash.aggregate({
        where: {
          name: CashOperationType.INCOME,
          dateCreate: { gte: startOfMonth, lte: endOfMonth }
        },
        _sum: { amount: true }
      }),
      // Касса - расход
      this.prisma.cash.aggregate({
        where: {
          name: CashOperationType.EXPENSE,
          dateCreate: { gte: startOfMonth, lte: endOfMonth }
        },
        _sum: { amount: true }
      }),
    ]);

    const revenue = revenueSum._sum.clean ? Number(revenueSum._sum.clean) : 0;
    const profit = incomeSum._sum.amount ? Number(incomeSum._sum.amount) : 0;
    const expenses = expenseSum._sum.amount ? Number(expenseSum._sum.amount) : 0;

    const response = {
      employees: {
        callCenter: callCenterEmployees,
        directors: directors,
        masters: masters
      },
      orders: orders,
      notOrders: notOrders,
      cancellations: cancellations,
      completedInMoney: completedInMoney,
      finance: {
        revenue: Math.round(revenue),
        profit: Math.round(profit),
        expenses: Math.round(expenses)
      }
    };

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getDashboardStats completed in ${duration}ms`, {
      period: `${startOfMonth.toISOString()} - ${endOfMonth.toISOString()}`,
      employees: response.employees,
      orders: response.orders,
      finance: response.finance
    });

    // ✅ Кешируем результат (короткий TTL для дашборда)
    await this.cacheManager.set(cacheKey, response, this.CACHE_TTL.DASHBOARD);

    return response;
  }
}
