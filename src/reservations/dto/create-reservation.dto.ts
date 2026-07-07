import { IsUUID, IsInt, Min, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReservationDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-ab12-cd34ef567890',
    description: 'The ID of the Inventory record (product-location pair) to reserve stock from',
  })
  @IsUUID()
  inventoryId!: string;

  @ApiProperty({
    example: 5,
    description: 'Number of units to reserve. Must be a positive integer.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({
    example: '2026-07-08T12:00:00.000Z',
    description:
      'Optional expiry timestamp (ISO 8601). If set, the reservation is eligible for expiry after this time. Leave null for no expiry.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
