import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Статистика операторов - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
   * Было: N операторов × 8 запросов = до 400 запросов
   * Стало: 4 группирующих запроса = 4 запроса
   */
  async getOperatorStatistics(startDate?: string, endDate?: string, operatorId?: number) {
    const callWhere: any = {};
    const orderWhere: any = {};

    if (startDate || endDate) {
      if (startDate) {
        callWhere.dateCreate = { ...callWhere.dateCreate, gte: new Date(startDate) };
        orderWhere.createDate = { ...orderWhere.createDate, gte: new Date(startDate) };
      }
      if (endDate) {
        callWhere.dateCreate = { ...callWhere.dateCreate, lte: new Date(endDate) };
        orderWhere.createDate = { ...orderWhere.createDate, lte: new Date(endDate) };
      }
    }

    if (operatorId) {
      callWhere.operatorId = operatorId;
      orderWhere.operatorNameId = operatorId;
    }

    // Получаем операторов
    const operators = await this.prisma.callcentreOperator.findMany({
      where: operatorId ? { id: operatorId } : {},
      select: {
        id: true,
        name: true,
        login: true,
        statusWork: true,
      },
    });

    // ОПТИМИЗАЦИЯ: Группируем все данные за один запрос
    const [callsStats, ordersStats, revenueStats] = await Promise.all([
      // Группировка звонков по операторам и статусам
      this.prisma.call.groupBy({
        by: ['operatorId', 'status'],
        where: callWhere,
        _count: { id: true },
        _avg: { duration: true },
      }),
      
      // Группировка заказов по операторам и статусам
      this.prisma.order.groupBy({
        by: ['operatorNameId', 'statusOrder'],
        where: orderWhere,
        _count: { id: true },
      }),
      
      // Группировка выручки по операторам
      this.prisma.order.groupBy({
        by: ['operatorNameId'],
        where: { ...orderWhere, result: { not: null } },
        _sum: { result: true },
      }),
    ]);

    // Преобразуем данные в Map для быстрого доступа
    const callsMap = new Map<number, Map<string, { count: number; avgDuration: number }>>();
    const ordersMap = new Map<number, Map<string, number>>();
    const revenueMap = new Map<number, number>();

    callsStats.forEach(stat => {
      if (!callsMap.has(stat.operatorId)) {
        callsMap.set(stat.operatorId, new Map());
      }
      callsMap.get(stat.operatorId)!.set(stat.status, {
        count: stat._count.id,
        avgDuration: stat._avg.duration || 0,
      });
    });

    ordersStats.forEach(stat => {
      if (!ordersMap.has(stat.operatorNameId)) {
        ordersMap.set(stat.operatorNameId, new Map());
      }
      ordersMap.get(stat.operatorNameId)!.set(stat.statusOrder, stat._count.id);
    });

    revenueStats.forEach(stat => {
      revenueMap.set(stat.operatorNameId, Number(stat._sum.result || 0));
    });

    // Формируем результат
    const operatorStats = operators.map(operator => {
      const calls = callsMap.get(operator.id) || new Map();
      const orders = ordersMap.get(operator.id) || new Map();
      const revenue = revenueMap.get(operator.id) || 0;

      const totalCalls = Array.from(calls.values()).reduce((sum, stat) => sum + stat.count, 0);
      const answeredCalls = calls.get('answered')?.count || 0;
      const missedCalls = calls.get('missed')?.count || 0;
      const avgDuration = calls.get('answered')?.avgDuration || 0;

      const totalOrders = Array.from(orders.values()).reduce((sum, count) => sum + count, 0);
      const completedOrders = orders.get('Закрыт') || 0;

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
          totalRevenue: revenue,
          avgRevenue: completedOrders > 0 ? Math.round(revenue / completedOrders) : 0,
        },
      };
    });

    return {
      success: true,
      data: operatorStats,
    };
  }

  /**
   * Аналитика по городам - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
   * Исправлена проблема с повторными запросами
   */
  async getCityAnalytics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    // ОПТИМИЗАЦИЯ: Один запрос получить все данные, сгруппированные по городам
    const [cityOrderStats, callsTotal, callsAnswered] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['city'],
        where,
        _count: { id: true },
        _sum: { result: true },
      }),
      
      // Общие звонки - запрашиваем один раз, а не для каждого города
      this.prisma.call.count({ 
        where: {
          ...(startDate || endDate ? {
            dateCreate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            }
          } : {})
        }
      }),
      
      this.prisma.call.count({ 
        where: {
          status: 'answered',
          ...(startDate || endDate ? {
            dateCreate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            }
          } : {})
        }
      }),
    ]);

    // Получаем детали по закрытым заказам
    const completedOrderStats = await this.prisma.order.groupBy({
      by: ['city', 'statusOrder'],
      where: { ...where, statusOrder: 'Закрыт' },
      _count: { id: true },
    });

    const completedMap = new Map<string, number>();
    completedOrderStats.forEach(stat => {
      completedMap.set(stat.city, stat._count.id);
    });

    const cityAnalytics = cityOrderStats.map(cityStat => {
      const totalOrders = cityStat._count.id;
      const completedOrders = completedMap.get(cityStat.city) || 0;
      const totalRevenue = Number(cityStat._sum.result || 0);

      const conversionRate = callsAnswered > 0 ? (totalOrders / callsAnswered) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

      return {
        city: cityStat.city,
        calls: {
          total: callsTotal,
          answered: callsAnswered,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          completionRate: Math.round(completionRate * 100) / 100,
        },
        revenue: {
          total: totalRevenue,
          avg: completedOrders > 0 ? Math.round(totalRevenue / completedOrders) : 0,
        },
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    return {
      success: true,
      data: cityAnalytics.sort((a, b) => b.orders.total - a.orders.total),
    };
  }

  /**
   * Аналитика по рекламным кампаниям - ОПТИМИЗИРОВАННАЯ
   */
  async getCampaignAnalytics(startDate?: string, endDate?: string) {
    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    // ОПТИМИЗАЦИЯ: Группировка
    const [campaignStats, completedStats, callsTotal, callsAnswered] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['rk'],
        where,
        _count: { id: true },
        _sum: { result: true },
      }),
      
      this.prisma.order.groupBy({
        by: ['rk', 'statusOrder'],
        where: { ...where, statusOrder: 'Закрыт' },
        _count: { id: true },
      }),
      
      this.prisma.call.count({ 
        where: {
          ...(startDate || endDate ? {
            dateCreate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            }
          } : {})
        }
      }),
      
      this.prisma.call.count({ 
        where: {
          status: 'answered',
          ...(startDate || endDate ? {
            dateCreate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            }
          } : {})
        }
      }),
    ]);

    const completedMap = new Map<string, number>();
    completedStats.forEach(stat => {
      completedMap.set(stat.rk, stat._count.id);
    });

    const campaignAnalytics = campaignStats.map(stat => {
      const totalOrders = stat._count.id;
      const completedOrders = completedMap.get(stat.rk) || 0;
      const revenueTotal = Number(stat._sum.result || 0);

      const conversionRate = callsAnswered > 0 ? (totalOrders / callsAnswered) * 100 : 0;
      const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;
      const roi = revenueTotal > 0 && totalOrders > 0 ? revenueTotal / totalOrders : 0;

      return {
        campaign: stat.rk,
        calls: {
          total: callsTotal,
          answered: callsAnswered,
        },
        orders: {
          total: totalOrders,
          completed: completedOrders,
          completionRate: Math.round(completionRate * 100) / 100,
        },
        revenue: {
          total: revenueTotal,
          avg: completedOrders > 0 ? Math.round(revenueTotal / completedOrders) : 0,
          roi: Math.round(roi),
        },
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    return {
      success: true,
      data: campaignAnalytics.sort((a, b) => b.revenue.total - a.revenue.total),
    };
  }

  /**
   * Дневная метрика - без изменений, уже оптимизирована
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

    const orders = await this.prisma.order.findMany({
      where,
      select: {
        createDate: true,
        statusOrder: true,
        result: true,
      },
    });

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
   * Performance Metrics - ОПТИМИЗИРОВАННАЯ
   */
  async getPerformanceMetrics(startDate?: string, endDate?: string) {
    const where: any = {};
    const callWhere: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      callWhere.dateCreate = {};
      if (startDate) {
        where.createDate.gte = new Date(startDate);
        callWhere.dateCreate.gte = new Date(startDate);
      }
      if (endDate) {
        where.createDate.lte = new Date(endDate);
        callWhere.dateCreate.lte = new Date(endDate);
      }
    }

    // ОПТИМИЗАЦИЯ: Используем groupBy где возможно
    const [
      orderStats,
      callStats,
      totalRevenue,
      totalExpenditure,
      completionTimeOrders,
      assignTimeOrders,
    ] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['statusOrder'],
        where,
        _count: { id: true },
      }),
      
      this.prisma.call.groupBy({
        by: ['status'],
        where: callWhere,
        _count: { id: true },
      }),
      
      this.prisma.order.aggregate({
        where: { ...where, result: { not: null } },
        _sum: { result: true },
      }),
      
      this.prisma.order.aggregate({
        where: { ...where, expenditure: { not: null } },
        _sum: { expenditure: true },
      }),
      
      // Для расчета среднего времени закрытия
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
        take: 1000, // Ограничиваем выборку
      }),
      
      // Для расчета среднего времени назначения
      this.prisma.order.findMany({
        where: {
          ...where,
          masterId: { not: null },
          dateMeeting: { not: null },
        },
        select: {
          createDate: true,
          dateMeeting: true,
        },
        take: 1000,
      }),
    ]);

    // Агрегируем результаты
    const ordersByStatus = new Map<string, number>();
    orderStats.forEach(stat => {
      ordersByStatus.set(stat.statusOrder, stat._count.id);
    });

    const callsByStatus = new Map<string, number>();
    callStats.forEach(stat => {
      callsByStatus.set(stat.status, stat._count.id);
    });

    const totalOrders = Array.from(ordersByStatus.values()).reduce((sum, count) => sum + count, 0);
    const completedOrders = ordersByStatus.get('Закрыт') || 0;
    const cancelledOrders = ordersByStatus.get('Отменен') || 0;

    const totalCalls = Array.from(callsByStatus.values()).reduce((sum, count) => sum + count, 0);
    const answeredCalls = callsByStatus.get('answered') || 0;
    const missedCalls = callsByStatus.get('missed') || 0;

    // Вычисляем средние времена
    const completionTimes = completionTimeOrders
      .map(o => {
        if (o.closingData && o.createDate) {
          return (new Date(o.closingData).getTime() - o.createDate.getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter(t => t !== null) as number[];

    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    const assignTimes = assignTimeOrders
      .map(o => {
        if (o.dateMeeting && o.createDate) {
          return (new Date(o.dateMeeting).getTime() - o.createDate.getTime()) / (1000 * 60 * 60);
        }
        return null;
      })
      .filter(t => t !== null) as number[];

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
          revenue: revenueTotal,
          expenditure: expenditureTotal,
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

