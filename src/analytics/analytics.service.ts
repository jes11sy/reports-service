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

  private readonly DEFAULT_LIMIT: number;
  private readonly MAX_LIMIT: number;

  private readonly CACHE_TTL: {
    DASHBOARD: number;
    OPERATORS: number;
    CITY: number;
    CAMPAIGN: number;
    DAILY: number;
  };

  // Cache for status code → ID mapping
  private statusCodeToId: Map<string, number> = new Map();
  private statusCacheExpiry = 0;

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

  private buildCacheKey(prefix: string, params: Record<string, any>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .filter(key => params[key] !== undefined && params[key] !== null)
      .map(key => `${key}:${params[key]}`)
      .join('|');
    return `v2:${prefix}:${sortedParams || 'all'}`;
  }

  private async getStatusId(code: string): Promise<number | undefined> {
    const now = Date.now();
    if (this.statusCacheExpiry < now || this.statusCodeToId.size === 0) {
      try {
        const statuses = await this.prisma.$queryRaw<{ id: number; code: string }[]>`
          SELECT id, code FROM references_service.order_statuses
        `;
        this.statusCodeToId = new Map(statuses.map(s => [s.code, s.id]));
        this.statusCacheExpiry = now + 5 * 60 * 1000;
      } catch (err) {
        this.logger.error('Failed to load status IDs', err);
      }
    }
    return this.statusCodeToId.get(code);
  }

  async getOperatorStatistics(startDate?: string, endDate?: string, operatorId?: number) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('operator-stats', { operatorId, startDate, endDate });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getOperatorStatistics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const callDateFilter: any = {};
    const orderDateFilter: any = {};

    if (startDate || endDate) {
      callDateFilter.createdAt = {};
      orderDateFilter.createdAt = {};
      if (startDate) {
        callDateFilter.createdAt.gte = new Date(startDate);
        orderDateFilter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        callDateFilter.createdAt.lte = new Date(endDate);
        orderDateFilter.createdAt.lte = new Date(endDate);
      }
    }

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const operators = await this.prisma.operator.findMany({
      where: operatorId ? { id: operatorId } : {},
      select: {
        id: true,
        name: true,
        login: true,
        status: true,
      },
    });

    const callStats = await this.prisma.call.groupBy({
      by: ['operatorId', 'status'],
      where: {
        ...(operatorId && { operatorId }),
        ...callDateFilter,
      },
      _count: { id: true },
      _avg: { duration: true },
    });

    const orderStats = await this.prisma.order.groupBy({
      by: ['operatorId', 'statusId'],
      where: {
        ...(operatorId && { operatorId }),
        ...orderDateFilter,
      },
      _count: { id: true },
      _sum: { result: true },
    });

    const operatorStatsResult = operators.map((operator) => {
      const operatorCalls = callStats.filter(c => c.operatorId === operator.id);
      const totalCalls = operatorCalls.reduce((sum, c) => sum + c._count.id, 0);
      const answeredCalls = operatorCalls.find(c => c.status === CallStatus.ANSWERED)?._count.id || 0;
      const missedCalls = operatorCalls.find(c => c.status === CallStatus.MISSED)?._count.id || 0;

      const avgDuration = operatorCalls.reduce((sum, c) => {
        return sum + ((c._avg.duration || 0) * c._count.id);
      }, 0) / (totalCalls || 1);

      const operatorOrders = orderStats.filter(o => o.operatorId === operator.id);
      const totalOrders = operatorOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = completedStatusId
        ? operatorOrders.filter(o => o.statusId === completedStatusId).reduce((sum, o) => sum + o._count.id, 0)
        : 0;

      const totalRevenue = operatorOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

      return {
        operatorId: operator.id,
        operatorName: operator.name,
        status: operator.status,
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

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.OPERATORS);

    return result;
  }

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
      orderDateFilter.createdAt = {};
      callDateFilter.createdAt = {};
      if (startDate) {
        orderDateFilter.createdAt.gte = new Date(startDate);
        callDateFilter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderDateFilter.createdAt.lte = new Date(endDate);
        callDateFilter.createdAt.lte = new Date(endDate);
      }
    }

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const orderStats = await this.prisma.order.groupBy({
      by: ['cityId', 'statusId'],
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

    const cityIds = [...new Set(orderStats.map(s => s.cityId).filter(Boolean))] as number[];
    const cityRecords = cityIds.length > 0
      ? await this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } })
      : [];
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));

    const cityAnalytics = cityIds.map((cityId) => {
      const cityOrders = orderStats.filter(s => s.cityId === cityId);

      const totalOrders = cityOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = completedStatusId
        ? cityOrders.filter(o => o.statusId === completedStatusId).reduce((sum, o) => sum + o._count.id, 0)
        : 0;

      const totalRevenue = cityOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

      return {
        cityId,
        cityName: cityNameMap.get(cityId) || String(cityId),
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
    this.logger.log(`✅ getCityAnalytics completed in ${duration}ms (${cityIds.length} cities, 3 queries)`);

    const result = {
      success: true,
      data: cityAnalytics.sort((a, b) => b.orders.total - a.orders.total),
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.CITY);

    return result;
  }

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
      orderDateFilter.createdAt = {};
      callDateFilter.createdAt = {};
      if (startDate) {
        orderDateFilter.createdAt.gte = new Date(startDate);
        callDateFilter.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        orderDateFilter.createdAt.lte = new Date(endDate);
        callDateFilter.createdAt.lte = new Date(endDate);
      }
    }

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const campaignStats = await this.prisma.order.groupBy({
      by: ['rkId', 'statusId'],
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

    const rkIds = [...new Set(campaignStats.map(s => s.rkId).filter(Boolean))] as number[];
    const rkRecords = rkIds.length > 0
      ? await this.prisma.rk.findMany({ where: { id: { in: rkIds } }, select: { id: true, name: true } })
      : [];
    const rkNameMap = new Map(rkRecords.map(r => [r.id, r.name]));

    const campaignAnalytics = rkIds.map((rkId) => {
      const rkOrders = campaignStats.filter(s => s.rkId === rkId);

      const totalOrders = rkOrders.reduce((sum, o) => sum + o._count.id, 0);
      const completedOrders = completedStatusId
        ? rkOrders.filter(o => o.statusId === completedStatusId).reduce((sum, o) => sum + o._count.id, 0)
        : 0;

      const totalRevenue = rkOrders.reduce((sum, o) => {
        return sum + Number(o._sum.result || 0);
      }, 0);

      const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
      const roi = totalRevenue > 0 && totalOrders > 0 ? totalRevenue / totalOrders : 0;

      return {
        rkId,
        rkName: rkNameMap.get(rkId) || String(rkId),
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
    this.logger.log(`✅ getCampaignAnalytics completed in ${duration}ms (${rkIds.length} campaigns, 3 queries)`);

    const result = {
      success: true,
      data: campaignAnalytics.sort((a, b) => b.revenue.total - a.revenue.total),
    };

    await this.cacheManager.set(cacheKey, result, this.CACHE_TTL.CAMPAIGN);

    return result;
  }

  async getDailyMetrics(startDate?: string, endDate?: string, cityId?: number, limit?: number) {
    const startTime = Date.now();

    const cacheKey = this.buildCacheKey('daily-metrics', { startDate, endDate, cityId });
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`✅ getDailyMetrics from CACHE in ${Date.now() - startTime}ms`);
      return cached;
    }

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const params: any[] = [start, end];
    let paramIndex = 3;
    let cityCondition = '';

    if (cityId) {
      cityCondition = ` AND city_id = $${paramIndex}`;
      params.push(cityId);
      paramIndex++;
    }

    const dailyStats = await this.prisma.$queryRawUnsafe<Array<{
      date: Date;
      total_orders: bigint;
      completed_orders: bigint;
      total_revenue: number;
    }>>(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE status_id = ${completedStatusId ?? 0}) as completed_orders,
        COALESCE(SUM(result) FILTER (WHERE status_id = ${completedStatusId ?? 0}), 0) as total_revenue
      FROM orders_service.orders
      WHERE created_at >= $1 AND created_at <= $2 ${cityCondition}
      GROUP BY DATE(created_at)
      ORDER BY date ASC`,
      ...params
    );

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

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);
    const inProgressStatusIds = await Promise.all(IN_PROGRESS_STATUSES.map(code => this.getStatusId(code)));
    const validInProgressIds = inProgressStatusIds.filter((id): id is number => id !== undefined);

    const [orderStats, callStats, activeOperators] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['statusId'],
        where: { createdAt: { gte: startDate, lte: now } },
        _count: { id: true },
        _sum: { result: true },
      }),
      this.prisma.call.groupBy({
        by: ['status'],
        where: { createdAt: { gte: startDate, lte: now } },
        _count: { id: true },
        _avg: { duration: true },
      }),
      this.prisma.operator.count({ where: { status: WorkStatus.ACTIVE } }),
    ]);

    const totalOrders = orderStats.reduce((sum, s) => sum + s._count.id, 0);
    const completedOrders = completedStatusId
      ? orderStats.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + s._count.id, 0)
      : 0;
    const inProgressOrders = validInProgressIds.length > 0
      ? orderStats.filter(s => validInProgressIds.includes(s.statusId)).reduce((sum, s) => sum + s._count.id, 0)
      : 0;

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

  async getPerformanceMetrics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const callWhere: any = {};
    if (startDate || endDate) {
      callWhere.createdAt = {};
      if (startDate) callWhere.createdAt.gte = new Date(startDate);
      if (endDate) callWhere.createdAt.lte = new Date(endDate);
    }

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);
    const cancelledStatusId = await this.getStatusId(OrderStatus.CANCELLED);

    const [orderStats, callStats] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['statusId'],
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
          ...(completedStatusId ? { statusId: completedStatusId } : {}),
          closingAt: { not: null },
        },
        select: {
          createdAt: true,
          closingAt: true,
        },
        take: this.MAX_LIMIT,
      }),
      this.prisma.order.findMany({
        where: {
          ...where,
          masterId: { not: null },
        },
        select: {
          createdAt: true,
          dateMeeting: true,
        },
        take: this.MAX_LIMIT,
      }),
    ]);

    const totalOrders = orderStats.reduce((sum, s) => sum + s._count.id, 0);
    const completedOrders = completedStatusId
      ? orderStats.filter(o => o.statusId === completedStatusId).reduce((sum, o) => sum + o._count.id, 0)
      : 0;
    const cancelledOrders = cancelledStatusId
      ? orderStats.filter(o => o.statusId === cancelledStatusId).reduce((sum, o) => sum + o._count.id, 0)
      : 0;

    const totalCalls = callStats.reduce((sum, s) => sum + s._count.id, 0);
    const answeredCalls = callStats.find(c => c.status === CallStatus.ANSWERED)?._count.id || 0;
    const missedCalls = callStats.find(c => c.status === CallStatus.MISSED)?._count.id || 0;

    const completionTimes = avgTimeToComplete
      .map((o) => {
        if (o.closingAt && o.createdAt) {
          return (new Date(o.closingAt).getTime() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter((t): t is number => t !== null && t > 0);

    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    const assignTimes = avgTimeToAssignMaster
      .map((o) => {
        if (o.dateMeeting && o.createdAt) {
          return (new Date(o.dateMeeting).getTime() - new Date(o.createdAt).getTime()) / (1000 * 60 * 60);
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
