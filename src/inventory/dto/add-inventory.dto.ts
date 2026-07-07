import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddInventoryDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Product ID (UUID)',
  })
  @IsUUID()
  productId: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174001',
    description: 'Location ID (UUID)',
  })
  @IsUUID()
  locationId: string;

  @ApiProperty({ example: 100, description: 'Quantity of stock to add' })
  @IsInt()
  @Min(1)
  quantity: number;
}
