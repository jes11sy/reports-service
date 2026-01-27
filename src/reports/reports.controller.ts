import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus, Response, Param, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { ReportsService } from './reports.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';
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

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // Защита от DDoS
  @ApiOperation({ summary: 'Health check endpoint' })
  async health() {
    return {
      success: true,
      message: 'Reports module is healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('orders')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get orders statistics' })
  async getOrdersReport(@Query() query: OrdersReportQueryDto) {
    return this.reportsService.getOrdersReport(query);
  }

  @Get('masters')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get masters report' })
  async getMastersReport(
    @Query() query: MastersReportQueryDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.reportsService.getMastersReport(query, req.user);
  }

  @Get('finance')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get finance report' })
  async getFinanceReport(@Query() query: FinanceReportQueryDto) {
    return this.reportsService.getFinanceReport(query);
  }

  @Get('cash/by-purpose')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get cash report grouped by city and payment purpose' })
  async getCashByPurpose(
    @Query() query: CashByPurposeQueryDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.reportsService.getCashByPurpose(query, req.user);
  }

  @Get('calls')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get calls statistics' })
  async getCallsReport(@Query() query: CallsReportQueryDto) {
    return this.reportsService.getCallsReport(query);
  }

  @Get('city')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Тяжёлый запрос - строгий лимит
  @ApiOperation({ summary: 'Get city report' })
  async getCityReport(
    @Query() query: CityReportQueryDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.reportsService.getCityReport(query, req.user);
  }

  @Get('city/:city')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Get detailed city report' })
  async getCityDetailedReport(
    @Query() query: CityReportQueryDto,
    @Param('city') city: string,
  ) {
    return this.reportsService.getCityDetailedReport(city, query);
  }

  @Get('campaigns')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @ApiOperation({ summary: 'Get campaigns report by cities' })
  async getCampaignsReport(
    @Query() query: CampaignsReportQueryDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.reportsService.getCampaignsReport(query, req.user);
  }

  @Get('export/excel')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR)
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // Экспорт - очень строгий лимит
  @ApiOperation({ summary: 'Export report to Excel' })
  async exportExcel(@Query() query: ExportQueryDto, @Response() res: any) {
    const buffer = await this.reportsService.exportToExcel(query);
    
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename=report-${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('statistics/master')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.MASTER)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Get master statistics by cities' })
  async getMasterStatistics(
    @Query() query: MastersReportQueryDto,
    @Request() req: { user: RequestUser },
  ) {
    return this.reportsService.getMasterStatistics(query, req.user);
  }
}
