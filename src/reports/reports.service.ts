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

    return {
      success: true,
      data: {
        orders,
        stats: {
          totalCount,
          completedCount,
          totalRevenue: totalRevenue._sum.result || 0,
          avgRevenue: completedCount > 0 ? Math.round((totalRevenue._sum.result || 0) / completedCount) : 0,
        },
      },
    };
  }

  async getMastersReport(query: any) {
    const { startDate, endDate, masterId } = query;

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.createDate = {};
      if (startDate) orderWhere.createDate.gte = new Date(startDate);
      if (endDate) orderWhere.createDate.lte = new Date(endDate);
    }
    if (masterId) orderWhere.masterId = +masterId;

    const masters = await this.prisma.master.findMany({
      where: masterId ? { id: +masterId } : {},
    });

    const masterStats = await Promise.all(
      masters.map(async (master) => {
        const [totalOrders, completedOrders, totalRevenue, totalExpenditure] = await Promise.all([
          this.prisma.order.count({ where: { ...orderWhere, masterId: master.id } }),
          this.prisma.order.count({ where: { ...orderWhere, masterId: master.id, statusOrder: 'Закрыт' } }),
          this.prisma.order.aggregate({
            where: { ...orderWhere, masterId: master.id, result: { not: null } },
            _sum: { result: true },
          }),
          this.prisma.order.aggregate({
            where: { ...orderWhere, masterId: master.id, expenditure: { not: null } },
            _sum: { expenditure: true },
          }),
        ]);

        return {
          masterId: master.id,
          masterName: master.name,
          totalOrders,
          completedOrders,
          totalRevenue: totalRevenue._sum.result || 0,
          totalExpenditure: totalExpenditure._sum.expenditure || 0,
          profit: (totalRevenue._sum.result || 0) - (totalExpenditure._sum.expenditure || 0),
        };
      })
    );

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

    const [cashTransactions, approvedSum, pendingSum] = await Promise.all([
      this.prisma.cash.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.cash.aggregate({
        where: { ...where, status: 'approved' },
        _sum: { amount: true },
      }),
      this.prisma.cash.aggregate({
        where: { ...where, status: 'pending' },
        _sum: { amount: true },
      }),
    ]);

    // Группировка по типам
    const byType = {
      расход: 0,
      предоплата: 0,
      чистый: 0,
    };

    cashTransactions.forEach(t => {
      if (t.status === 'approved' && t.type in byType) {
        byType[t.type] += t.amount;
      }
    });

    return {
      success: true,
      data: {
        totalApproved: approvedSum._sum.amount || 0,
        totalPending: pendingSum._sum.amount || 0,
        byType,
        transactions: cashTransactions,
      },
    };
  }

  async getCallsReport(query: any) {
    const { startDate, endDate, operatorId } = query;

    const where: any = {};
    if (startDate || endDate) {
      where.callDate = {};
      if (startDate) where.callDate.gte = new Date(startDate);
      if (endDate) where.callDate.lte = new Date(endDate);
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
}




