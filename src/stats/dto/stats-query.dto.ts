import { IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DateRangeDto } from '../../common/dto/date-range.dto';

export class StatsQueryDto extends DateRangeDto {}

