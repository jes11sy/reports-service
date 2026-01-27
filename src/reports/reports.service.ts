import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import {
  OrdersReportQueryDto,
  MastersReportQueryDto,
  CallsReportQueryDto,
  ExportQueryDto,
  CampaignsReportQueryDto,
  CashByPurposeQueryDto,
  CityReportQueryDto,
  FinanceReportQueryDto,
} from './dto/reports-query.dto';
import { RequestUser } from '../common/interfaces/user.interface';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  CLOSED_STATUSES,
  CashOperationType,
  CallStatus,
} from '../common/constants/order-statuses';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  
  // Лимиты пагинации из конфигурации
  private readonly DEFAULT_LIMIT: number;
  private readonly MAX_LIMIT: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.DEFAULT_LIMIT = this.configService.get<number>('REPORTS_DEFAULT_LIMIT', 1000);
    this.MAX_LIMIT = this.configService.get<number>('REPORTS_MAX_LIMIT', 5000);
  }

  /**
   * ✅ FIX: Безопасная конвертация BigInt в Number
   * PostgreSQL агрегатные функции (COUNT, SUM) возвращают BigInt
   * Number() теряет точность для значений > Number.MAX_SAFE_INTEGER (2^53 - 1)
   * 
   * Для финансовых данных важно сохранить точность:
   * - Если значение в безопасном диапазоне - возвращаем Number
   * - Если значение слишком большое - логируем warning и возвращаем Number (с потерей точности)
   * 
   * @param value - значение из БД (может быть BigInt, number, string, null, undefined)
   * @param fieldName - имя поля для логирования (опционально)
   * @returns number
   */
  private safeBigIntToNumber(value: bigint | number | string | null | undefined, fieldName?: string): number {
    if (value === null || value === undefined) {
      return 0;
    }
    
    // Если уже number - возвращаем как есть
    if (typeof value === 'number') {
      return value;
    }
    
    // Если string - парсим
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    
    // Если BigInt - проверяем диапазон
    if (typeof value === 'bigint') {
      // Number.MAX_SAFE_INTEGER = 9007199254740991 (2^53 - 1)
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        this.logger.warn(
          `⚠️ BigInt precision loss${fieldName ? ` for ${fieldName}` : ''}: ${value.toString()} exceeds safe integer range`
        );
      }
      return Number(value);
    }
    
    // Fallback для других типов
    return Number(value) || 0;
  }

  /**
   * Отчёт по заказам с пагинацией
   */
  async getOrdersReport(query: OrdersReportQueryDto) {
    const { startDate, endDate, city, status, masterId, limit = this.DEFAULT_LIMIT, offset = 0 } = query;

    // Прогрев соединения перед тяжелыми запросами
    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    const where: any = {};

    if (startDate || endDate) {
      where.createDate = {};
      if (startDate) where.createDate.gte = new Date(startDate);
      if (endDate) where.createDate.lte = new Date(endDate);
    }

    if (city) where.city = city;
    if (status) where.statusOrder = status;
    if (masterId) where.masterId = masterId;

    // Используем транзакцию для согласованности данных
    const [orders, totalCount, completedCount, totalRevenue] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createDate: 'desc' },
        take: Math.min(limit, this.MAX_LIMIT),
        skip: offset,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.count({ where: { ...where, statusOrder: OrderStatus.COMPLETED } }),
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
        pagination: {
          limit: Math.min(limit, this.MAX_LIMIT),
          offset,
          total: totalCount,
          hasMore: offset + orders.length < totalCount,
        },
      },
    };
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Отчет по мастерам
   * БЫЛО: 1 + 4*M*C запросов (где M - мастера, C - города)
   * СТАЛО: 2 запроса
   */
  async getMastersReport(query: MastersReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate, masterId } = query;

    // Прогрев соединения
    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.closingData.lte = end;
      }
    }
    if (masterId) orderWhere.masterId = masterId;

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
        where: masterId ? { id: masterId } : {},
      });
    }

    // 2. Группированная статистика по мастерам и городам (1 запрос вместо M*C*4)
    const masterOrderStats = await this.prisma.order.groupBy({
      by: ['masterId', 'city', 'statusOrder'],
      where: {
        ...orderWhere,
        masterId: { not: null },
        ...(masterId && { masterId }),
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
          .filter(s => CLOSED_STATUSES.includes(s.statusOrder as any))
          .reduce((sum, s) => sum + s._count.id, 0);

        // Сумма чистыми (только Готово)
        const turnover = stats
          .filter(s => s.statusOrder === OrderStatus.COMPLETED)
          .reduce((sum, s) => sum + Number(s._sum.clean || 0), 0);

        // Сумма сдача мастера (только Готово)
        const salary = stats
          .filter(s => s.statusOrder === OrderStatus.COMPLETED)
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
    this.logger.log(`✅ getMastersReport completed in ${duration}ms (${masters.length} masters, ${totalCombinations} combinations, 2 queries)`);

    return {
      success: true,
      data: masterStats,
    };
  }

  /**
   * Финансовый отчёт с пагинацией
   */
  async getFinanceReport(query: FinanceReportQueryDto) {
    const { startDate, endDate, limit = this.DEFAULT_LIMIT, offset = 0 } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Транзакция для согласованности
    const [cashTransactions, totalCount, totalSum] = await this.prisma.$transaction([
      this.prisma.cash.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, this.MAX_LIMIT),
        skip: offset,
      }),
      this.prisma.cash.count({ where }),
      this.prisma.cash.aggregate({
        where,
        _sum: { amount: true },
      }),
    ]);

    // Группировка по name
    const byName = {
      [CashOperationType.INCOME]: 0,
      [CashOperationType.EXPENSE]: 0,
    };

    cashTransactions.forEach(t => {
      const amount = Number(t.amount);
      if (t.name === CashOperationType.INCOME) {
        byName[CashOperationType.INCOME] += amount;
      } else if (t.name === CashOperationType.EXPENSE) {
        byName[CashOperationType.EXPENSE] += amount;
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
        pagination: {
          limit: Math.min(limit, this.MAX_LIMIT),
          offset,
          total: totalCount,
          hasMore: offset + cashTransactions.length < totalCount,
        },
      },
    };
  }

  /**
   * Отчёт по кассе с группировкой по городам и назначениям платежа
   * ✅ Исправлено: параметризованные SQL запросы
   */
  async getCashByPurpose(query: CashByPurposeQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate, city, purposes } = query;

    // Формируем параметры для параметризованного запроса
    const params: any[] = [];
    let paramIndex = 1;
    
    // Базовые условия
    let dateCondition = '';
    let cityCondition = '';

    if (startDate) {
      dateCondition += ` AND date_create >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }
    
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateCondition += ` AND date_create <= $${paramIndex}`;
      params.push(end);
      paramIndex++;
    }
    
    // Фильтр по городу
    if (city) {
      // Проверка прав директора
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        return { success: true, data: { cities: [], totals: { income: 0, expense: 0, balance: 0 } } };
      }
      cityCondition = ` AND city = $${paramIndex}`;
      params.push(city);
      paramIndex++;
    } else if (user?.role === 'director' && user?.cities?.length) {
      cityCondition = ` AND city = ANY($${paramIndex}::text[])`;
      params.push(user.cities);
      paramIndex++;
    }
    
    // Фильтр по назначениям платежа
    const purposeFilter = purposes 
      ? (Array.isArray(purposes) ? purposes : purposes.split(','))
      : null;

    // ✅ ИСПРАВЛЕНО: Параметризованный SQL запрос
    const cashStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string | null;
      payment_purpose: string | null;
      name: string;
      total_amount: any;
      count: bigint;
    }>>(
      `SELECT 
        city,
        payment_purpose,
        name,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) as count
      FROM cash
      WHERE 1=1 ${dateCondition} ${cityCondition}
      GROUP BY city, payment_purpose, name`,
      ...params
    );
    
    this.logger.debug(`[getCashByPurpose] Raw SQL returned ${cashStats.length} rows`);

    /**
     * Нормализация назначения платежа
     */
    const normalizePurpose = (rawPurpose: string | null): string => {
      if (!rawPurpose) return 'Без назначения';
      if (rawPurpose.toLowerCase().startsWith('заказ')) {
        return 'Заказ';
      }
      return rawPurpose;
    };

    // Собираем данные по городам
    const citiesMap = new Map<string, Map<string, { income: number; expense: number }>>();
    let grandTotalIncome = 0;
    let grandTotalExpense = 0;

    cashStats.forEach(stat => {
      const cityName = stat.city || 'Не указан';
      const purpose = normalizePurpose(stat.payment_purpose);
      const amount = Number(stat.total_amount) || 0;

      // Фильтр по нормализованным назначениям
      if (purposeFilter?.length && !purposeFilter.includes(purpose)) {
        return;
      }

      if (!citiesMap.has(cityName)) {
        citiesMap.set(cityName, new Map());
      }

      const purposeMap = citiesMap.get(cityName)!;
      if (!purposeMap.has(purpose)) {
        purposeMap.set(purpose, { income: 0, expense: 0 });
      }

      const purposeData = purposeMap.get(purpose)!;
      if (stat.name === CashOperationType.INCOME) {
        purposeData.income += amount;
        grandTotalIncome += amount;
      } else if (stat.name === CashOperationType.EXPENSE) {
        purposeData.expense += amount;
        grandTotalExpense += amount;
      }
    });

    // Формируем результат
    const cities = Array.from(citiesMap.entries()).map(([cityName, purposeMap]) => {
      const purposes: any[] = [];
      let cityIncome = 0;
      let cityExpense = 0;

      purposeMap.forEach((data, purpose) => {
        purposes.push({
          purpose,
          income: data.income,
          expense: data.expense,
          balance: data.income - data.expense,
        });
        cityIncome += data.income;
        cityExpense += data.expense;
      });

      purposes.sort((a, b) => (b.income + b.expense) - (a.income + a.expense));

      return {
        city: cityName,
        purposes,
        totalIncome: cityIncome,
        totalExpense: cityExpense,
        balance: cityIncome - cityExpense,
      };
    });

    cities.sort((a, b) => (b.totalIncome + b.totalExpense) - (a.totalIncome + a.totalExpense));

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCashByPurpose completed in ${duration}ms (${cities.length} cities)`);

    return {
      success: true,
      data: {
        cities,
        totals: {
          income: grandTotalIncome,
          expense: grandTotalExpense,
          balance: grandTotalIncome - grandTotalExpense,
        },
      },
    };
  }

  /**
   * Отчёт по звонкам
   */
  async getCallsReport(query: CallsReportQueryDto) {
    const { startDate, endDate, operatorId } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.dateCreate = {};
      if (startDate) where.dateCreate.gte = new Date(startDate);
      if (endDate) where.dateCreate.lte = new Date(endDate);
    }
    if (operatorId) where.operatorId = operatorId;

    // Транзакция для согласованности
    const [totalCalls, answeredCalls, missedCalls, avgDuration] = await this.prisma.$transaction([
      this.prisma.call.count({ where }),
      this.prisma.call.count({ where: { ...where, status: CallStatus.ANSWERED } }),
      this.prisma.call.count({ where: { ...where, status: CallStatus.MISSED } }),
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

  /**
   * Экспорт в Excel
   */
  async exportToExcel(query: ExportQueryDto) {
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
   * ✅ ИСПРАВЛЕНО: SQL Injection - теперь параметризованные запросы
   */
  async getCityReport(query: CityReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    this.logger.debug('=== getCityReport START (OPTIMIZED + SECURED) ===');
    const { startDate, endDate, city } = query;

    // Прогрев соединения
    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    // Определяем список городов
    let cityList: string[];
    
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        return { success: true, data: [] };
      }
      cityList = [city];
    } else if (user?.role === 'director' && user?.cities) {
      cityList = user.cities;
    } else {
      const cities = await this.prisma.order.findMany({
        select: { city: true },
        distinct: ['city'],
      });
      cityList = cities.map(c => c.city).filter(Boolean);
    }

    if (cityList.length === 0) {
      return { success: true, data: [] };
    }

    // ✅ ИСПРАВЛЕНО: Параметризованные запросы вместо конкатенации строк
    const params: any[] = [cityList];
    let paramIndex = 2;

    // Условия для createDate
    let createDateCondition = '';
    let updatedAtCondition = '';
    let closingDataCondition = '';
    
    if (startDate) {
      const startDateValue = new Date(startDate);
      createDateCondition += ` AND create_date >= $${paramIndex}`;
      updatedAtCondition += ` AND updated_at >= $${paramIndex}`;
      closingDataCondition += ` AND closing_data >= $${paramIndex}`;
      params.push(startDateValue);
      paramIndex++;
    }
    
    if (endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      createDateCondition += ` AND create_date <= $${paramIndex}`;
      updatedAtCondition += ` AND updated_at <= $${paramIndex}`;
      closingDataCondition += ` AND closing_data <= $${paramIndex}`;
      params.push(endOfDay);
      paramIndex++;
    }

    // 1. Создано - заказы по createDate
    const totalOrdersStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      total_orders: bigint;
    }>>(
      `SELECT city, COUNT(*) as total_orders
       FROM orders
       WHERE city = ANY($1::text[]) ${createDateCondition}
       GROUP BY city`,
      ...params
    );

    // 2. Незаказы и Отказы - по updatedAt
    const statusByUpdatedAt = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      status_order: string;
      count: bigint;
    }>>(
      `SELECT city, status_order, COUNT(*) as count
       FROM orders
       WHERE city = ANY($1::text[])
         AND status_order IN ($${paramIndex}, $${paramIndex + 1})
         ${updatedAtCondition}
       GROUP BY city, status_order`,
      ...params, OrderStatus.NOT_ORDER, OrderStatus.CANCELLED
    );

    // Обновляем params для следующего запроса
    const paramsForCompleted = [...params];

    // 3. В деньги и категории чеков - по closingData
    const completedOrdersStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      completed_orders: bigint;
      micro_under_1500: bigint;
      micro_1500_10000: bigint;
      over10k_count: bigint;
      max_check: number;
      turnover: number;
      profit: number;
    }>>(
      `SELECT 
        city,
        COUNT(*) FILTER (WHERE status_order = $${paramIndex} AND result > 0) as completed_orders,
        COUNT(*) FILTER (WHERE status_order = $${paramIndex} AND result > 0 AND clean > 0 AND clean < 1500) as micro_under_1500,
        COUNT(*) FILTER (WHERE status_order = $${paramIndex} AND result > 0 AND clean >= 1500 AND clean < 10000) as micro_1500_10000,
        COUNT(*) FILTER (WHERE status_order = $${paramIndex} AND result > 0 AND clean >= 10000) as over10k_count,
        COALESCE(MAX(clean) FILTER (WHERE status_order = $${paramIndex}), 0) as max_check,
        COALESCE(SUM(clean) FILTER (WHERE status_order = $${paramIndex}), 0) as turnover,
        COALESCE(SUM(master_change) FILTER (WHERE status_order = $${paramIndex}), 0) as profit
      FROM orders
      WHERE city = ANY($1::text[]) ${closingDataCondition}
      GROUP BY city`,
      ...paramsForCompleted, OrderStatus.COMPLETED
    );

    // 4. Статистика "Модерн" (без фильтра по датам)
    const modernStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      modern_count: bigint;
    }>>(
      `SELECT city, COUNT(*) as modern_count
       FROM orders
       WHERE city = ANY($1::text[]) AND status_order = $2
       GROUP BY city`,
      cityList, OrderStatus.MODERN
    );

    // 5. Кассовая статистика
    const cashStats = await this.prisma.$queryRawUnsafe<Array<{
      city: string;
      name: string;
      total_amount: number;
    }>>(
      `SELECT city, name, COALESCE(SUM(amount), 0) as total_amount
       FROM cash
       WHERE city = ANY($1::text[])
       GROUP BY city, name`,
      cityList
    );

    // 6. Собираем данные в памяти
    const cityStatsResult = cityList.map((cityName) => {
      const cityTotalOrders = totalOrdersStats.find(s => s.city === cityName);
      const cityStatusUpdated = statusByUpdatedAt.filter(s => s.city === cityName);
      const cityCompleted = completedOrdersStats.find(s => s.city === cityName);
      const cityModern = modernStats.find(m => m.city === cityName);
      const cityCash = cashStats.filter(c => c.city === cityName);

      // ✅ FIX: Используем safeBigIntToNumber для предотвращения потери точности BigInt
      const totalOrders = this.safeBigIntToNumber(cityTotalOrders?.total_orders, 'total_orders');
      const notOrders = this.safeBigIntToNumber(
        cityStatusUpdated.find(s => s.status_order === OrderStatus.NOT_ORDER)?.count,
        'not_orders'
      );
      const zeroOrders = this.safeBigIntToNumber(
        cityStatusUpdated.find(s => s.status_order === OrderStatus.CANCELLED)?.count,
        'zero_orders'
      );

      const completedOrders = this.safeBigIntToNumber(cityCompleted?.completed_orders, 'completed_orders');
      const microUnder1500 = this.safeBigIntToNumber(cityCompleted?.micro_under_1500, 'micro_under_1500');
      const micro1500to10000 = this.safeBigIntToNumber(cityCompleted?.micro_1500_10000, 'micro_1500_10000');
      const over10kCount = this.safeBigIntToNumber(cityCompleted?.over10k_count, 'over10k_count');
      const maxCheckValue = this.safeBigIntToNumber(cityCompleted?.max_check, 'max_check');
      const turnover = this.safeBigIntToNumber(cityCompleted?.turnover, 'turnover');
      const profit = this.safeBigIntToNumber(cityCompleted?.profit, 'profit');

      const modernOrders = this.safeBigIntToNumber(cityModern?.modern_count, 'modern_count');

      const income = this.safeBigIntToNumber(
        cityCash.find(c => c.name === CashOperationType.INCOME)?.total_amount,
        'income'
      );
      const expense = this.safeBigIntToNumber(
        cityCash.find(c => c.name === CashOperationType.EXPENSE)?.total_amount,
        'expense'
      );
      const totalAmount = income - expense;

      const totalClosed = completedOrders + zeroOrders;
      const avgCheck = completedOrders > 0 ? turnover / completedOrders : 0;
      const completedPercent = totalClosed > 0 ? (completedOrders / totalClosed) * 100 : 0;

      return {
        city: cityName,
        orders: {
          closedOrders: totalClosed,
          refusals: zeroOrders,
          notOrders,
          totalClean: turnover,
          totalCleanOur: turnover,
          totalCleanPartner: 0,
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
          microUnder1500,
          micro1500to10000,
          over10kCount,
          microCheckCount: microUnder1500 + micro1500to10000,
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
    this.logger.log(`✅ getCityReport completed in ${duration}ms (${cityList.length} cities)`);

    return {
      success: true,
      data: cityStatsResult,
    };
  }

  /**
   * Детальный отчёт по городу с пагинацией
   */
  async getCityDetailedReport(city: string, query: CityReportQueryDto) {
    const { startDate, endDate, limit = this.DEFAULT_LIMIT, offset = 0 } = query;
    
    const where: any = { city };
    
    if (startDate) {
      where.createDate = { ...where.createDate, gte: new Date(startDate) };
    }
    
    if (endDate) {
      where.createDate = { ...where.createDate, lte: new Date(endDate) };
    }

    const [orders, totalCount] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          master: {
            select: { name: true }
          }
        },
        orderBy: { createDate: 'desc' },
        take: Math.min(limit, this.MAX_LIMIT),
        skip: offset,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      success: true,
      data: orders,
      pagination: {
        limit: Math.min(limit, this.MAX_LIMIT),
        offset,
        total: totalCount,
        hasMore: offset + orders.length < totalCount,
      },
    };
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Статистика мастера (исправлен N+1)
   * БЫЛО: 4*N запросов (где N - количество городов)
   * СТАЛО: 2 запроса
   */
  async getMasterStatistics(query: MastersReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate } = query;

    const masterId = user?.userId;
    
    if (!masterId) {
      throw new BadRequestException('Master ID not found in token');
    }

    // Получаем данные мастера
    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
      select: { id: true, name: true, cities: true },
    });

    if (!master) {
      throw new NotFoundException('Master not found');
    }

    const cities = master.cities || [];
    if (cities.length === 0) {
      return { success: true, data: [] };
    }

    // ✅ ИСПРАВЛЕНО: Один запрос с группировкой вместо N*4 запросов
    const orderWhere: any = {
      masterId,
      city: { in: cities },
    };

    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) orderWhere.closingData.lte = new Date(endDate);
    }

    // Группированная статистика по городам и статусам
    const cityStats = await this.prisma.order.groupBy({
      by: ['city', 'statusOrder'],
      where: orderWhere,
      _count: { id: true },
      _sum: { clean: true, masterChange: true },
    });

    // Собираем результат по городам
    const result = cities.map((city) => {
      const cityData = cityStats.filter(s => s.city === city);
      
      const closedOrders = cityData
        .filter(s => s.statusOrder === OrderStatus.COMPLETED)
        .reduce((sum, s) => sum + s._count.id, 0);
      
      const modernOrders = cityData
        .filter(s => s.statusOrder === OrderStatus.MODERN)
        .reduce((sum, s) => sum + s._count.id, 0);
      
      const totalRevenue = cityData
        .filter(s => s.statusOrder === OrderStatus.COMPLETED)
        .reduce((sum, s) => sum + Number(s._sum.clean || 0), 0);
      
      const salary = cityData
        .filter(s => s.statusOrder === OrderStatus.COMPLETED)
        .reduce((sum, s) => sum + Number(s._sum.masterChange || 0), 0);

      const averageCheck = closedOrders > 0 ? totalRevenue / closedOrders : 0;

      return {
        city,
        closedOrders,
        modernOrders,
        totalRevenue,
        averageCheck,
        salary,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getMasterStatistics completed in ${duration}ms (${cities.length} cities, 2 queries)`);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * ✅ ОПТИМИЗИРОВАНО: Отчет по кампаниям
   */
  async getCampaignsReport(query: CampaignsReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    this.logger.debug('=== getCampaignsReport START (OPTIMIZED) ===');
    
    const { startDate, endDate, city } = query;

    const orderWhere: any = {};
    
    if (startDate || endDate) {
      orderWhere.closingData = {};
      if (startDate) orderWhere.closingData.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.closingData.lte = end;
      }
    }
    
    if (city) {
      if (user?.role === 'director' && user?.cities && !user.cities.includes(city)) {
        return { success: true, data: [] };
      }
      orderWhere.city = city;
    }

    if (user?.role === 'director' && user?.cities && !city) {
      orderWhere.city = { in: user.cities };
    }

    // Один запрос с группировкой
    const campaigns = await this.prisma.order.groupBy({
      by: ['city', 'rk', 'avitoName'],
      where: {
        ...orderWhere,
        statusOrder: { in: CLOSED_STATUSES }
      },
      _count: { id: true },
      _sum: {
        clean: true,
        masterChange: true
      }
    });

    // Группируем по городам
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

    const cityReports = Array.from(citiesMap.entries()).map(([city, campaigns]) => ({
      city,
      campaigns,
    }));

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCampaignsReport completed in ${duration}ms (${cityReports.length} cities, 1 query)`);

    return {
      success: true,
      data: cityReports,
    };
  }
}
