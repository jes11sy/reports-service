import { IsOptional, IsInt, IsString, MaxLength, IsIn, Min, Max, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../common/dto/date-range.dto';

/**
 * Базовый DTO с пагинацией
 */
export class PaginatedQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'Лимит записей', default: 1000, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5000)
  @Type(() => Number)
  limit?: number = 1000;

  @ApiPropertyOptional({ description: 'Смещение', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  offset?: number = 0;
}

/**
 * DTO для отчёта по заказам
 */
export class OrdersReportQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Статус заказа' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @ApiPropertyOptional({ description: 'ID мастера' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  masterId?: number;
}

/**
 * DTO для отчёта по мастерам
 */
export class MastersReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID мастера' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  masterId?: number;
}

/**
 * DTO для отчёта по звонкам
 */
export class CallsReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID оператора' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  operatorId?: number;
}

/**
 * DTO для экспорта
 */
export class ExportQueryDto extends OrdersReportQueryDto {
  @ApiPropertyOptional({ enum: ['orders', 'masters', 'calls'], default: 'orders' })
  @IsOptional()
  @IsIn(['orders', 'masters', 'calls'])
  type?: string;
}

/**
 * DTO для отчёта по кампаниям
 */
export class CampaignsReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}

/**
 * DTO для отчёта по кассе с группировкой
 */
export class CashByPurposeQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ description: 'Назначения платежей (через запятую или массив)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map(s => s.trim());
    return value;
  })
  purposes?: string | string[];
}

/**
 * DTO для отчёта по городам
 */
export class CityReportQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({ description: 'Город' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}

/**
 * DTO для финансового отчёта
 */
export class FinanceReportQueryDto extends PaginatedQueryDto {}
