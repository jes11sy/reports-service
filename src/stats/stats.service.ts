import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatsService {
  private readonly logger = new Logger(StatsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Получить статистику оператора
   */
  async getOperatorStats(operatorId: number, startDate?: string, endDate?: string) {
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

    // Оптимизированная статистика звонков
    const callsStats = await this.prisma.call.groupBy({
      by: ['status'],
      where: callWhere,
      _count: {
        id: true,
      },
    });

    const acceptedCalls = callsStats
      .filter(stat => stat.status === 'answered')
      .reduce((sum, stat) => sum + stat._count.id, 0);
    const missedCalls = callsStats
      .filter(stat => ['missed', 'no_answer', 'busy'].includes(stat.status))
      .reduce((sum, stat) => sum + stat._count.id, 0);
    
    // Всего звонков = принятые + пропущенные
    const totalCalls = acceptedCalls + missedCalls;

    // Средняя длительность звонков
    const avgCallDuration = await this.prisma.call.aggregate({
      where: { ...callWhere, duration: { not: null } },
      _avg: { duration: true },
    });

    // Статистика заказов
    const ordersStats = await this.prisma.order.aggregate({
      where: orderWhere,
      _count: { id: true },
    });

    // Заказы по статусам
    const ordersByStatus = await this.prisma.order.groupBy({
      by: ['statusOrder'],
      where: orderWhere,
      _count: { id: true },
    });

    // Статистика по дням (только принятые звонки за последние 7 дней)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const dailyStats = await this.prisma.call.groupBy({
      by: ['dateCreate'],
      where: {
        operatorId,
        status: 'answered',
        dateCreate: {
          gte: sevenDaysAgo,
          lte: end,
        },
      },
      _count: { id: true },
      orderBy: { dateCreate: 'asc' },
    });

    const dailyStatsFormatted = dailyStats.map(stat => ({
      date: stat.dateCreate.toISOString().split('T')[0],
      calls: stat._count?.id || 0,
    }));

    // Статистика по городам (только принятые звонки)
    const cityStats = await this.prisma.call.groupBy({
      by: ['city'],
      where: {
        ...callWhere,
        status: 'answered',
      },
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
    });

    // Статистика по РК (только принятые звонки)
    const rkStats = await this.prisma.call.groupBy({
      by: ['rk'],
      where: {
        ...callWhere,
        status: 'answered',
      },
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
    });

    // Выручка
    const totalRevenue = await this.prisma.order.aggregate({
      where: { ...orderWhere, result: { not: null } },
      _sum: { result: true },
    });

    const completedOrders = ordersByStatus.find(s => s.statusOrder === 'Закрыт')?._count.id || 0;
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
        total: totalCalls,  // принятые + пропущенные
        accepted: acceptedCalls,  // принятые
        missed: missedCalls,  // пропущенные
        acceptanceRate: totalCalls > 0 ? Math.round((acceptedCalls / totalCalls) * 100) : 0,
        avgDuration: Math.round(avgCallDuration._avg.duration || 0),
      },
      orders: {
        total: ordersStats._count.id,  // созданные заказы данным оператором
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

    this.logger.log(`Статистика оператора ${operator.name} получена`, {
      operatorId,
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    return response;
  }

  /**
   * Получить общую статистику
   */
  async getOverallStats(startDate?: string, endDate?: string) {
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

    // Общая статистика звонков
    const totalCalls = await this.prisma.call.count({ where: callWhere });
    const acceptedCalls = await this.prisma.call.count({
      where: { ...callWhere, status: 'answered' },
    });
    const missedCalls = await this.prisma.call.count({
      where: {
        ...callWhere,
        status: { in: ['missed', 'no_answer', 'busy'] },
      },
    });

    // Общая статистика заказов
    const totalOrders = await this.prisma.order.count({ where: orderWhere });

    // Статистика по операторам
    const operatorStats = await this.prisma.call.groupBy({
      by: ['operatorId'],
      where: callWhere,
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
    });

    // Получаем имена операторов
    const operatorIds = operatorStats.map(stat => stat.operatorId);
    const operators = await this.prisma.callcentreOperator.findMany({
      where: {
        id: { in: operatorIds },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const operatorMap = operators.reduce((acc, op) => {
      acc[op.id] = op.name;
      return acc;
    }, {} as Record<number, string>);

    // Статистика по городам
    const cityStats = await this.prisma.call.groupBy({
      by: ['city'],
      where: callWhere,
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
    });

    // Статистика по РК
    const rkStats = await this.prisma.call.groupBy({
      by: ['rk'],
      where: callWhere,
      _count: { id: true },
      orderBy: {
        _count: { id: 'desc' },
      },
    });

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

    this.logger.log('Общая статистика получена', {
      period: `${start.toISOString()} - ${end.toISOString()}`,
      calls: response.calls.total,
      orders: response.orders.total,
    });

    return response;
  }

  /**
   * Получить статистику для главного дашборда админки
   */
  async getDashboardStats() {
    // Получаем количество сотрудников по типам
    const [callCenterEmployees, directors, masters] = await Promise.all([
      this.prisma.callcentreOperator.count({
        where: { statusWork: 'active' } // У операторов - 'active'!
      }),
      this.prisma.director.count(), // У директоров нет поля statusWork
      this.prisma.master.count({
        where: { statusWork: 'работает' } // У мастеров - 'работает'!
      })
    ]);

    // Получаем количество заказов
    const orders = await this.prisma.order.count();

    // Финансовая статистика - суммируем все закрытые заказы
    const closedOrders = await this.prisma.order.findMany({
      where: {
        statusOrder: 'Закрыт',
        result: { not: null }
      },
      select: {
        result: true,
        expenditure: true,
        clean: true,
      }
    });

    // Считаем финансы
    let revenue = 0;
    let expenses = 0;
    let profit = 0;

    closedOrders.forEach(order => {
      const orderRevenue = Number(order.result) || 0;
      const orderExpenses = (Number(order.expenditure) || 0) + (Number(order.clean) || 0);
      
      revenue += orderRevenue;
      expenses += orderExpenses;
      profit += (orderRevenue - orderExpenses);
    });

    // Авито: средняя цена заказа с Авито за последний месяц
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    const avitoOrders = await this.prisma.order.findMany({
      where: {
        statusOrder: 'Закрыт',
        result: { not: null },
        avitoChatId: { not: null }, // Заказы с Авито
        closingData: {
          gte: oneMonthAgo
        }
      },
      select: {
        result: true
      }
    });

    let avitoOrderPrice = 0;
    if (avitoOrders.length > 0) {
      const totalAvitoRevenue = avitoOrders.reduce((sum, order) => sum + (Number(order.result) || 0), 0);
      avitoOrderPrice = Math.round(totalAvitoRevenue / avitoOrders.length);
    }

    const response = {
      employees: {
        callCenter: callCenterEmployees,
        directors: directors,
        masters: masters
      },
      orders: orders,
      finance: {
        revenue: Math.round(revenue),
        profit: Math.round(profit),
        expenses: Math.round(expenses)
      },
      avito: {
        orderPrice: avitoOrderPrice
      }
    };

    this.logger.log('Статистика дашборда получена', {
      employees: response.employees,
      orders: response.orders,
      finance: response.finance
    });

    return response;
  }
}


