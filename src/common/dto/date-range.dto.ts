import { IsOptional, IsDateString, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

@ValidatorConstraint({ name: 'dateRangeValidator', async: false })
export class DateRangeValidator implements ValidatorConstraintInterface {
  private errorMessage = 'Date range must not exceed 365 days';

  validate(value: any, args: any) {
    const startDate = args.object.startDate;
    const endDate = args.object.endDate;
    
    if (!startDate || !endDate) {
      return true;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // ✅ FIX #106: Проверка что endDate >= startDate
    if (end.getTime() < start.getTime()) {
      this.errorMessage = 'End date must be greater than or equal to start date';
      return false;
    }
    
    // Максимальный диапазон - 1 год
    const maxRangeDays = 365;
    const diffTime = end.getTime() - start.getTime(); // Убран Math.abs - теперь end > start гарантировано
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > maxRangeDays) {
      this.errorMessage = 'Date range must not exceed 365 days';
      return false;
    }
    
    return true;
  }

  defaultMessage() {
    return this.errorMessage;
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

