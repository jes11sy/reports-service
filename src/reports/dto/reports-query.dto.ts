import { IsOptional, IsInt, IsString, MaxLength, IsIn, Min, Max } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../common/dto/date-range.dto';

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

export class OrdersReportQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({ description: 'ID города' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;

  @ApiPropertyOptional({ description: 'Код статуса заказа' })
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

export class MastersReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID мастера' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  masterId?: number;
}

export class CallsReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID оператора' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  operatorId?: number;
}

export class ExportQueryDto extends OrdersReportQueryDto {
  @ApiPropertyOptional({ enum: ['orders', 'masters', 'calls'], default: 'orders' })
  @IsOptional()
  @IsIn(['orders', 'masters', 'calls'])
  type?: string;
}

export class CampaignsReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID города' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;
}

export class CashByPurposeQueryDto extends DateRangeDto {
  @ApiPropertyOptional({ description: 'ID города' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;

  @ApiPropertyOptional({ description: 'Назначения платежей (через запятую или массив)' })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((s: string) => s.trim());
    return value;
  })
  purposes?: string | string[];
}

export class CityReportQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({ description: 'ID города' })
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  cityId?: number;
}

export class FinanceReportQueryDto extends PaginatedQueryDto {}
