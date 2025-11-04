import { Controller, Get, Query, UseGuards, HttpCode, HttpStatus, Request, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { StatsService } from './stats.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private statsService: StatsService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check endpoint' })
  async health() {
    return {
      success: true,
      message: 'Stats module is healthy',
      timestamp: new Date().toISOString(),
    };
  }

  // Личная статистика оператора
  @Get('my')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить личную статистику оператора' })
  @ApiQuery({ name: 'startDate', required: false, type: String, example: '2024-01-01' })
  @ApiQuery({ name: 'endDate', required: false, type: String, example: '2024-12-31' })
  async getMyStats(
    @Request() req,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const operatorId = req.user.userId;
    return this.statsService.getOperatorStats(operatorId, startDate, endDate);
  }

  // Статистика конкретного оператора (для админов)
  @Get('operator/:operatorId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить статистику оператора' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async getOperatorStats(
    @Param('operatorId') operatorId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.statsService.getOperatorStats(+operatorId, startDate, endDate);
  }

  // Общая статистика (для админов)
  @Get('overall')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.DIRECTOR, UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить общую статистику' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  async getOverallStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.statsService.getOverallStats(startDate, endDate);
  }

  // Статистика для главного дашборда админки
  @Get('dashboard')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Получить статистику для дашборда админки' })
  async getDashboardStats() {
    return this.statsService.getDashboardStats();
  }
}

