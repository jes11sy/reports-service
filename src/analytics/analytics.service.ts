import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderStatus,
  CallStatus,
  IN_PROGRESS_STATUSES,
  WorkStatus,
} from '../common/constants/order-statuses';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  // Лимиты из конфигурации
  private readonly DEFAULT_LIMIT: number;
  private readonly MAX_LIMIT: number;

  // TTL кеша из конфигурации
  private readonly CACHE_TTL: {
    DASHBOARD: number;
    OPERATORS: number;
    CITY: number;
    CAMPAIGN: number;
    DAILY: number;
  };

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.DEFAULT_LIMIT = this.configService.get<number>('ANALYTICS_DEFAULT_LIMIT', 1000);
    this.MAX_LIMIT = this.configService.get<number>('ANALYTICS_MAX_LIMIT', 5000);
    
    this.CACHE_TTL = {
      DASHBOARD: this.configService.get<number>('CACHE_TTL_DASHBOARD', 30000),
      OPERATORS: this.configService.get<number>('CACHE_TTL_OPERATORS', 120000),
      CITY: this.configService.get<number>('CACHE_TTL_CITY', 300000),
      CAMPAIGN: this.configService.get<number>('CACHE_TTL_CAMPAIGN', 300000),
      DAILY: this.configService.get<number>('CACHE_TTL_DAILY', 600000),
    };
  }

  /**
   * ✅ Улучшенный ключ кеша с версионированием
   */
  private buildCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `v2:${prefix}:${sortedParams || 'all'}`;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Статистика операторов
   */
  async getOperatorStatistics(startDate?: string, endDate?: string, operatorId?: number) {
    const startTime = Date.now();

    // Проверяем кеш
    const cacheKey = this.buildCacheKey('operator-stats', { operatorId, startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOperatorStatistics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    // Фильтры по дате
    const callDateFilter: any = {};
    const orderDateFilter: any = {};
    
    if (startDate || endDate) {
      callDateFilter.createdAt = {};
      orderDateFilter.createDate = {};
      if (startDate) {
        callDateFilter.createdAt.gte = new Date(startDate);
        orderDateFilter.createDate.gte = new Date(startDate);
      }
      if (endDate) {
        callDateFilter.createdAt.lte = new Date(endDate);
        orderDateFilter.createDate.lte = new Date(endDate);
      }
    }

    // 1. Получаем список операторов (1 запрос)
    const operators = await this.prisma.callcentreOperator.findMany({
      where: operatorId ? { id: operatorId } : {},
      select: {
        id: true,
        name: true,
        login: true,
        statusWork: true,
      },
    });

    // 2. Группированная статистика по звонкам
    const callStats = await this.prisma.call.groupBy({
      by: ['operatorId', 'status'],
      where: {
        ...(operatorId && { operatorId }),
        ...callDateFilter,
      },
      _count: { id: true },
      _avg: { duration: true },
    });

    // 3. Группированная статистика по заказам
    const orderStats = await this.prisma.order.groupBy({
      by: ['operatorNameId', 'statusOrder'],
      where: {
        ...(operatorId && { operatorNameId: operatorId }),
        ...orderDateFilter,
      },
      _count: { id: true },
      _sum: { result: true },
    });

    // 4. Собираем данные в памяти
    const operatorStatsResult = operators.map((operator) => {
      const operatorCalls = callStats.filter(c => c.operatorId === operator.id);
      const totalCalls = operatorCalls.reduce((sum, c) => sum + c._count.id, 0);
      const answeredCalls = operatorCalls.find(c => c.status === CallStatus.ANSWERED)?._count.id || 0;
      const missedCalls = operatorCalls.find(c => c.status === CallStatus.MISSED)?._count.id || 0;
      
      const avgDuration = operatorCalls.reduce((sum, c) => {
        return sum + ((c._avg.duration || 0) * c._count.id);
      }, 0) / (totalCalls || 1);

      const operatorOrders = orderStats.filter(o => o.operatorNameId === operator.id);
      const totalOrders = operatorOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = operatorOrders.find(o => o.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
      
      const totalRevenue = operatorOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

      return {
        operatorId: operator.id,
        operatorName: operator.name,
        status: operator.statusWork,
        calls: {
          total: totalCalls,
          answered: answeredCalls,
          missed: missedCalls,
          avgDuration: Math.round(avgDuration),
          answerRate: Math.round(answerRate * 100) / 100,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          conversionRate: Math.round(conversionRate * 100) / 100,
          totalRevenue: Math.round(totalRevenue),
          avgRevenue: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
        },
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getOperatorStatistics completed in ${duration}ms (${operators.length} operators, 3 queries)`);

    const result = {
      success: true,
      data: operatorStatsResult,
    };

    // Кешируем
    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.OPERATORS);

    return result;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Аналитика по городам
   */
  async getCityAnalytics(startDate?: string, endDate?: string) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('city-analytics', { startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getCityAnalytics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const orderDateFilter: any = {};
    const callDateFilter: any = {};

    if (startDate || endDate) {
      orderDateFilter.createDate = {};
      callDateFilter.createdAt = {};
      if (startDate) {
        orderDateFilter.createDate.gte = new Date(startDate);
        callDateFilter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderDateFilter.createDate.lte = new Date(endDate);
        callDateFilter.createdAt.lte = new Date(endDate);
      }
    }

    // Группированная статистика (groupBy вынесен из $transaction из-за ограничений типизации Prisma)
    const orderStats = await this.prisma.order.groupBy({
      by: ['city', 'statusOrder'],
      where: orderDateFilter,
      _count: { id: true },
      _sum: { result: true },
    });

    const [totalCalls, answeredCalls] = await Promise.all([
      this.prisma.call.count({
        where: callDateFilter.createdAt ? { createdAt: callDateFilter.createdAt } : {},
      }),
      this.prisma.call.count({
        where: {
          status: CallStatus.ANSWERED,
          ...(callDateFilter.createdAt && { createdAt: callDateFilter.createdAt }),
        },
      }),
    ]);

    const cities = [...new Set(orderStats.map(s => s.city))];

    const cityAnalytics = cities.map((city) => {
      const cityOrders = orderStats.filter(s => s.city === city);
      
      const totalOrders = cityOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = cityOrders.find(o => o.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
      
      const totalRevenue = cityOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

      return {
        city,
        calls: {
          total: totalCalls,
          answered: answeredCalls,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          completionRate: Math.round(completionRate * 100) / 100,
        },
        revenue: {
          total: Math.round(totalRevenue),
          avg: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
        },
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCityAnalytics completed in ${duration}ms (${cities.length} cities, 3 queries)`);

    const result = {
      success: true,
      data: cityAnalytics.sort((a, b) => b.orders.total - a.orders.total),
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.CITY);

    return result;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Аналитика по РК
   */
  async getCampaignAnalytics(startDate?: string, endDate?: string) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('campaign-analytics', { startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getCampaignAnalytics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const orderDateFilter: any = {};
    const callDateFilter: any = {};

    if (startDate || endDate) {
      orderDateFilter.createDate = {};
      callDateFilter.createdAt = {};
      if (startDate) {
        orderDateFilter.createDate.gte = new Date(startDate);
        callDateFilter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderDateFilter.createDate.lte = new Date(endDate);
        callDateFilter.createdAt.lte = new Date(endDate);
      }
    }

    // groupBy вынесен из $transaction из-за ограничений типизации Prisma
    const campaignStats = await this.prisma.order.groupBy({
      by: ['rk', 'statusOrder'],
      where: orderDateFilter,
      _count: { id: true },
      _sum: { result: true },
    });

    const [totalCalls, answeredCalls] = await Promise.all([
      this.prisma.call.count({
        where: callDateFilter.createdAt ? { createdAt: callDateFilter.createdAt } : {},
      }),
      this.prisma.call.count({
        where: {
          status: CallStatus.ANSWERED,
          ...(callDateFilter.createdAt && { createdAt: callDateFilter.createdAt }),
        },
      }),
    ]);

    const campaigns = [...new Set(campaignStats.map(s => s.rk))];

    const campaignAnalytics = campaigns.map((rk) => {
      const rkOrders = campaignStats.filter(s => s.rk === rk);
      
      const totalOrders = rkOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = rkOrders.find(o => o.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
      
      const totalRevenue = rkOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
      const roi = totalRevenue > 0 && totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        campaign: rk,
        calls: {
          total: totalCalls,
          answered: answeredCalls,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          completionRate: Math.round(completionRate * 100) / 100,
        },
        revenue: {
          total: Math.round(totalRevenue),
          avg: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
          roi: Math.round(roi),
        },
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCampaignAnalytics completed in ${duration}ms (${campaigns.length} campaigns, 3 queries)`);

    const result = {
      success: true,
      data: campaignAnalytics.sort((a, b) => b.revenue.total - a.revenue.total),
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.CAMPAIGN);

    return result;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Дневная метрика с SQL агрегацией
   * БЫЛО: findMany до 5000 записей + агрегация в JS
   * СТАЛО: SQL GROUP BY DATE() - минимальная передача данных
   */
  async getDailyMetrics(startDate?: string, endDate?: string, city?: string, limit?: number) {
    const startTime = Date.now();
    
    const cacheKey = this.buildCacheKey('daily-metrics', { startDate, endDate, city });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getDailyMetrics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;

    // ✅ Параметризованный SQL запрос с агрегацией на стороне БД
    const params: any[] = [start, end];
    let paramIndex = 3;
    let cityCondition = '';

    if (city) {
      cityCondition = ` AND city = $${paramIndex}`;
      params.push(city);
    }

    // ✅ SQL GROUP BY DATE() вместо загрузки всех записей
    const dailyStats = await this.prisma.$queryRawUnsafe<Array<{
      date: Date;
      total_orders: bigint;
      completed_orders: bigint;
      total_revenue: number;
    }>>(
      `SELECT 
        DATE(create_date) as date,
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status_order = '${OrderStatus.COMPLETED}') as completed_orders,
        COALESCE(SUM(result) FILTER (WHERE status_order = '${OrderStatus.COMPLETED}'), 0) as total_revenue
      FROM orders
      WHERE create_date >= $1 AND create_date <= $2 ${cityCondition}
      GROUP BY DATE(create_date)
      ORDER BY date ASC`,
      ...params
    );

    // Преобразуем результат
    const dailyMetrics = dailyStats.map(stat => ({
      date: stat.date instanceof Date 
        ? stat.date.toISOString().split('T')[0] 
        : String(stat.date),
      totalOrders: Number(stat.total_orders),
      completedOrders: Number(stat.completed_orders),
      totalRevenue: Number(stat.total_revenue) || 0,
    }));

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getDailyMetrics completed in ${duration}ms (${dailyMetrics.length} days, 1 SQL query)`);

    const result = {
      success: true,
      data: dailyMetrics,
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.DAILY);

    return result;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Dashboard
   */
  async getDashboardData(period: 'today' | 'week' | 'month' = 'today') {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('dashboard', { period });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getDashboardData from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }
    
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
    }

    // Параллельные запросы (groupBy вынесен из $transaction из-за ограничений типизации Prisma)
    const [orderStats, callStats, activeOperators] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['statusOrder'],
        where: {
          createDate: { gte: startDate, lte: now },
        },
        _count: { id: true },
        _sum: { result: true },
      }),
      this.prisma.call.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: startDate, lte: now },
        },
        _count: { id: true },
        _avg: { duration: true },
      }),
      this.prisma.callcentreOperator.count({ 
        where: { statusWork: WorkStatus.ACTIVE } 
      }),
    ]);

    const totalOrders = orderStats.reduce((sum, s) => sum + s._count.id, 0);
    const completedOrders = orderStats.find(s => s.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
    const inProgressOrders = orderStats
      .filter(s => IN_PROGRESS_STATUSES.includes(s.statusOrder as any))
      .reduce((sum, s) => sum + s._count.id, 0);
    
    const totalRevenue = orderStats.reduce((sum, s) => sum + Number(s._sum.result || 0), 0);

    const totalCalls = callStats.reduce((sum, s) => sum + s._count.id, 0);
    const answeredCalls = callStats.find(s => s.status === CallStatus.ANSWERED)?._count.id || 0;
    
    const avgCallDuration = callStats.reduce((sum, s) => {
      return sum + ((s._avg.duration || 0) * s._count.id);
    }, 0) / (totalCalls || 1);

    const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getDashboardData completed in ${duration}ms (${period}, 3 queries)`);

    const result = {
      success: true,
      data: {
        period,
        orders: {
          total: totalOrders,
          completed: completedOrders,
          inProgress: inProgressOrders,
          completionRate: Math.round(completionRate * 100) / 100,
        },
        revenue: {
          total: Math.round(totalRevenue),
          avg: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
        },
        calls: {
          total: totalCalls,
          answered: answeredCalls,
          avgDuration: Math.round(avgCallDuration),
          answerRate: Math.round(answerRate * 100) / 100,
        },
        performance: {
          conversionRate: Math.round(conversionRate * 100) / 100,
          activeOperators,
        },
      },
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.DASHBOARD);

    return result;
  }

  /**
   * Performance Metrics с пагинацией
   */
  async getPerformanceMetrics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    const callWhere: any = {};
    if (startDate || endDate) {
      callWhere.createdAt = {};
      if (startDate) callWhere.createdAt.gte = new Date(startDate);
      if (endDate) callWhere.createdAt.lte = new Date(endDate);
    }

    // groupBy вынесен отдельно из-за ограничений типизации Prisma
    const [orderStats, callStats] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['statusOrder'],
        where,
        _count: { id: true },
      }),
      this.prisma.call.groupBy({
        by: ['status'],
        where: callWhere,
        _count: { id: true },
        _avg: { duration: true },
      }),
    ]);

    const [
      totalRevenue,
      totalExpenditure,
      avgTimeToComplete,
      avgTimeToAssignMaster,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: { ...where, result: { not: null } },
        _sum: { result: true },
      }),
      this.prisma.order.aggregate({
        where: { ...where, expenditure: { not: null } },
        _sum: { expenditure: true },
      }),
      this.prisma.order.findMany({
        where: {
          ...where,
          statusOrder: OrderStatus.COMPLETED,
          closingData: { not: null },
        },
        select: {
          createDate: true,
          closingData: true,
        },
        take: this.MAX_LIMIT,
      }),
      this.prisma.order.findMany({
        where: {
          ...where,
          masterId: { not: null },
        },
        select: {
          createDate: true,
          dateMeeting: true,
        },
        take: this.MAX_LIMIT,
      }),
    ]);

    // Вычисляем метрики
    const totalOrders = orderStats.reduce((sum, s) => sum + s._count.id, 0);
    const completedOrders = orderStats.find(o => o.statusOrder === OrderStatus.COMPLETED)?._count.id || 0;
    const cancelledOrders = orderStats.find(o => o.statusOrder === OrderStatus.CANCELLED)?._count.id || 0;

    const totalCalls = callStats.reduce((sum, s) => sum + s._count.id, 0);
    const answeredCalls = callStats.find(c => c.status === CallStatus.ANSWERED)?._count.id || 0;
    const missedCalls = callStats.find(c => c.status === CallStatus.MISSED)?._count.id || 0;

    // Среднее время закрытия заказа (в часах)
    const completionTimes = avgTimeToComplete
      .map((o) => {
        if (o.closingData && o.createDate) {
          const closingDate = new Date(o.closingData);
          return (closingDate.getTime() - o.createDate.getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter((t): t is number => t !== null && t > 0);

    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    // Среднее время назначения мастера
    const assignTimes = avgTimeToAssignMaster
      .map((o) => {
        if (o.dateMeeting && o.createDate) {
          const meetingDate = new Date(o.dateMeeting);
          return (meetingDate.getTime() - o.createDate.getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter((t): t is number => t !== null && t > 0);

    const avgAssignTime =
      assignTimes.length > 0 ? assignTimes.reduce((a, b) => a + b, 0) / assignTimes.length : 0;

    const revenueTotal = Number(totalRevenue._sum.result || 0);
    const expenditureTotal = Number(totalExpenditure._sum.expenditure || 0);
    const profit = revenueTotal - expenditureTotal;
    const profitMargin = revenueTotal > 0 ? (profit / revenueTotal) * 100 : 0;

    return {
      success: true,
      data: {
        orders: {
          total: totalOrders,
          completed: completedOrders,
          cancelled: cancelledOrders,
          completionRate: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100 * 100) / 100 : 0,
          cancellationRate: totalOrders > 0 ? Math.round((cancelledOrders / totalOrders) * 100 * 100) / 100 : 0,
        },
        calls: {
          total: totalCalls,
          answered: answeredCalls,
          missed: missedCalls,
          answerRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100 * 100) / 100 : 0,
          missRate: totalCalls > 0 ? Math.round((missedCalls / totalCalls) * 100 * 100) / 100 : 0,
        },
        timing: {
          avgCompletionTime: Math.round(avgCompletionTime * 10) / 10,
          avgAssignTime: Math.round(avgAssignTime * 10) / 10,
        },
        finance: {
          revenue: revenueTotal,
          expenditure: expenditureTotal,
          profit,
          profitMargin: Math.round(profitMargin * 100) / 100,
        },
        conversion: {
          callToOrder: answeredCalls > 0 ? Math.round((totalOrders / answeredCalls) * 100 * 100) / 100 : 0,
          orderToCompletion: totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100 * 100) / 100 : 0,
        },
      },
    };
  }
}
