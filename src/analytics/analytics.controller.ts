import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';
import { AnalyticsQueryDto, DashboardQueryDto } from './dto/analytics-query.dto';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('operators')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить статистику операторов' })
  async getOperatorStatistics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getOperatorStatistics(
      query.startDate,
      query.endDate,
      query.operatorId,
    );
  }

  @Get('cities')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить аналитику по городам' })
  async getCityAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getCityAnalytics(query.startDate, query.endDate);
  }

  @Get('campaigns')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить аналитику по рекламным кампаниям (РК)' })
  async getCampaignAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getCampaignAnalytics(query.startDate, query.endDate);
  }

  @Get('daily')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить дневную метрику' })
  async getDailyMetrics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getDailyMetrics(query.startDate, query.endDate, query.city);
  }

  @Get('dashboard')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN, UserRole.CALLCENTRE_OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить данные для дашборда' })
  async getDashboardData(@Query() query: DashboardQueryDto) {
    return this.analyticsService.getDashboardData(query.period || 'today');
  }

  @Get('performance')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить метрики производительности' })
  async getPerformanceMetrics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getPerformanceMetrics(query.startDate, query.endDate);
  }
}

