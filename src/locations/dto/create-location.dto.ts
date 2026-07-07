import { IsString, IsNotEmpty, IsInt, IsBoolean, IsArray, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLocationDto {
  @ApiProperty({ example: 'Central Warehouse', description: 'The name of the location' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Bangalore', description: 'The city of the location' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Karnataka', description: 'The state of the location' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({
    example: ['560001', '560002'],
    description: 'List of pincodes this location serves',
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  pincodes: string[];

  @ApiProperty({
    example: 1,
    description: 'Priority of this location (lower number means higher priority)',
  })
  @IsInt()
  @Min(1)
  priority: number;

  @ApiPropertyOptional({ example: true, description: 'Whether the location is currently active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
