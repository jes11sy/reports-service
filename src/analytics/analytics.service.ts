import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Статистика операторов
   */
  async getOperatorStatistics(startDate?: string, endDate?: string, operatorId?: number) {
    const where: any = {};
    
    if (startDate || endDate) {
      where.dateCreate = {};
      if (startDate) where.dateCreate.gte = new Date(startDate);
      if (endDate) where.dateCreate.lte = new Date(endDate);
    }

    if (operatorId) {
      where.operatorId = operatorId;
    }

    const operators = await this.prisma.callcentreOperator.findMany({
      where: operatorId ? { id: operatorId } : {},
      select: {
        id: true,
        name: true,
        login: true,
        statusWork: true,
      },
    });

    const operatorStats = await Promise.all(
      operators.map(async (operator) => {
        const callWhere = {
          operatorId: operator.id,
          ...(startDate || endDate
            ? {
                dateCreate: {
                  ...(startDate && { gte: new Date(startDate) }),
                  ...(endDate && { lte: new Date(endDate) }),
                },
              }
            : {}),
        };

        const orderWhere = {
          operatorNameId: operator.id,
          ...(startDate || endDate
            ? {
                createDate: {
                  ...(startDate && { gte: new Date(startDate) }),
                  ...(endDate && { lte: new Date(endDate) }),
                },
              }
            : {}),
        };

        const [
          totalCalls,
          answeredCalls,
          missedCalls,
          avgCallDuration,
          totalOrders,
          completedOrders,
          totalRevenue,
        ] = await Promise.all([
          this.prisma.call.count({ where: callWhere }),
          this.prisma.call.count({ where: { ...callWhere, status: 'answered' } }),
          this.prisma.call.count({ where: { ...callWhere, status: 'missed' } }),
          this.prisma.call.aggregate({
            where: { ...callWhere, duration: { not: null } },
            _avg: { duration: true },
          }),
          this.prisma.order.count({ where: orderWhere }),
          this.prisma.order.count({ where: { ...orderWhere, statusOrder: 'Закрыт' } }),
          this.prisma.order.aggregate({
            where: { ...orderWhere, result: { not: null } },
            _sum: { result: true },
          }),
        ]);

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
            avgDuration: Math.round(avgCallDuration._avg.duration || 0),
            answerRate: Math.round(answerRate * 100) / 100,
          },
          orders: {
            total: totalOrders,
            completed: completedOrders,
            conversionRate: Math.round(conversionRate * 100) / 100,
            totalRevenue: Number(totalRevenue._sum.result || 0),
            avgRevenue:
              completedOrders > 0
                ? Math.round(Number(totalRevenue._sum.result || 0) / completedOrders)
                : 0,
          },
        };
      })
    );

    return {
      success: true,
      data: operatorStats,
    };
  }

  /**
   * Аналитика по городам
   */
  async getCityAnalytics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    // Получаем уникальные города
    const cities = await this.prisma.order.findMany({
      where,
      select: { city: true },
      distinct: ['city'],
    });

    const cityAnalytics = await Promise.all(
      cities.map(async ({ city }) => {
        const cityWhere = { ...where, city };

        const [totalOrders, completedOrders, totalRevenue] =
          await Promise.all([
            this.prisma.order.count({ where: cityWhere }),
            this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Закрыт' } }),
            this.prisma.order.aggregate({
              where: { ...cityWhere, result: { not: null } },
              _sum: { result: true },
            }),
          ]);
        
        // Calls don't have city field, so get all calls for time period
        const totalCalls = await this.prisma.call.count({ where: where });
        const answeredCalls = await this.prisma.call.count({ where: { ...where, status: 'answered' } });

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
            total: Number(totalRevenue._sum.result || 0),
            avg:
              completedOrders > 0
                ? Math.round(Number(totalRevenue._sum.result || 0) / completedOrders)
                : 0,
          },
          conversionRate: Math.round(conversionRate * 100) / 100,
        };
      })
    );

    return {
      success: true,
      data: cityAnalytics.sort((a, b) => b.orders.total - a.orders.total),
    };
  }

  /**
   * Аналитика по рекламным кампаниям (РК)
   */
  async getCampaignAnalytics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    // Получаем уникальные РК
    const campaigns = await this.prisma.order.findMany({
      where,
      select: { rk: true },
      distinct: ['rk'],
    });

    const campaignAnalytics = await Promise.all(
      campaigns.map(async ({ rk }) => {
        const rkWhere = { ...where, rk };

        const [totalOrders, completedOrders, totalRevenue] =
          await Promise.all([
            this.prisma.order.count({ where: rkWhere }),
            this.prisma.order.count({ where: { ...rkWhere, statusOrder: 'Закрыт' } }),
            this.prisma.order.aggregate({
              where: { ...rkWhere, result: { not: null } },
              _sum: { result: true },
            }),
          ]);
        
        // Calls don't have rk field, so get all calls for time period
        const totalCalls = await this.prisma.call.count({ where: where });
        const answeredCalls = await this.prisma.call.count({ where: { ...where, status: 'answered' } });

        const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
        const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
        const roi =
          totalRevenue._sum.result && totalOrders > 0
            ? Number(totalRevenue._sum.result) / totalOrders
            : 0;

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
            total: Number(totalRevenue._sum.result || 0),
            avg:
              completedOrders > 0
                ? Math.round(Number(totalRevenue._sum.result || 0) / completedOrders)
                : 0,
            roi: Math.round(roi),
          },
          conversionRate: Math.round(conversionRate * 100) / 100,
        };
      })
    );

    return {
      success: true,
      data: campaignAnalytics.sort((a, b) => b.revenue.total - a.revenue.total),
    };
  }

  /**
   * Дневная метрика
   */
  async getDailyMetrics(startDate?: string, endDate?: string, city?: string) {
    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;

    const where: any = {
      createDate: {
        gte: start,
        lte: end,
      },
    };

    if (city) {
      where.city = city;
    }

    // Получаем заказы
    const orders = await this.prisma.order.findMany({
      where,
      select: {
        createDate: true,
        statusOrder: true,
        result: true,
      },
    });

    // Группируем по дням
    const dailyMap = new Map<string, any>();

    orders.forEach((order) => {
      const dateKey = order.createDate.toISOString().split('T')[0];

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          totalOrders: 0,
          completedOrders: 0,
          totalRevenue: 0,
        });
      }

      const day = dailyMap.get(dateKey);
      day.totalOrders++;

      if (order.statusOrder === 'Закрыт') {
        day.completedOrders++;
        day.totalRevenue += Number(order.result || 0);
      }
    });

    const dailyMetrics = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    return {
      success: true,
      data: dailyMetrics,
    };
  }

  /**
   * Dashboard - общая аналитика
   */
  async getDashboardData(period: 'today' | 'week' | 'month' = 'today') {
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

    const where = {
      createDate: {
        gte: startDate,
        lte: now,
      },
    };

    const callWhere = {
      dateCreate: {
        gte: startDate,
        lte: now,
      },
    };

    const [
      totalOrders,
      completedOrders,
      inProgressOrders,
      totalRevenue,
      totalCalls,
      answeredCalls,
      avgCallDuration,
      activeOperators,
    ] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.count({ where: { ...where, statusOrder: 'Закрыт' } }),
      this.prisma.order.count({
        where: {
          ...where,
          statusOrder: { in: ['В работе', 'Назначен мастер', 'Мастер выехал'] },
        },
      }),
      this.prisma.order.aggregate({
        where: { ...where, result: { not: null } },
        _sum: { result: true },
      }),
      this.prisma.call.count({ where: callWhere }),
      this.prisma.call.count({ where: { ...callWhere, status: 'answered' } }),
      this.prisma.call.aggregate({
        where: { ...callWhere, duration: { not: null } },
        _avg: { duration: true },
      }),
      this.prisma.callcentreOperator.count({ where: { statusWork: 'работает' } }),
    ]);

    const conversionRate = answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0;
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
    const answerRate = totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0;

    return {
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
          total: Number(totalRevenue._sum.result || 0),
          avg:
            completedOrders > 0
              ? Math.round(Number(totalRevenue._sum.result || 0) / completedOrders)
              : 0,
        },
        calls: {
          total: totalCalls,
          answered: answeredCalls,
          avgDuration: Math.round(avgCallDuration._avg.duration || 0),
          answerRate: Math.round(answerRate * 100) / 100,
        },
        performance: {
          conversionRate: Math.round(conversionRate * 100) / 100,
          activeOperators,
        },
      },
    };
  }

  /**
   * Performance Metrics - детальные метрики производительности
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
      callWhere.dateCreate = {};
      if (startDate) callWhere.dateCreate.gte = new Date(startDate);
      if (endDate) callWhere.dateCreate.lte = new Date(endDate);
    }

    const [
      orders,
      calls,
      totalRevenue,
      totalExpenditure,
      avgTimeToComplete,
      avgTimeToAssignMaster,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          statusOrder: true,
          createDate: true,
          closingData: true,
        },
      }),
      this.prisma.call.findMany({
        where: callWhere,
        select: {
          status: true,
          duration: true,
        },
      }),
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
          statusOrder: 'Закрыт',
          closingData: { not: null },
        },
        select: {
          createDate: true,
          closingData: true,
        },
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
      }),
    ]);

    // Вычисляем метрики
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o) => o.statusOrder === 'Закрыт').length;
    const cancelledOrders = orders.filter((o) => o.statusOrder === 'Отменен').length;

    const totalCalls = calls.length;
    const answeredCalls = calls.filter((c) => c.status === 'answered').length;
    const missedCalls = calls.filter((c) => c.status === 'missed').length;

    // Среднее время закрытия заказа (в часах)
    const completionTimes = avgTimeToComplete
      .map((o) => {
        if (o.closingData && o.createDate) {
          const closingDate = o.closingData ? new Date(o.closingData) : null;
          return closingDate ? (closingDate.getTime() - o.createDate.getTime()) / (1000 * 60 * 60) : 0;
        }
        return null;
      })
      .filter((t) => t !== null);

    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    // Среднее время назначения мастера (в часах)
    const assignTimes = avgTimeToAssignMaster
      .map((o) => {
        if (o.dateMeeting && o.createDate) {
          const meetingDate = new Date(o.dateMeeting);
          return (meetingDate.getTime() - o.createDate.getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter((t) => t !== null);

    const avgAssignTime =
      assignTimes.length > 0 ? assignTimes.reduce((a, b) => a + b, 0) / assignTimes.length : 0;

    const profit = Number(totalRevenue._sum.result || 0) - Number(totalExpenditure._sum.expenditure || 0);
    const profitMargin =
      totalRevenue._sum.result > 0
        ? (profit / Number(totalRevenue._sum.result)) * 100
        : 0;

    return {
      success: true,
      data: {
        orders: {
          total: totalOrders,
          completed: completedOrders,
          cancelled: cancelledOrders,
          completionRate: totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0,
          cancellationRate: totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0,
        },
        calls: {
          total: totalCalls,
          answered: answeredCalls,
          missed: missedCalls,
          answerRate: totalCalls > 0 ? (answeredCalls / totalCalls) * 100 : 0,
          missRate: totalCalls > 0 ? (missedCalls / totalCalls) * 100 : 0,
        },
        timing: {
          avgCompletionTime: Math.round(avgCompletionTime * 10) / 10,
          avgAssignTime: Math.round(avgAssignTime * 10) / 10,
        },
        finance: {
          revenue: Number(totalRevenue._sum.result || 0),
          expenditure: Number(totalExpenditure._sum.expenditure || 0),
          profit,
          profitMargin: Math.round(profitMargin * 100) / 100,
        },
        conversion: {
          callToOrder: answeredCalls > 0 ? (totalOrders / answeredCalls) * 100 : 0,
          orderToCompletion: totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0,
        },
      },
    };
  }
}

