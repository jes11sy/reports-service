import { IsOptional, IsInt, IsString, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../common/dto/date-range.dto';

export class AnalyticsQueryDto extends DateRangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  operatorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}

export class DashboardQueryDto {
  @ApiPropertyOptional({ enum: ['today', 'week', 'month'], default: 'today' })
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';
}

