import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus, Response, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from './reports.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';

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
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get orders statistics' })
  async getOrdersReport(@Query() query: any) {
    return this.reportsService.getOrdersReport(query);
  }

  @Get('masters')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get masters report' })
  async getMastersReport(@Query() query: any) {
    return this.reportsService.getMastersReport(query);
  }

  @Get('finance')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get finance report' })
  async getFinanceReport(@Query() query: any) {
    return this.reportsService.getFinanceReport(query);
  }

  @Get('calls')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Get calls statistics' })
  async getCallsReport(@Query() query: any) {
    return this.reportsService.getCallsReport(query);
  }

  @Get('city')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get city report' })
  async getCityReport(@Query() query: any) {
    return this.reportsService.getCityReport(query);
  }

  @Get('city/:city')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get detailed city report' })
  async getCityDetailedReport(@Query() query: any, @Param('city') city: string) {
    return this.reportsService.getCityDetailedReport(city, query);
  }

  @Get('export/excel')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Export report to Excel' })
  async exportExcel(@Query() query: any, @Response() res: any) {
    const buffer = await this.reportsService.exportToExcel(query);
    
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', `attachment; filename=report-${Date.now()}.xlsx`);
    res.send(buffer);
  }
}














