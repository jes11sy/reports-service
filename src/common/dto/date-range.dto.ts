import { IsOptional, IsDateString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'dateRangeValidator', async: false })
export class DateRangeValidator implements ValidatorConstraintInterface {
  validate(value: any, args: any) {
    const startDate = args.object.startDate;
    const endDate = args.object.endDate;
    
    if (!startDate || !endDate) {
      return true;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Максимальный диапазон - 1 год
    const maxRangeDays = 365;
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return diffDays <= maxRangeDays;
  }

  defaultMessage() {
    return 'Date range must not exceed 365 days';
  }
}

export class DateRangeDto {
  @ApiPropertyOptional({ example: '2024-01-01', description: 'Start date in ISO format' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2024-12-31', description: 'End date in ISO format' })
  @IsOptional()
  @IsDateString()
  @Validate(DateRangeValidator)
  endDate?: string;
}

