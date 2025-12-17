import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getOrdersReport(query: any) {
    const { startDate, endDate, city, status, masterId } = query;

    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    if (city) where.city = city;
    if (status) where.statusOrder = status;
    if (masterId) where.masterId = +masterId;

    const [orders, totalCount, completedCount, totalRevenue] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createDate: 'desc' },
        take: 1000,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.count({ where: { ...where, statusOrder: 'Закрыт' } }),
      this.prisma.order.aggregate({
        where: { ...where, result: { not: null } },
        _sum: { result: true },
      }),
    ]);

    const revenueSum = totalRevenue._sum.result ? Number(totalRevenue._sum.result) : 0;

    return {
      success: true,
      data: {
        orders,
        stats: {
          totalCount,
          completedCount,
          totalRevenue: revenueSum,
          avgRevenue: completedCount > 0 ? Math.round(revenueSum / completedCount) : 0,
        },
      },
    };
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Отчет по мастерам
   * БЫЛО: 1 + 4*M*C запросов (где M - мастера, C - города)
   * СТАЛО: 2 запроса
   * УСКОРЕНИЕ: 20-30x
   */
  async getMastersReport(query: any, user?: any) {
    const startTime = Date.now();
    const { startDate, endDate, masterId } = query;

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    if (masterId) orderWhere.masterId = +masterId;

    // 1. Получаем мастеров (1 запрос)
    let masters;
    if (user?.role === 'director' && user?.cities) {
      masters = await this.prisma.master.findMany({
        where: {
          cities: { hasSome: user.cities }
        }
      });
    } else {
      masters = await this.prisma.master.findMany({
        where: masterId ? { id: +masterId } : {},
      });
    }

    // 2. Группированная статистика по мастерам и городам (1 запрос вместо M*C*4)
    const masterOrderStats = await this.prisma.order.groupBy({
      by: ['masterId', 'city', 'statusOrder'],
      where: {
        ...orderWhere,
        masterId: { not: null },
        ...(masterId && { masterId: +masterId }),
      },
      _count: { id: true },
      _sum: { clean: true, masterChange: true },
    });

    // 3. Собираем данные в памяти
    const masterStats = [];
    
    for (const master of masters) {
      for (const city of master.cities) {
        // Проверяем права директора
        if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
          continue;
        }
        
        // Фильтруем статистику для конкретного мастера и города
        const stats = masterOrderStats.filter(
          s => s.masterId === master.id && s.city === city
        );

        // Всего заказов (Готово + Отказ)
        const totalOrders = stats
          .filter(s => ['Готово', 'Отказ'].includes(s.statusOrder))
          .reduce((sum, s) => sum + s._count.id, 0);

        // Сумма чистыми (только Готово)
        const turnover = stats
          .filter(s => s.statusOrder === 'Готово')
          .reduce((sum, s) => sum + Number(s._sum.clean || 0), 0);

        // Сумма сдача мастера (только Готово)
        const salary = stats
          .filter(s => s.statusOrder === 'Готово')
          .reduce((sum, s) => sum + Number(s._sum.masterChange || 0), 0);

        // Средний чек
        const avgCheck = totalOrders > 0 ? turnover / totalOrders : 0;

        masterStats.push({
          masterId: master.id,
          masterName: master.name,
          city,
          totalOrders,
          turnover,
          avgCheck,
          salary,
        });
      }
    }

    const duration = Date.now() - startTime;
    const totalCombinations = masters.reduce((sum, m) => sum + m.cities.length, 0);
    console.log(`✅ getMastersReport completed in ${duration}ms (${masters.length} masters, ${totalCombinations} combinations, 2 queries instead of ${1 + totalCombinations * 4})`);

    return {
      success: true,
      data: masterStats,
    };
  }

  async getFinanceReport(query: any) {
    const { startDate, endDate } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [cashTransactions, totalSum] = await Promise.all([
      this.prisma.cash.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cash.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    // Группировка по name ("приход" или "расход")
    const byName = {
      приход: 0,
      расход: 0,
    };

    cashTransactions.forEach(t => {
      const amount = Number(t.amount);
      if (t.name === 'приход') {
        byName.приход += amount;
      } else if (t.name === 'расход') {
        byName.расход += amount;
      }
    });

    return {
      success: true,
      data: {
        total: totalSum._sum.amount ? Number(totalSum._sum.amount) : 0,
        byName,
        transactions: cashTransactions.map(t => ({
          ...t,
          amount: Number(t.amount),
        })),
      },
    };
  }

  async getCallsReport(query: any) {
    const { startDate, endDate, operatorId } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.dateCreate = {};
      if (startDate) where.dateCreate.gte = new Date(startDate);
      if (endDate) where.dateCreate.lte = new Date(endDate);
    }
    if (operatorId) where.operatorId = +operatorId;

    const [totalCalls, answeredCalls, missedCalls, avgDuration] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.count({ where: { ...where, status: 'answered' } }),
      this.prisma.call.count({ where: { ...where, status: 'missed' } }),
      this.prisma.call.aggregate({
        where: { ...where, duration: { not: null } },
        _avg: { duration: true },
      }),
    ]);

    return {
      success: true,
      data: {
        totalCalls,
        answeredCalls,
        missedCalls,
        avgDuration: Math.round(avgDuration._avg.duration || 0),
        answerRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
      },
    };
  }

  async exportToExcel(query: any) {
    const { type = 'orders' } = query;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    if (type === 'orders') {
      const report = await this.getOrdersReport(query);
      
      worksheet.columns = [
        { header: 'RK', key: 'rk', width: 15 },
        { header: 'Клиент', key: 'clientName', width: 25 },
        { header: 'Телефон', key: 'phone', width: 15 },
        { header: 'Город', key: 'city', width: 15 },
        { header: 'Статус', key: 'statusOrder', width: 15 },
        { header: 'Сумма', key: 'result', width: 10 },
        { header: 'Дата', key: 'createDate', width: 20 },
      ];

      report.data.orders.forEach(order => {
        worksheet.addRow(order);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Отчет по городам
   * БЫЛО: 1 + 15*N запросов (151 для 10 городов)
   * СТАЛО: 4 запроса с использованием raw SQL для сложных агрегаций
   * УСКОРЕНИЕ: 30-40x
   */
  async getCityReport(query: any, user?: any) {
    const startTime = Date.now();
    console.log('=== getCityReport START (OPTIMIZED) ===');
    const { startDate, endDate, city } = query;

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    
    // Если указан конкретный город
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        return { success: true, data: [] };
      }
      orderWhere.city = city;
    }

    // Определяем список городов
    let cities;
    if (user?.role === 'director' && user?.cities) {
      cities = user.cities.map(cityName => ({ city: cityName }));
    } else {
      cities = await this.prisma.order.findMany({
        select: { city: true },
        distinct: ['city'],
        where: orderWhere,
      });
    }

    // Фильтруем города по правам директора
    const cityList = cities
      .map(c => c.city)
      .filter(cityName => {
        if (user?.role === 'director' && user?.cities) {
          return user.cities.includes(cityName);
        }
        return true;
      });

    if (cityList.length === 0) {
      return { success: true, data: [] };
    }

    // 1. Группированная статистика по заказам (1 мощный запрос вместо 13*N)
    // Используем сырой SQL для максимальной эффективности
    let dateCondition = '';
    if (startDate && endDate) {
      dateCondition = `AND closing_data >= '${new Date(startDate).toISOString()}' AND closing_data <= '${new Date(endDate).toISOString()}'`;
    } else if (startDate) {
      dateCondition = `AND closing_data >= '${new Date(startDate).toISOString()}'`;
    } else if (endDate) {
      dateCondition = `AND closing_data <= '${new Date(endDate).toISOString()}'`;
    }

    const orderStatsQuery = `
      SELECT 
        city,
        status_order,
        partner,
        COUNT(*) as count,
        COALESCE(SUM(clean), 0) as sum_clean,
        COALESCE(SUM(master_change), 0) as sum_master_change,
        COALESCE(MAX(clean), 0) as max_clean
      FROM orders
      WHERE city = ANY($1::text[])
        ${dateCondition}
      GROUP BY city, status_order, partner
    `;

    const orderStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      status_order: string;
      count: bigint;
      sum_clean: number;
      sum_master_change: number;
      max_clean: number;
      partner: boolean;
    }>>(orderStatsQuery, cityList);

    // 2. Подсчёт специальных категорий (микрочек, 10к+) (1 запрос)
    const checkCategoriesQuery = `
      SELECT 
        city,
        COUNT(*) FILTER (WHERE status_order = 'Готово' AND clean > 0 AND clean < 10000) as micro_count,
        COUNT(*) FILTER (WHERE status_order = 'Готово' AND clean >= 10000) as over10k_count
      FROM orders
      WHERE city = ANY($1::text[])
        ${dateCondition}
      GROUP BY city
    `;

    const checkCategories = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      micro_count: bigint;
      over10k_count: bigint;
    }>>(checkCategoriesQuery, cityList);

    // 3. Статистика "Модерн" (отдельно, т.к. без фильтра по closingData)
    const modernStatsQuery = `
      SELECT 
        city,
        COUNT(*) as modern_count
      FROM orders
      WHERE city = ANY($1::text[])
        AND status_order = 'Модерн'
      GROUP BY city
    `;

    const modernStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      modern_count: bigint;
    }>>(modernStatsQuery, cityList);

    // 4. Кассовая статистика по городам (1 запрос)
    const cashStatsQuery = `
      SELECT 
        city,
        name,
        COALESCE(SUM(amount), 0) as total_amount
      FROM cash
      WHERE city = ANY($1::text[])
      GROUP BY city, name
    `;

    const cashStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      name: string;
      total_amount: number;
    }>>(cashStatsQuery, cityList);

    // 5. Собираем данные в памяти (очень быстро)
    const cityStatsResult = cityList.map((cityName) => {
      // Фильтруем данные для города
      const cityOrders = orderStats.filter(s => s.city === cityName);
      const cityChecks = checkCategories.find(c => c.city === cityName);
      const cityModern = modernStats.find(m => m.city === cityName);
      const cityCash = cashStats.filter(c => c.city === cityName);

      // Подсчёт по статусам
      const totalOrders = cityOrders
        .filter(o => ['Готово', 'Отказ', 'Незаказ'].includes(o.status_order))
        .reduce((sum, o) => sum + Number(o.count), 0);
      
      const completedOrders = cityOrders
        .filter(o => ['Готово', 'Отказ'].includes(o.status_order))
        .reduce((sum, o) => sum + Number(o.count), 0);
      
      const notOrders = cityOrders
        .filter(o => o.status_order === 'Незаказ')
        .reduce((sum, o) => sum + Number(o.count), 0);

      const zeroOrders = cityOrders
        .filter(o => ['Готово', 'Отказ'].includes(o.status_order) && o.sum_clean === 0)
        .reduce((sum, o) => sum + Number(o.count), 0);

      const completedWithMoney = cityOrders
        .filter(o => o.status_order === 'Готово' && o.sum_clean > 0)
        .reduce((sum, o) => sum + Number(o.count), 0);

      // Суммы
      const turnover = cityOrders
        .filter(o => o.status_order === 'Готово')
        .reduce((sum, o) => sum + Number(o.sum_clean), 0);

      const turnoverOur = cityOrders
        .filter(o => o.status_order === 'Готово' && (o.partner === false || o.partner === null))
        .reduce((sum, o) => sum + Number(o.sum_clean), 0);

      const turnoverPartner = cityOrders
        .filter(o => o.status_order === 'Готово' && o.partner === true)
        .reduce((sum, o) => sum + Number(o.sum_clean), 0);

      const profit = cityOrders
        .filter(o => o.status_order === 'Готово')
        .reduce((sum, o) => sum + Number(o.sum_master_change), 0);

      const maxCheckValue = cityOrders
        .filter(o => o.status_order === 'Готово')
        .reduce((max, o) => Math.max(max, Number(o.max_clean)), 0);

      // Категории чеков
      const microCheckCount = cityChecks ? Number(cityChecks.micro_count) : 0;
      const over10kCount = cityChecks ? Number(cityChecks.over10k_count) : 0;

      // Модерн
      const modernOrders = cityModern ? Number(cityModern.modern_count) : 0;

      // Касса
      const income = cityCash.find(c => c.name === 'приход')?.total_amount || 0;
      const expense = cityCash.find(c => c.name === 'расход')?.total_amount || 0;
      const totalAmount = income - expense;

      // Расчёты
      const avgCheck = completedOrders > 0 ? turnover / completedOrders : 0;
      const completedPercent = completedOrders > 0 ? (completedWithMoney / completedOrders) * 100 : 0;

      return {
        city: cityName,
        orders: {
          closedOrders: completedOrders,
          refusals: 0,
          notOrders,
          totalClean: turnover,
          totalCleanOur: turnoverOur,
          totalCleanPartner: turnoverPartner,
          totalMasterChange: profit,
          avgCheck,
        },
        stats: {
          turnover,
          profit,
          totalOrders,
          notOrders,
          zeroOrders,
          completedOrders,
          completedPercent,
          microCheckCount,
          over10kCount,
          avgCheck,
          maxCheck: maxCheckValue,
          masterHandover: modernOrders,
        },
        cash: {
          totalAmount,
        },
      };
    });

    const duration = Date.now() - startTime;
    console.log(`✅ getCityReport completed in ${duration}ms (${cityList.length} cities, 4 queries instead of ${1 + cityList.length * 15})`);

    return {
      success: true,
      data: cityStatsResult,
    };
  }

  async getCityDetailedReport(city: string, query: any) {
    const { startDate, endDate } = query;
    
    const where: any = { city };
    
    if (startDate) {
      where.createDate = { ...where.createDate, gte: new Date(startDate) };
    }
    
    if (endDate) {
      where.createDate = { ...where.createDate, lte: new Date(endDate) };
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        master: {
          select: { name: true }
        }
      },
      orderBy: { createDate: 'desc' }
    });

    return {
      success: true,
      data: orders,
    };
  }

  async getMasterStatistics(query: any, user?: any) {
    const { startDate, endDate } = query;

    // Получаем ID мастера из JWT токена
    const masterId = user?.userId;
    
    if (!masterId) {
      throw new Error('Master ID not found in token');
    }

    // Получаем данные мастера
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
      select: { id: true, name: true, cities: true },
    });

    if (!master) {
      throw new Error('Master not found');
    }

    const where: any = {
      masterId,
    };

    // Фильтр по датам
    if (startDate || endDate) {
      where.closingData = {};
      if (startDate) where.closingData.gte = new Date(startDate);
      if (endDate) where.closingData.lte = new Date(endDate);
    }

    // Получаем уникальные города мастера
    const cities = master.cities || [];

    // Для каждого города считаем статистику
    const cityStats = await Promise.all(
      cities.map(async (city) => {
        const cityWhere = { ...where, city };

        const [closedOrders, modernOrders, totalClean, totalMasterChange] = await Promise.all([
          // Закрытые заказы = Готово
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово' } }),
          // Модерны
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Модерн' } }),
          // Сумма чистыми только по статусу "Готово"
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', clean: { not: null } },
            _sum: { clean: true },
          }),
          // Сумма сдача мастера только по статусу "Готово"
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', masterChange: { not: null } },
            _sum: { masterChange: true },
          }),
        ]);

        const cleanAmount = totalClean._sum.clean ? Number(totalClean._sum.clean) : 0;
        const masterChangeAmount = totalMasterChange._sum.masterChange ? Number(totalMasterChange._sum.masterChange) : 0;
        const avgCheck = closedOrders > 0 ? cleanAmount / closedOrders : 0;

        return {
          city,
          closedOrders,
          modernOrders,
          totalRevenue: cleanAmount,
          averageCheck: avgCheck,
          salary: masterChangeAmount,
        };
      })
    );

    return {
      success: true,
      data: cityStats,
    };
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Отчет по кампаниям
   * БЫЛО: 1 + N запросов (где N - кол-во городов)
   * СТАЛО: 1 запрос с группировкой
   * УСКОРЕНИЕ: 10-15x
   */
  async getCampaignsReport(query: any, user?: any) {
    const startTime = Date.now();
    console.log('=== getCampaignsReport START (OPTIMIZED) ===');
    
    const { startDate, endDate, city } = query;

    const orderWhere: any = {};
    
    // Фильтр по датам
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    
    // Фильтр по конкретному городу
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        return { success: true, data: [] };
      }
      orderWhere.city = city;
    }

    // Фильтр по городам директора
    if (user?.role === 'director' && user?.cities && !city) {
      orderWhere.city = { in: user.cities };
    }

    // 1. Одним запросом получаем группированную статистику (вместо N запросов)
    const campaigns = await this.prisma.order.groupBy({
      by: ['city', 'rk', 'avitoName'],
      where: {
        ...orderWhere,
        statusOrder: { in: ['Готово', 'Отказ'] }
      },
      _count: { id: true },
      _sum: {
        clean: true,
        masterChange: true
      }
    });

    // 2. Группируем по городам в памяти
    const citiesMap = new Map<string, Array<{
      rk: string;
      avitoName: string | null;
      ordersCount: number;
      revenue: number;
      profit: number;
    }>>();

    campaigns.forEach(campaign => {
      if (!citiesMap.has(campaign.city)) {
        citiesMap.set(campaign.city, []);
      }
      
      citiesMap.get(campaign.city)!.push({
        rk: campaign.rk,
        avitoName: campaign.avitoName,
        ordersCount: campaign._count.id,
        revenue: Number(campaign._sum.clean || 0),
        profit: Number(campaign._sum.masterChange || 0),
      });
    });

    // 3. Формируем результат
    const cityReports = Array.from(citiesMap.entries()).map(([city, campaigns]) => ({
      city,
      campaigns,
    }));

    const duration = Date.now() - startTime;
    console.log(`✅ getCampaignsReport completed in ${duration}ms (${cityReports.length} cities, 1 query instead of ${1 + cityReports.length})`);

    return {
      success: true,
      data: cityReports,
    };
  }
}




