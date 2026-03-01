import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
import {
  OrderStatus,
  CLOSED_STATUSES,
  CashOperationType,
  CallStatus,
} from '../common/constants/order-statuses';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  private readonly DEFAULT_LIMIT: number;
  private readonly MAX_LIMIT: number;

  // Cache for status code → ID mapping
  private statusCodeToId: Map<string, number> = new Map();
  private statusCacheExpiry = 0;

  // Cache for city ID → name mapping
  private cityIdToName: Map<number, string> = new Map();
  private cityCacheExpiry = 0;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.DEFAULT_LIMIT = this.configService.get<number>('REPORTS_DEFAULT_LIMIT', 1000);
    this.MAX_LIMIT = this.configService.get<number>('REPORTS_MAX_LIMIT', 5000);
  }

  private safeBigIntToNumber(value: bigint | number | string | null | undefined, fieldName?: string): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof value === 'bigint') {
      if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
        this.logger.warn(`⚠️ BigInt precision loss${fieldName ? ` for ${fieldName}` : ''}: ${value.toString()}`);
      }
      return Number(value);
    }
    return Number(value) || 0;
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

  private async getStatusIds(codes: string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const code of codes) {
      const id = await this.getStatusId(code);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }

  private async getCityName(cityId: number): Promise<string> {
    const now = Date.now();
    if (this.cityCacheExpiry < now || this.cityIdToName.size === 0) {
      try {
        const cities = await this.prisma.city.findMany({ select: { id: true, name: true } });
        this.cityIdToName = new Map(cities.map(c => [c.id, c.name]));
        this.cityCacheExpiry = now + 10 * 60 * 1000;
      } catch (err) {
        this.logger.error('Failed to load city names', err);
      }
    }
    return this.cityIdToName.get(cityId) || String(cityId);
  }

  async getOrdersReport(query: OrdersReportQueryDto) {
    const { startDate, endDate, cityId, status, masterId, limit = this.DEFAULT_LIMIT, offset = 0 } = query;

    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    const where: any = {};

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    if (cityId) where.cityId = cityId;

    if (status) {
      const statusId = await this.getStatusId(status);
      if (statusId) where.statusId = statusId;
    }

    if (masterId) where.masterId = masterId;

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const [orders, totalCount, completedCount, totalRevenue] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, this.MAX_LIMIT),
        skip: offset,
      }),
      this.prisma.order.count({ where }),
      this.prisma.order.count({
        where: { ...where, ...(completedStatusId ? { statusId: completedStatusId } : {}) },
      }),
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

  async getMastersReport(query: MastersReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate, masterId } = query;

    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.closingAt = {};
      if (startDate) orderWhere.closingAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.closingAt.lte = end;
      }
    }
    if (masterId) orderWhere.masterId = masterId;

    let masters;
    if (user?.role === 'director' && user?.cityIds?.length) {
      masters = await this.prisma.master.findMany({
        where: { cityIds: { hasSome: user.cityIds } },
      });
    } else {
      masters = await this.prisma.master.findMany({
        where: masterId ? { id: masterId } : {},
      });
    }

    const closedStatusIds = await this.getStatusIds(CLOSED_STATUSES);
    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);

    const masterOrderStats = await this.prisma.order.groupBy({
      by: ['masterId', 'cityId', 'statusId'],
      where: {
        ...orderWhere,
        masterId: { not: null },
        ...(masterId && { masterId }),
      },
      _count: { id: true },
      _sum: { clean: true, masterChange: true },
    });

    const allCityIds = [...new Set(masters.flatMap(m => m.cityIds as number[]))];
    const cityRecords = allCityIds.length > 0
      ? await this.prisma.city.findMany({ where: { id: { in: allCityIds } }, select: { id: true, name: true } })
      : [];
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));

    const masterStats: any[] = [];

    for (const master of masters) {
      for (const cityId of master.cityIds) {
        if (user?.role === 'director' && user?.cityIds && !user.cityIds.includes(cityId)) {
          continue;
        }

        const stats = masterOrderStats.filter(
          s => s.masterId === master.id && s.cityId === cityId
        );

        const totalOrders = closedStatusIds.length > 0
          ? stats.filter(s => closedStatusIds.includes(s.statusId)).reduce((sum, s) => sum + s._count.id, 0)
          : stats.reduce((sum, s) => sum + s._count.id, 0);

        const turnover = completedStatusId
          ? stats.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + Number(s._sum.clean || 0), 0)
          : 0;

        const salary = completedStatusId
          ? stats.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + Number(s._sum.masterChange || 0), 0)
          : 0;

        const avgCheck = totalOrders > 0 ? turnover / totalOrders : 0;

        masterStats.push({
          masterId: master.id,
          masterName: master.name,
          cityId,
          cityName: cityNameMap.get(cityId) || String(cityId),
          totalOrders,
          turnover,
          avgCheck,
          salary,
        });
      }
    }

    const duration = Date.now() - startTime;
    const totalCombinations = masters.reduce((sum, m) => sum + m.cityIds.length, 0);
    this.logger.log(`✅ getMastersReport completed in ${duration}ms (${masters.length} masters, ${totalCombinations} combinations, 2 queries)`);

    return { success: true, data: masterStats };
  }

  async getFinanceReport(query: FinanceReportQueryDto) {
    const { startDate, endDate, limit = this.DEFAULT_LIMIT, offset = 0 } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [cashTransactions, totalCount, totalSum] = await this.prisma.$transaction([
      this.prisma.cash.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, this.MAX_LIMIT),
        skip: offset,
      }),
      this.prisma.cash.count({ where }),
      this.prisma.cash.aggregate({ where, _sum: { amount: true } }),
    ]);

    const byType = {
      [CashOperationType.INCOME]: 0,
      [CashOperationType.EXPENSE]: 0,
    };

    cashTransactions.forEach(t => {
      const amount = Number(t.amount);
      if (t.type === CashOperationType.INCOME) {
        byType[CashOperationType.INCOME] += amount;
      } else if (t.type === CashOperationType.EXPENSE) {
        byType[CashOperationType.EXPENSE] += amount;
      }
    });

    return {
      success: true,
      data: {
        total: totalSum._sum.amount ? Number(totalSum._sum.amount) : 0,
        byType,
        transactions: cashTransactions.map(t => ({ ...t, amount: Number(t.amount) })),
        pagination: {
          limit: Math.min(limit, this.MAX_LIMIT),
          offset,
          total: totalCount,
          hasMore: offset + cashTransactions.length < totalCount,
        },
      },
    };
  }

  async getCashByPurpose(query: CashByPurposeQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate, cityId, purposes } = query;

    const params: any[] = [];
    let paramIndex = 1;

    let dateCondition = '';
    let cityCondition = '';

    if (startDate) {
      dateCondition += ` AND created_at >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateCondition += ` AND created_at <= $${paramIndex}`;
      params.push(end);
      paramIndex++;
    }

    if (cityId) {
      if (user?.role === 'director' && user?.cityIds && !user.cityIds.includes(cityId)) {
        return { success: true, data: { cities: [], totals: { income: 0, expense: 0, balance: 0 } } };
      }
      cityCondition = ` AND city_id = $${paramIndex}`;
      params.push(cityId);
      paramIndex++;
    } else if (user?.role === 'director' && user?.cityIds?.length) {
      cityCondition = ` AND city_id = ANY($${paramIndex}::int[])`;
      params.push(user.cityIds);
      paramIndex++;
    }

    const purposeFilter = purposes
      ? (Array.isArray(purposes) ? purposes : purposes.split(','))
      : null;

    const cashStats = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      payment_purpose: string | null;
      type: string;
      total_amount: any;
      count: bigint;
    }>>(
      `SELECT 
        city_id,
        payment_purpose,
        type,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) as count
      FROM cash_service.cash
      WHERE 1=1 ${dateCondition} ${cityCondition}
      GROUP BY city_id, payment_purpose, type`,
      ...params
    );

    this.logger.debug(`[getCashByPurpose] Raw SQL returned ${cashStats.length} rows`);

    const normalizePurpose = (rawPurpose: string | null): string => {
      if (!rawPurpose) return 'Без назначения';
      if (rawPurpose.toLowerCase().startsWith('заказ')) return 'Заказ';
      return rawPurpose;
    };

    // Collect all city IDs, then fetch names
    const cityIds = [...new Set(cashStats.map(s => s.city_id))];
    const cityRecords = cityIds.length > 0
      ? await this.prisma.city.findMany({ where: { id: { in: cityIds } }, select: { id: true, name: true } })
      : [];
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));

    const citiesMap = new Map<number, Map<string, { income: number; expense: number }>>();
    let grandTotalIncome = 0;
    let grandTotalExpense = 0;

    cashStats.forEach(stat => {
      const cId = stat.city_id;
      const purpose = normalizePurpose(stat.payment_purpose);
      const amount = Number(stat.total_amount) || 0;

      if (purposeFilter?.length && !purposeFilter.includes(purpose)) return;

      if (!citiesMap.has(cId)) citiesMap.set(cId, new Map());

      const purposeMap = citiesMap.get(cId)!;
      if (!purposeMap.has(purpose)) purposeMap.set(purpose, { income: 0, expense: 0 });

      const purposeData = purposeMap.get(purpose)!;
      if (stat.type === CashOperationType.INCOME) {
        purposeData.income += amount;
        grandTotalIncome += amount;
      } else if (stat.type === CashOperationType.EXPENSE) {
        purposeData.expense += amount;
        grandTotalExpense += amount;
      }
    });

    const cities = Array.from(citiesMap.entries()).map(([cId, purposeMap]) => {
      const purposeList: any[] = [];
      let cityIncome = 0;
      let cityExpense = 0;

      purposeMap.forEach((data, purpose) => {
        purposeList.push({
          purpose,
          income: data.income,
          expense: data.expense,
          balance: data.income - data.expense,
        });
        cityIncome += data.income;
        cityExpense += data.expense;
      });

      purposeList.sort((a, b) => (b.income + b.expense) - (a.income + a.expense));

      return {
        cityId: cId,
        cityName: cityNameMap.get(cId) || String(cId),
        purposes: purposeList,
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

  async getCallsReport(query: CallsReportQueryDto) {
    const { startDate, endDate, operatorId } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }
    if (operatorId) where.operatorId = operatorId;

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

  async exportToExcel(query: ExportQueryDto) {
    const { type = 'orders' } = query;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    if (type === 'orders') {
      const report = await this.getOrdersReport(query);

      worksheet.columns = [
        { header: 'RK ID', key: 'rkId', width: 10 },
        { header: 'Клиент', key: 'clientName', width: 25 },
        { header: 'Телефон', key: 'phone', width: 15 },
        { header: 'Город ID', key: 'cityId', width: 10 },
        { header: 'Статус ID', key: 'statusId', width: 10 },
        { header: 'Сумма', key: 'result', width: 10 },
        { header: 'Дата создания', key: 'createdAt', width: 20 },
      ];

      report.data.orders.forEach(order => {
        worksheet.addRow(order);
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
  }

  async getCityReport(query: CityReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    this.logger.debug('=== getCityReport START ===');
    const { startDate, endDate, cityId } = query;

    await this.prisma.executeWithRetry(async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);
    const notOrderStatusId = await this.getStatusId(OrderStatus.NOT_ORDER);
    const cancelledStatusId = await this.getStatusId(OrderStatus.CANCELLED);
    const modernStatusId = await this.getStatusId(OrderStatus.MODERN);

    let cityIdList: number[];

    if (cityId) {
      if (user?.role === 'director' && user?.cityIds && !user.cityIds.includes(cityId)) {
        return { success: true, data: [] };
      }
      cityIdList = [cityId];
    } else if (user?.role === 'director' && user?.cityIds) {
      cityIdList = user.cityIds;
    } else {
      const cities = await this.prisma.order.findMany({
        select: { cityId: true },
        distinct: ['cityId'],
      });
      cityIdList = cities.map(c => c.cityId).filter(Boolean) as number[];
    }

    if (cityIdList.length === 0) {
      return { success: true, data: [] };
    }

    const params: any[] = [cityIdList];
    let paramIndex = 2;

    let createDateCondition = '';
    let updatedAtCondition = '';
    let closingAtCondition = '';

    if (startDate) {
      const startDateValue = new Date(startDate);
      createDateCondition += ` AND created_at >= $${paramIndex}`;
      updatedAtCondition += ` AND updated_at >= $${paramIndex}`;
      closingAtCondition += ` AND closing_at >= $${paramIndex}`;
      params.push(startDateValue);
      paramIndex++;
    }

    if (endDate) {
      const endOfDay = new Date(endDate);
      endOfDay.setHours(23, 59, 59, 999);
      createDateCondition += ` AND created_at <= $${paramIndex}`;
      updatedAtCondition += ` AND updated_at <= $${paramIndex}`;
      closingAtCondition += ` AND closing_at <= $${paramIndex}`;
      params.push(endOfDay);
      paramIndex++;
    }

    // 1. Total orders by createdAt
    const totalOrdersStats = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      total_orders: bigint;
    }>>(
      `SELECT city_id, COUNT(*) as total_orders
       FROM orders_service.orders
       WHERE city_id = ANY($1::int[]) ${createDateCondition}
       GROUP BY city_id`,
      ...params
    );

    // 2. Not-orders and cancellations by updatedAt
    const statusByUpdatedAt = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      status_id: number;
      count: bigint;
    }>>(
      `SELECT city_id, status_id, COUNT(*) as count
       FROM orders_service.orders
       WHERE city_id = ANY($1::int[])
         AND status_id IN (${notOrderStatusId ?? 0}, ${cancelledStatusId ?? 0})
         ${updatedAtCondition}
       GROUP BY city_id, status_id`,
      ...params
    );

    const paramsForCompleted = [...params];

    // 3. Completed orders stats by closingAt
    const completedOrdersStats = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      completed_orders: bigint;
      micro_under_1500: bigint;
      micro_1500_10000: bigint;
      over10k_count: bigint;
      max_check: number;
      turnover: number;
      profit: number;
    }>>(
      `SELECT 
        city_id,
        COUNT(*) FILTER (WHERE status_id = ${completedStatusId ?? 0} AND result > 0) as completed_orders,
        COUNT(*) FILTER (WHERE status_id = ${completedStatusId ?? 0} AND result > 0 AND clean > 0 AND clean < 1500) as micro_under_1500,
        COUNT(*) FILTER (WHERE status_id = ${completedStatusId ?? 0} AND result > 0 AND clean >= 1500 AND clean < 10000) as micro_1500_10000,
        COUNT(*) FILTER (WHERE status_id = ${completedStatusId ?? 0} AND result > 0 AND clean >= 10000) as over10k_count,
        COALESCE(MAX(clean) FILTER (WHERE status_id = ${completedStatusId ?? 0}), 0) as max_check,
        COALESCE(SUM(clean) FILTER (WHERE status_id = ${completedStatusId ?? 0}), 0) as turnover,
        COALESCE(SUM(master_change) FILTER (WHERE status_id = ${completedStatusId ?? 0}), 0) as profit
      FROM orders_service.orders
      WHERE city_id = ANY($1::int[]) ${closingAtCondition}
      GROUP BY city_id`,
      ...paramsForCompleted
    );

    // 4. Modern orders
    const modernStats = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      modern_count: bigint;
    }>>(
      `SELECT city_id, COUNT(*) as modern_count
       FROM orders_service.orders
       WHERE city_id = ANY($1::int[]) AND status_id = ${modernStatusId ?? 0}
       GROUP BY city_id`,
      cityIdList
    );

    // 5. Cash stats
    const cashStats = await this.prisma.$queryRawUnsafe<Array<{
      city_id: number;
      type: string;
      total_amount: number;
    }>>(
      `SELECT city_id, type, COALESCE(SUM(amount), 0) as total_amount
       FROM cash_service.cash
       WHERE city_id = ANY($1::int[])
       GROUP BY city_id, type`,
      cityIdList
    );

    // Fetch city names
    const cityRecords = await this.prisma.city.findMany({
      where: { id: { in: cityIdList } },
      select: { id: true, name: true },
    });
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));

    // 6. Build result
    const cityStatsResult = cityIdList.map((cId) => {
      const cityTotalOrders = totalOrdersStats.find(s => s.city_id === cId);
      const cityStatusUpdated = statusByUpdatedAt.filter(s => s.city_id === cId);
      const cityCompleted = completedOrdersStats.find(s => s.city_id === cId);
      const cityModern = modernStats.find(m => m.city_id === cId);
      const cityCash = cashStats.filter(c => c.city_id === cId);

      const totalOrders = this.safeBigIntToNumber(cityTotalOrders?.total_orders, 'total_orders');
      const notOrders = this.safeBigIntToNumber(
        cityStatusUpdated.find(s => s.status_id === notOrderStatusId)?.count, 'not_orders'
      );
      const zeroOrders = this.safeBigIntToNumber(
        cityStatusUpdated.find(s => s.status_id === cancelledStatusId)?.count, 'zero_orders'
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
        cityCash.find(c => c.type === CashOperationType.INCOME)?.total_amount, 'income'
      );
      const expense = this.safeBigIntToNumber(
        cityCash.find(c => c.type === CashOperationType.EXPENSE)?.total_amount, 'expense'
      );
      const totalAmount = income - expense;

      const totalClosed = completedOrders + zeroOrders;
      const avgCheck = completedOrders > 0 ? turnover / completedOrders : 0;
      const completedPercent = totalClosed > 0 ? (completedOrders / totalClosed) * 100 : 0;

      return {
        cityId: cId,
        cityName: cityNameMap.get(cId) || String(cId),
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
        cash: { totalAmount },
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCityReport completed in ${duration}ms (${cityIdList.length} cities)`);

    return { success: true, data: cityStatsResult };
  }

  async getCityDetailedReport(cityId: number, query: CityReportQueryDto) {
    const { startDate, endDate, limit = this.DEFAULT_LIMIT, offset = 0 } = query;

    const where: any = { cityId };

    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

    const [orders, totalCount] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          cashSubmission: { select: { status: true, amount: true } },
        },
        orderBy: { createdAt: 'desc' },
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

  async getMasterStatistics(query: MastersReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    const { startDate, endDate } = query;

    const masterId = user?.userId;

    if (!masterId) {
      throw new BadRequestException('Master ID not found in token');
    }

    const master = await this.prisma.master.findUnique({
      where: { id: masterId },
      select: { id: true, name: true, cityIds: true },
    });

    if (!master) {
      throw new NotFoundException('Master not found');
    }

    const cityIds = master.cityIds || [];
    if (cityIds.length === 0) {
      return { success: true, data: [] };
    }

    const completedStatusId = await this.getStatusId(OrderStatus.COMPLETED);
    const modernStatusId = await this.getStatusId(OrderStatus.MODERN);

    const orderWhere: any = {
      masterId,
      cityId: { in: cityIds },
    };

    if (startDate || endDate) {
      orderWhere.closingAt = {};
      if (startDate) orderWhere.closingAt.gte = new Date(startDate);
      if (endDate) orderWhere.closingAt.lte = new Date(endDate);
    }

    const cityStats = await this.prisma.order.groupBy({
      by: ['cityId', 'statusId'],
      where: orderWhere,
      _count: { id: true },
      _sum: { clean: true, masterChange: true },
    });

    const cityRecords = await this.prisma.city.findMany({
      where: { id: { in: cityIds } },
      select: { id: true, name: true },
    });
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));

    const result = cityIds.map((cId) => {
      const cityData = cityStats.filter(s => s.cityId === cId);

      const closedOrders = completedStatusId
        ? cityData.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + s._count.id, 0)
        : 0;

      const modernOrders = modernStatusId
        ? cityData.filter(s => s.statusId === modernStatusId).reduce((sum, s) => sum + s._count.id, 0)
        : 0;

      const totalRevenue = completedStatusId
        ? cityData.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + Number(s._sum.clean || 0), 0)
        : 0;

      const salary = completedStatusId
        ? cityData.filter(s => s.statusId === completedStatusId).reduce((sum, s) => sum + Number(s._sum.masterChange || 0), 0)
        : 0;

      const averageCheck = closedOrders > 0 ? totalRevenue / closedOrders : 0;

      return {
        cityId: cId,
        cityName: cityNameMap.get(cId) || String(cId),
        closedOrders,
        modernOrders,
        totalRevenue,
        averageCheck,
        salary,
      };
    });

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getMasterStatistics completed in ${duration}ms (${cityIds.length} cities, 2 queries)`);

    return { success: true, data: result };
  }

  async getCampaignsReport(query: CampaignsReportQueryDto, user?: RequestUser) {
    const startTime = Date.now();
    this.logger.debug('=== getCampaignsReport START ===');

    const { startDate, endDate, cityId } = query;

    const orderWhere: any = {};

    if (startDate || endDate) {
      orderWhere.closingAt = {};
      if (startDate) orderWhere.closingAt.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        orderWhere.closingAt.lte = end;
      }
    }

    if (cityId) {
      if (user?.role === 'director' && user?.cityIds && !user.cityIds.includes(cityId)) {
        return { success: true, data: [] };
      }
      orderWhere.cityId = cityId;
    } else if (user?.role === 'director' && user?.cityIds && !cityId) {
      orderWhere.cityId = { in: user.cityIds };
    }

    const closedStatusIds = await this.getStatusIds(CLOSED_STATUSES);

    const campaigns = await this.prisma.order.groupBy({
      by: ['cityId', 'rkId', 'statusId'],
      where: {
        ...orderWhere,
        ...(closedStatusIds.length > 0 ? { statusId: { in: closedStatusIds } } : {}),
      },
      _count: { id: true },
      _sum: { clean: true, masterChange: true },
    });

    const allCityIds = [...new Set(campaigns.map(c => c.cityId))];
    const allRkIds = [...new Set(campaigns.map(c => c.rkId))];

    const [cityRecords, rkRecords] = await Promise.all([
      allCityIds.length > 0
        ? this.prisma.city.findMany({ where: { id: { in: allCityIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      allRkIds.length > 0
        ? this.prisma.rk.findMany({ where: { id: { in: allRkIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const cityNameMap = new Map(cityRecords.map(c => [c.id, c.name]));
    const rkNameMap = new Map(rkRecords.map(r => [r.id, r.name]));

    // Group by cityId, rkId
    const citiesMap = new Map<number, Array<{
      rkId: number;
      rkName: string;
      ordersCount: number;
      revenue: number;
      profit: number;
    }>>();

    campaigns.forEach(campaign => {
      if (!citiesMap.has(campaign.cityId)) citiesMap.set(campaign.cityId, []);
      citiesMap.get(campaign.cityId)!.push({
        rkId: campaign.rkId,
        rkName: rkNameMap.get(campaign.rkId) || String(campaign.rkId),
        ordersCount: campaign._count.id,
        revenue: Number(campaign._sum.clean || 0),
        profit: Number(campaign._sum.masterChange || 0),
      });
    });

    const cityReports = Array.from(citiesMap.entries()).map(([cId, campaignList]) => ({
      cityId: cId,
      cityName: cityNameMap.get(cId) || String(cId),
      campaigns: campaignList,
    }));

    const duration = Date.now() - startTime;
    this.logger.log(`✅ getCampaignsReport completed in ${duration}ms (${cityReports.length} cities, 1 query)`);

    return { success: true, data: cityReports };
  }
}
