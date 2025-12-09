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

  async getMastersReport(query: any, user?: any) {
    const { startDate, endDate, masterId } = query;

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    if (masterId) orderWhere.masterId = +masterId;

    // Фильтрация по городам директора
    let masters;
    if (user?.role === 'director' && user?.cities) {
      // Для директора показываем только мастеров его городов
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

    // Для каждого мастера создаем записи по каждому его городу
    const masterStats = [];
    
    for (const master of masters) {
      for (const city of master.cities) {
        // Проверяем, что город входит в список городов директора
        if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
          continue;
        }
        
        const cityWhere = { ...orderWhere, masterId: master.id, city };
        
        const [totalOrders, completedOrders, totalRevenue, totalExpenditure] = await Promise.all([
          // Всего заказов = Готово + Отказ
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: { in: ['Готово', 'Отказ'] } } }),
          // Заказы со статусом Готово
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово' } }),
          // Сумма чистыми только по статусу Готово
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', clean: { not: null } },
            _sum: { clean: true },
          }),
          // Сумма сдача мастера только по статусу Готово
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', masterChange: { not: null } },
            _sum: { masterChange: true },
          }),
        ]);

        const revSum = totalRevenue._sum.clean ? Number(totalRevenue._sum.clean) : 0;
        const expSum = totalExpenditure._sum.masterChange ? Number(totalExpenditure._sum.masterChange) : 0;
        // Средний чек = сумма чистыми / (Готово + Отказ)
        const avgCheck = totalOrders > 0 ? revSum / totalOrders : 0;

        masterStats.push({
          masterId: master.id,
          masterName: master.name,
          city,
          totalOrders, // Готово + Отказ
          turnover: revSum, // Сумма чистыми (только Готово)
          avgCheck, // Сумма чистыми / (Готово + Отказ)
          salary: expSum, // Сумма сдача мастера (только Готово)
        });
      }
    }

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

  async getCityReport(query: any, user?: any) {
    console.log('=== getCityReport START ===');
    console.log('getCityReport called with user:', user);
    console.log('getCityReport called with query:', query);
    const { startDate, endDate, city } = query;

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    
    // Фильтрация по городам директора НЕ применяем здесь - будем фильтровать в цикле
    
    // Если указан конкретный город, он должен быть в списке городов директора
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        // Если директор пытается посмотреть город, которого нет в его списке
        return { success: true, data: [] };
      }
      orderWhere.city = city;
    }

    // Получаем уникальные города
    let cities;
    if (user?.role === 'director' && user?.cities) {
      // Для директора показываем только его города (точное совпадение)
      console.log('Director cities:', user.cities);
      cities = user.cities.map(cityName => ({ city: cityName }));
      console.log('Filtered cities for director:', cities);
    } else {
      // Для других ролей получаем все города из базы
      cities = await this.prisma.order.findMany({
        select: { city: true },
        distinct: ['city'],
        where: orderWhere,
      });
    }

    // Для каждого города считаем статистику
    const cityStats = await Promise.all(
      cities.map(async (cityData) => {
        const cityWhere = { ...orderWhere, city: cityData.city };
        
        // Для директора дополнительно проверяем, что город в его списке
        if (user?.role === 'director' && user?.cities && !user.cities.includes(cityData.city)) {
          return null; // Пропускаем город, которого нет у директора
        }
        
        const [
          totalOrders,        // Всего заказов (Готово + Отказ + Незаказ)
          completedOrders,    // Выполненных (Готово)
          refusals,           // Отказов
          notOrders,          // Незаказ
          zeroOrders,         // Ноль (Готово/Отказ с clean=0 или null)
          completedWithMoney, // Выполненных в деньги (Готово с clean > 0)
          totalClean,         // Сумма чистыми - Оборот
          totalMasterChange,  // Сумма сдача мастера - Прибыль
          maxCheck,           // Максимальный чек (по clean)
          microCheckCount,    // Микрочек (до 10к) - Готово с clean < 10000 и > 0
          over10kCount,       // От 10к - Готово с clean >= 10000
          modernOrders,       // СД - кол-во заказов со статусом Модерн
        ] = await Promise.all([
          // Всего заказов = Готово + Отказ + Незаказ
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: { in: ['Готово', 'Отказ', 'Незаказ'] } } }),
          // Выполненных = Готово
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово' } }),
          // Отказов
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Отказ' } }),
          // Незаказ
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Незаказ' } }),
          // Ноль = Готово/Отказ с clean=0 или null
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: { in: ['Готово', 'Отказ'] }, OR: [{ clean: 0 }, { clean: null }] } }),
          // Выполненных в деньги = Готово с clean > 0
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово', clean: { gt: 0 } } }),
          // Оборот = сумма чистыми только по статусу "Готово"
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', clean: { not: null } },
            _sum: { clean: true },
          }),
          // Прибыль = сумма сдача мастера только по статусу "Готово"
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', masterChange: { not: null } },
            _sum: { masterChange: true },
          }),
          // Максимальный чек (по clean)
          this.prisma.order.aggregate({
            where: { ...cityWhere, statusOrder: 'Готово', clean: { not: null, gt: 0 } },
            _max: { clean: true },
          }),
          // Микрочек (до 10к) - Готово с clean > 0 и < 10000
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово', clean: { gt: 0, lt: 10000 } } }),
          // От 10к - Готово с clean >= 10000
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Готово', clean: { gte: 10000 } } }),
          // СД = кол-во заказов со статусом Модерн
          this.prisma.order.count({ where: { ...cityWhere, statusOrder: 'Модерн' } }),
        ]);

        // Получаем данные по кассе для города (без фильтрации по дате)
        const cashWhere: any = { city: cityData.city };
        
        // Считаем приходы и расходы отдельно
        const [incomeData, expenseData] = await Promise.all([
          this.prisma.cash.aggregate({
            where: { ...cashWhere, name: 'приход' },
            _sum: { amount: true },
          }),
          this.prisma.cash.aggregate({
            where: { ...cashWhere, name: 'расход' },
            _sum: { amount: true },
          }),
        ]);
        
        const income = incomeData._sum.amount ? Number(incomeData._sum.amount) : 0;
        const expense = expenseData._sum.amount ? Number(expenseData._sum.amount) : 0;
        const totalAmount = income - expense;

        // Расчёты
        const turnover = totalClean._sum.clean ? Number(totalClean._sum.clean) : 0; // Оборот = сумма чистыми
        const profit = totalMasterChange._sum.masterChange ? Number(totalMasterChange._sum.masterChange) : 0; // Прибыль = сумма сдача мастера
        const maxCheckValue = maxCheck._max.clean ? Number(maxCheck._max.clean) : 0; // Макс чек (по clean)
        
        // Закрытые заказы (для обратной совместимости) = Готово + Отказ
        const closedOrders = completedOrders + refusals;
        
        // Средний чек = Оборот / Выполненных (Готово)
        const avgCheck = completedOrders > 0 ? turnover / completedOrders : 0;
        
        // Выполненных в деньги (%) = Готово с clean > 0 / (Готово + Отказ) * 100
        const completedPercent = closedOrders > 0 ? (completedWithMoney / closedOrders) * 100 : 0;
        
        // Эффективность = (Выполненных + СД) / (Заказов - Не заказ) * 100
        const ordersWithoutNotOrders = totalOrders - notOrders;
        const efficiency = ordersWithoutNotOrders > 0 ? ((completedOrders + modernOrders) / ordersWithoutNotOrders) * 100 : 0;

        return {
          city: cityData.city,
          orders: {
            closedOrders,       // Для обратной совместимости
            refusals,
            notOrders,
            totalClean: turnover, // Для обратной совместимости
            totalMasterChange: profit, // Для обратной совместимости
            avgCheck,           // Для обратной совместимости
          },
          // Новые расширенные поля
          stats: {
            turnover,           // Оборот = сумма чистыми
            profit,             // Прибыль = сумма сдача мастера
            totalOrders,        // Заказов (всего)
            notOrders,          // Не заказ
            zeroOrders,         // Ноль
            completedOrders,    // Выполненных
            completedPercent,   // Вып в деньги (%)
            microCheckCount,    // Микрочек (до 10к)
            over10kCount,       // От 10к
            efficiency,         // Эффективность
            avgCheck,           // Ср чек
            maxCheck: maxCheckValue, // Макс чек
            masterHandover: modernOrders,     // СД = кол-во Модерн
          },
          cash: {
            totalAmount: totalAmount,
          },
        };
      })
    );

    return {
      success: true,
      data: cityStats.filter(stat => stat !== null),
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

  async getCampaignsReport(query: any, user?: any) {
    console.log('=== getCampaignsReport START ===');
    console.log('getCampaignsReport called with user:', user);
    console.log('getCampaignsReport called with query:', query);
    
    const { startDate, endDate, city } = query;

    const orderWhere: any = {};
    
    // Фильтр по датам (используем closingData для закрытых заказов)
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }
    
    // Если указан конкретный город
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        // Если директор пытается посмотреть город, которого нет в его списке
        return { success: true, data: [] };
      }
      orderWhere.city = city;
    }

    // Получаем уникальные города
    let cities;
    if (user?.role === 'director' && user?.cities) {
      // Для директора показываем только его города
      console.log('Director cities:', user.cities);
      cities = user.cities.map(cityName => ({ city: cityName }));
      console.log('Filtered cities for director:', cities);
    } else {
      // Для других ролей получаем все города из базы
      cities = await this.prisma.order.findMany({
        select: { city: true },
        distinct: ['city'],
        where: orderWhere,
      });
    }

    // Для каждого города получаем статистику по РК и мастерам
    const cityReports = await Promise.all(
      cities.map(async (cityData) => {
        const cityWhere = { ...orderWhere, city: cityData.city };
        
        // Для директора дополнительно проверяем, что город в его списке
        if (user?.role === 'director' && user?.cities && !user.cities.includes(cityData.city)) {
          return null; // Пропускаем город, которого нет у директора
        }
        
        // Получаем уникальные комбинации РК и avitoName для этого города
        const campaigns = await this.prisma.order.groupBy({
          by: ['rk', 'avitoName'],
          where: {
            ...cityWhere,
            statusOrder: { in: ['Готово', 'Отказ'] } // Учитываем только закрытые заказы
          },
          _count: {
            id: true
          },
          _sum: {
            clean: true,         // Оборот (сумма чистыми)
            masterChange: true   // Выручка (сдача мастера)
          }
        });

        // Форматируем данные по кампаниям
        const campaignsData = campaigns.map(campaign => ({
          rk: campaign.rk,
          avitoName: campaign.avitoName,
          ordersCount: campaign._count.id,
          revenue: campaign._sum.clean ? Number(campaign._sum.clean) : 0,           // Оборот = чистыми
          profit: campaign._sum.masterChange ? Number(campaign._sum.masterChange) : 0  // Выручка = сдача мастера
        }));

        return {
          city: cityData.city,
          campaigns: campaignsData
        };
      })
    );

    return {
      success: true,
      data: cityReports.filter(report => report !== null),
    };
  }
}




