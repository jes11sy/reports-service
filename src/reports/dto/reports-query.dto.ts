import { IsOptional, IsInt, IsString, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../common/dto/date-range.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class OrdersReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  masterId?: number;
}

export class MastersReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  masterId?: number;
}

export class CallsReportQueryDto extends DateRangeDto {
  @ApiPropertyOptional()
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

