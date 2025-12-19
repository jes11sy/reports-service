import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus, Response, Param, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { ReportsService } from './reports.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';
import { CampaignsReportQueryDto } from './dto/reports-query.dto';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
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
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get orders statistics' })
  async getOrdersReport(@Query() query: any) {
    return this.reportsService.getOrdersReport(query);
  }

  @Get('masters')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get masters report' })
  async getMastersReport(@Query() query: any, @Request() req: any) {
    return this.reportsService.getMastersReport(query, req.user);
  }

  @Get('finance')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get finance report' })
  async getFinanceReport(@Query() query: any) {
    return this.reportsService.getFinanceReport(query);
  }

  @Get('calls')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get calls statistics' })
  async getCallsReport(@Query() query: any) {
    return this.reportsService.getCallsReport(query);
  }

  @Get('city')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get city report' })
  async getCityReport(@Query() query: any, @Request() req: any) {
    console.log('Controller - req.user:', req.user);
    return this.reportsService.getCityReport(query, req.user);
  }

  @Get('city/:city')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get detailed city report' })
  async getCityDetailedReport(@Query() query: any, @Param('city') city: string) {
    return this.reportsService.getCityDetailedReport(city, query);
  }

  @Get('campaigns')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get campaigns report by cities' })
  async getCampaignsReport(@Query() query: CampaignsReportQueryDto, @Request() req: any) {
    return this.reportsService.getCampaignsReport(query, req.user);
  }

  @Get('export/excel')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Export report to Excel' })
  async exportExcel(@Query() query: any, @Response() res: any) {
    const buffer = await this.reportsService.exportToExcel(query);
    
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename=report-${Date.now()}.xlsx`);
    res.send(buffer);
  }

  @Get('statistics/master')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.MASTER)
  @ApiOperation({ summary: 'Get master statistics by cities' })
  async getMasterStatistics(@Query() query: any, @Request() req: any) {
    return this.reportsService.getMasterStatistics(query, req.user);
  }
}














