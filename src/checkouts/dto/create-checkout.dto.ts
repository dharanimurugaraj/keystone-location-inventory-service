import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-ab12-cd34ef567890',
    description: 'Product ID (UUID)',
  })
  @IsUUID()
  productId!: string;

  @ApiProperty({
    example: 5,
    description: 'Number of units to purchase. Must be a positive integer.',
  })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({
    example: '560001',
    description: 'Delivery pincode — used to match a service-zone warehouse first.',
  })
  @IsString()
  @MinLength(1)
  deliveryPincode!: string;

  @ApiProperty({
    example: 'Bangalore',
    description:
      'Delivery city — used as the first fallback tier when no service-zone warehouse qualifies.',
  })
  @IsString()
  @MinLength(1)
  deliveryCity!: string;

  @ApiProperty({
    example: 'Karnataka',
    description:
      'Delivery state — used as the second fallback tier when no same-city warehouse qualifies.',
  })
  @IsString()
  @MinLength(1)
  deliveryState!: string;
}
